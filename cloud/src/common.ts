// What the API (index.ts), OAuth (oauth.ts) and the MCP server (mcp.ts) share: errors, role checks, and saving a model.
import { quotaFor } from './quotas';
import type { WriteResult } from './room';

export type Role = 'owner' | 'editor' | 'viewer';
export const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export interface User {
  id: string;
  email: string;
  name: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: object,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
export const now = () => new Date().toISOString();
/** 128-bit random id, URL-safe. */
export const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 22);

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const SESSION_COOKIE = 'em_session';

export function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
}

export async function sessionUser(req: Request, env: Env): Promise<User | null> {
  const token = cookie(req, SESSION_COOKIE);
  if (!token) return null;
  return env.DB.prepare('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.suspended_at IS NULL')
    .bind(await sha256(token), now())
    .first<User>();
}

/** A model file: JSON with an entities list. Returns its title. */
export function checkModel(text: string, maxBytes: number): string {
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, `Models are limited to ${Math.round(maxBytes / 1e6)} MB.`);
  let m: { title?: unknown; entities?: unknown };
  try {
    m = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The model is not valid JSON.');
  }
  if (!m || typeof m !== 'object' || !Array.isArray(m.entities)) throw new HttpError(400, 'Not a model file: it has no entities list.');
  return typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 200) : 'Untitled model';
}

export async function roleIn(env: Env, workspace: string, user: string): Promise<{ role: Role; plan: string } | null> {
  return env.DB.prepare('SELECT m.role, w.plan FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.workspace_id = ? AND m.user_id = ?').bind(workspace, user).first<{ role: Role; plan: string }>();
}

export async function need(env: Env, workspace: string, user: string, min: Role) {
  const r = await roleIn(env, workspace, user);
  // Not a member looks the same as not existing, so ids can't be probed.
  if (!r) throw new HttpError(404, 'Not found.');
  if (RANK[r.role] < RANK[min]) throw new HttpError(403, `This needs the ${min} role.`);
  return r;
}

export async function modelAccess(env: Env, model: string, user: string, min: Role) {
  const row = await env.DB.prepare('SELECT workspace_id, title FROM models WHERE id = ?').bind(model).first<{ workspace_id: string; title: string }>();
  if (!row) throw new HttpError(404, 'Not found.');
  return { ...row, ...(await need(env, row.workspace_id, user, min)) };
}

export const room = (env: Env, model: string) => env.MODEL.get(env.MODEL.idFromName(model));

/** A new model in a workspace, within its quotas. The caller has checked the person's role. */
export async function addModel(env: Env, workspace: string, plan: string, text: string, user: string, via?: string) {
  const q = quotaFor(plan);
  const title = checkModel(text, q.modelBytes);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM models WHERE workspace_id = ?').bind(workspace).first<{ n: number }>();
  if ((count?.n ?? 0) >= q.modelsPerWorkspace) throw new HttpError(403, `Workspaces are limited to ${q.modelsPerWorkspace} models.`);
  const id = newId();
  await room(env, id).create(text, user, via);
  await env.DB.prepare('INSERT INTO models (id, workspace_id, title, size, created_by, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, workspace, title, text.length, user, now(), now(), user).run();
  return { id, title };
}

/** Save a new version on top of `base`. A newer version comes back as a conflict; other refusals throw. */
export async function commit(env: Env, id: string, plan: string, base: number, text: string, user: string, via?: string): Promise<Extract<WriteResult, { ok: true }> | Extract<WriteResult, { reason: 'conflict' }>> {
  const q = quotaFor(plan);
  const title = checkModel(text, q.modelBytes);
  const r: WriteResult = await room(env, id).write(base, text, user, q.savesPerMinute, via);
  if (!r.ok) {
    if (r.reason === 'conflict') return r;
    if (r.reason === 'rate') throw new HttpError(429, 'Too many saves for this model; try again in a minute.');
    throw new HttpError(404, 'Not found.');
  }
  await env.DB.prepare('UPDATE models SET title = ?, size = ?, updated_at = ?, updated_by = ? WHERE id = ?').bind(title, text.length, now(), user, id).run();
  return r;
}
