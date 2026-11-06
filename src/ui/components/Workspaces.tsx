import { useDialogs } from '../dialogs';
import { useEffect, useState } from 'react';
import { Cloud, Plus, Trash2, Users } from '../icons';
import type { ModelSummary } from '../../core';
import { cloud, storage } from '../storage';
import { CLOUD_PREFIX, type CloudClient, type CloudUser, type ConnectedAgent, type Role, type WorkspaceDetail, type WorkspaceRef } from '../storage/cloud';
import { useStore } from '../store';
import { Field, Modal, Select, TextInput } from './forms';

const PROVIDER_LABEL: Record<string, string> = { github: 'GitHub', google: 'Google' };
const ROLES: { value: Role; label: string }[] = [
  { value: 'editor', label: 'Editor: can change models' },
  { value: 'viewer', label: 'Viewer: can only look' },
  { value: 'owner', label: 'Owner: also manages members' },
];

type Me = { user: CloudUser; workspaces: WorkspaceRef[] };

/**
 * Shared workspaces on the home page, shown only when the site has the cloud API. Models here are stored on the
 * server and shared with the workspace's members; the models above stay in this browser (or models/ folder).
 */
export function WorkspacesSection({ localModels }: { localModels: ModelSummary[] }) {
  const toast = useStore((s) => s.toast);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [details, setDetails] = useState<Record<string, WorkspaceDetail>>({});
  const [naming, setNaming] = useState<string | null>(null);
  const [members, setMembers] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [linkSentTo, setLinkSentTo] = useState('');

  const load = async () => {
    if (!cloud) return;
    try {
      const m = await cloud.me();
      setMe(m);
      if (m) setDetails(Object.fromEntries(await Promise.all(m.workspaces.map(async (w) => [w.id, await cloud!.workspace(w.id)] as const))));
    } catch (e: any) {
      toast(`Workspaces: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    // A failed sign-in comes back as ?signin_error=…
    const params = new URLSearchParams(location.search);
    const err = params.get('signin_error');
    if (err) {
      toast(err, 'error');
      params.delete('signin_error');
      history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cloud) return null;
  const c = cloud;
  const run = (what: string, fn: () => Promise<unknown>) => fn().catch((e: any) => toast(`${what}: ${e.message}`, 'error'));

  const copyIn = (ws: WorkspaceRef, localId: string) =>
    run('Could not add the model', async () => {
      const id = await c.createModel(ws.id, await storage.get(localId));
      await load();
      toast(`Copied to ${ws.name}. The copy in ${storage.kind === 'files' ? 'models/' : 'this browser'} is unchanged.`, 'success');
      return id;
    });

  return (
    <>
      <h2 className="home-section">
        <Cloud size={16} /> Shared workspaces
        {me && (
          <span className="muted small ws-account">
            {me.user.email} ·{' '}
            <button className="link" onClick={() => setAccount(true)}>
              Account
            </button>{' '}
            ·{' '}
            <button className="link" onClick={() => run('Sign out failed', async () => (await c.logout(), setMe(null)))}>
              Sign out
            </button>
          </span>
        )}
      </h2>

      <p className="muted small home-note">
        Connect Claude, Codex or another AI agent to your workspace models.{' '}
        <button className="link" onClick={() => useDialogs.getState().open({ agents: true })}>
          Show me how
        </button>
      </p>

      {me === null && (
        <div className="ws-signin">
          <p className="muted small home-note">Work on models with your team: members see each other's changes within a second. Workspace models are stored on the server; the models above stay where they are.</p>
          <div className="ws-actions">
            {c.providers.filter((p) => p !== 'email').map((p) => (
              <a key={p} className="btn" href={c.signInUrl(p, '/')}>
                Sign in with {PROVIDER_LABEL[p] || p}
              </a>
            ))}
            {c.providers.includes('email') &&
              (linkSentTo ? (
                <span className="muted small">
                  Check {linkSentTo} for a sign-in link. It works once, for 15 minutes.{' '}
                  <button className="link" onClick={() => setLinkSentTo('')}>
                    Use another address
                  </button>
                </span>
              ) : (
                <form
                  className="ws-actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const to = email.trim();
                    run('Could not send the link', async () => (await c.emailLink(to, '/'), setLinkSentTo(to)));
                  }}
                >
                  <TextInput value={email} onChange={setEmail} placeholder="you@example.com" />
                  <button className="btn" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>
                    Email me a link
                  </button>
                </form>
              ))}
            {c.dev && !c.providers.includes('email') && (
              <form
                className="ws-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  run('Sign-in failed', async () => (await c.devLogin(email), load()));
                }}
              >
                <TextInput value={email} onChange={setEmail} placeholder="you@example.com" />
                <button className="btn" disabled={!email.includes('@')}>
                  Sign in (development)
                </button>
              </form>
            )}
            {!c.providers.length && !c.dev && <span className="muted small">Sign-in isn't set up on this server yet.</span>}
          </div>
        </div>
      )}

      {me?.workspaces.map((ws) => {
        const d = details[ws.id];
        const canEdit = ws.role !== 'viewer';
        return (
          <section key={ws.id} className="ws-block">
            <div className="ws-head">
              <h3>{ws.name}</h3>
              <span className="pill">{ws.role}</span>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => setMembers(ws.id)}>
                <Users size={14} /> {d ? `${d.members.length} member${d.members.length === 1 ? '' : 's'}` : 'Members'}
              </button>
              {canEdit && localModels.length > 0 && (
                <Select<string> className="ws-add" value="" placeholder="Add a model…" onChange={(id) => copyIn(ws, id)} options={localModels.filter((m) => !m.error).map((m) => ({ value: m.id, label: m.title }))} />
              )}
            </div>
            <div className="model-grid">
              {d?.models.map((m) => (
                <div key={m.id} className="model-card-wrap">
                  <button className="model-card" onClick={() => useStore.getState().openModel(CLOUD_PREFIX + m.id).catch((e) => toast(e.message, 'error'))}>
                    <div className="mc-title">{m.title}</div>
                    <div className="mc-foot">
                      <span className="muted small">{new Date(m.updated_at).toLocaleString()}</span>
                    </div>
                  </button>
                  {ws.role === 'owner' && (
                    <button
                      className="icon-btn danger model-delete"
                      title="Delete from the workspace"
                      onClick={() => window.confirm(`Delete "${m.title}" from ${ws.name} for everyone? This cannot be undone.`) && run('Delete failed', async () => (await c.deleteModel(CLOUD_PREFIX + m.id), load()))}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {d && !d.models.length && <p className="muted small">{canEdit ? 'No models yet. Add one from your models with “Add a model…”.' : 'No models yet.'}</p>}
            </div>
          </section>
        );
      })}

      {me && (
        <button className="btn sm" onClick={() => setNaming('')}>
          <Plus size={14} /> New workspace
        </button>
      )}

      {naming !== null && (
        <Modal
          title="New workspace"
          onClose={() => setNaming(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setNaming(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={!naming.trim()} onClick={() => run('Could not create the workspace', async () => (await c.createWorkspace(naming.trim()), setNaming(null), load()))}>
                Create
              </button>
            </>
          }
        >
          <Field label="Name">
            <TextInput autoFocus value={naming} onChange={setNaming} placeholder="Data team" />
          </Field>
        </Modal>
      )}

      {account && me && (
        <AccountDialog
          me={me.user}
          onClose={() => setAccount(false)}
          onDeleted={() => {
            setAccount(false);
            setMe(null);
            setDetails({});
            toast('Your account is deleted. Models in this browser are unchanged.', 'success');
          }}
        />
      )}

      {members && me && details[members] && <MembersDialog ws={me.workspaces.find((w) => w.id === members)!} detail={details[members]} me={me.user} onClose={() => setMembers(null)} onChanged={load} />}
    </>
  );
}

function AccountDialog({ me, onClose, onDeleted }: { me: CloudUser; onClose: () => void; onDeleted: () => void }) {
  const toast = useStore((s) => s.toast);
  const c = cloud!;
  const [going, setGoing] = useState<{ id: string; name: string; members: number; models: number }[] | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    c.deletionPreview()
      .then((r) => setGoing(r.workspaces))
      .catch((e: any) => toast(`Account: ${e.message}`, 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = typed.trim().toLowerCase() === me.email.toLowerCase();
  const remove = () => {
    setBusy(true);
    c.deleteAccount(typed.trim())
      .then(onDeleted)
      .catch((e: any) => {
        setBusy(false);
        toast(`Could not delete the account: ${e.message}`, 'error');
      });
  };
  return (
    <Modal
      title="Your account"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="stack">
        <ConnectedAgents c={c} />
        <div>
          <h3 className="ws-account-title">Download your data</h3>
          <p className="muted small ws-account-text">One JSON file with your account details, your connected agents, and the current version of every model in your workspaces, with its pending proposals.</p>
          <a className="btn sm" href={c.exportUrl} download>
            Download my data
          </a>
        </div>
        <div>
          <h3 className="ws-account-title">Delete your account</h3>
          <p className="muted small ws-account-text">This removes your sign-in details and your memberships, and can't be undone. Models in this browser aren't affected. Workspaces with another owner carry on, with their models.</p>
          {going === null ? (
            <p className="muted small ws-account-text">Checking your workspaces…</p>
          ) : going.length ? (
            <>
              <p className="small ws-account-text">You're the only owner of these workspaces, so they will be deleted, with their models, for everyone in them:</p>
              <ul className="ws-members ws-going">
                {going.map((w) => (
                  <li key={w.id}>
                    <span>{w.name}</span>
                    <span className="muted small">
                      {w.models} model{w.models === 1 ? '' : 's'}, {w.members} member{w.members === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small ws-account-text">To keep one, close this and make another member its owner first.</p>
            </>
          ) : (
            <p className="muted small ws-account-text">You aren't the only owner of any workspace, so none will be deleted.</p>
          )}
          <Field label={`Type ${me.email} to confirm`}>
            <TextInput value={typed} onChange={setTyped} placeholder={me.email} />
          </Field>
          <button className="btn danger ws-account-delete" disabled={!matches || going === null || busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MembersDialog({ ws, detail, me, onClose, onChanged }: { ws: WorkspaceRef; detail: WorkspaceDetail; me: CloudUser; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useStore((s) => s.toast);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const owner = ws.role === 'owner';
  const c = cloud!;
  const run = (what: string, fn: () => Promise<unknown>) => fn().then(onChanged).catch((e: any) => toast(`${what}: ${e.message}`, 'error'));
  return (
    <Modal
      title={
        <>
          <Users size={16} /> {ws.name}: members
        </>
      }
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="stack">
        <ul className="ws-members">
          {detail.members.map((m) => (
            <li key={m.id}>
              <span>
                {m.name || m.email} {m.name && <span className="muted small">{m.email}</span>}
              </span>
              <span className="pill">{m.role}</span>
              {(owner || m.id === me.id) && (
                <button className="btn xs ghost" onClick={() => run('Could not remove', () => c.removeMember(ws.id, m.id))}>
                  {m.id === me.id ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && (
          <>
            <Field label="Add someone" hint="They need to have signed in once.">
              <TextInput value={email} onChange={setEmail} placeholder="colleague@example.com" />
            </Field>
            <Field label="Role">
              <Select<Role> value={role} onChange={setRole} options={ROLES} />
            </Field>
            <div>
              <button className="btn primary" disabled={!email.includes('@')} onClick={() => run('Could not add', async () => (await c.addMember(ws.id, email.trim(), role), setEmail('')))}>
                Add member
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const ACCESS: Record<string, string> = { 'models:apply': 'can change models directly', 'models:propose': 'can suggest changes', 'models:read': 'can read models' };

/** Apps connected through the hosted MCP server. Disconnecting ends their access at once. */
function ConnectedAgents({ c }: { c: CloudClient }) {
  const toast = useStore((s) => s.toast);
  const [agents, setAgents] = useState<ConnectedAgent[] | null>(null);
  useEffect(() => {
    c.agents()
      .then(setAgents)
      // A Worker older than this page has no such route: show none rather than an error.
      .catch(() => setAgents([]));
  }, [c]);
  const disconnect = (a: ConnectedAgent) =>
    c
      .revokeAgent(a.id)
      .then(() => setAgents((list) => (list || []).filter((x) => x.id !== a.id)))
      .catch((e: any) => toast(`Could not disconnect ${a.name}: ${e.message}`, 'error'));
  return (
    <div>
      <h3 className="ws-account-title">Connected agents</h3>
      <p className="muted small ws-account-text">
        Apps you connected at <code>entitymodel.com/mcp</code>. They act as you in your workspaces. <a href="/docs/mcp-server/">How this works</a>
      </p>
      {agents === null ? (
        <p className="muted small ws-account-text">Loading…</p>
      ) : agents.length ? (
        <ul className="ws-members">
          {agents.map((a) => (
            <li key={a.id}>
              <span>{a.name}</span>
              <span className="muted small">{ACCESS[['models:apply', 'models:propose', 'models:read'].find((s) => a.scope.includes(s)) || 'models:read']}</span>
              <button className="btn sm ghost" onClick={() => disconnect(a)}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small ws-account-text">None.</p>
      )}
    </div>
  );
}
