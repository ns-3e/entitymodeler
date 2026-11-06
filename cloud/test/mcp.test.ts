// The hosted MCP server end to end: an app registers, a person signs in and consents, and the token drives the tools.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';

const site = 'https://entitymodel.com';
const base = `${site}/api/cloud`;
const REDIRECT = 'https://app.example.com/callback';
const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };

async function as(email: string, name = email.split('@')[0]) {
  const login = await exports.default.fetch(`${base}/dev/login`, { method: 'POST', body: JSON.stringify({ email, name }), headers: { Origin: site } });
  const session = login.headers.get('Set-Cookie')!.split(';')[0];
  const req = (path: string, init: RequestInit = {}) => exports.default.fetch(`${base}/${path}`, { ...init, headers: { Origin: site, Cookie: session, ...(init.headers as Record<string, string>) } });
  const id = ((await (await req('me')).json()) as any).user.id as string;
  return { req, session, id, email };
}
type Person = Awaited<ReturnType<typeof as>>;

async function workspace(owner: Person) {
  const ws = ((await (await owner.req('workspaces', { method: 'POST', body: JSON.stringify({ name: 'Team' }) })).json()) as any).id as string;
  const model = ((await (await owner.req(`workspaces/${ws}/models`, { method: 'POST', body: JSON.stringify({ format: 'entitymodeler', name: 'm', title: 'Shop', entities: [{ name: 'customer', display_name: 'Customer', entity_type: 'standard', attributes: [{ name: 'customer_id', type: 'BIGINT', is_primary_key: true }] }], relationships: [] }) })).json()) as any).id as string;
  return { ws, model };
}

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function register(name = 'Test Agent') {
  const res = await exports.default.fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).client_id as string;
}

async function authUrl(client: string, verifier: string, scope = 'models:read') {
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return `${base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: REDIRECT, scope, state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256', resource: `${site}/mcp` })}`;
}

const ticketIn = (html: string) => /name="ticket" value="([^"]+)"/.exec(html)![1];
const consent = (p: Person, ticket: string, fields: Record<string, string>, origin = site) =>
  exports.default.fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: p.session, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket, ...fields }).toString() });

/** The whole dance, granting what `fields` ticks. Returns an access token. */
async function connect(p: Person, fields: Record<string, string> = { propose: 'on' }, name?: string) {
  const client = await register(name);
  const verifier = `verifier-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const page = await exports.default.fetch(await authUrl(client, verifier), { headers: { Cookie: p.session } });
  expect(page.status).toBe(200);
  const done = await consent(p, ticketIn(await page.text()), { action: 'allow', ...fields });
  expect(done.status).toBe(303);
  const back = new URL(done.headers.get('Location')!);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('st4te');
  const token = await exports.default.fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: client, code_verifier: verifier, resource: `${site}/mcp` }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as any).access_token as string;
}

const post = (token: string | null, body: object, headers: Record<string, string> = {}) =>
  exports.default.fetch(`${site}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });

/** A tool call as a 2026-07-28 client makes it. */
async function tool(token: string, name: string, args: object = {}) {
  const res = await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: META } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name });
  expect(res.status).toBe(200);
  const r = ((await res.json()) as any).result;
  return { text: r.content[0].text as string, isError: !!r.isError };
}
const ADD = { op: 'add_attribute', entity: 'customer', attribute: { name: 'tier', type: 'STRING' } };

describe('discovery', () => {
  it('sends clients without a token to the metadata', async () => {
    const res = await post(null, { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('WWW-Authenticate')!;
    expect(challenge).toContain('resource_metadata=');
    expect(challenge).toContain('models:read');
    const url = /resource_metadata="([^"]+)"/.exec(challenge)![1];
    const meta = (await (await exports.default.fetch(url)).json()) as any;
    expect(meta.resource).toBe(`${site}/mcp`);
    expect(meta.authorization_servers).toEqual([site]);
    const as_ = (await (await exports.default.fetch(`${site}/.well-known/oauth-authorization-server`)).json()) as any;
    expect(as_.authorization_endpoint).toBe(`${site}/api/cloud/oauth/authorize`);
    expect(as_.token_endpoint).toBe(`${site}/api/cloud/oauth/token`);
    expect(as_.registration_endpoint).toBe(`${site}/api/cloud/oauth/register`);
    expect(as_.code_challenge_methods_supported).toContain('S256');
    expect(as_.scopes_supported).toEqual(expect.arrayContaining(['models:read', 'models:propose', 'models:apply']));
  });

  it('refuses a made-up token', async () => {
    expect((await post('nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });
});

describe('client registration', () => {
  it('is limited per address', async () => {
    const attempt = () => exports.default.fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ client_name: 'x', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await attempt()).status);
    expect(codes[0]).toBe(201);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('consent', () => {
  it('asks a signed-out person to sign in first, and keeps the request out of the sign-in links', async () => {
    const client = await register('Sign-in App');
    const res = await exports.default.fetch(await authUrl(client, 'v'.repeat(50)));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign in to connect Sign-in App');
    expect(html).not.toContain('name="ticket"');
    const start = /auth\/github\/start\?return=([^"]+)"/.exec(html)!;
    const back = decodeURIComponent(start[1]);
    expect(back).toMatch(/^\/api\/cloud\/oauth\/authorize\?resume=/);
    // After signing in, the short return address leads to the consent form.
    const p = await as('signed-in@example.com');
    const page = await exports.default.fetch(`${site}${back}`, { headers: { Cookie: p.session } });
    expect(await page.text()).toContain('Connect Sign-in App?');
  });

  it('survives a request too long for a cookie', async () => {
    const client = await register('Long App');
    const url = new URL(await authUrl(client, 'v'.repeat(50)));
    url.searchParams.set('state', 'x'.repeat(5000));
    const html = await (await exports.default.fetch(url)).text();
    const back = decodeURIComponent(/auth\/github\/start\?return=([^"]+)"/.exec(html)![1]);
    expect(back.length).toBeLessThan(100);
  });

  it('escapes what a client says about itself', async () => {
    const p = await as('escape@example.com');
    const client = await register('<img src=x onerror=alert(1)>');
    const page = await exports.default.fetch(await authUrl(client, 'v'.repeat(50)), { headers: { Cookie: p.session } });
    const html = await page.text();
    expect(html).not.toContain('<img');
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('leaves direct changes off, and read cannot be turned off', async () => {
    const p = await as('defaults@example.com');
    const client = await register();
    const html = await (await exports.default.fetch(await authUrl(client, 'v'.repeat(50), 'models:read models:propose models:apply'), { headers: { Cookie: p.session } })).text();
    expect(html).toMatch(/name="propose" checked/);
    expect(html).toMatch(/name="apply">/);
  });

  it('does not trust a redirect address the client did not register', async () => {
    const p = await as('redirect@example.com');
    const client = await register();
    const url = new URL(await authUrl(client, 'v'.repeat(50)));
    url.searchParams.set('redirect_uri', 'https://evil.example.com/cb');
    const res = await exports.default.fetch(url, { headers: { Cookie: p.session }, redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('accepts a form once, only from the person it was shown to, and only from our site', async () => {
    const ada = await as('once-ada@example.com');
    const eve = await as('once-eve@example.com');
    const client = await register();
    const ticket = ticketIn(await (await exports.default.fetch(await authUrl(client, 'v'.repeat(50)), { headers: { Cookie: ada.session } })).text());
    expect((await consent(ada, ticket, { action: 'allow' }, 'https://evil.example.com')).status).toBe(403);
    expect((await consent(eve, ticket, { action: 'allow' })).status).toBe(400);
    expect((await consent(ada, ticket, { action: 'allow' })).status).toBe(303);
    expect((await consent(ada, ticket, { action: 'allow' })).status).toBe(400);
  });

  it('tells the app when the person says no', async () => {
    const p = await as('deny@example.com');
    const client = await register();
    const ticket = ticketIn(await (await exports.default.fetch(await authUrl(client, 'v'.repeat(50)), { headers: { Cookie: p.session } })).text());
    const res = await consent(p, ticket, { action: 'deny' });
    const back = new URL(res.headers.get('Location')!);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });
});

describe('tools', () => {
  it('reads and proposes, and the proposal reaches the app', async () => {
    const p = await as('proposer@example.com', 'Pat');
    const { ws, model } = await workspace(p);
    const token = await connect(p, { propose: 'on' }, 'Claude');
    expect((await tool(token, 'list_workspaces')).text).toContain(ws);
    expect((await tool(token, 'list_models')).text).toContain(`${model}: Shop [workspace Team]`);
    expect((await tool(token, 'get_model', { model })).text).toContain('customer');
    const r = await tool(token, 'propose_changes', { model, title: 'Add tier', ops: [ADD] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/Proposal .* saved for review/);
    const list = (await (await p.req(`models/${model}/proposals`)).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Add tier', author: 'Pat via Claude' });
    // Only a proposal so far.
    expect((await tool(token, 'get_model', { model })).text).not.toContain('tier');
    // base_hash is the SHA-1 the review dialog computes.
    const text = ((await (await p.req(`models/${model}`)).json()) as any).text as string;
    const sha1 = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(list[0].base_hash).toBe(sha1);
    expect((await p.req(`models/${model}/proposals/${list[0].id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await p.req(`models/${model}/proposals/${list[0].id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('tells everyone with the model open when proposals change', async () => {
    const p = await as('live@example.com');
    const { model } = await workspace(p);
    const token = await connect(p);
    const ws = (await p.req(`models/${model}/live`, { headers: { Upgrade: 'websocket' } })).webSocket!;
    const told = new Promise<void>((resolve) => ws.addEventListener('message', (e) => JSON.parse(e.data as string).type === 'proposals' && resolve()));
    ws.accept();
    await tool(token, 'propose_changes', { model, title: 'Add tier', ops: [ADD] });
    await told;
    ws.close();
  });

  it('checks ops before saving a proposal', async () => {
    const p = await as('badops@example.com');
    const { model } = await workspace(p);
    const token = await connect(p);
    const r = await tool(token, 'propose_changes', { model, title: 'x', ops: [{ op: 'delete_entity', entity: 'nope' }] });
    expect(r.isError).toBe(true);
    expect((await p.req(`models/${model}/proposals`).then((x) => x.json())) as any[]).toHaveLength(0);
  });

  it('holds each scope to what it grants', async () => {
    const p = await as('scopes@example.com');
    const { model } = await workspace(p);
    const read = await connect(p, {});
    expect((await tool(read, 'get_model', { model })).isError).toBe(false);
    const denied = await tool(read, 'propose_changes', { model, title: 'x', ops: [ADD] });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('models:propose');

    const propose = await connect(p, { propose: 'on' });
    const noApply = await tool(propose, 'apply_changes', { model, ops: [ADD] });
    expect(noApply.isError).toBe(true);
    expect(noApply.text).toContain('models:apply');
    // A tool that proposes can't be talked into applying.
    const sneaky = await tool(propose, 'import_ddl', { model, text: 'CREATE TABLE sneaky (id BIGINT PRIMARY KEY);', apply: true });
    expect(sneaky.isError).toBe(true);
    expect((await tool(propose, 'get_model', { model })).text).not.toContain('sneaky');

    const apply = await connect(p, { propose: 'on', apply: 'on' });
    expect((await tool(apply, 'apply_changes', { model, ops: [ADD] })).text).toContain('Applied 1 change');
    expect((await tool(apply, 'get_model', { model })).text).toContain('tier');
  });

  it('marks direct saves in history with the app that made them', async () => {
    const p = await as('history@example.com', 'Hal');
    const { model } = await workspace(p);
    const token = await connect(p, { propose: 'on', apply: 'on' }, 'Claude');
    await tool(token, 'apply_changes', { model, ops: [ADD] });
    const [latest] = (await (await p.req(`models/${model}/history`)).json()) as any[];
    expect(latest).toMatchObject({ by: 'Hal', via: 'Claude' });
  });

  it('holds a viewer to read, whatever the token says', async () => {
    const owner = await as('role-owner@example.com');
    const viewer = await as('role-viewer@example.com');
    const { ws, model } = await workspace(owner);
    await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: viewer.email, role: 'viewer' }) });
    const token = await connect(viewer, { propose: 'on', apply: 'on' });
    expect((await tool(token, 'get_model', { model })).isError).toBe(false);
    for (const [name, args] of [['propose_changes', { model, title: 'x', ops: [ADD] }], ['apply_changes', { model, ops: [ADD] }], ['create_model', { title: 'New', workspace: ws }]] as const) {
      const r = await tool(token, name, args);
      expect(r.isError).toBe(true);
      expect(r.text).toContain('editor');
    }
  });

  it('applies losing a membership on the next call', async () => {
    const owner = await as('gone-owner@example.com');
    const member = await as('gone-member@example.com');
    const { ws, model } = await workspace(owner);
    await owner.req(`workspaces/${ws}/members`, { method: 'POST', body: JSON.stringify({ email: member.email, role: 'editor' }) });
    const token = await connect(member);
    expect((await tool(token, 'get_model', { model })).isError).toBe(false);
    await owner.req(`workspaces/${ws}/members/${member.id}`, { method: 'DELETE' });
    const r = await tool(token, 'get_model', { model });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Not found');
    expect((await tool(token, 'list_models')).text).not.toContain(model);
  });

  it('refuses a suspended account at once', async () => {
    const p = await as('suspended@example.com');
    const token = await connect(p);
    await env.DB.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(new Date().toISOString(), p.id).run();
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it('re-applies a direct edit on the newer version when it loses a race', async () => {
    const p = await as('race@example.com');
    const { model } = await workspace(p);
    const token = await connect(p, { propose: 'on', apply: 'on' });
    const before = (await (await p.req(`models/${model}`)).json()) as any;
    const results = await Promise.all([
      tool(token, 'apply_changes', { model, ops: [{ op: 'add_attribute', entity: 'customer', attribute: { name: 'one', type: 'STRING' } }] }),
      tool(token, 'apply_changes', { model, ops: [{ op: 'add_attribute', entity: 'customer', attribute: { name: 'two', type: 'STRING' } }] }),
      tool(token, 'apply_changes', { model, ops: [{ op: 'add_attribute', entity: 'customer', attribute: { name: 'three', type: 'STRING' } }] }),
    ]);
    expect(results.every((r) => !r.isError)).toBe(true);
    const text = (await tool(token, 'get_model', { model })).text;
    for (const name of ['one', 'two', 'three']) expect(text).toContain(name);
    const after = (await (await p.req(`models/${model}`)).json()) as any;
    expect(after.version).toBe(before.version + 3);
  });

  it('does not let an agent sign comments as someone else', async () => {
    const p = await as('author@example.com', 'Amy');
    const { model } = await workspace(p);
    const token = await connect(p, { propose: 'on', apply: 'on' }, 'Claude');
    await tool(token, 'apply_changes', { model, ops: [{ op: 'add_comment', target: { kind: 'model' }, text: 'Hi', author: 'The CEO' }] });
    const text = (await tool(token, 'list_comments', { model })).text;
    expect(text).toContain('Amy via Claude');
    expect(text).not.toContain('The CEO');
  });

  it('replies to comments as the person, via the app', async () => {
    const p = await as('reply@example.com', 'Ria');
    const { model } = await workspace(p);
    const token = await connect(p, { propose: 'on', apply: 'on' }, 'Claude');
    await tool(token, 'apply_changes', { model, ops: [{ op: 'add_comment', target: { kind: 'model' }, text: 'Why?', author: 'x' }] });
    const id = /\[([^\]]+)\]/.exec((await tool(token, 'list_comments', { model })).text)![1];
    const read = await connect(p, {});
    expect((await tool(read, 'reply_comment', { model, id, text: 'No' })).isError).toBe(true);
    const propose = await connect(p, { propose: 'on' }, 'Claude');
    expect((await tool(propose, 'reply_comment', { model, id, text: 'Because.' })).isError).toBe(false);
    expect((await tool(propose, 'list_comments', { model })).text).toContain('Ria via Claude: Because.');
  });

  it('creates models in a workspace', async () => {
    const p = await as('creator@example.com');
    const { ws } = await workspace(p);
    const token = await connect(p);
    const r = await tool(token, 'create_model', { title: 'Fresh', workspace: ws });
    expect(r.isError).toBe(false);
    expect((await tool(token, 'list_models')).text).toContain('Fresh');
    const other = await as('creator-other@example.com');
    const theirs = await connect(other);
    expect((await tool(theirs, 'create_model', { title: 'Nope', workspace: ws })).isError).toBe(true);
  });

  it('offers no local-only tools', async () => {
    const p = await as('catalog@example.com');
    const token = await connect(p, {});
    const res = await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
    const names = ((await res.json()) as any).result.tools.map((t: any) => t.name);
    for (const n of ['pull_schema', 'profile_data', 'plan_writeback', 'search_glossary', 'propose_terms']) expect(names).not.toContain(n);
    for (const n of ['get_model', 'propose_changes', 'apply_changes', 'list_workspaces', 'create_model']) expect(names).toContain(n);
  });

  it('keeps pending proposals bounded', async () => {
    const p = await as('flood@example.com');
    const { model } = await workspace(p);
    const token = await connect(p);
    let last = { text: '', isError: false };
    for (let i = 0; i < 31 && !last.isError; i++) last = await tool(token, 'propose_changes', { model, title: `P${i}`, ops: [ADD] });
    expect(last.isError).toBe(true);
    expect(last.text).toMatch(/too many/i);
  });
});

describe('transport', () => {
  it('serves a client that still uses the handshake', async () => {
    const p = await as('legacy@example.com');
    const token = await connect(p, {});
    const init = await post(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    expect(((await init.json()) as any).result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'entitymodel.com', version } });
    expect(init.headers.get('Mcp-Session-Id')).toBeNull();
    const list = await post(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' });
    expect(((await list.json()) as any).result.tools.length).toBeGreaterThan(10);
  });

  it('answers GET and DELETE with 405', async () => {
    const p = await as('verbs@example.com');
    const token = await connect(p, {});
    for (const method of ['GET', 'DELETE']) {
      const res = await exports.default.fetch(`${site}/mcp`, { method, headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(405);
    }
  });

  it('refuses a browser page from another site, and allows no Origin', async () => {
    const p = await as('origin@example.com');
    const token = await connect(p, {});
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Origin: 'https://evil.example.com' })).status).toBe(403);
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(200);
  });
});

describe('connected agents', () => {
  it('lists them, and revoking one ends its access', async () => {
    const p = await as('revoke@example.com');
    const token = await connect(p, { propose: 'on' }, 'Revocable');
    const list = (await (await p.req('me/agents')).json()) as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Revocable' });
    expect(list[0].scope).toEqual(['models:read', 'models:propose']);
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(200);
    await p.req(`me/agents/${list[0].id}`, { method: 'DELETE' });
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it("can't revoke someone else's", async () => {
    const a = await as('rev-a@example.com');
    const b = await as('rev-b@example.com');
    const token = await connect(a, {});
    const [grant] = (await (await a.req('me/agents')).json()) as any[];
    await b.req(`me/agents/${grant.id}`, { method: 'DELETE' });
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(200);
  });

  it('are named in the data export, and go with the account', async () => {
    const p = await as('leaving@example.com');
    const token = await connect(p, {}, 'Departing');
    const exported = (await (await p.req('me/export')).json()) as any;
    expect(exported.connected_agents[0].name).toBe('Departing');
    expect(JSON.stringify(exported.connected_agents)).not.toContain(token);
    expect((await p.req('me', { method: 'DELETE', body: JSON.stringify({ confirm_email: p.email }) })).status).toBe(200);
    expect((await post(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    const left = await env.OAUTH_KV.list({ prefix: `grant:${p.id}:` });
    expect(left.keys).toHaveLength(0);
  });
});
