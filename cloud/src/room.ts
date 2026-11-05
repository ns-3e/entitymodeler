// One Durable Object per workspace model: the authoritative copy of its JSON, the last versions, and the live
// connections of everyone who has it open. Saves are ordered here, so two people can't overwrite each other: a
// save names the version it was based on and is refused (with the current text) when that is no longer current.
// Only the Worker can reach this object, after it has checked the session and the person's role.
import { DurableObject } from 'cloudflare:workers';

/** Characters per stored row: SQLite rows are limited to 2 MB, and a character can take up to 3 bytes. */
const CHUNK = 500_000;
/** The latest saves are all kept. The editor saves every second or so while someone works, so this covers minutes. */
const KEEP = 20;
/** Beyond those, the last save of each hour, so history reaches back further than the current session. */
const HOURLY = 30;
/** Models above this size keep fewer hourly versions, to bound what one model can store. */
const LARGE = 1_000_000;
const HOURLY_LARGE = 5;
/** Live messages carry the model text up to this size; larger models send only the version, and clients fetch. */
const PUSH_TEXT = 1_000_000;
/** Clients ping every minute, so a connection silent for this long is gone. */
const STALE_MS = 150_000;
/** Selected entities shared per connection, and the longest name shared. */
const MAX_SELECTED = 8;
const MAX_NAME = 60;
/** Selection changes closer together than this are ignored. The app sends at most one every 300 ms. */
const MIN_SELECT_MS = 100;

export type WriteResult = { ok: true; version: number } | { ok: false; reason: 'conflict'; version: number; text: string } | { ok: false; reason: 'rate' | 'missing' };

/** What a connection carries across hibernation. Attachments are limited to 2 KB, which the limits below respect. */
export interface Attachment {
  user: string;
  name: string;
  role: string;
  /** Last message from this connection, to drop ones that vanished without closing (a laptop going to sleep). */
  seen: number;
  /** Last selection change, to limit how often one can be shared. */
  selectedAt: number;
  /** What the person has selected. Held only while connected, never stored with the model. */
  tab: string | null;
  entities: string[];
}

export interface Present {
  user: string;
  name: string;
  tab: string | null;
  entities: string[];
}

export class ModelRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Save times in the last minute, for the per-model rate limit. In memory: it resets if the object is evicted. */
  private recent: number[] = [];
  /** deleteAll() drops the tables, but this instance can live on and take more calls: they should find no model. */
  private destroyed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chunks (version INTEGER NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (version, idx))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, saved_by TEXT NOT NULL, saved_at TEXT NOT NULL, size INTEGER NOT NULL)`);
  }

  private current(): number {
    if (this.destroyed) return 0;
    return this.sql.exec<{ v: number | null }>('SELECT MAX(version) AS v FROM versions').one().v ?? 0;
  }

  private store(version: number, text: string, by: string) {
    for (let i = 0, idx = 0; i < text.length || idx === 0; i += CHUNK, idx++) this.sql.exec('INSERT INTO chunks (version, idx, data) VALUES (?, ?, ?)', version, idx, text.slice(i, i + CHUNK));
    this.sql.exec('INSERT INTO versions (version, saved_by, saved_at, size) VALUES (?, ?, ?, ?)', version, by, new Date().toISOString(), text.length);
    this.sql.exec(
      'DELETE FROM versions WHERE version <= ? AND version NOT IN (SELECT MAX(version) AS v FROM versions GROUP BY substr(saved_at, 1, 13) ORDER BY v DESC LIMIT ?)',
      version - KEEP,
      text.length > LARGE ? HOURLY_LARGE : HOURLY,
    );
    this.sql.exec('DELETE FROM chunks WHERE version NOT IN (SELECT version FROM versions)');
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

  /** The text of a version still kept, or null. */
  async readVersion(version: number): Promise<string | null> {
    if (this.destroyed || !this.sql.exec('SELECT 1 FROM versions WHERE version = ?', version).toArray().length) return null;
    return this.textOf(version);
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
    this.destroyed = true;
  }

  /** Close one person's connections, when they no longer have access. Code 4404 tells the app not to reconnect. */
  async disconnect(user: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(user)) ws.close(4404, 'Access removed');
    this.sharePresence((a) => a.user !== user);
  }

  /** WebSocket upgrade, forwarded by the Worker with the checked user in headers. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    const who: Attachment = { user: request.headers.get('x-user-id') || '', name: (request.headers.get('x-user-name') || '').slice(0, 254), role: request.headers.get('x-role') || 'viewer', seen: Date.now(), selectedAt: 0, tab: null, entities: [] };
    // Hibernation: idle connections cost nothing; the attachment survives eviction.
    this.ctx.acceptWebSocket(server, [who.user]);
    server.serializeAttachment(who);
    server.send(JSON.stringify({ type: 'hello', version: this.current(), you: who.user }));
    this.sharePresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 1000) return;
    let m: { type?: string; tab?: unknown; entities?: unknown };
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    const who = ws.deserializeAttachment() as Attachment;
    const now = Date.now();
    if (m.type === 'ping') {
      ws.serializeAttachment({ ...who, seen: now });
      ws.send(JSON.stringify({ type: 'pong', version: this.current() }));
      ws.send(JSON.stringify({ type: 'presence', people: this.present() }));
    } else if (m.type === 'select') {
      if (now - who.selectedAt < MIN_SELECT_MS) return;
      const entities = (Array.isArray(m.entities) ? m.entities : []).filter((e): e is string => typeof e === 'string' && e.length <= MAX_NAME).slice(0, MAX_SELECTED);
      ws.serializeAttachment({ ...who, seen: now, selectedAt: now, tab: typeof m.tab === 'string' ? m.tab.slice(0, MAX_NAME) : null, entities });
      this.sharePresence();
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'Closed');
    } catch {
      /* already closed */
    }
    this.sharePresence(undefined, ws);
  }

  async webSocketError(ws: WebSocket) {
    this.sharePresence(undefined, ws);
  }

  /** Who is connected now. One entry per connection: the app merges a person's several tabs. */
  private present(keep?: (a: Attachment) => boolean, gone?: WebSocket): Present[] {
    const cutoff = Date.now() - STALE_MS;
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== gone && ws.readyState === WebSocket.OPEN)
      .map((ws) => ws.deserializeAttachment() as Attachment)
      .filter((a) => a.seen > cutoff && (!keep || keep(a)))
      .map(({ user, name, tab, entities }) => ({ user, name, tab, entities }));
  }

  private sharePresence(keep?: (a: Attachment) => boolean, gone?: WebSocket) {
    this.broadcast({ type: 'presence', people: this.present(keep, gone) });
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
