import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailer } from '../src/email';

const base = 'https://entitymodel.com/api/cloud';
const ORIGIN = 'https://entitymodel.com';
const model = (title: string) => JSON.stringify({ title, entities: [{ name: 'e', attributes: [] }] });

async function as(email: string) {
  const login = await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email }), headers: { Origin: ORIGIN } });
  expect(login.status).toBe(200);
  const session = login.headers.get('Set-Cookie')!.split(';')[0];
  const req = (path: string, init: RequestInit = {}) => exports.default.fetch(`${base}/${path}`, { ...init, headers: { Origin: ORIGIN, Cookie: session, ...(init.headers as Record<string, string>) } });
  const send = async <T = any>(path: string, method: string, body?: string) => {
    const res = await req(path, { method, body });
    expect(res.status, `${method} ${path}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  const id = (await send<{ user: { id: string } }>('me', 'GET')).user.id;
  return { req, send, id, email };
}
type Person = Awaited<ReturnType<typeof as>>;
const workspace = async (p: Person, name: string) => (await p.send<{ id: string }>('workspaces', 'POST', JSON.stringify({ name }))).id;
const addModel = async (p: Person, ws: string, title: string) => (await p.send<{ id: string }>(`workspaces/${ws}/models`, 'POST', model(title))).id;
const addMember = (p: Person, ws: string, q: Person, role: string) => p.send(`workspaces/${ws}/members`, 'POST', JSON.stringify({ email: q.email, role }));
const remove = (p: Person, confirm = p.email) => p.req('me', { method: 'DELETE', body: JSON.stringify({ confirm_email: confirm }) });
const count = async (sql: string, ...args: string[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

afterEach(() => vi.restoreAllMocks());

describe('download my data', () => {
  it('returns the account and the full model of every workspace, as valid JSON', async () => {
    const ada = await as('export@example.com');
    const ws = await workspace(ada, 'Team');
    await addModel(ada, ws, 'Sales');
    await addModel(ada, ws, 'Finance');
    const other = await as('export-other@example.com');
    await addModel(other, await workspace(other, 'Private'), 'Not yours');

    const res = await ada.req('me/export');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="entitymodel-export-/);
    const data = (await res.json()) as any;
    expect(data.account).toMatchObject({ id: ada.id, email: ada.email });
    expect(data.sign_ins).toMatchObject([{ provider: 'email' }]);
    expect(data.workspaces).toMatchObject([{ id: ws, name: 'Team', role: 'owner' }]);
    expect(data.models.map((m: any) => m.title).sort()).toEqual(['Finance', 'Sales']);
    expect(data.models[0]).toMatchObject({ workspace_id: ws, version: 1 });
    expect(data.models[0].model.entities).toEqual([{ name: 'e', attributes: [] }]);
  });

  it('works with no workspaces, and needs a session', async () => {
    const ada = await as('export-empty@example.com');
    expect(await (await ada.req('me/export')).json()).toMatchObject({ workspaces: [], models: [] });
    expect((await exports.default.fetch(`${base}/me/export`)).status).toBe(401);
  });
});

describe('delete my account', () => {
  it('needs the email typed, and another site cannot do it', async () => {
    const ada = await as('confirm@example.com');
    expect((await remove(ada, 'wrong@example.com')).status).toBe(400);
    expect((await exports.default.fetch(`${base}/me`, { method: 'DELETE', body: JSON.stringify({ confirm_email: ada.email }), headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await ada.req('me')).status).toBe(200);
  });

  it('removes all personal rows and ends the session', async () => {
    const ada = await as('gone@example.com');
    await env.DB.prepare('INSERT INTO email_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').bind('h1', 'GONE@example.com', '2026-01-01', '2099-01-01').run();
    const res = await remove(ada);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/^em_session=; .*Max-Age=0/);
    expect((await ada.req('me')).status).toBe(401);
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE email = ?', ada.email)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM identities WHERE user_id = ?', ada.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', ada.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM email_links WHERE email = ?', ada.email)).toBe(0);
  });

  it('deletes workspaces it alone owns, for everyone, with their model contents', async () => {
    const owner = await as('sole@example.com');
    const editor = await as('sole-editor@example.com');
    const ws = await workspace(owner, 'Mine');
    const id = await addModel(owner, ws, 'Sales');
    await addMember(owner, ws, editor, 'editor');
    expect(await owner.send('me/deletion', 'GET')).toEqual({ workspaces: [{ id: ws, name: 'Mine', members: 2, models: 1 }] });

    expect((await remove(owner)).status).toBe(200);
    expect((await editor.req(`models/${id}`)).status).toBe(404);
    expect((await editor.send('me', 'GET')).workspaces).toEqual([]);
    expect(await count('SELECT COUNT(*) AS n FROM models WHERE id = ?', id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM workspaces WHERE id = ?', ws)).toBe(0);
    expect(await env.MODEL.get(env.MODEL.idFromName(id)).read()).toBeNull();
  });

  it('leaves workspaces with another owner running, and no trace of who made them', async () => {
    const maker = await as('maker@example.com');
    const other = await as('co-owner@example.com');
    const ws = await workspace(maker, 'Shared');
    const id = await addModel(maker, ws, 'Sales');
    await addMember(maker, ws, other, 'owner');
    expect(await maker.send('me/deletion', 'GET')).toEqual({ workspaces: [] });

    expect((await remove(maker)).status).toBe(200);
    expect(await other.send(`models/${id}`, 'GET')).toMatchObject({ version: 1 });
    expect((await other.send(`workspaces/${ws}`, 'GET')).members.map((m: any) => m.email)).toEqual([other.email]);
    expect(await count('SELECT COUNT(*) AS n FROM workspaces WHERE created_by = ?', maker.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM models WHERE created_by = ? OR updated_by = ?', maker.id, maker.id)).toBe(0);
    // The workspace still saves after its creator is gone.
    expect((await other.req(`models/${id}`, { method: 'PUT', body: model('Next'), headers: { 'If-Match': '1' } })).status).toBe(200);
  });

  it('removes a member who only edited, without touching the workspace', async () => {
    const owner = await as('keeper@example.com');
    const editor = await as('leaver@example.com');
    const ws = await workspace(owner, 'Team');
    const id = await addModel(owner, ws, 'Sales');
    await addMember(owner, ws, editor, 'editor');
    await editor.send(`models/${id}`, 'GET');
    expect((await editor.req(`models/${id}`, { method: 'PUT', body: model('Edited'), headers: { 'If-Match': '1' } })).status).toBe(200);
    expect((await remove(editor)).status).toBe(200);
    expect(await owner.send(`models/${id}`, 'GET')).toMatchObject({ version: 2 });
  });

  it('allows a fresh start with the same email', async () => {
    const first = await as('again@example.com');
    await remove(first);
    const second = await as('again@example.com');
    expect(second.id).not.toBe(first.id);
  });
});

describe('losing access', () => {
  it('closes the live connection of a removed member and of a deleted account', async () => {
    const owner = await as('live-owner@example.com');
    const a = await as('live-a@example.com');
    const b = await as('live-b@example.com');
    const ws = await workspace(owner, 'Live');
    const id = await addModel(owner, ws, 'Sales');
    await addMember(owner, ws, a, 'viewer');
    await addMember(owner, ws, b, 'viewer');
    const open = async (p: Person) => {
      const s = (await p.req(`models/${id}/live`, { headers: { Upgrade: 'websocket' } })).webSocket!;
      const closed = new Promise<number>((resolve) => s.addEventListener('close', (e) => resolve(e.code)));
      s.accept();
      return { closed };
    };
    const aClosed = await open(a);
    const bClosed = await open(b);
    await owner.send(`workspaces/${ws}/members/${a.id}`, 'DELETE');
    expect(await aClosed.closed).toBe(4404);
    expect((await remove(b)).status).toBe(200);
    expect(await bClosed.closed).toBe(4404);
  });
});

describe('suspended accounts', () => {
  const suspend = (email: string) => env.DB.prepare('UPDATE users SET suspended_at = ? WHERE email = ?').bind('2026-11-04', email).run();

  it('are locked out, get no sign-in email, and cannot be added to a workspace', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue(undefined as never);
    const bad = await as('bad@example.com');
    const owner = await as('bad-owner@example.com');
    await suspend(bad.email);
    expect((await bad.req('me')).status).toBe(401);
    const start = await exports.default.fetch(`${base}/auth/email/start`, { method: 'POST', body: JSON.stringify({ email: bad.email }), headers: { Origin: ORIGIN } });
    expect(start.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    const login = await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email: bad.email }), headers: { Origin: ORIGIN } });
    expect(login.status).toBe(403);
    const ws = await workspace(owner, 'Team');
    expect((await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: bad.email }) })).status).toBe(404);
  });

  it('a link sent before the suspension does not sign in', async () => {
    vi.spyOn(mailer, 'send').mockImplementation(async (_e, m) => void (link = m.link));
    let link = '';
    await as('late@example.com');
    await exports.default.fetch(`${base}/auth/email/start`, { method: 'POST', body: JSON.stringify({ email: 'late@example.com' }), headers: { Origin: ORIGIN } });
    await suspend('late@example.com');
    const form = new FormData();
    form.set('token', new URL(link).searchParams.get('token')!);
    const res = await exports.default.fetch(`${base}/auth/email/verify`, { method: 'POST', body: form, redirect: 'manual', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toMatch(/signin_error=.*suspended/);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('the placeholder for deleted accounts cannot be added or signed in', async () => {
    const owner = await as('placeholder@example.com');
    const ws = await workspace(owner, 'Team');
    expect((await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: 'deleted-account.invalid' }) })).status).toBe(404);
    expect((await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email: 'deleted-account.invalid' }), headers: { Origin: ORIGIN } })).status).toBe(400);
  });
});
