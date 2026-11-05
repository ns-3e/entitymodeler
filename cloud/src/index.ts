// Shared workspaces API, under /api/cloud. Accounts, workspaces and membership live in D1; each model's JSON lives
// in its own Durable Object (room.ts), which orders saves and pushes new versions to everyone who has it open.
// Phase 1 of docs/plans/shared-workspaces.md. Sign-in: GitHub and Google (auth.ts), one-time email links
// (email.ts), and a development login that is off unless DEV_LOGIN is "1".
import { PROVIDERS, pkceChallenge, randomToken, safeReturn } from './auth';
import { LINKS_PER_HOUR, LINK_MINUTES, confirmPage, mailer } from './email';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { HttpError, RANK, SESSION_COOKIE, addModel, commit, cookie, json, modelAccess, need, newId, now, roleIn, room, sessionUser, sha256, type Role, type User } from './common';
import { mcpHandler } from './mcp';
import { SCOPES, authorize, listAgents, revokeAgent, revokeAllAgents } from './oauth';
import { quotaFor } from './quotas';

export { ModelRoom } from './room';

const SESSION_DAYS = 30;

class Suspended extends HttpError {
  constructor() {
    super(403, 'This account is suspended. Contact support@entitymodel.com.');
  }
}

/** Created by migration 0003: takes over created_by on what outlives a deleted account. */
const DELETED_ACCOUNT = 'deleted-account';

async function body<T>(req: Request, max = 10_000): Promise<T> {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Request too large.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Expected JSON.');
  }
}

async function startSession(env: Env, userId: string): Promise<string> {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, now(), expires).run();
  return `${SESSION_COOKIE}=${token}; Path=/api/cloud; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

/** Find or create the user behind a sign-in (provider + subject), as every sign-in method will. */
export async function signIn(env: Env, provider: string, subject: string, email: string, name: string, avatar?: string): Promise<string> {
  const found = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first<{ user_id: string }>();
  let userId = found?.user_id;
  if (!userId) {
    // The same email from another provider is the same person.
    userId = (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())?.id;
    if (!userId) {
      userId = newId();
      await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)').bind(userId, email, name, now()).run();
    }
    await env.DB.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)').bind(provider, subject, userId, now()).run();
  }
  if ((await env.DB.prepare('SELECT suspended_at FROM users WHERE id = ?').bind(userId).first<{ suspended_at: string | null }>())?.suspended_at) throw new Suspended();
  // Fill in a name and picture the account doesn't have yet; never overwrite what the person set.
  await env.DB.prepare("UPDATE users SET name = CASE WHEN name = '' THEN ? ELSE name END, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?").bind(name.slice(0, 100), avatar ?? null, userId).run();
  return userId;
}


const OAUTH_COOKIE = 'em_oauth';

/** GET auth/providers, GET auth/:provider/start?return=/path, GET auth/:provider/callback (the provider sends people back here). */
async function auth(req: Request, env: Env, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const emailOn = !!(env.EMAIL && env.EMAIL_FROM);
  if (path[1] === 'providers' && req.method === 'GET')
    return json({ providers: [...Object.values(PROVIDERS).filter((p) => p.enabled(env)).map((p) => p.id), ...(emailOn ? ['email'] : [])], dev: env.DEV_LOGIN === '1' });
  if (path[1] === 'email' && emailOn) return emailAuth(req, env, path[2], url);
  const p = PROVIDERS[path[1]];
  if (!p || !p.enabled(env) || req.method !== 'GET') throw new HttpError(404, 'Not found.');
  const redirect = `${env.PUBLIC_URL}/api/cloud/auth/${p.id}/callback`;

  if (path[2] === 'start') {
    const state = randomToken();
    const verifier = randomToken();
    const back = safeReturn(url.searchParams.get('return'));
    // The state ties the callback to this browser (no sign-in CSRF); the verifier is PKCE for Google.
    const value = [p.id, state, verifier, encodeURIComponent(back)].join('.');
    return new Response(null, {
      status: 302,
      headers: { Location: p.authorizeUrl(env, redirect, state, await pkceChallenge(verifier)), 'Set-Cookie': `${OAUTH_COOKIE}=${value}; Path=/api/cloud/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'Cache-Control': 'no-store' },
    });
  }

  if (path[2] === 'callback') {
    const [provider, state, verifier, back] = (cookie(req, OAUTH_COOKIE) || '').split('.');
    const fail = (message: string) =>
      new Response(null, { status: 302, headers: { Location: `/?signin_error=${encodeURIComponent(message)}`, 'Set-Cookie': `${OAUTH_COOKIE}=; Path=/api/cloud/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
    if (url.searchParams.get('error')) return fail('Sign-in was cancelled.');
    const code = url.searchParams.get('code');
    if (!code || !state || provider !== p.id || url.searchParams.get('state') !== state) return fail('Sign-in expired or came from another browser. Try again.');
    let userId: string;
    try {
      const prof = await p.profile(env, code, redirect, verifier);
      userId = await signIn(env, p.id, prof.subject, prof.email, prof.name, prof.avatar);
    } catch (e) {
      console.error('sign-in failed', p.id, (e as Error).message);
      return fail(e instanceof Suspended || (e as Error).message.includes('verified email') ? (e as Error).message : `Sign-in with ${p.id === 'github' ? 'GitHub' : 'Google'} failed. Try again.`);
    }
    const headers = new Headers({ Location: safeReturn(decodeURIComponent(back || '')), 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', await startSession(env, userId));
    headers.append('Set-Cookie', `${OAUTH_COOKIE}=; Path=/api/cloud/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 302, headers });
  }
  throw new HttpError(404, 'Not found.');
}

/** POST auth/email/start {email, return} → a link by email; GET auth/email/callback?token → confirm page; POST auth/email/verify → session. */
async function emailAuth(req: Request, env: Env, step: string | undefined, url: URL): Promise<Response> {
  if (step === 'start' && req.method === 'POST') {
    const b = await body<{ email?: string; return?: string }>(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Enter an email address.');
    // The same answer as for anyone else, so this can't be used to find out who is suspended.
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND suspended_at IS NOT NULL').bind(email).first()) return json({ ok: true });
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM email_links WHERE email = ? AND created_at > ?').bind(email, hourAgo).first<{ n: number }>();
    if ((recent?.n ?? 0) >= LINKS_PER_HOUR) throw new HttpError(429, 'Too many sign-in links for this address. Try again in an hour.');
    const token = randomToken();
    await env.DB.prepare('INSERT INTO email_links (token_hash, email, return_path, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), email, safeReturn(b.return ?? null), now(), new Date(Date.now() + LINK_MINUTES * 60_000).toISOString())
      .run();
    try {
      await mailer.send(env, { to: email, link: `${env.PUBLIC_URL}/api/cloud/auth/email/callback?token=${token}` });
    } catch (e) {
      console.error('sign-in email failed', (e as { code?: string }).code, (e as Error).message);
      throw new HttpError(502, 'Could not send the email. Try again in a minute.');
    }
    return json({ ok: true });
  }

  if (step === 'callback' && req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    const link = await env.DB.prepare('SELECT email FROM email_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').bind(await sha256(token), now()).first<{ email: string }>();
    if (!link) return new Response(null, { status: 302, headers: { Location: `/?signin_error=${encodeURIComponent('That sign-in link has expired or was already used. Ask for a new one.')}` } });
    // same-origin, not no-referrer: under no-referrer, browsers send "Origin: null" with the form's POST, which the
    // origin check refuses. same-origin still keeps the token out of requests to other sites.
    return new Response(confirmPage(token, link.email), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (step === 'verify' && req.method === 'POST') {
    const token = String((await req.formData()).get('token') || '');
    // Used once: the update succeeds for only one request.
    const link = await env.DB.prepare('UPDATE email_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, return_path')
      .bind(now(), await sha256(token), now())
      .first<{ email: string; return_path: string }>();
    if (!link) return new Response(null, { status: 303, headers: { Location: `/?signin_error=${encodeURIComponent('That sign-in link has expired or was already used. Ask for a new one.')}` } });
    let userId: string;
    try {
      userId = await signIn(env, 'email', link.email, link.email, '');
    } catch (e) {
      if (e instanceof Suspended) return new Response(null, { status: 303, headers: { Location: `/?signin_error=${encodeURIComponent(e.message)}` } });
      throw e;
    }
    return new Response(null, { status: 303, headers: { Location: safeReturn(link.return_path), 'Set-Cookie': await startSession(env, userId), 'Cache-Control': 'no-store' } });
  }
  throw new HttpError(404, 'Not found.');
}

/** Workspaces whose only owner is the bound user. They can't outlive that user's account. */
const SOLE_OWNER = `w.id IN (SELECT workspace_id FROM members WHERE user_id = ?1 AND role = 'owner')
  AND NOT EXISTS (SELECT 1 FROM members o WHERE o.workspace_id = w.id AND o.role = 'owner' AND o.user_id <> ?1)`;

/** End someone's open connections to a workspace's models, so they stop receiving new versions. */
async function closeConnections(env: Env, user: string, workspace: string) {
  const { results } = await env.DB.prepare('SELECT id FROM models WHERE workspace_id = ?').bind(workspace).all<{ id: string }>();
  await Promise.all(results.map((m) => room(env, m.id).disconnect(user)));
}

/**
 * Remove the account: its sign-ins, sessions and memberships, and every workspace it alone owns, with those models.
 * Model contents go first: if that fails, nothing in the database has changed and the person can simply try again.
 */
async function deleteAccount(env: Env, user: User) {
  await revokeAllAgents(env, user.id);
  const doomed = await env.DB.prepare(`SELECT d.id FROM models d JOIN workspaces w ON w.id = d.workspace_id WHERE ${SOLE_OWNER}`).bind(user.id).all<{ id: string }>();
  await Promise.all(doomed.results.map((m) => room(env, m.id).destroy()));
  const kept = await env.DB.prepare(`SELECT w.id FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1 AND NOT (${SOLE_OWNER})`).bind(user.id).all<{ id: string }>();
  await Promise.all(kept.results.map((w) => closeConnections(env, user.id, w.id)));
  // One transaction. Members and models of the deleted workspaces, and the account's sign-ins, sessions and memberships, cascade.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM workspaces AS w WHERE ${SOLE_OWNER}`).bind(user.id),
    env.DB.prepare('UPDATE workspaces SET created_by = ? WHERE created_by = ?').bind(DELETED_ACCOUNT, user.id),
    env.DB.prepare('UPDATE models SET created_by = ? WHERE created_by = ?').bind(DELETED_ACCOUNT, user.id),
    env.DB.prepare('UPDATE models SET updated_by = NULL WHERE updated_by = ?').bind(user.id),
    env.DB.prepare('DELETE FROM email_links WHERE email = ?').bind(user.email),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
}

/**
 * Everything stored about a person, as one JSON download. It streams, one model at a time, because the models of
 * several workspaces can be larger than a Worker's memory. A failed read aborts the download rather than truncating it.
 */
async function exportAccount(env: Env, user: User): Promise<Response> {
  const account = await env.DB.prepare('SELECT id, email, name, avatar_url, created_at FROM users WHERE id = ?').bind(user.id).first();
  const signIns = await env.DB.prepare('SELECT provider, subject, created_at FROM identities WHERE user_id = ? ORDER BY created_at').bind(user.id).all();
  const workspaces = await env.DB.prepare('SELECT w.id, w.name, w.plan, w.created_at, m.role, m.added_at FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.name').bind(user.id).all();
  const models = await env.DB.prepare('SELECT d.id, d.workspace_id, d.title, d.created_at, d.updated_at FROM models d JOIN members m ON m.workspace_id = d.workspace_id WHERE m.user_id = ? ORDER BY d.workspace_id, d.title').bind(user.id).all<{ id: string }>();

  const agents = await listAgents(env, user.id);

  const encoder = new TextEncoder();
  let next = 0;
  let written = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const head = JSON.stringify({ exported_at: now(), account, sign_ins: signIns.results, connected_agents: agents, workspaces: workspaces.results });
      controller.enqueue(encoder.encode(`${head.slice(0, -1)},"models":[`));
    },
    async pull(controller) {
      while (next < models.results.length) {
        const row = models.results[next++];
        const current = await room(env, row.id).read();
        if (!current) continue; // deleted since the list was read
        // The text was checked to be JSON when it was saved, so it goes in as it is.
        const entry = JSON.stringify({ ...row, version: current.version });
        const proposals = await room(env, row.id).proposals();
        controller.enqueue(encoder.encode(`${written++ ? ',' : ''}${entry.slice(0, -1)},"proposals":[${proposals.join(',')}],"model":${current.text}}`));
        return;
      }
      controller.enqueue(encoder.encode(']}'));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="entitymodel-export-${now().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function route(req: Request, env: Env, path: string[]): Promise<Response> {
  const method = req.method;

  if (path[0] === 'dev' && path[1] === 'login' && method === 'POST') {
    if (env.DEV_LOGIN !== '1') throw new HttpError(404, 'Not found.');
    const b = await body<{ email?: string; name?: string }>(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'An email address is needed.');
    const userId = await signIn(env, 'email', email, email, (b.name || '').slice(0, 100));
    return json({ ok: true }, 200, { 'Set-Cookie': await startSession(env, userId) });
  }

  if (path[0] === 'auth') return auth(req, env, path);
  if (path[0] === 'oauth' && path[1] === 'authorize' && !path[2]) return authorize(req, env);

  const user = await sessionUser(req, env);
  if (!user) throw new HttpError(401, 'Sign in first.');

  if (path[0] === 'logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(cookie(req, SESSION_COOKIE)!)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/api/cloud; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (path[0] === 'me' && !path[1] && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT w.id, w.name, w.plan, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.name').bind(user.id).all();
    return json({ user, workspaces: results });
  }

  if (path[0] === 'me' && path[1] === 'export' && method === 'GET') return exportAccount(env, user);

  if (path[0] === 'me' && path[1] === 'agents' && !path[2] && method === 'GET') return json(await listAgents(env, user.id));

  if (path[0] === 'me' && path[1] === 'agents' && path[2] && !path[3] && method === 'DELETE') {
    await revokeAgent(env, user.id, path[2]);
    return json({ ok: true });
  }

  if (path[0] === 'me' && path[1] === 'deletion' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT w.id, w.name,
              (SELECT COUNT(*) FROM members m WHERE m.workspace_id = w.id) AS members,
              (SELECT COUNT(*) FROM models d WHERE d.workspace_id = w.id) AS models
       FROM workspaces w WHERE ${SOLE_OWNER} ORDER BY w.name`,
    )
      .bind(user.id)
      .all();
    return json({ workspaces: results });
  }

  if (path[0] === 'me' && !path[1] && method === 'DELETE') {
    const b = await body<{ confirm_email?: string }>(req);
    if ((b.confirm_email || '').trim().toLowerCase() !== user.email.toLowerCase()) throw new HttpError(400, 'Type your email address to confirm.');
    await deleteAccount(env, user);
    return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/api/cloud; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  if (path[0] === 'workspaces' && !path[1] && method === 'POST') {
    const b = await body<{ name?: string }>(req);
    const name = (b.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'A workspace needs a name.');
    const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces WHERE created_by = ?').bind(user.id).first<{ n: number }>();
    if ((owned?.n ?? 0) >= quotaFor('free').workspacesPerUser) throw new HttpError(403, `You can create up to ${quotaFor('free').workspacesPerUser} workspaces.`);
    const id = newId();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)').bind(id, name, user.id, now()),
      env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now()),
    ]);
    return json({ id, name, plan: 'free', role: 'owner' }, 201);
  }

  if (path[0] === 'workspaces' && path[1]) {
    const ws = path[1];
    if (!path[2] && method === 'GET') {
      const { role } = await need(env, ws, user.id, 'viewer');
      const [members, models] = await Promise.all([
        env.DB.prepare('SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.email').bind(ws).all(),
        env.DB.prepare('SELECT id, title, size, updated_at FROM models WHERE workspace_id = ? ORDER BY updated_at DESC').bind(ws).all(),
      ]);
      return json({ id: ws, role, members: members.results, models: models.results });
    }

    if (path[2] === 'members' && !path[3] && method === 'POST') {
      const { plan } = await need(env, ws, user.id, 'owner');
      const b = await body<{ email?: string; role?: Role }>(req);
      const role = b.role && RANK[b.role] ? b.role : 'editor';
      // Email invitations arrive with email sign-in; until then a member must have signed in once.
      const target = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND suspended_at IS NULL').bind((b.email || '').trim().toLowerCase()).first<{ id: string }>();
      if (!target) throw new HttpError(404, 'Nobody with that email has signed in yet.');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE workspace_id = ?').bind(ws).first<{ n: number }>();
      const existing = await roleIn(env, ws, target.id);
      if (!existing && (count?.n ?? 0) >= quotaFor(plan).membersPerWorkspace) throw new HttpError(403, `Workspaces are limited to ${quotaFor(plan).membersPerWorkspace} members.`);
      await env.DB.prepare('INSERT INTO members (workspace_id, user_id, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role').bind(ws, target.id, role, now()).run();
      return json({ ok: true, role });
    }

    if (path[2] === 'members' && path[3] && method === 'DELETE') {
      // Owners remove anyone; anyone can leave.
      if (path[3] !== user.id) await need(env, ws, user.id, 'owner');
      else await need(env, ws, user.id, 'viewer');
      const owners = await env.DB.prepare("SELECT user_id FROM members WHERE workspace_id = ? AND role = 'owner'").bind(ws).all<{ user_id: string }>();
      if (owners.results.length === 1 && owners.results[0].user_id === path[3]) throw new HttpError(409, 'A workspace needs an owner: make someone else owner first.');
      await env.DB.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').bind(ws, path[3]).run();
      await closeConnections(env, path[3], ws);
      return json({ ok: true });
    }

    if (path[2] === 'models' && !path[3] && method === 'POST') {
      const { plan } = await need(env, ws, user.id, 'editor');
      const { id, title } = await addModel(env, ws, plan, await req.text(), user.id);
      return json({ id, title, version: 1 }, 201);
    }
  }

  if (path[0] === 'models' && path[1]) {
    const id = path[1];

    if (!path[2] && method === 'GET') {
      const a = await modelAccess(env, id, user.id, 'viewer');
      const r = await room(env, id).read();
      if (!r) throw new HttpError(404, 'Not found.');
      return json({ id, workspace_id: a.workspace_id, role: a.role, version: r.version, text: r.text }, 200, { ETag: `"${r.version}"` });
    }

    if (!path[2] && method === 'PUT') {
      const a = await modelAccess(env, id, user.id, 'editor');
      const base = Number((req.headers.get('If-Match') || '').replace(/"/g, ''));
      if (!Number.isInteger(base) || base < 1) throw new HttpError(428, 'Send If-Match with the version this save is based on.');
      const r = await commit(env, id, a.plan, base, await req.text(), user.id);
      if (!r.ok) throw new HttpError(409, 'Someone else saved a newer version.', { version: r.version, text: r.text });
      return json({ version: r.version }, 200, { ETag: `"${r.version}"` });
    }

    if (!path[2] && method === 'DELETE') {
      await modelAccess(env, id, user.id, 'owner');
      await room(env, id).destroy();
      await env.DB.prepare('DELETE FROM models WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }

    if (path[2] === 'history' && !path[3] && method === 'GET') {
      const a = await modelAccess(env, id, user.id, 'viewer');
      const [versions, people] = await Promise.all([
        room(env, id).history(),
        env.DB.prepare('SELECT u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?').bind(a.workspace_id).all<User>(),
      ]);
      // Only current members are named: someone who left or deleted their account shows as no one in particular.
      const names = new Map(people.results.map((p) => [p.id, p.name || p.email]));
      return json(versions.map(({ saved_by, via, ...v }) => ({ ...v, by: names.get(saved_by) ?? null, via })));
    }

    if (path[2] === 'history' && path[3] && !path[4] && method === 'GET') {
      await modelAccess(env, id, user.id, 'viewer');
      const text = await room(env, id).readVersion(Number(path[3]));
      if (text === null) throw new HttpError(404, 'That version is no longer kept.');
      return json({ version: Number(path[3]), text });
    }

    // Restoring saves the old text as a new version on top, so it never removes anything and can itself be undone.
    if (path[2] === 'history' && path[3] && path[4] === 'restore' && method === 'POST') {
      const a = await modelAccess(env, id, user.id, 'editor');
      const base = Number((req.headers.get('If-Match') || '').replace(/"/g, ''));
      if (!Number.isInteger(base) || base < 1) throw new HttpError(428, 'Send If-Match with the version this restore is based on.');
      const text = await room(env, id).readVersion(Number(path[3]));
      if (text === null) throw new HttpError(404, 'That version is no longer kept.');
      const r = await commit(env, id, a.plan, base, text, user.id);
      if (!r.ok) throw new HttpError(409, 'Someone else saved a newer version.', { version: r.version, text: r.text });
      return json({ version: r.version, text });
    }

    if (path[2] === 'proposals' && !path[3] && method === 'GET') {
      await modelAccess(env, id, user.id, 'viewer');
      return json((await room(env, id).proposals()).map((p) => JSON.parse(p)));
    }

    // Accepting saves the model through the usual PUT, then removes the proposal here. Rejecting only removes it.
    if (path[2] === 'proposals' && path[3] && !path[4] && method === 'DELETE') {
      await modelAccess(env, id, user.id, 'editor');
      if (!(await room(env, id).removeProposal(path[3]))) throw new HttpError(404, 'Not found.');
      return json({ ok: true });
    }

    if (path[2] === 'live' && method === 'GET') {
      if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket.');
      const a = await modelAccess(env, id, user.id, 'viewer');
      const headers = new Headers({ Upgrade: 'websocket', 'x-user-id': user.id, 'x-user-name': user.name || user.email, 'x-role': a.role });
      return room(env, id).fetch(new Request('https://room/live', { headers }));
    }
  }

  throw new HttpError(404, 'Not found.');
}

/** The site's own API, and what OAuthProvider hands everything to except /mcp and the token endpoints. */
const api = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/cloud/')) return json({ error: 'Not found.' }, 404);
    // Changes and live connections only from our own pages, so another site can't act with someone's cookie.
    const changes = req.method !== 'GET' && req.method !== 'HEAD';
    if (changes || req.headers.get('Upgrade') === 'websocket') {
      const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
      if (!allowed.includes(req.headers.get('Origin') || '')) return json({ error: 'Origin not allowed.' }, 403);
    }
    try {
      return await route(req, env, url.pathname.slice('/api/cloud/'.length).split('/').filter(Boolean).map(decodeURIComponent));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.body }, e.status);
      console.error('cloud api error', (e as Error).message);
      return json({ error: 'Something went wrong.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

const REGISTER_PATH = '/api/cloud/oauth/register';

/** Built on first use because the addresses come from env, so a self-hosted copy advertises its own. */
let provider: OAuthProvider<Env> | undefined;
const oauthProvider = (env: Env) =>
  (provider ??= new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpHandler as never,
    defaultHandler: api,
    authorizeEndpoint: '/api/cloud/oauth/authorize',
    tokenEndpoint: '/api/cloud/oauth/token',
    clientRegistrationEndpoint: REGISTER_PATH,
    scopesSupported: [...SCOPES, 'offline_access'],
    // The baseline only: clients request what a 401 names, and the consent page offers the rest.
    requiredScopes: ['models:read'],
    resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL], resource_name: 'EntityModel.com', bearer_methods_supported: ['header'] },
    clientIdMetadataDocumentEnabled: true,
  }));

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Anyone can register a client without signing in, so this is the one route with no account to limit by.
    if (req.method === 'POST' && new URL(req.url).pathname === REGISTER_PATH) {
      const { success } = await env.REGISTER_LIMITER.limit({ key: req.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return json({ error: 'too_many_requests', error_description: 'Too many client registrations. Try again in a minute.' }, 429);
    }
    return oauthProvider(env).fetch(req, env, ctx);
  },
};
