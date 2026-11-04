// Installing EntityModel.com as a standalone app (Chrome, Edge): the install prompt, model files the OS
// opens with the app (manifest file_handlers), and the window's title-bar colour.
import { create } from 'zustand';
import { normalizeModel, toInternalName, type DataModel } from '../core';
import { storage } from './storage';
import { useStore } from './store';

/** Chrome's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

/** Whether the app can be installed right now, and whether it is running as the installed app. */
export const useInstall = create<{ prompt: InstallPromptEvent | null; standalone: boolean }>(() => ({ prompt: null, standalone: standalone() }));

/** Show the browser's install dialog. */
export async function installApp() {
  const p = useInstall.getState().prompt;
  if (!p) return;
  await p.prompt();
  const { outcome } = await p.userChoice;
  // The event can only be used once.
  useInstall.setState({ prompt: null });
  if (outcome === 'accepted') useStore.getState().toast('Installed. Open EntityModel.com from your apps, dock or Start menu.', 'success');
}

const toId = (s: string) => toInternalName(s).replace(/_/g, '-').slice(0, 60);

/** Save a model under a free id and open it. */
export async function createAndOpen(m: DataModel, idBase: string) {
  const taken = new Set((await storage.list()).map((x) => x.id));
  let id = toId(idBase) || 'model';
  for (let i = 2; taken.has(id); i++) id = `${toId(idBase) || 'model'}-${i}`;
  await storage.create(id, m);
  await useStore.getState().openModel(id);
}

/** Open a model .json file as a copy. */
export async function openModelFile(f: File) {
  try {
    const m = normalizeModel(JSON.parse(await f.text()));
    await createAndOpen(m, m.name || m.title);
  } catch (e: any) {
    useStore.getState().toast(`Could not open ${f.name}: ${e.message}`, 'error');
  }
}

// The installed window's title bar takes the top bar's colour, following the app's theme.
const TITLE_BAR = { light: '#fafaf8', dark: '#1f2023' };
function syncTitleBar(theme: 'light' | 'dark') {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = TITLE_BAR[theme];
  document.head.appendChild(meta);
}

// Listen from the start: the prompt can arrive before storage is ready.
window.addEventListener('beforeinstallprompt', (e) => {
  // Keep it for our own Install button instead of Chrome's mini-infobar.
  e.preventDefault();
  useInstall.setState({ prompt: e as InstallPromptEvent });
});
window.addEventListener('appinstalled', () => useInstall.setState({ prompt: null }));
window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => useInstall.setState({ standalone: standalone() }));

/** Once storage is ready: open launched files, and keep the title bar in step with the theme. */
export function initInstall() {
  // Files opened with the installed app ("Open with", or dropped on its icon).
  (window as any).launchQueue?.setConsumer(async (params: { files?: FileSystemFileHandle[] }) => {
    for (const handle of params.files || []) await openModelFile(await handle.getFile());
  });

  syncTitleBar(useStore.getState().display.theme);
  useStore.subscribe((s, prev) => {
    if (s.display.theme !== prev.display.theme) syncTitleBar(s.display.theme);
  });
}
