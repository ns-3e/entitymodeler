import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const base = 'https://entitymodel.com/api/cloud';
const ORIGIN = 'https://entitymodel.com';

async function as(email: string, name: string) {
  const login = await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email, name }), headers: { Origin: ORIGIN } });
  const session = login.headers.get('Set-Cookie')!.split(';')[0];
  const req = (path: string, init: RequestInit = {}) => exports.default.fetch(`${base}/${path}`, { ...init, headers: { Origin: ORIGIN, Cookie: session, ...(init.headers as Record<string, string>) } });
  const id = ((await (await req('me')).json()) as any).user.id as string;
  return { req, id, email, name };
}
type Person = Awaited<ReturnType<typeof as>>;

async function team(prefix: string) {
  const ada = await as(`${prefix}-ada@example.com`, 'Ada');
  const bob = await as(`${prefix}-bob@example.com`, 'Bob');
  const ws = ((await (await ada.req('workspaces', { method: 'POST', body: JSON.stringify({ name: 'Team' }) })).json()) as any).id as string;
  const model = ((await (await ada.req(`workspaces/${ws}/models`, { method: 'POST', body: JSON.stringify({ title: 'M', entities: [] }) })).json()) as any).id as string;
  await ada.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: bob.email, role: 'viewer' }) });
  return { ada, bob, ws, model };
}

/** A live connection that remembers messages and lets a test wait for a presence update it expects. */
async function connect(p: Person, model: string) {
  const ws = (await p.req(`models/${model}/live`, { headers: { Upgrade: 'websocket' } })).webSocket!;
  const seen: any[] = [];
  const waiting: { test: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data as string);
    seen.push(m);
    for (const w of [...waiting]) if (w.test(m)) (waiting.splice(waiting.indexOf(w), 1), w.resolve(m));
  });
  ws.accept();
  const until = (test: (m: any) => boolean) => {
    const found = seen.find(test);
    return found ? Promise.resolve(found) : new Promise<any>((resolve) => waiting.push({ test, resolve }));
  };
  const nextPresence = (test: (people: any[]) => boolean) =>
    new Promise<any[]>((resolve) => {
      const hit = seen.filter((m) => m.type === 'presence').at(-1);
      if (hit && test(hit.people)) return resolve(hit.people);
      waiting.push({ test: (m) => m.type === 'presence' && test(m.people), resolve: (m) => resolve(m.people) });
    });
  return { ws, seen, until, nextPresence, send: (m: object) => ws.send(JSON.stringify(m)) };
}
const names = (people: any[]) => people.map((p) => p.name).sort();

describe('presence', () => {
  it('says who you are, and lists people as they arrive and leave', async () => {
    const { ada, bob, model } = await team('p1');
    const a = await connect(ada, model);
    expect(await a.until((m) => m.type === 'hello')).toMatchObject({ you: ada.id });
    await a.nextPresence((p) => p.length === 1);
    const b = await connect(bob, model);
    expect(names(await a.nextPresence((p) => p.length === 2))).toEqual(['Ada', 'Bob']);
    b.ws.close(1000);
    expect(names(await a.nextPresence((p) => p.length === 1))).toEqual(['Ada']);
    a.ws.close(1000);
  });

  it('shares a selection with the others, even from a viewer', async () => {
    const { ada, bob, model } = await team('p2');
    const a = await connect(ada, model);
    const b = await connect(bob, model);
    await a.nextPresence((p) => p.length === 2);
    b.send({ type: 'select', tab: 'main', entities: ['customer', 'order'] });
    const people = await a.nextPresence((p) => p.some((x) => x.entities.length));
    expect(people.find((x) => x.user === bob.id)).toEqual({ user: bob.id, name: 'Bob', tab: 'main', entities: ['customer', 'order'] });
    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('bounds what a connection can share', async () => {
    const { ada, model } = await team('p3');
    const a = await connect(ada, model);
    await a.nextPresence((p) => p.length === 1);
    a.send({ type: 'select', tab: 'x'.repeat(100), entities: [...Array.from({ length: 12 }, (_, i) => `e${i}`), 'y'.repeat(61), 7] });
    const [me] = await a.nextPresence((p) => p[0].entities.length > 0);
    expect(me.entities).toEqual(Array.from({ length: 8 }, (_, i) => `e${i}`));
    expect(me.tab).toHaveLength(60);
    a.ws.close(1000);
  });

  it('drops someone removed from the workspace straight away', async () => {
    const { ada, bob, ws, model } = await team('p4');
    const a = await connect(ada, model);
    const b = await connect(bob, model);
    await a.nextPresence((p) => p.length === 2);
    await ada.req(`workspaces/${ws}/members/${bob.id}`, { method: 'DELETE' });
    expect(names(await a.nextPresence((p) => p.length === 1))).toEqual(['Ada']);
    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('tells someone their role changed, and nobody else', async () => {
    const { ada, bob, ws, model } = await team('role');
    const a = await connect(ada, model);
    const b = await connect(bob, model);
    await b.nextPresence((p) => names(p).includes('Ada'));
    await ada.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: bob.email, role: 'editor' }) });
    expect(await b.until((m) => m.type === 'role')).toMatchObject({ role: 'editor' });
    // Saving the same role again says nothing new.
    await ada.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: bob.email, role: 'editor' }) });
    await ada.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: bob.email, role: 'viewer' }) });
    await b.until((m) => m.type === 'role' && m.role === 'viewer');
    expect(b.seen.filter((m) => m.type === 'role').map((m) => m.role)).toEqual(['editor', 'viewer']);
    expect(a.seen.some((m) => m.type === 'role')).toBe(false);
    a.ws.close(1000);
    b.ws.close(1000);
  });

  it('stops listing a connection that went silent', async () => {
    const { ada, bob, model } = await team('p5');
    const a = await connect(ada, model);
    const b = await connect(bob, model);
    await a.nextPresence((p) => p.length === 2);
    const stub = env.MODEL.get(env.MODEL.idFromName(model));
    await runInDurableObject(stub, (_i, state) => {
      for (const ws of state.getWebSockets(bob.id)) ws.serializeAttachment({ ...ws.deserializeAttachment(), seen: Date.now() - 200_000 });
    });
    a.send({ type: 'ping' });
    expect(names(await a.nextPresence((p) => p.length === 1))).toEqual(['Ada']);
    expect(await a.until((m) => m.type === 'pong')).toMatchObject({ version: 1 });
    a.ws.close(1000);
    b.ws.close(1000);
  });
});
