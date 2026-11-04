// Sign-in with GitHub and Google (OAuth 2.0 authorization code flow). A provider is offered only when its client id
// and secret are configured (`wrangler secret put GITHUB_CLIENT_SECRET`, …). Both require a verified email, because
// the same email from two providers signs in to the same account.

export interface Profile {
  subject: string;
  email: string;
  name: string;
  avatar?: string;
}

interface Provider {
  id: 'github' | 'google';
  enabled(env: Env): boolean;
  authorizeUrl(env: Env, redirect: string, state: string, challenge: string): string;
  profile(env: Env, code: string, redirect: string, verifier: string): Promise<Profile>;
}

const form = (o: Record<string, string>) => new URLSearchParams(o);

async function ok<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return (await res.json()) as T;
}

const github: Provider = {
  id: 'github',
  enabled: (env) => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
  authorizeUrl: (env, redirect, state) => `https://github.com/login/oauth/authorize?${form({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirect, scope: 'read:user user:email', state, allow_signup: 'true' })}`,
  async profile(env, code, redirect) {
    const token = await ok<{ access_token?: string; error?: string }>(
      await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json' }, body: form({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirect }) }),
      'GitHub token exchange',
    );
    if (!token.access_token) throw new Error(`GitHub sign-in was refused (${token.error || 'no token'}).`);
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'entitymodel.com' };
    const [user, emails] = await Promise.all([
      ok<{ id: number; login: string; name: string | null; avatar_url?: string }>(await fetch('https://api.github.com/user', { headers }), 'GitHub profile'),
      ok<{ email: string; primary: boolean; verified: boolean }[]>(await fetch('https://api.github.com/user/emails', { headers }), 'GitHub emails'),
    ]);
    const email = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!email) throw new Error('Your GitHub account has no verified email address.');
    return { subject: String(user.id), email: email.email.toLowerCase(), name: user.name || user.login, avatar: user.avatar_url };
  },
};

const google: Provider = {
  id: 'google',
  enabled: (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  authorizeUrl: (env, redirect, state, challenge) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${form({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' })}`,
  async profile(env, code, redirect, verifier) {
    const token = await ok<{ access_token?: string }>(
      await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: form({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) }),
      'Google token exchange',
    );
    if (!token.access_token) throw new Error('Google sign-in was refused.');
    const u = await ok<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
      await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }),
      'Google profile',
    );
    if (!u.email || !u.email_verified) throw new Error('Your Google account has no verified email address.');
    return { subject: u.sub, email: u.email.toLowerCase(), name: u.name || u.email, avatar: u.picture };
  },
};

export const PROVIDERS: Record<string, Provider> = { github, google };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function pkceChallenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Where to go after sign-in: a path on our own site only, never another host. */
export const safeReturn = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\') ? r : '/');
