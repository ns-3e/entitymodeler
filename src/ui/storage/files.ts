// Dev-server API (src/server/api.ts) over models/<id>/model.json.
import type { GlossaryTerm, ModelSummary, Proposal } from '../../core';
import type { AgentEvent, ModelStorage } from './types';

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      msg = (await r.json()).error || msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return r.json();
}

const modelUrl = (id: string) => `/api/models/${encodeURIComponent(id)}`;

/** The files backend, or null when no dev-server API answers (static hosting, vite preview). */
export async function connectFiles(): Promise<ModelStorage | null> {
  let modelsDir: string;
  let canRun = false;
  try {
    const r = await fetch('/api/info');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('application/json')) return null;
    const info = await r.json();
    modelsDir = info.modelsDir;
    canRun = !!info.agent;
  } catch {
    return null;
  }
  const hot = <T,>(event: string, cb: (data: T) => void) => {
    import.meta.hot?.on(event, cb);
    return () => import.meta.hot?.off(event, cb);
  };
  return {
    kind: 'files',
    location: modelsDir,
    list: () => fetch('/api/models').then((r) => json<ModelSummary[]>(r)),
    async get(id) {
      const r = await fetch(modelUrl(id));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Could not open model ${id}`);
      return r.text();
    },
    async put(id, text) {
      await fetch(modelUrl(id), { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } }).then((r) => json(r));
    },
    async create(id, model) {
      await fetch('/api/models', { method: 'POST', body: JSON.stringify({ id, model }), headers: { 'Content-Type': 'application/json' } }).then((r) => json(r));
    },
    async saveExport(id, filename, data) {
      const r = await fetch(`${modelUrl(id)}/exports/${encodeURIComponent(filename)}`, { method: 'POST', body: data as BodyInit });
      return (await json<{ path: string }>(r)).path;
    },
    onChange(cb) {
      return hot<{ id: string }>('em:changed', ({ id }) => cb(id));
    },
    glossary: {
      get: () => fetch('/api/glossary').then((r) => json<GlossaryTerm[]>(r)),
      async put(terms) {
        await fetch('/api/glossary', { method: 'PUT', body: JSON.stringify(terms), headers: { 'Content-Type': 'application/json' } }).then((r) => json(r));
      },
      onChange: (cb) => hot('em:glossary', () => cb()),
    },
    async profile(id, req) {
      const r = await fetch(`${modelUrl(id)}/profile`, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } });
      return json(r);
    },
    async writebackPlan(id, req) {
      const r = await fetch(`${modelUrl(id)}/writeback-plan`, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } });
      return json(r);
    },
    agentTools: {
      canRun,
      proposals: (id) => fetch(`${modelUrl(id)}/proposals`).then((r) => json<Proposal[]>(r)),
      async dismissProposal(id, pid) {
        await fetch(`${modelUrl(id)}/proposals/${encodeURIComponent(pid)}`, { method: 'DELETE' });
      },
      onProposals: (cb) => hot<{ id: string }>('em:proposals', ({ id }) => cb(id)),
      async run(id, req) {
        const r = await fetch(`${modelUrl(id)}/agent`, { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } });
        return (await json<{ runId: string }>(r)).runId;
      },
      async cancel(runId) {
        await fetch(`/api/agent/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
      },
      onAgent: (cb) => hot<AgentEvent>('em:agent', cb),
    },
  };
}
