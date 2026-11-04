import { connectBrowser } from './browser';
import { connectCloud, withCloud, type CloudClient } from './cloud';
import { connectFiles } from './files';
import type { ModelStorage } from './types';

export type { ModelStorage } from './types';

/** Set once by initStorage() before the app renders. */
export let storage: ModelStorage;
/** Shared workspaces, when this site has the cloud API (null otherwise, e.g. the static site today). */
export let cloud: CloudClient | null = null;

/** Files when the dev-server API answers (npm run dev, the macOS service); browser storage otherwise. ?storage=browser forces browser. */
export async function initStorage(): Promise<ModelStorage> {
  const forceBrowser = new URLSearchParams(location.search).get('storage') === 'browser';
  const [base, c] = await Promise.all([(async () => (!forceBrowser && (await connectFiles())) || connectBrowser())(), connectCloud()]);
  cloud = c;
  storage = c ? withCloud(base) : base;
  return storage;
}
