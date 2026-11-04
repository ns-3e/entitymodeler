// Sign-in links by email (Cloudflare Email Service, from signin@entitymodel.com). The link opens a page with a
// "Sign in" button instead of signing in on GET: mail scanners open links in messages, and a one-time link they
// open first would be used up before the person clicks it.

/** Links per address per hour, so the form can't be used to flood someone's inbox. */
export const LINKS_PER_HOUR = 5;
export const LINK_MINUTES = 15;

export interface SignInMail {
  to: string;
  link: string;
}

/** Indirection so tests can capture mail instead of sending it. */
export const mailer = {
  async send(env: Env, mail: SignInMail): Promise<void> {
    await env.EMAIL.send({
      from: { email: env.EMAIL_FROM, name: 'EntityModel.com' },
      to: mail.to,
      replyTo: env.EMAIL_REPLY_TO,
      subject: 'Sign in to EntityModel.com',
      text: [
        'Use this link to sign in to EntityModel.com:',
        '',
        mail.link,
        '',
        `It works once, for ${LINK_MINUTES} minutes. If you didn't ask to sign in, ignore this email: nothing happens without the link.`,
      ].join('\n'),
      html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#1b1b1b;max-width:480px;margin:24px auto;padding:0 16px">
<h1 style="font-size:20px;margin:0 0 16px">Sign in to EntityModel.com</h1>
<p><a href="${escapeHtml(mail.link)}" style="display:inline-block;background:#1b1b1b;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Sign in</a></p>
<p style="color:#555;font-size:14px">The link works once, for ${LINK_MINUTES} minutes. If you didn't ask to sign in, ignore this email: nothing happens without the link.</p>
</body></html>`,
    });
  },
};

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The page the emailed link opens: a button that POSTs the token, so only a person's click signs in. */
export function confirmPage(token: string, email: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · EntityModel.com</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;background:Canvas;color:CanvasText}
h1{font-size:22px;margin:0 0 8px}p{opacity:.8}button{font:inherit;padding:10px 18px;border-radius:6px;border:0;background:CanvasText;color:Canvas;cursor:pointer}</style></head>
<body><h1>Sign in to EntityModel.com</h1><p>as ${escapeHtml(email)}</p>
<form method="post" action="/api/cloud/auth/email/verify"><input type="hidden" name="token" value="${escapeHtml(token)}"><button>Sign in</button></form></body></html>`;
}
