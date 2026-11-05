import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const base = 'https://entitymodel.com/api/cloud';
const ORIGIN = 'https://entitymodel.com';
const model = (title: string) => JSON.stringify({ title, entities: [{ name: 'e', attributes: [] }] });

async function as(email: string, name = '') {
  const login = await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email, name }), headers: { Origin: ORIGIN } });
  const session = login.headers.get('Set-Cookie')!.split(';')[0];
  const req = (path: string, init: RequestInit = {}) => exports.default.fetch(`${base}/${path}`, { ...init, headers: { Origin: ORIGIN, Cookie: session, ...(init.headers as Record<string, string>) } });
  const id = ((await (await req('me')).json()) as any).user.id as string;
  return { req, id, email, get: async (path: string) => (await (await req(path)).json()) as any };
}
type Person = Awaited<ReturnType<typeof as>>;

async function setup(owner: Person) {
  const ws = ((await (await owner.req('workspaces', { method: 'POST', body: JSON.stringify({ name: 'Team' }) })).json()) as any).id as string;
  const id = ((await (await owner.req(`workspaces/${ws}/models`, { method: 'POST', body: model('First') })).json()) as any).id as string;
  return { ws, id };
}
const save = (p: Person, id: string, baseVersion: number, title: string) => p.req(`models/${id}`, { method: 'PUT', body: model(title), headers: { 'If-Match': `"${baseVersion}"` } });
const restore = (p: Person, id: string, version: number, on?: number) => p.req(`models/${id}/history/${version}/restore`, { method: 'POST', headers: on ? { 'If-Match': `"${on}"` } : {} });
const add = (owner: Person, ws: string, p: Person, role: string) => owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: p.email, role }) });

describe('version history', () => {
  it('lists versions with who saved them, and reads an old one', async () => {
    const ada = await as('h-ada@example.com', 'Ada');
    const bob = await as('h-bob@example.com');
    const { ws, id } = await setup(ada);
    await add(ada, ws, bob, 'editor');
    expect((await save(bob, id, 1, 'Second')).status).toBe(200);
    expect(await ada.get(`models/${id}/history`)).toMatchObject([
      { version: 2, by: 'h-bob@example.com' },
      { version: 1, by: 'Ada' },
    ]);
    expect(await ada.get(`models/${id}/history/1`)).toEqual({ version: 1, text: model('First') });
    expect((await ada.req(`models/${id}/history/9`)).status).toBe(404);
    expect((await ada.req(`models/${id}/history/abc`)).status).toBe(404);
  });

  it('no longer names someone who has left', async () => {
    const ada = await as('h-left@example.com', 'Ada');
    const bob = await as('h-leaver@example.com', 'Bob');
    const { ws, id } = await setup(ada);
    await add(ada, ws, bob, 'editor');
    await save(bob, id, 1, 'Second');
    await bob.req(`workspaces/${ws}/members/${bob.id}`, { method: 'DELETE' });
    const list = await ada.get(`models/${id}/history`);
    expect(list[0]).toMatchObject({ version: 2, by: null });
    expect(list[0].saved_by).toBeUndefined();
  });

  it('restores an old version as a new one, updating the title and everyone connected', async () => {
    const ada = await as('h-restore@example.com');
    const { ws, id } = await setup(ada);
    await save(ada, id, 1, 'Second');
    const socket = (await ada.req(`models/${id}/live`, { headers: { Upgrade: 'websocket' } })).webSocket!;
    const pushed = new Promise<any>((resolve) => socket.addEventListener('message', (e) => JSON.parse(e.data as string).type === 'version' && resolve(JSON.parse(e.data as string))));
    socket.accept();

    const res = await restore(ada, id, 1, 2);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 3, text: model('First') });
    expect(await pushed).toMatchObject({ type: 'version', version: 3, text: model('First') });
    socket.close();
    expect((await ada.get(`models/${id}`)).text).toBe(model('First'));
    expect((await ada.get(`models/${id}/history`)).map((h: any) => h.version)).toEqual([3, 2, 1]);
    expect((await ada.get(`workspaces/${ws}`)).models[0].title).toBe('First');
  });

  it('refuses a restore on a stale version, returning the newer one', async () => {
    const ada = await as('h-stale@example.com');
    const { id } = await setup(ada);
    await save(ada, id, 1, 'Second');
    const res = await restore(ada, id, 1, 1);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ version: 2, text: model('Second') });
    expect((await restore(ada, id, 1)).status).toBe(428);
    expect((await restore(ada, id, 9, 2)).status).toBe(404);
  });

  it('lets viewers read history but not restore, and hides it from strangers', async () => {
    const ada = await as('h-owner@example.com');
    const viewer = await as('h-viewer@example.com');
    const stranger = await as('h-stranger@example.com');
    const { ws, id } = await setup(ada);
    await save(ada, id, 1, 'Second');
    await add(ada, ws, viewer, 'viewer');
    expect((await viewer.req(`models/${id}/history/1`)).status).toBe(200);
    expect((await restore(viewer, id, 1, 2)).status).toBe(403);
    expect((await stranger.req(`models/${id}/history`)).status).toBe(404);
    expect((await stranger.req(`models/${id}/history/1`)).status).toBe(404);
    expect((await stranger.req(`models/${id}/history/1/restore`, { method: 'POST', headers: { 'If-Match': '"2"' } })).status).toBe(404);
  });

  it('keeps the latest saves plus the last of each hour, and frees what it drops', async () => {
    const stub = env.MODEL.get(env.MODEL.newUniqueId());
    await stub.create(model('v1'), 'u');
    // 60 saves, the first 40 of them an hour apart, oldest first.
    const backdate = (hour: number) =>
      runInDurableObject(stub, (_i, state) => {
        state.storage.sql.exec('UPDATE versions SET saved_at = ? WHERE version = (SELECT MAX(version) FROM versions)', new Date(Date.UTC(2026, 0, 1, hour)).toISOString());
      });
    await backdate(0);
    for (let v = 1; v < 60; v++) {
      expect(await stub.write(v, model(`v${v + 1}`), 'u', 1000)).toMatchObject({ ok: true });
      if (v < 40) await backdate(v);
    }
    const kept = (await stub.history()).map((h) => h.version);
    // The latest 20 (41–60); the 20 saved just now share one hour, so 29 older hourly slots remain: versions 12–40.
    expect(kept).toEqual(Array.from({ length: 49 }, (_, i) => 60 - i));
    expect(await stub.readVersion(12)).toBe(model('v12'));
    expect(await stub.readVersion(11)).toBeNull();
    const chunks = await runInDurableObject(stub, (_i, state) => state.storage.sql.exec<{ n: number }>('SELECT COUNT(DISTINCT version) AS n FROM chunks').one().n);
    expect(chunks).toBe(49);
  });

  it('keeps fewer hourly versions of a large model', async () => {
    const stub = env.MODEL.get(env.MODEL.newUniqueId());
    const big = (n: number) => JSON.stringify({ title: `v${n}`, pad: 'x'.repeat(1_100_000), entities: [] });
    await stub.create(big(1), 'u');
    for (let v = 1; v < 30; v++) {
      await stub.write(v, big(v + 1), 'u', 1000);
      await runInDurableObject(stub, (_i, state) => {
        state.storage.sql.exec('UPDATE versions SET saved_at = ? WHERE version = ?', new Date(Date.UTC(2026, 0, 1, v)).toISOString(), v + 1);
      });
    }
    const kept = (await stub.history()).map((h) => h.version);
    expect(Math.max(...kept)).toBe(30);
    expect(kept.length).toBe(20);
  });
});
