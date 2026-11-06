// Shared workspaces (the backend in cloud/). Workspace models open in the same editor as local ones: their ids carry
// a "cloud:" prefix, and withCloud() routes those to the API while everything else goes to the local storage.
// Each save names the version it was based on; a newer version saved by someone else comes back as CloudConflict,
// which the editor shows with the "changed elsewhere" banner. The open model has a live connection, so others'
// saves arrive within a second and reload through the same path as a file changed on disk.
import type { Proposal } from '../../core';
import type { AgentTools, ModelStorage, Peer } from './types';

export const CLOUD_PREFIX = 'cloud:';
export const isCloudId = (id: string | null | undefined) => !!id && id.startsWith(CLOUD_PREFIX);
const bare = (id: string) => id.slice(CLOUD_PREFIX.length);
const API = '/api/cloud';

export type Role = 'owner' | 'editor' | 'viewer';
export interface CloudUser {
  id: string;
  email: string;
  name: string;
}
export interface WorkspaceRef {
  id: string;
  name: string;
  plan: string;
  role: Role;
}
export interface WorkspaceDetail {
  id: string;
  role: Role;
  members: { id: string; email: string; name: string; role: Role }[];
  models: { id: string; title: string; size: number; updated_at: string }[];
}

/** A save refused because someone saved a newer version; `text` is that version. */
export class CloudConflict extends Error {
  constructor(public text: string) {
    super('Someone else saved a newer version of this model.');
    this.name = 'CloudConflict';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/${path}`, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  return body as T;
}
const send = (method: string, body?: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** An app connected through the hosted MCP server, as the account dialog lists it. */
export interface ConnectedAgent {
  id: string;
  name: string;
  scope: string[];
  created_at: string;
}

export interface CloudClient {
  providers: string[];
  dev: boolean;
  me(): Promise<{ user: CloudUser; workspaces: WorkspaceRef[] } | null>;
  devLogin(email: string): Promise<void>;
  /** Email a one-time sign-in link (when the server offers 'email'). */
  emailLink(email: string, back?: string): Promise<void>;
  signInUrl(provider: string, back?: string): string;
  logout(): Promise<void>;
  /** Download address for everything stored about this account, as JSON. */
  exportUrl: string;
  /** The workspaces this account alone owns, which go with it. */
  deletionPreview(): Promise<{ workspaces: { id: string; name: string; members: number; models: number }[] }>;
  deleteAccount(confirmEmail: string): Promise<void>;
  agents(): Promise<ConnectedAgent[]>;
  revokeAgent(id: string): Promise<void>;
  createWorkspace(name: string): Promise<WorkspaceRef>;
  workspace(id: string): Promise<WorkspaceDetail>;
  addMember(ws: string, email: string, role: Role): Promise<void>;
  removeMember(ws: string, user: string): Promise<void>;
  /** Copy a model's JSON into a workspace. Returns the editor id ("cloud:…"). */
  createModel(ws: string, text: string): Promise<string>;
  deleteModel(id: string): Promise<void>;
}

/** The cloud API, when this site has one. The static site without the cloud Worker answers /api/* with index.html. */
export async function connectCloud(): Promise<CloudClient | null> {
  let info: { providers: string[]; dev: boolean };
  try {
    const res = await fetch(`${API}/auth/providers`, { credentials: 'same-origin' });
    if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return null;
    info = await res.json();
  } catch {
    return null;
  }
  return {
    ...info,
    async me() {
      try {
        return await call('me');
      } catch (e: any) {
        if (e.status === 401) return null;
        throw e;
      }
    },
    devLogin: (email) => call('dev/login', send('POST', { email })),
    emailLink: (email, back = '/') => call('auth/email/start', send('POST', { email, return: back })),
    signInUrl: (provider, back = '/') => `${API}/auth/${provider}/start?return=${encodeURIComponent(back)}`,
    logout: () => call('logout', send('POST')),
    exportUrl: `${API}/me/export`,
    deletionPreview: () => call('me/deletion'),
    deleteAccount: (confirmEmail) => call('me', send('DELETE', { confirm_email: confirmEmail })),
    agents: () => call('me/agents'),
    revokeAgent: (id) => call(`me/agents/${encodeURIComponent(id)}`, send('DELETE')),
    createWorkspace: (name) => call('workspaces', send('POST', { name })),
    workspace: (id) => call(`workspaces/${encodeURIComponent(id)}`),
    addMember: (ws, email, role) => call(`workspaces/${encodeURIComponent(ws)}/members`, send('POST', { email, role })),
    removeMember: (ws, user) => call(`workspaces/${encodeURIComponent(ws)}/members/${encodeURIComponent(user)}`, send('DELETE')),
    async createModel(ws, text) {
      const r = await call<{ id: string }>(`workspaces/${encodeURIComponent(ws)}/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      return CLOUD_PREFIX + r.id;
    },
    deleteModel: (id) => call(`models/${encodeURIComponent(bare(id))}`, send('DELETE')),
  };
}

/** Local storage plus workspace models: "cloud:" ids go to the API, everything else to `base`. */
export function withCloud(base: ModelStorage): ModelStorage {
  const versions = new Map<string, number>();
  const roles = new Map<string, Role>();
  const saving = new Map<string, Promise<unknown>>();
  const listeners = new Set<(id: string) => void>();
  const peerListeners = new Set<(people: Peer[]) => void>();
  const proposalListeners = new Set<(id: string) => void>();
  let peers: Peer[] = [];
  const showPeers = (people: Peer[]) => {
    peers = people;
    peerListeners.forEach((cb) => cb(people));
  };
  let live: { id: string; ws: WebSocket | null; retry: number; timer?: ReturnType<typeof setTimeout>; ping?: ReturnType<typeof setInterval>; you?: string; selection?: string } | null = null;

  /** The other people here, one entry each: someone with two tabs open shows once, with the tab that has a selection. */
  const others = (people: Peer[], you: string | undefined) => {
    const byUser = new Map<string, Peer>();
    for (const p of people) if (p.user !== you && (!byUser.has(p.user) || p.entities.length)) byUser.set(p.user, p);
    return [...byUser.values()];
  };

  const changed = async (id: string, version: number) => {
    // A broadcast of our own save can arrive before the save's response: wait for it, then compare versions.
    await saving.get(id);
    if (version > (versions.get(id) ?? 0)) listeners.forEach((cb) => cb(id));
  };

  const connect = (id: string) => {
    if (live?.id === id) return;
    disconnect();
    const state: NonNullable<typeof live> = { id, ws: null, retry: 0 };
    live = state;
    const open = () => {
      if (live !== state) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API}/models/${encodeURIComponent(bare(id))}/live`);
      state.ws = ws;
      ws.onopen = () => {
        state.retry = 0;
        if (state.selection) ws.send(state.selection);
        // Keeps this person listed, and picks up a save or a departure a dropped message would have announced.
        clearInterval(state.ping);
        state.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 60_000);
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type: string; version?: number; you?: string; people?: Peer[]; role?: Role };
          if (m.type === 'hello') state.you = m.you;
          if (m.type === 'role' && m.role) roles.set(id, m.role);
          // A new role changes which review buttons show, and reloading proposals redraws them.
          if (m.type === 'proposals' || m.type === 'role') proposalListeners.forEach((cb) => cb(id));
          else if (m.type === 'presence') showPeers(others(m.people || [], state.you));
          // "hello" after a reconnect, and "pong", may carry a version saved while we were away.
          else if ((m.type === 'version' || m.type === 'hello' || m.type === 'pong') && m.version) void changed(id, m.version);
        } catch {
          /* not ours */
        }
      };
      ws.onclose = (e) => {
        clearInterval(state.ping);
        if (live !== state) return;
        showPeers([]);
        if (e.code === 4404) return;
        state.timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** state.retry++));
      };
    };
    open();
  };
  const disconnect = () => {
    if (!live) return;
    clearTimeout(live.timer);
    clearInterval(live.ping);
    const ws = live.ws;
    live = null;
    showPeers([]);
    ws?.close(1000);
  };

  // Agents reach workspace models through the hosted MCP server, and their proposals are reviewed here. The Ask panel
  // needs a local Claude, so it stays with local models.
  const local = base.agentTools;
  const agentTools: AgentTools = {
    canRun: local?.canRun ?? false,
    async proposals(id) {
      if (!isCloudId(id)) return local ? local.proposals(id) : [];
      try {
        return await call<Proposal[]>(`models/${encodeURIComponent(bare(id))}/proposals`);
      } catch (e: any) {
        // The site and the Worker deploy separately: a Worker without this route simply has no proposals.
        if (e.status === 404) return [];
        throw e;
      }
    },
    async dismissProposal(id, pid) {
      if (!isCloudId(id)) return local?.dismissProposal(id, pid);
      try {
        await call(`models/${encodeURIComponent(bare(id))}/proposals/${encodeURIComponent(pid)}`, send('DELETE'));
      } catch (e: any) {
        // Someone else reviewed it first.
        if (e.status !== 404) throw e;
      }
    },
    onProposals(cb) {
      proposalListeners.add(cb);
      const off = local?.onProposals(cb);
      return () => {
        proposalListeners.delete(cb);
        off?.();
      };
    },
    canReview: (id) => !isCloudId(id) || roles.get(id) !== 'viewer',
    run: (id, req) => (!isCloudId(id) && local ? local.run(id, req) : Promise.reject(new Error('Ask Claude works on local models. Connect your agent to entitymodel.com/mcp to work on workspace models.'))),
    cancel: (runId) => local?.cancel(runId) ?? Promise.resolve(),
    onAgent: (cb) => local?.onAgent(cb) ?? (() => {}),
  };

  return {
    ...base,
    agentTools,
    async get(id) {
      if (!isCloudId(id)) return base.get(id);
      const r = await call<{ version: number; text: string; role: Role }>(`models/${encodeURIComponent(bare(id))}`);
      versions.set(id, r.version);
      roles.set(id, r.role);
      connect(id);
      return r.text;
    },
    async put(id, text) {
      if (!isCloudId(id)) return base.put(id, text);
      const p = (async () => {
        const res = await fetch(`${API}/models/${encodeURIComponent(bare(id))}`, { method: 'PUT', credentials: 'same-origin', headers: { 'If-Match': `"${versions.get(id) ?? 0}"`, 'Content-Type': 'application/json' }, body: text });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
          // "Keep mine" saves again on top of the version we now know about.
          versions.set(id, body.version);
          throw new CloudConflict(body.text);
        }
        if (!res.ok) throw new Error(body.error || `Save failed (${res.status})`);
        versions.set(id, body.version);
      })();
      saving.set(id, p.catch(() => {}));
      try {
        await p;
      } finally {
        if (saving.get(id)) saving.delete(id);
      }
    },
    presence: {
      onPeople(cb) {
        peerListeners.add(cb);
        // The connection opens while the model loads, so the first update can arrive before the editor is listening.
        cb(peers);
        return () => peerListeners.delete(cb);
      },
      select(id, tab, entities) {
        if (live?.id !== id) return;
        live.selection = JSON.stringify({ type: 'select', tab, entities });
        if (live.ws?.readyState === WebSocket.OPEN) live.ws.send(live.selection);
      },
    },
    versions: {
      list: (id) => call(`models/${encodeURIComponent(bare(id))}/history`),
      text: async (id, version) => (await call<{ text: string }>(`models/${encodeURIComponent(bare(id))}/history/${version}`)).text,
      async restore(id, version) {
        const p = (async () => {
          const res = await fetch(`${API}/models/${encodeURIComponent(bare(id))}/history/${version}/restore`, { method: 'POST', credentials: 'same-origin', headers: { 'If-Match': `"${versions.get(id) ?? 0}"` } });
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            versions.set(id, body.version);
            throw new CloudConflict(body.text);
          }
          if (!res.ok) throw new Error(body.error || `Restore failed (${res.status})`);
          versions.set(id, body.version);
          return body.text as string;
        })();
        // As with a save: our own broadcast can arrive before this response.
        saving.set(id, p.catch(() => {}));
        try {
          return await p;
        } finally {
          saving.delete(id);
        }
      },
      canRestore: (id) => roles.get(id) !== 'viewer',
    },
    release(id) {
      if (live?.id === id) disconnect();
    },
    async create(id, model) {
      if (isCloudId(id)) throw new Error('Create workspace models from the home page.');
      return base.create(id, model);
    },
    onChange(cb) {
      listeners.add(cb);
      const off = base.onChange(cb);
      return () => {
        listeners.delete(cb);
        off();
      };
    },
    // Local-only features (exports to models/, profiling, the Ask panel) don't apply to workspace models.
    saveExport: base.saveExport && ((id, f, d) => (isCloudId(id) ? Promise.reject(new Error('Not for workspace models.')) : base.saveExport!(id, f, d))),
  };
}
