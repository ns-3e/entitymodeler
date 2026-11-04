// One Durable Object per workspace model: the authoritative copy of its JSON, the last versions, and the live
// connections of everyone who has it open. Saves are ordered here, so two people can't overwrite each other: a
// save names the version it was based on and is refused (with the current text) when that is no longer current.
// Only the Worker can reach this object, after it has checked the session and the person's role.
import { DurableObject } from 'cloudflare:workers';

/** Characters per stored row: SQLite rows are limited to 2 MB, and a character can take up to 3 bytes. */
const CHUNK = 500_000;
/** Versions kept for history and restore (Phase 2 shows them). */
const KEEP = 20;
/** Live messages carry the model text up to this size; larger models send only the version, and clients fetch. */
const PUSH_TEXT = 1_000_000;

export type WriteResult = { ok: true; version: number } | { ok: false; reason: 'conflict'; version: number; text: string } | { ok: false; reason: 'rate' | 'missing' };

export interface Attachment {
  user: string;
  name: string;
  role: string;
}

export class ModelRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Save times in the last minute, for the per-model rate limit. In memory: it resets if the object is evicted. */
  private recent: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks (version INTEGER NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (version, idx))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, size INTEGER NOT NULL)`);
  }

  private current(): number {
    return this.sql.exec<{ v: number | null }>('SELECT MAX(version) AS v FROM versions').one().v ?? 0;
  }

  private store(version: number, text: string, by: string) {
    for (let i = 0, idx = 0; i < text.length || idx === 0; i += CHUNK, idx++) this.sql.exec('INSERT INTO chunks (version, idx, data) VALUES (?, ?, ?)', version, idx, text.slice(i, i + CHUNK));
    this.sql.exec('INSERT INTO versions (version, saved_by, saved_at, size) VALUES (?, ?, ?, ?)', version, by, new Date().toISOString(), text.length);
    this.sql.exec('DELETE FROM chunks WHERE version <= ?', version - KEEP);
    this.sql.exec('DELETE FROM versions WHERE version <= ?', version - KEEP);
  }

  private textOf(version: number): string {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM chunks WHERE version = ? ORDER BY idx', version)
      .toArray()
      .map((r) => r.data)
      .join('');
  }

  /** First version of a new model. Refuses if the model already exists. */
  async create(text: string, by: string): Promise<{ version: number }> {
    if (this.current()) throw new Error('Model already exists.');
    this.store(1, text, by);
    return { version: 1 };
  }

  async read(): Promise<{ version: number; text: string } | null> {
    const version = this.current();
    return version ? { version, text: this.textOf(version) } : null;
  }

  async history(): Promise<{ version: number; saved_by: string; saved_at: string; size: number }[]> {
    return this.sql.exec<{ version: number; saved_by: string; saved_at: string; size: number }>('SELECT version, saved_by, saved_at, size FROM versions ORDER BY version DESC').toArray();
  }

  async write(base: number, text: string, by: string, savesPerMinute: number): Promise<WriteResult> {
    const version = this.current();
    if (!version) return { ok: false, reason: 'missing' };
    if (base !== version) return { ok: false, reason: 'conflict', version, text: this.textOf(version) };
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 60_000);
    if (this.recent.length >= savesPerMinute) return { ok: false, reason: 'rate' };
    this.recent.push(now);
    const next = version + 1;
    this.store(next, text, by);
    this.broadcast({ type: 'version', version: next, by, ...(text.length <= PUSH_TEXT ? { text } : {}) });
    return { ok: true, version: next };
  }

  /** Delete everything: storage and live connections. */
  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4404, 'Model deleted');
    await this.ctx.storage.deleteAll();
  }

  /** WebSocket upgrade, forwarded by the Worker with the checked user in headers. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    const who: Attachment = { user: request.headers.get('x-user-id') || '', name: request.headers.get('x-user-name') || '', role: request.headers.get('x-role') || 'viewer' };
    // Hibernation: idle connections cost nothing; the attachment survives eviction.
    this.ctx.acceptWebSocket(server, [who.user]);
    server.serializeAttachment(who);
    server.send(JSON.stringify({ type: 'hello', version: this.current() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 1000) return;
    let m: { type?: string };
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', version: this.current() }));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Closed');
    } catch {
      /* already closed */
    }
  }

  private broadcast(msg: object) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }
}
