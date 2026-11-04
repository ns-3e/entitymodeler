// Headless Chrome over the DevTools protocol, for the scripts that drive the app (screenshots, ui-audit,
// og-images; each uses its own debugging port, so they can run side by side).
// Needs Google Chrome; set CHROME to its binary if it isn't in the usual place.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers defined in the page by `open()`, for every `page()` body. */
export const HELPERS = `
  window.__wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__btn = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
  window.__click = (el) => { if (!el) throw new Error('missing element'); el.click(); };
  window.__entity = (title) => __click([...document.querySelectorAll('.side-item')].find((b) => b.textContent.trim().replace(/\\d+$/, '') === title));
  window.__type = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.__select = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
`;

/**
 * Start Chrome with a throwaway profile and connect to its page. `send` calls a DevTools method; `page`
 * runs an async function body in the page and returns its result; `open` loads a URL fresh and defines
 * HELPERS; `close` stops Chrome and removes the profile.
 */
export async function launch({ port = 9333 } = {}) {
  // WebSocket is built into Node from 22 (and behind --experimental-websocket in 20.10+).
  if (typeof WebSocket === 'undefined') throw new Error(`These scripts need Node 22 or newer (this is ${process.version}), or node --experimental-websocket`);
  const profile = mkdtempSync(join(tmpdir(), 'em-chrome-'));
  // GitHub's Ubuntu runners don't allow Chrome's sandbox; there it only ever loads the local dev server.
  const sandbox = process.env.CI ? ['--no-sandbox'] : [];
  // A cold CI runner can take well over 10 s to bring Chrome up: wait up to 45 s, and relaunch once.
  let chrome;
  let target;
  let stderr = '';
  for (let attempt = 0; attempt < 2 && !target; attempt++) {
    if (chrome) chrome.kill('SIGKILL');
    chrome = spawn(CHROME, ['--headless=new', ...sandbox, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
    for (let i = 0; i < 150 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === 'page');
      } catch {
        // not listening yet
      }
      if (!target) await sleep(300);
    }
  }
  const ws = target && new WebSocket(target.webSocketDebuggerUrl);
  if (!ws) throw new Error(`Chrome did not start within 90 s.${stderr ? `\nChrome said:\n${stderr}` : ''}`);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, bad } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? bad(new Error(msg.error.message)) : ok(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((ok, bad) => {
      const id = ++seq;
      pending.set(id, { ok, bad });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const page = async (body) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (url, settle = 2500) => {
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url });
    await sleep(settle);
    await page(`${HELPERS} await document.fonts.ready; return true;`);
  };
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  return { send, page, open, close };
}
