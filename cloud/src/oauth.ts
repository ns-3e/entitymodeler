// Connecting an MCP client to someone's account. @cloudflare/workers-oauth-provider runs the OAuth protocol (tokens,
// PKCE, client registration, discovery); this file is the part it leaves to the app: who is signing in, and what they
// agree to. The page always asks: a client registered by anyone must never get an account's access without a click.
import { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { PROVIDERS, randomToken } from './auth';
import { HttpError, now, sessionUser, sha256 } from './common';
import { escapeHtml } from './email';

export const SCOPES = ['models:read', 'models:propose', 'models:apply'] as const;
export type Scope = (typeof SCOPES)[number];

const AUTHORIZE = '/api/cloud/oauth/authorize';
const TICKET_MINUTES = 15;
const MAX_QUERY = 8000;
/** Client names are self-reported and end up on version history lines. */
const MAX_CLIENT_NAME = 60;

export interface GrantProps {
  userId: string;
  clientName: string;
}

const oauth = (env: Env) => (env as Env & { OAUTH_PROVIDER: import('@cloudflare/workers-oauth-provider').OAuthHelpers }).OAUTH_PROVIDER;

async function issueTicket(env: Env, query: string, user: string | null): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_tickets WHERE expires_at < ?').bind(now()),
    env.DB.prepare('INSERT INTO oauth_tickets (token_hash, query, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), query, user, now(), new Date(Date.now() + TICKET_MINUTES * 60_000).toISOString()),
  ]);
  return token;
}

const page = (title: string, body: string, nonce: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} · EntityModel.com</title>
<style nonce="${nonce}">:root{color-scheme:light dark}body{font-family:system-ui,-apple-system,sans-serif;max-width:460px;margin:10vh auto;padding:0 16px;background:Canvas;color:CanvasText;line-height:1.45}
h1{font-size:22px;margin:0 0 8px}p{margin:8px 0}.muted{opacity:.75;font-size:14px}code{overflow-wrap:anywhere}
label{display:flex;gap:10px;align-items:flex-start;margin:14px 0}label b{display:block}input[type=checkbox]{margin-top:4px}input[type=email]{font:inherit;padding:9px 10px;width:100%;box-sizing:border-box;margin:6px 0;border:1px solid GrayText;border-radius:6px;background:Canvas;color:CanvasText}
.buttons{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}button,.btn{font:inherit;padding:10px 18px;border-radius:6px;border:1px solid CanvasText;cursor:pointer;background:Canvas;color:CanvasText;text-decoration:none;display:inline-block}
button.primary{background:CanvasText;color:Canvas}.plain{display:block;margin:20px 0 0}.warn{border-left:3px solid #c77700;padding-left:10px;font-size:14px;margin:4px 0 0 28px}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        // same-origin, not no-referrer: under no-referrer, browsers send "Origin: null", which the origin check refuses.
        'Referrer-Policy': 'same-origin',
        // No form-action: browsers apply it to the redirect after the form, which goes to the client's own address.
        'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );

const problemPage = (message: string, nonce: string) => page('Can’t connect', `<h1>This app can’t connect</h1><p>${escapeHtml(message)}</p><p class="muted">Go back to the app and try connecting again.</p>`, nonce, 400);

function signInPage(env: Env, back: string, name: string, nonce: string) {
  const providers = Object.values(PROVIDERS).filter((p) => p.enabled(env));
  const links = providers.map((p) => `<a class="btn" href="/api/cloud/auth/${p.id}/start?return=${encodeURIComponent(back)}">Continue with ${p.id === 'github' ? 'GitHub' : 'Google'}</a>`).join(' ');
  const email = env.EMAIL && env.EMAIL_FROM;
  return page(
    'Sign in',
    `<h1>Sign in to connect ${escapeHtml(name)}</h1><p class="muted">You’ll choose what it can do after signing in.</p>
<div class="buttons">${links}</div>
${
  email
    ? `<form id="f"><p><label for="e" class="plain">${links ? 'Or get' : 'Get'} an email link</label><input id="e" type="email" required autocomplete="email" placeholder="you@example.com"></p><button>Email me a link</button><p id="m" class="muted" role="status"></p></form>
<script nonce="${nonce}">document.getElementById('f').addEventListener('submit',async function(ev){ev.preventDefault();var m=document.getElementById('m');m.textContent='Sending…';var r=await fetch('/api/cloud/auth/email/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('e').value,return:${JSON.stringify(back).replace(/</g, '\\u003c')}})});m.textContent=r.ok?'Check your email for the link. You can close this tab.':'That didn’t work. Try again in a minute.'});</script>`
    : ''
}`,
    nonce,
  );
}

function consentPage(clientName: string, redirectUri: string, who: string, ticket: string, nonce: string) {
  const u = new URL(redirectUri);
  const where = u.protocol === 'https:' || u.protocol === 'http:' ? u.host : u.protocol.replace(/:$/, '');
  return page(
    'Connect an app',
    `<h1>Connect ${escapeHtml(clientName)}?</h1>
<p class="muted">It will act as <b>${escapeHtml(who)}</b> in your workspaces, with the access you choose. It sends you back to <code>${escapeHtml(where)}</code>. An app names itself, so continue only if you just started connecting from there.</p>
<form method="post" action="${AUTHORIZE}">
<input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
<label><input type="checkbox" checked disabled><span><b>Read models</b><span class="muted">See the models in your workspaces, with their comments and proposals.</span></span></label>
<label><input type="checkbox" name="propose" checked><span><b>Suggest changes</b><span class="muted">Create models, reply to comments, and propose edits that an editor reviews.</span></span></label>
<label><input type="checkbox" name="apply"><span><b>Change models directly</b><span class="muted">Edit shared models and accept proposals with no review.</span></span></label>
<p class="warn">Models can hold text written by other people, and an app might act on instructions hidden in it. Allow direct changes only if you trust this app and the people you share workspaces with. Version history can restore earlier saves.</p>
<div class="buttons"><button class="primary" name="action" value="allow">Allow</button><button name="action" value="deny">Deny</button></div>
</form>`,
    nonce,
  );
}

/** /oauth/authorize: GET shows sign-in or the consent form, and the form's POST finishes the authorization. */
export async function authorize(req: Request, env: Env): Promise<Response> {
  const nonce = randomToken(16);
  const origin = new URL(req.url).origin;
  const parse = (query: string) => oauth(env).parseAuthRequest(new Request(`${origin}${AUTHORIZE}${query}`));
  const nameOf = async (clientId: string) => ((await oauth(env).lookupClient(clientId))?.clientName || 'An app').slice(0, MAX_CLIENT_NAME);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    let query = url.search;
    const resume = url.searchParams.get('resume');
    if (resume) {
      const t = await env.DB.prepare('SELECT query FROM oauth_tickets WHERE token_hash = ? AND user_id IS NULL AND expires_at > ?').bind(await sha256(resume), now()).first<{ query: string }>();
      if (!t) return problemPage('This sign-in took too long.', nonce);
      query = t.query;
    }
    if (query.length > MAX_QUERY) return problemPage('The request is too long.', nonce);
    let request;
    try {
      request = await parse(query);
    } catch (e) {
      // Only a redirect the library has checked against the client's registered addresses may be followed.
      if (e instanceof AuthorizationError && e.redirectTo) return new Response(null, { status: 302, headers: { Location: e.redirectTo } });
      return problemPage(e instanceof AuthorizationError ? e.message : 'The request isn’t valid.', nonce);
    }
    const name = await nameOf(request.clientId);
    const user = await sessionUser(req, env);
    if (!user) return signInPage(env, `${AUTHORIZE}?resume=${resume || (await issueTicket(env, query, null))}`, name, nonce);
    return consentPage(name, request.redirectUri, user.name || user.email, await issueTicket(env, query, user.id), nonce);
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Not allowed.');
  const user = await sessionUser(req, env);
  if (!user) throw new HttpError(401, 'Sign in first.');
  const form = await req.formData();
  const token = String(form.get('ticket') || '');
  // Used up here, whatever happens next: one click, by the person the form was shown to. This also stops cross-site posts.
  const t = await env.DB.prepare('UPDATE oauth_tickets SET used_at = ? WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ? RETURNING query').bind(now(), await sha256(token), user.id, now()).first<{ query: string }>();
  if (!t) return problemPage('This page has expired.', nonce);
  const request = await parse(t.query);

  if (form.get('action') !== 'allow') {
    const back = new URL(request.redirectUri);
    back.searchParams.set('error', 'access_denied');
    if (request.state) back.searchParams.set('state', request.state);
    return new Response(null, { status: 303, headers: { Location: back.toString(), 'Cache-Control': 'no-store' } });
  }

  const scope: string[] = ['models:read'];
  if (form.get('propose')) scope.push('models:propose');
  if (form.get('apply')) scope.push('models:apply');
  if (request.scope.includes('offline_access')) scope.push('offline_access');
  const clientName = await nameOf(request.clientId);
  const props: GrantProps = { userId: user.id, clientName };
  const { redirectTo } = await oauth(env).completeAuthorization({ request, userId: user.id, metadata: { clientName }, scope, props });
  return new Response(null, { status: 303, headers: { Location: redirectTo, 'Cache-Control': 'no-store' } });
}

export interface ConnectedAgent {
  id: string;
  name: string;
  scope: string[];
  created_at: string;
}

/** The apps connected to an account. Keeps paging, because the list is what deletion revokes. */
export async function listAgents(env: Env, user: string): Promise<ConnectedAgent[]> {
  const out: ConnectedAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth(env).listUserGrants(user, cursor ? { cursor } : undefined);
    for (const g of page.items) out.push({ id: g.id, name: g.metadata?.clientName || 'An app', scope: g.scope, created_at: new Date(g.createdAt * 1000).toISOString() });
    cursor = page.cursor;
  } while (cursor);
  return out;
}

export async function revokeAgent(env: Env, user: string, grant: string) {
  // The grant is looked up under the user's own keys, so someone else's id finds nothing.
  await oauth(env).revokeGrant(grant, user);
}

export async function revokeAllAgents(env: Env, user: string) {
  for (const a of await listAgents(env, user)) await revokeAgent(env, user, a.id);
}
