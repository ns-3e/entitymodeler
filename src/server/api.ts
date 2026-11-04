// Dev-server middleware: reads/writes models/<id>/model.json and pushes a websocket event
// when a model file changes on disk (e.g. Claude edited it), so the UI reloads live.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { summarizeModel } from '../core/model';
import { GLOSSARY_FILE, deleteProposal, glossaryText, listProposals, readGlossary } from './workbench';
import { agentAvailable, cancelAgent, startAgent } from './agent';

const MODEL_FILE = 'model.json';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,150}$/;

const hash = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, bad) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', bad);
  });
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/**
 * State-changing requests must come from the app itself. Browsers send Origin on cross-site POST/PUT/DELETE,
 * so this stops other websites from driving the local API (writing models, starting the agent).
 */
function sameOrigin(req: IncomingMessage): boolean {
  if (!LOCAL_HOST.test(req.headers.host || '')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function modelApi(root: string): Plugin {
  const modelsDir = resolve(root, 'models');
  // Content we wrote ourselves, so the watcher does not echo our own saves back to the UI.
  const selfWritten = new Map<string, string>();

  const modelPath = (id: string) => join(modelsDir, id, MODEL_FILE);

  return {
    name: 'em-model-api',
    configureServer(server: ViteDevServer) {
      mkdirSync(modelsDir, { recursive: true });
      watchModels(server);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://x');
        if (!url.pathname.startsWith('/api/')) return next();
        const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // after "api"
        try {
          if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Requests must come from the EntityModel.com app.' });
          if (parts[0] === 'info' && req.method === 'GET') return send(res, 200, { root, modelsDir, agent: agentAvailable() });
          if (parts[0] === 'agent' && parts[1] && parts[2] === 'cancel' && req.method === 'POST') return send(res, 200, { ok: cancelAgent(parts[1]) });

          if (parts[0] === 'glossary' && req.method === 'GET') return send(res, 200, readGlossary(modelsDir));
          if (parts[0] === 'glossary' && req.method === 'PUT') {
            const terms = JSON.parse((await readBody(req)).toString('utf8'));
            if (!Array.isArray(terms)) return send(res, 400, { error: 'Expected an array of terms.' });
            const text = glossaryText(terms);
            selfWritten.set(GLOSSARY_FILE, hash(text));
            writeFileSync(join(modelsDir, GLOSSARY_FILE), text);
            return send(res, 200, { ok: true });
          }

          if (parts[0] !== 'models') return send(res, 404, { error: 'not found' });
          const id = parts[1];

          if (!id && req.method === 'GET') {
            const list = readdirSync(modelsDir)
              .filter((d) => existsSync(modelPath(d)))
              .map((d) => {
                try {
                  return summarizeModel(d, JSON.parse(readFileSync(modelPath(d), 'utf8')), statSync(modelPath(d)).mtime.toISOString());
                } catch (e: any) {
                  return { id: d, title: d, error: e.message };
                }
              })
              .sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
            return send(res, 200, list);
          }

          if (!id && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8'));
            const newId: string = body.id;
            if (!ID_RE.test(newId)) return send(res, 400, { error: 'Invalid model id (lowercase letters, digits, - and _).' });
            if (existsSync(modelPath(newId))) return send(res, 409, { error: `Model "${newId}" already exists.` });
            mkdirSync(join(modelsDir, newId, 'inputs'), { recursive: true });
            const text = JSON.stringify(body.model, null, 2) + '\n';
            selfWritten.set(newId, hash(text));
            writeFileSync(modelPath(newId), text);
            return send(res, 201, { id: newId });
          }

          if (!id || !ID_RE.test(id)) return send(res, 400, { error: 'Invalid model id.' });

          if (parts[2] === 'exports' && parts[3] && req.method === 'POST') {
            if (!FILE_RE.test(parts[3])) return send(res, 400, { error: 'Invalid file name.' });
            const dir = join(modelsDir, id, 'exports');
            mkdirSync(dir, { recursive: true });
            const target = join(dir, parts[3]);
            if (!target.startsWith(dir + sep)) return send(res, 400, { error: 'Invalid path.' });
            writeFileSync(target, await readBody(req));
            return send(res, 201, { path: target });
          }

          if (parts[2] === 'proposals' && !parts[3] && req.method === 'GET') return send(res, 200, listProposals(join(modelsDir, id)));
          if (parts[2] === 'proposals' && parts[3] && req.method === 'DELETE') return send(res, deleteProposal(join(modelsDir, id), parts[3]) ? 200 : 404, { ok: true });

          if (parts[2] === 'agent' && req.method === 'POST') {
            if (!agentAvailable()) return send(res, 501, { error: 'The claude CLI is not installed on this machine.' });
            if (!existsSync(modelPath(id))) return send(res, 404, { error: 'Model not found.' });
            const body = JSON.parse((await readBody(req)).toString('utf8'));
            if (typeof body.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { error: 'Empty request.' });
            return send(res, 202, { runId: startAgent(server, root, id, { prompt: body.prompt.slice(0, 8000), tab: body.tab, selection: Array.isArray(body.selection) ? body.selection.slice(0, 200) : undefined }) });
          }

          if (parts.length === 2 && req.method === 'GET') {
            if (!existsSync(modelPath(id))) return send(res, 404, { error: 'Model not found.' });
            const text = readFileSync(modelPath(id), 'utf8');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Model-Hash', hash(text));
            return res.end(text);
          }

          if (parts.length === 2 && req.method === 'PUT') {
            const text = (await readBody(req)).toString('utf8');
            JSON.parse(text); // reject invalid JSON
            if (!existsSync(join(modelsDir, id))) mkdirSync(join(modelsDir, id), { recursive: true });
            selfWritten.set(id, hash(text));
            writeFileSync(modelPath(id), text);
            return send(res, 200, { ok: true, hash: hash(text) });
          }

          return send(res, 405, { error: 'Method not allowed' });
        } catch (e: any) {
          return send(res, 500, { error: e.message || String(e) });
        }
      });
    },
  };

  function watchModels(server: ViteDevServer) {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    try {
      watch(modelsDir, { recursive: true }, (_evt, filename) => {
        if (!filename) return;
        const f = filename.toString().split(sep);
        if (f.length === 1 && f[0] === GLOSSARY_FILE) {
          clearTimeout(timers.get('glossary'));
          timers.set(
            'glossary',
            setTimeout(() => {
              const file = join(modelsDir, GLOSSARY_FILE);
              const h = existsSync(file) ? hash(readFileSync(file, 'utf8')) : '';
              if (selfWritten.get(GLOSSARY_FILE) === h) return;
              selfWritten.set(GLOSSARY_FILE, h);
              server.ws.send({ type: 'custom', event: 'em:glossary', data: {} });
            }, 150),
          );
          return;
        }
        // Proposals (from agents or `em apply`) arrive as files too.
        if (f.length === 3 && f[1] === 'proposals' && f[2].endsWith('.json')) {
          clearTimeout(timers.get(`p:${f[0]}`));
          timers.set(`p:${f[0]}`, setTimeout(() => server.ws.send({ type: 'custom', event: 'em:proposals', data: { id: f[0] } }), 150));
          return;
        }
        if (f.length !== 2 || f[1] !== MODEL_FILE) return;
        const id = f[0];
        clearTimeout(timers.get(id));
        timers.set(
          id,
          setTimeout(() => {
            if (!existsSync(modelPath(id))) return;
            const text = readFileSync(modelPath(id), 'utf8');
            const h = hash(text);
            if (selfWritten.get(id) === h) return;
            selfWritten.set(id, h);
            server.ws.send({ type: 'custom', event: 'em:changed', data: { id, hash: h } });
          }, 150),
        );
      });
    } catch (e) {
      console.warn('[em] file watching unavailable:', e);
    }
  }
}
