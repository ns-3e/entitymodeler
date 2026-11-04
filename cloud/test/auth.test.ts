import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

const base = 'https://entitymodel.com/api/cloud';
const call = (path: string, cookie = '') => exports.default.fetch(`${base}/${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
const cookieOf = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${name}=`))!;

/** Stand-ins for GitHub's and Google's endpoints. */
function mockProviders(opts: { githubEmailVerified?: boolean } = {}) {
  const real = globalThis.fetch;
  const seen: { url: string; body?: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, body: init?.body ? String(init.body) : undefined });
    const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://github.com/login/oauth/access_token') return j({ access_token: 'gh-token' });
    if (url === 'https://api.github.com/user') return j({ id: 42, login: 'ada', name: 'Ada Lovelace', avatar_url: 'https://avatars/ada' });
    if (url === 'https://api.github.com/user/emails') return j([{ email: 'Ada@Example.com', primary: true, verified: opts.githubEmailVerified ?? true }]);
    if (url === 'https://oauth2.googleapis.com/token') return j({ access_token: 'g-token' });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return j({ sub: 'g-7', email: 'ada@example.com', email_verified: true, name: 'Ada L.' });
    return real(input as RequestInfo, init);
  });
  return seen;
}

/** Start → (the provider) → callback, as a browser would. */
async function signInWith(provider: string, back = '/models') {
  const start = await call(`auth/${provider}/start?return=${encodeURIComponent(back)}`);
  expect(start.status).toBe(302);
  const to = new URL(start.headers.get('Location')!);
  const state = to.searchParams.get('state')!;
  const oauth = cookieOf(start, 'em_oauth');
  const done = await call(`auth/${provider}/callback?code=abc&state=${state}`, oauth);
  return { start, to, done, oauth, state };
}

afterEach(() => vi.restoreAllMocks());

describe('sign-in with GitHub and Google', () => {
  it('lists the providers that are configured', async () => {
    expect(await (await call('auth/providers')).json()).toEqual({ providers: ['github', 'google', 'email'], dev: true });
  });

  it('signs in with GitHub and returns to the page, with a session', async () => {
    mockProviders();
    const { to, done } = await signInWith('github');
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(to.searchParams.get('redirect_uri')).toBe('https://entitymodel.com/api/cloud/auth/github/callback');
    expect(done.status).toBe(302);
    expect(done.headers.get('Location')).toBe('/models');
    const session = cookieOf(done, 'em_session');
    const me = (await (await call('me', session)).json()) as { user: { email: string; name: string } };
    expect(me.user).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace' });
  });

  it('signs the same verified email in to the same account from Google, using PKCE', async () => {
    const seen = mockProviders();
    const gh = await signInWith('github');
    const g = await signInWith('google');
    expect(g.to.searchParams.get('code_challenge_method')).toBe('S256');
    const verifier = g.oauth.split('=')[1].split('.')[2];
    expect(seen.find((s) => s.url.includes('oauth2.googleapis.com'))!.body).toContain(`code_verifier=${verifier}`);
    const id = async (r: Response) => ((await (await call('me', cookieOf(r, 'em_session'))).json()) as { user: { id: string } }).user.id;
    expect(await id(g.done)).toBe(await id(gh.done));
  });

  it('refuses a callback without the matching state, and unverified emails', async () => {
    mockProviders({ githubEmailVerified: false });
    const start = await call('auth/github/start');
    const forged = await call('auth/github/callback?code=abc&state=guess', cookieOf(start, 'em_oauth'));
    expect(forged.headers.get('Location')).toMatch(/^\/\?signin_error=/);
    expect(forged.headers.getSetCookie().some((c) => c.startsWith('em_session='))).toBe(false);
    const { done } = await signInWith('github');
    expect(decodeURIComponent(done.headers.get('Location')!)).toContain('no verified email');
  });

  it('only returns to paths on this site', async () => {
    mockProviders();
    for (const evil of ['https://evil.example/', '//evil.example', '/\\evil.example']) expect((await signInWith('github', evil)).done.headers.get('Location')).toBe('/');
  });
});
