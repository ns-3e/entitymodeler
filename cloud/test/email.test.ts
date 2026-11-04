import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailer, type SignInMail } from '../src/email';

const base = 'https://entitymodel.com/api/cloud';
const ORIGIN = 'https://entitymodel.com';
const post = (path: string, body: BodyInit, type = 'application/json') => exports.default.fetch(`${base}/${path}`, { method: 'POST', redirect: 'manual', body, headers: { Origin: ORIGIN, 'Content-Type': type } });
const get = (path: string, cookie = '') => exports.default.fetch(`${base}/${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });

function captureMail() {
  const sent: SignInMail[] = [];
  vi.spyOn(mailer, 'send').mockImplementation(async (_env, mail) => void sent.push(mail));
  return sent;
}
const tokenOf = (mail: SignInMail) => new URL(mail.link).searchParams.get('token')!;

afterEach(() => vi.restoreAllMocks());

describe('sign-in by email link', () => {
  it('emails a link whose page signs in only when the button is pressed, once', async () => {
    const sent = captureMail();
    expect((await post('auth/email/start', JSON.stringify({ email: 'Grace@Example.com', return: '/models' }))).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('grace@example.com');
    expect(sent[0].link).toMatch(/^https:\/\/entitymodel\.com\/api\/cloud\/auth\/email\/callback\?token=/);
    const token = tokenOf(sent[0]);

    // Opening the link (as a mail scanner would) doesn't sign in or use it up.
    for (let i = 0; i < 2; i++) {
      const page = await get(`auth/email/callback?token=${token}`);
      expect(page.status).toBe(200);
      expect(page.headers.getSetCookie()).toEqual([]);
      // no-referrer would make the browser send "Origin: null" with the form, which the origin check refuses.
      expect(page.headers.get('Referrer-Policy')).toBe('same-origin');
      expect(await page.text()).toContain('grace@example.com');
    }

    const verify = await post('auth/email/verify', new URLSearchParams({ token }), 'application/x-www-form-urlencoded');
    expect(verify.status).toBe(303);
    expect(verify.headers.get('Location')).toBe('/models');
    const session = verify.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('em_session='))!;
    expect(((await (await get('me', session)).json()) as { user: { email: string } }).user.email).toBe('grace@example.com');

    const again = await post('auth/email/verify', new URLSearchParams({ token }), 'application/x-www-form-urlencoded');
    expect(again.headers.get('Location')).toMatch(/signin_error=/);
    expect((await get(`auth/email/callback?token=${token}`)).headers.get('Location')).toMatch(/signin_error=/);
  });

  it('limits links per address, refuses bad input and other origins', async () => {
    captureMail();
    for (let i = 0; i < 5; i++) expect((await post('auth/email/start', JSON.stringify({ email: 'flood@example.com' }))).status).toBe(200);
    expect((await post('auth/email/start', JSON.stringify({ email: 'flood@example.com' }))).status).toBe(429);
    expect((await post('auth/email/start', JSON.stringify({ email: 'not-an-email' }))).status).toBe(400);
    const evil = await exports.default.fetch(`${base}/auth/email/start`, { method: 'POST', body: JSON.stringify({ email: 'x@example.com' }), headers: { Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
  });

  it('reports a failed send', async () => {
    vi.spyOn(mailer, 'send').mockRejectedValue(Object.assign(new Error('nope'), { code: 'E_RATE_LIMIT_EXCEEDED' }));
    expect((await post('auth/email/start', JSON.stringify({ email: 'late@example.com' }))).status).toBe(502);
  });
});
