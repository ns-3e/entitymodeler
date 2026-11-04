// IndexedDB storage for the hosted site: one record { id, text } per model. Other tabs hear about
// saves over a BroadcastChannel, which feeds the same reload / conflict flow as file changes on disk.
import { serializeModel, summarizeModel, type GlossaryTerm, type ModelSummary } from '../../core';
import type { ModelStorage } from './types';

const DB_NAME = 'entitymodeler';
const STORE = 'models';
/** Key-value records shared across models (the glossary). Added in DB version 2. */
const KV = 'kv';
const CHANNEL = 'entitymodeler';

interface Rec {
  id: string;
  text: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: 'id' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => bad(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, bad) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => bad(req.error);
  });
}

export function connectBrowser(): ModelStorage {
  const db = openDb();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  const store = async (mode: IDBTransactionMode, name = STORE) => (await db).transaction(name, mode).objectStore(name);
  let persistAsked = false;
  const write = async (rec: Rec) => {
    await done((await store('readwrite')).put(rec));
    channel?.postMessage({ id: rec.id });
    if (!persistAsked) {
      persistAsked = true;
      // Best effort: ask the browser not to evict models under storage pressure.
      navigator.storage?.persist?.().catch(() => {});
    }
  };

  return {
    kind: 'browser',
    location: 'this browser',
    async list() {
      const recs = await done((await store('readonly')).getAll() as IDBRequest<Rec[]>);
      return recs
        .map((r): ModelSummary => {
          try {
            return summarizeModel(r.id, JSON.parse(r.text));
          } catch (e: any) {
            return { id: r.id, title: r.id, error: e.message };
          }
        })
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    },
    async get(id) {
      const rec = await done((await store('readonly')).get(id) as IDBRequest<Rec | undefined>);
      if (!rec) throw new Error(`Model "${id}" not found in this browser.`);
      return rec.text;
    },
    put: (id, text) => write({ id, text }),
    async create(id, model) {
      if (await done((await store('readonly')).count(id))) throw new Error(`Model "${id}" already exists.`);
      await write({ id, text: serializeModel(model) });
    },
    async remove(id) {
      await done((await store('readwrite')).delete(id));
      channel?.postMessage({ id });
    },
    glossary: {
      async get() {
        const rec = await done((await store('readonly', KV)).get('glossary') as IDBRequest<{ id: string; terms: GlossaryTerm[] } | undefined>);
        return rec?.terms || [];
      },
      async put(terms) {
        await done((await store('readwrite', KV)).put({ id: 'glossary', terms }));
        channel?.postMessage({ glossary: true });
      },
      onChange(cb) {
        if (!channel) return () => {};
        const h = (e: MessageEvent<{ glossary?: boolean }>) => e.data.glossary && cb();
        channel.addEventListener('message', h);
        return () => channel.removeEventListener('message', h);
      },
    },
    onChange(cb) {
      if (!channel) return () => {};
      const h = (e: MessageEvent<{ id?: string }>) => e.data.id && cb(e.data.id);
      channel.addEventListener('message', h);
      return () => channel.removeEventListener('message', h);
    },
  };
}
