import { connectBrowser } from './browser';
import { connectFiles } from './files';
import type { ModelStorage } from './types';

export type { ModelStorage } from './types';

/** Set once by initStorage() before the app renders. */
export let storage: ModelStorage;

/** Files when the dev-server API answers (npm run dev, the macOS service); browser storage otherwise. ?storage=browser forces browser. */
export async function initStorage(): Promise<ModelStorage> {
  const forceBrowser = new URLSearchParams(location.search).get('storage') === 'browser';
  storage = (!forceBrowser && (await connectFiles())) || connectBrowser();
  return storage;
}
