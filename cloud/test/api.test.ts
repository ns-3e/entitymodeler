import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://entitymodel.com';
const model = (title: string, n = 1) => JSON.stringify({ title, entities: Array.from({ length: n }, (_, i) => ({ name: `e${i}`, attributes: [] })) });

/** A signed-in browser: keeps its session cookie and sends our Origin. */
async function as(email: string) {
  const call = (path: string, init: RequestInit = {}, cookie = '') =>
    exports.default.fetch(`https://entitymodel.com/api/cloud/${path}`, { ...init, headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers as Record<string, string>) } });
  const login = await call('dev/login', { method: 'POST', body: JSON.stringify({ email }) });
  expect(login.status).toBe(200);
  const setCookie = login.headers.get('Set-Cookie')!;
  expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  const session = setCookie.split(';')[0];
  const req = (path: string, init: RequestInit = {}) => call(path, init, session);
  const get = async <T = any>(path: string) => (await (await req(path)).json()) as T;
  return { req, get, session };
}

async function workspaceWithModel(owner: Awaited<ReturnType<typeof as>>, name = 'Data team') {
  const ws = (await (await owner.req('workspaces', { method: 'POST', body: JSON.stringify({ name }) })).json()) as { id: string };
  const m = (await (await owner.req(`workspaces/${ws.id}/models`, { method: 'POST', body: model('Sales') })).json()) as { id: string; version: number };
  return { ws: ws.id, model: m.id };
}

describe('cloud workspaces API', () => {
  it('needs a session, and changes only from allowed origins', async () => {
    expect((await exports.default.fetch('https://entitymodel.com/api/cloud/me')).status).toBe(401);
    const ada = await as('ada@example.com');
    const evil = await exports.default.fetch('https://entitymodel.com/api/cloud/workspaces', { method: 'POST', body: '{"name":"x"}', headers: { Origin: 'https://evil.example', Cookie: ada.session } });
    expect(evil.status).toBe(403);
    expect((await ada.get('me')).user.email).toBe('ada@example.com');
  });

  it('saves only on top of the current version, and returns the newer one on a conflict', async () => {
    const ada = await as('ada2@example.com');
    const { model: id } = await workspaceWithModel(ada);
    const first = await ada.get(`models/${id}`);
    expect(first).toMatchObject({ version: 1, role: 'owner' });
    const save = (base: number, text: string) => ada.req(`models/${id}`, { method: 'PUT', body: text, headers: { 'If-Match': `"${base}"` } });
    expect(await (await save(1, model('Sales v2', 2))).json()).toEqual({ version: 2 });
    // A second tab still on version 1:
    const stale = await save(1, model('Lost update'));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 2, text: model('Sales v2', 2) });
    expect((await save(2, '{"title":"no entities"}')).status).toBe(400);
    expect((await ada.req(`models/${id}`, { method: 'PUT', body: model('x') })).status).toBe(428);
    expect((await ada.get(`models/${id}/history`)).map((h: { version: number }) => h.version)).toEqual([2, 1]);
    // The workspace list follows the title in the file.
    const ws = await ada.get(`workspaces/${(await ada.get('me')).workspaces[0].id}`);
    expect(ws.models[0]).toMatchObject({ id, title: 'Sales v2' });
  });

  it('enforces roles, and hides workspaces from non-members', async () => {
    const owner = await as('owner@example.com');
    const viewer = await as('viewer@example.com');
    const stranger = await as('stranger@example.com');
    const { ws, model: id } = await workspaceWithModel(owner);
    expect((await stranger.req(`models/${id}`)).status).toBe(404);
    expect((await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: 'nobody@example.com' }) })).status).toBe(404);
    expect((await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: 'viewer@example.com', role: 'viewer' }) })).status).toBe(200);
    expect((await viewer.get(`models/${id}`)).role).toBe('viewer');
    const put = await viewer.req(`models/${id}`, { method: 'PUT', body: model('x'), headers: { 'If-Match': '1' } });
    expect(put.status).toBe(403);
    expect((await viewer.req(`models/${id}`, { method: 'DELETE' })).status).toBe(403);
    // The last owner can't leave.
    const me = (await owner.get('me')).user.id;
    expect((await owner.req(`workspaces/${ws}/members/${me}`, { method: 'DELETE' })).status).toBe(409);
    expect((await owner.req(`models/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await owner.req(`models/${id}`)).status).toBe(404);
  });

  it('limits workspaces per user', async () => {
    const u = await as('busy@example.com');
    for (let i = 0; i < 3; i++) expect((await u.req('workspaces', { method: 'POST', body: JSON.stringify({ name: `W${i}` }) })).status).toBe(201);
    const fourth = await u.req('workspaces', { method: 'POST', body: JSON.stringify({ name: 'W4' }) });
    expect(fourth.status).toBe(403);
  });

  it('pushes each new version to everyone who has the model open', async () => {
    const ada = await as('live@example.com');
    const { model: id } = await workspaceWithModel(ada);
    const res = await ada.req(`models/${id}/live`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const messages: any[] = [];
    const next = () => new Promise<any>((resolve) => ws.addEventListener('message', (e) => resolve(JSON.parse(e.data as string)), { once: true }));
    ws.accept();
    let pending = next();
    messages.push(await pending);
    expect(messages[0]).toEqual({ type: 'hello', version: 1 });
    pending = next();
    await ada.req(`models/${id}`, { method: 'PUT', body: model('Pushed'), headers: { 'If-Match': '1' } });
    expect(await pending).toMatchObject({ type: 'version', version: 2, text: model('Pushed') });
    ws.close();
  });
});
