import { create } from 'zustand';
import { produce } from 'immer';
import { MAIN_TAB, hasTab, normalizeModel, serializeModel, tabView, validateModel, validateTabs, withTab, type DataModel, type Issue } from '../core';
import { storage } from './storage';
import { CloudConflict, isCloudId } from './storage/cloud';
import { placeUnpositioned } from './canvas/layout';

export type Selection =
  | { kind: 'model' }
  | { kind: 'entity'; name: string; tab?: string; attribute?: string }
  | { kind: 'relationship'; name: string }
  | { kind: 'hierarchy'; name: string }
  | { kind: 'area'; id: string }
  | { kind: 'note'; id: string };

export type Tool = 'select' | 'relationship';
export type Detail = 'full' | 'keys' | 'title';

export interface Display {
  detail: Detail;
  showRelationships: boolean;
  showReferences: boolean;
  showDependencies: boolean;
  showMinimap: boolean;
  focusHierarchy: string | null;
  theme: 'light' | 'dark';
  showSidebar: boolean;
  showInspector: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
}

/** Phone-sized screens: side panels become drawers over the diagram (see styles.css). */
export const isNarrow = () => !!window.matchMedia?.('(max-width: 760px)').matches;
const pickPanels = (d: Partial<Display>) => ({ showSidebar: d.showSidebar ?? true, showInspector: d.showInspector ?? true });

export const PANEL_WIDTHS = {
  sidebar: { default: 252, min: 180, max: 520 },
  inspector: { default: 430, min: 320, max: 900 },
};

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

interface State {
  modelId: string | null;
  /** The whole model file, every tab. Saved, and what undo/redo step through. */
  doc: DataModel | null;
  /** The active tab as a single-tab model (see tabView). Everything that edits or shows the diagram uses this. */
  model: DataModel | null;
  activeTab: string;
  issues: Issue[];
  past: DataModel[];
  future: DataModel[];
  /** Canvas items selected together (node ids: entity:x, area:id, note:id). `selection` is the one the inspector shows. */
  multi: string[];
  /** Render every node, not just those on screen (image export captures the DOM). */
  renderAll: boolean;
  lastCoalesce: { key: string; at: number } | null;
  saveState: 'saved' | 'pending' | 'saving' | 'error';
  savedText: string;
  externalModel: DataModel | null;
  selection: Selection;
  view: 'diagram' | 'tables' | 'issues' | 'mappings' | 'glossary';
  tool: Tool;
  pendingSource: string | null;
  display: Display;
  toasts: Toast[];
  layoutRequest: number;
  fitRequest: number;

  openModel(id: string): Promise<void>;
  /** Back to the home page; `resetHash` false keeps the current URL fragment (e.g. a share link). */
  closeModel(resetHash?: boolean): void;
  /** Edit the active tab (header fields like title go to the model). */
  update(fn: (m: DataModel) => void, coalesceKey?: string): void;
  /** Edit the whole file: tabs, their meta and content. */
  updateDoc(fn: (d: DataModel) => void): void;
  /** Housekeeping edit that saves but is not an undo step (e.g. refreshing the glossary snapshot). */
  amend(fn: (d: DataModel) => void): void;
  /** Swap in new content for the active tab (e.g. an import merge) as one undoable step. */
  replaceModel(next: DataModel): void;
  setActiveTab(id: string): void;
  setMulti(ids: string[]): void;
  undo(): void;
  redo(): void;
  select(s: Selection): void;
  setView(v: State['view']): void;
  setTool(t: Tool): void;
  setPendingSource(n: string | null): void;
  setDisplay(p: Partial<Display>): void;
  toast(text: string, kind?: Toast['kind']): void;
  saveNow(): Promise<void>;
  acceptExternal(): void;
  dismissExternal(): void;
  receiveExternal(m: DataModel): void;
  requestLayout(): void;
  requestFit(): void;
}

const HISTORY_LIMIT = 150;
const loadDisplay = (): Display => {
  const d: Display = {
    detail: 'full',
    showRelationships: true,
    showReferences: true,
    showDependencies: true,
    showMinimap: false,
    focusHierarchy: null,
    theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    showSidebar: true,
    showInspector: true,
    sidebarWidth: PANEL_WIDTHS.sidebar.default,
    inspectorWidth: PANEL_WIDTHS.inspector.default,
  };
  try {
    const saved = { ...d, ...JSON.parse(localStorage.getItem('em.display') || '{}'), focusHierarchy: null };
    // On a phone the drawers start closed so the diagram is visible.
    return isNarrow() ? { ...saved, showSidebar: false, showInspector: false } : saved;
  } catch {
    return d;
  }
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 1;

/** State derived from a new file: the active tab's view and its issues. Falls back to the primary tab. */
function derive(doc: DataModel, activeTab: string) {
  const tab = hasTab(doc, activeTab) ? activeTab : MAIN_TAB;
  const model = tabView(doc, tab);
  return { doc, model, activeTab: tab, issues: [...validateTabs(doc), ...validateModel(model)] };
}

const tabKey = (id: string) => `em.tab.${id}`;
function rememberTab(modelId: string | null, tab: string) {
  try {
    if (modelId) localStorage.setItem(tabKey(modelId), tab);
  } catch {
    /* storage unavailable */
  }
}

/** Node id for a selection, for keeping the canvas multi-selection in step with the inspector. */
function nodeIdOf(s: Selection): string | null {
  if (s.kind === 'entity') return `entity:${s.name}`;
  if (s.kind === 'area') return `area:${s.id}`;
  if (s.kind === 'note') return `note:${s.id}`;
  return null;
}

export const useStore = create<State>((set, get) => ({
  modelId: null,
  doc: null,
  model: null,
  activeTab: MAIN_TAB,
  multi: [],
  renderAll: false,
  issues: [],
  past: [],
  future: [],
  lastCoalesce: null,
  saveState: 'saved',
  savedText: '',
  externalModel: null,
  selection: { kind: 'model' },
  view: 'diagram',
  tool: 'select',
  pendingSource: null,
  display: loadDisplay(),
  toasts: [],
  layoutRequest: 0,
  fitRequest: 0,

  async openModel(id) {
    const text = await storage.get(id);
    const doc = normalizeModel(JSON.parse(text));
    let tab = MAIN_TAB;
    try {
      tab = localStorage.getItem(tabKey(id)) || MAIN_TAB;
    } catch {
      /* storage unavailable */
    }
    const d = derive(doc, tab);
    set({
      modelId: id,
      ...d,
      past: [],
      future: [],
      savedText: text,
      saveState: 'saved',
      externalModel: null,
      selection: { kind: 'model' },
      multi: [],
      view: 'diagram',
      tool: 'select',
    });
    history.replaceState(null, '', `#/model/${encodeURIComponent(id)}`);
    // Entities without a canvas position (e.g. added by Claude) get laid out once the canvas mounts.
    if (d.model.entities.some((e) => !e.ui)) set({ layoutRequest: get().layoutRequest + 1 });
  },

  closeModel(resetHash = true) {
    clearTimeout(saveTimer);
    const id = get().modelId;
    // Closing during "changed elsewhere": ask which version wins rather than dropping these edits silently.
    if (get().externalModel && get().saveState === 'pending') {
      if (window.confirm('Someone else saved this model while you had unsaved edits. Keep your edits (replacing their version)? Cancel keeps theirs.')) set({ externalModel: null });
      else set({ saveState: 'saved' });
    }
    const saved = get().saveState === 'pending' ? get().saveNow() : Promise.resolve();
    if (id) void saved.then(() => storage.release?.(id));
    set({ modelId: null, doc: null, model: null, past: [], future: [], externalModel: null, multi: [] });
    if (resetHash) history.replaceState(null, '', '#/');
  },

  update(fn, coalesceKey) {
    const { doc, activeTab } = get();
    if (!doc) return;
    commit(
      produce(doc, (d) => withTab(d as DataModel, activeTab, fn)),
      coalesceKey,
    );
  },

  updateDoc(fn) {
    const { doc } = get();
    if (!doc) return;
    commit(produce(doc, (d) => fn(d as DataModel)));
  },

  amend(fn) {
    const { doc, activeTab } = get();
    if (!doc) return;
    const next = produce(doc, (d) => fn(d as DataModel));
    if (next === doc) return;
    set(derive(next, activeTab));
    scheduleSave();
  },

  setActiveTab(id) {
    const { doc, activeTab, modelId } = get();
    if (!doc || id === activeTab || !hasTab(doc, id)) return;
    const d = derive(doc, id);
    set({ ...d, selection: { kind: 'model' }, multi: [], tool: 'select', pendingSource: null, lastCoalesce: null });
    rememberTab(modelId, d.activeTab);
    if (d.model.entities.some((e) => !e.ui)) set({ layoutRequest: get().layoutRequest + 1 });
    else set({ fitRequest: get().fitRequest + 1 });
  },

  setMulti(ids) {
    const cur = get().multi;
    if (ids.length === cur.length && ids.every((x, i) => x === cur[i])) return;
    const patch: Partial<State> = { multi: ids };
    if (ids.length <= 1) {
      const id = ids[0];
      const [kind, key] = id ? [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)] : ['', ''];
      const sel = get().selection;
      if (!id) patch.selection = { kind: 'model' };
      else if (nodeIdOf(sel) !== id) patch.selection = kind === 'entity' ? { kind: 'entity', name: key } : kind === 'area' ? { kind: 'area', id: key } : { kind: 'note', id: key };
    }
    set(patch);
  },

  replaceModel(incoming) {
    const { model, display } = get();
    if (!model) return;
    // Place new entities now, so the whole change (content + layout) is a single undoable step.
    const pos = placeUnpositioned(incoming, display.detail);
    get().update((v) => {
      for (const k of ['entities', 'relationships', 'hierarchies', 'areas', 'notes'] as const) (v as any)[k] = incoming[k];
      for (const e of v.entities) if (!e.ui && pos.has(e.name)) e.ui = { ...pos.get(e.name)! };
    });
    set({ lastCoalesce: null, selection: { kind: 'model' }, multi: [] });
    if (pos.size) set({ fitRequest: get().fitRequest + 1 });
  },

  undo() {
    const { past, doc, future, activeTab } = get();
    if (!past.length || !doc) return;
    const prev = past[past.length - 1];
    set({ ...derive(prev, activeTab), past: past.slice(0, -1), future: [doc, ...future], lastCoalesce: null });
    scheduleSave();
  },

  redo() {
    const { past, doc, future, activeTab } = get();
    if (!future.length || !doc) return;
    const [next, ...rest] = future;
    set({ ...derive(next, activeTab), past: [...past, doc], future: rest, lastCoalesce: null });
    scheduleSave();
  },

  select(selection) {
    const id = nodeIdOf(selection);
    set({ selection, multi: id ? [id] : [] });
    // On a phone, picking something opens its details drawer (and closes the list drawer).
    if (isNarrow() && selection.kind !== 'model') set({ display: { ...get().display, showInspector: true, showSidebar: false } });
  },
  setView(view) {
    set({ view });
  },
  setTool(tool) {
    set({ tool, pendingSource: null });
  },
  setPendingSource(pendingSource) {
    set({ pendingSource });
  },
  setDisplay(p) {
    const display = { ...get().display, ...p };
    set({ display });
    try {
      // Drawer open/closed on a phone is momentary; keep the saved (desktop) panel layout as it was.
      const saved = isNarrow() ? { ...display, ...pickPanels(JSON.parse(localStorage.getItem('em.display') || '{}')) } : display;
      localStorage.setItem('em.display', JSON.stringify(saved));
    } catch {
      /* storage unavailable */
    }
  },
  toast(text, kind = 'info') {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3200);
  },

  async saveNow() {
    clearTimeout(saveTimer);
    const { doc, modelId, externalModel } = get();
    if (!doc || !modelId) return;
    // A newer version arrived while these edits were unsaved: wait for "Load theirs" or "Keep mine" instead of
    // overwriting it. Edits made meanwhile stay pending.
    if (externalModel) return;
    const stamped = { ...doc, updated_at: new Date().toISOString() };
    const text = serializeModel(stamped);
    set({ saveState: 'saving' });
    try {
      await storage.put(modelId, text);
      // The in-memory model keeps its identity (no re-render mid-drag); only the file carries the new timestamp.
      set({ savedText: text, saveState: get().saveState === 'saving' ? 'saved' : get().saveState });
    } catch (e: any) {
      if (e instanceof CloudConflict) {
        // Someone else saved first: same choice as a file changed on disk ("Load theirs" / "Keep mine").
        try {
          set({ externalModel: normalizeModel(JSON.parse(e.text)), saveState: 'pending' });
          return;
        } catch {
          /* unreadable: fall through to the error */
        }
      }
      set({ saveState: 'error' });
      get().toast(`Save failed: ${e.message}`, 'error');
    }
  },

  receiveExternal(m) {
    const { saveState, doc, activeTab } = get();
    if (!doc) return;
    if (saveState === 'pending' || saveState === 'saving') {
      set({ externalModel: m });
      return;
    }
    const d = derive(m, activeTab);
    set({ ...d, past: [...get().past, doc], future: [], savedText: serializeModel(m) });
    get().toast(`Model updated ${isCloudId(get().modelId) ? 'by someone else' : storage.kind === 'files' ? 'on disk' : 'in another tab'} — reloaded. Undo to revert.`, 'info');
    if (d.model.entities.some((e) => !e.ui)) set({ layoutRequest: get().layoutRequest + 1 });
  },
  acceptExternal() {
    const { externalModel, doc, activeTab } = get();
    if (!externalModel || !doc) return;
    clearTimeout(saveTimer);
    const d = derive(externalModel, activeTab);
    set({ ...d, past: [...get().past, doc], future: [], externalModel: null, saveState: 'saved', savedText: serializeModel(externalModel) });
    if (d.model.entities.some((e) => !e.ui)) set({ layoutRequest: get().layoutRequest + 1 });
  },
  dismissExternal() {
    set({ externalModel: null });
    get().saveNow();
  },
  requestLayout() {
    set({ layoutRequest: get().layoutRequest + 1 });
  },
  requestFit() {
    set({ fitRequest: get().fitRequest + 1 });
  },
}));

/** Record a new file version: history, derived view and issues, then a debounced save. */
function commit(next: DataModel, coalesceKey?: string) {
  const { doc, past, lastCoalesce, activeTab } = useStore.getState();
  if (!doc || next === doc) return;
  const now = Date.now();
  const coalesce = !!coalesceKey && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < 1500;
  useStore.setState({
    ...derive(next, activeTab),
    past: coalesce ? past : [...past.slice(-HISTORY_LIMIT), doc],
    future: [],
    lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
  });
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  useStore.setState({ saveState: 'pending' });
  saveTimer = setTimeout(() => useStore.getState().saveNow(), 700);
}

/** Shorthand selectors */
export const useModel = () => useStore((s) => s.model!);
export const useUpdate = () => useStore((s) => s.update);
