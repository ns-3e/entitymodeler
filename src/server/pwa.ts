// Build-time service worker: precaches every file of this build so entitymodel.com works offline once visited.
// Generated per build, so the cache list always matches the hashed asset names.
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/** Files from public/ to precache (the bundle's own files are added automatically). */
const PUBLIC_FILES = ['/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

const WORKER = `// EntityModel.com service worker (generated at build time).
const CACHE = 'em-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('em-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // The API and the static docs pages (/docs/, llms.txt) go straight to the network.
  // (No regex literals in this template: a backslash in it would be lost and break the worker.)
  const path = url.pathname;
  if (req.method !== 'GET' || url.origin !== self.location.origin || path.startsWith('/api/') || path.startsWith('/docs/') || path.startsWith('/llms')) return;
  if (req.mode === 'navigate') {
    // Pages: network first (to pick up new releases), the cached app when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok && url.pathname === '/') caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }
  // Hashed assets and icons: cache first.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;

/** The service worker's source for one build. */
export function workerSource(version: string, precache: string[]) {
  return WORKER.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2));
}

export function serviceWorker(): Plugin {
  return {
    name: 'em-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f !== 'index.html' && !f.endsWith('.map'))
        .map((f) => `/${f}`);
      const precache = ['/', ...files, ...PUBLIC_FILES];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(version, precache) });
    },
  };
}
