// Offline support for the hosted site: register the build's service worker (see src/server/pwa.ts).
import { storage } from './storage';
import { useStore } from './store';

export function registerServiceWorker() {
  // Only the static site: local file mode talks to the dev server and must never be served from a cache.
  if (!import.meta.env.PROD || storage.kind !== 'browser' || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) useStore.getState().toast('EntityModel.com was updated — reload to use the new version.', 'info');
  });
  const register = () =>
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    });
  // This runs after storage starts, usually after the page has loaded: then waiting for 'load' never fires.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
