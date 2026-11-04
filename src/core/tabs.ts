// Diagram tabs. The model's top-level content is the primary tab ("main"); `tabs` holds the rest. Every core
// function works on a single-tab DataModel, so callers project the tab they want with `tabView`.
import { toInternalName, uid, uniqueName } from './model';
import type { DataModel, Entity, ModelContent, ModelTab, TabKind, TabMeta } from './types';

export const MAIN_TAB = 'main';
export const CONTENT_KEYS = ['entities', 'relationships', 'hierarchies', 'areas', 'notes'] as const;

export interface TabInfo extends TabMeta {
  id: string;
  entities: number;
}

export function mainTabMeta(m: DataModel): TabMeta {
  return { name: 'Main', kind: 'logical', ...m.tab };
}

/** All tabs, primary first. */
export function listTabs(m: DataModel): TabInfo[] {
  return [
    { ...mainTabMeta(m), id: MAIN_TAB, entities: m.entities.length },
    ...(m.tabs || []).map(({ entities, relationships: _r, hierarchies: _h, areas: _a, notes: _n, ...meta }) => ({ ...meta, entities: entities.length })),
  ];
}

export function hasTab(m: DataModel, id: string): boolean {
  return id === MAIN_TAB || !!m.tabs?.some((t) => t.id === id);
}

/** Find a tab by id or (case-insensitive) name. */
export function resolveTab(m: DataModel, ref: string | undefined): string | undefined {
  if (!ref) return MAIN_TAB;
  const r = ref.toLowerCase();
  // An exact id wins over a name, so "logical" can't mean a different tab that happens to be named "Logical".
  const tabs = listTabs(m);
  return (tabs.find((t) => t.id === ref) || tabs.find((t) => t.name.toLowerCase() === r))?.id;
}

export function tabContent(m: DataModel, id: string): ModelContent {
  const src = id === MAIN_TAB ? m : m.tabs?.find((t) => t.id === id);
  if (!src) throw new Error(`Tab "${id}" not found`);
  return { entities: src.entities, relationships: src.relationships, hierarchies: src.hierarchies, areas: src.areas, notes: src.notes };
}

/**
 * The model as seen from one tab: header fields plus that tab's content, with `tab` set to the tab's meta and no
 * `tabs`. Validation, docs and exports all take this shape.
 */
export function tabView(m: DataModel, id: string = MAIN_TAB): DataModel {
  const { tabs: _tabs, ...header } = m;
  if (id === MAIN_TAB) return markTab({ ...header, tab: mainTabMeta(m) }, MAIN_TAB);
  const t = m.tabs?.find((x) => x.id === id);
  if (!t) return markTab({ ...header, tab: mainTabMeta(m) }, MAIN_TAB);
  const { id: _id, entities, relationships, hierarchies, areas, notes, ...meta } = t;
  return markTab({ ...header, entities, relationships, hierarchies, areas, notes, tab: meta }, id);
}

const TAB_ID = Symbol('tab');
/** Remember which tab a view shows, without it ever reaching the file (symbols aren't serialized or spread by JSON). */
function markTab<T extends object>(view: T, id: string): T {
  Object.defineProperty(view, TAB_ID, { value: id, enumerable: false });
  return view;
}
/** The tab id of a view from tabView/withTab; the primary tab for a full model. */
export function viewTabId(m: DataModel): string {
  return (m as any)[TAB_ID] ?? MAIN_TAB;
}

/**
 * Run an edit written against a single-tab model on one tab of the full model. Works on immer drafts: the edit
 * sees the tab's arrays, and whatever it assigns is written back (content to the tab, header fields to the model).
 */
export function withTab(m: DataModel, id: string, fn: (view: DataModel) => void) {
  if (id === MAIN_TAB) return fn(m);
  const t = m.tabs?.find((x) => x.id === id);
  if (!t) throw new Error(`Tab "${id}" not found`);
  const view = markTab({ ...m, entities: t.entities, relationships: t.relationships, hierarchies: t.hierarchies, areas: t.areas, notes: t.notes } as DataModel, id);
  delete view.tabs;
  delete view.tab;
  fn(view);
  for (const k of CONTENT_KEYS) (t as any)[k] = view[k];
  for (const k of Object.keys(view) as (keyof DataModel)[]) {
    if ((CONTENT_KEYS as readonly string[]).includes(k) || k === 'tab' || k === 'tabs') continue;
    if (m[k] !== view[k]) (m as any)[k] = view[k];
  }
}

export function emptyContent(): ModelContent {
  return { entities: [], relationships: [], hierarchies: [], areas: [], notes: [] };
}

/** Add a tab (mutates). Returns its id. */
export function addTab(m: DataModel, meta: Partial<TabMeta> & { kind: TabKind }, content: ModelContent = emptyContent()): string {
  const id = uniqueName(toInternalName(meta.name || meta.kind) || uid('tab'), [MAIN_TAB, ...(m.tabs || []).map((t) => t.id)]);
  const tab: ModelTab = { id, ...meta, name: uniqueTabName(m, meta.name || defaultTabName(meta.kind)), ...structuredCopy(content) };
  m.tabs = [...(m.tabs || []), tab];
  return id;
}

export function uniqueTabName(m: DataModel, base: string): string {
  const taken = new Set(listTabs(m).map((t) => t.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  while (taken.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

export function defaultTabName(kind: TabKind): string {
  return { conceptual: 'Conceptual', logical: 'Logical', physical: 'Physical', variant: 'Variant' }[kind];
}

export function updateTabMeta(m: DataModel, id: string, patch: Partial<TabMeta>) {
  if (id === MAIN_TAB) m.tab = { ...mainTabMeta(m), ...patch };
  else {
    const t = m.tabs?.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  }
}

export function deleteTab(m: DataModel, id: string) {
  if (id === MAIN_TAB) throw new Error('The primary tab cannot be deleted; make another tab primary first.');
  m.tabs = (m.tabs || []).filter((t) => t.id !== id);
  for (const t of m.tabs) if (t.derived_from === id) delete t.derived_from;
  if (m.mappings) m.mappings = m.mappings.filter((x) => x.target.tab !== id).map((x) => ({ ...x, sources: x.sources.filter((e) => e.tab !== id) }));
  if (m.tab?.derived_from === id) delete m.tab.derived_from;
  if (!m.tabs.length) delete m.tabs;
}

/** Swap a tab with the primary one, so it becomes the top-level content (what single-tab tools see first). */
export function makePrimary(m: DataModel, id: string) {
  const i = m.tabs?.findIndex((x) => x.id === id) ?? -1;
  if (id === MAIN_TAB || i === -1) return;
  const { id: _id, entities, relationships, hierarchies, areas, notes, ...meta } = m.tabs![i];
  // The old primary takes the promoted tab's slot with an id from its own name (not the promoted tab's old id,
  // which would leave e.g. a legacy tab with the id "logical"). Every reference follows.
  const oldMeta = mainTabMeta(m);
  const taken = [MAIN_TAB, ...m.tabs!.filter((t) => t.id !== id).map((t) => t.id)];
  const newId = uniqueName(toInternalName(oldMeta.name) || 'tab', taken);
  const old: ModelTab = { id: newId, ...oldMeta, ...tabContent(m, MAIN_TAB) };
  Object.assign(m, { entities, relationships, hierarchies, areas, notes, tab: meta });
  m.tabs![i] = old;
  const swap = (x?: string) => (x === id ? MAIN_TAB : x === MAIN_TAB ? newId : x);
  for (const t of [m.tab!, ...m.tabs!]) {
    const d = swap(t.derived_from);
    if (d) t.derived_from = d;
    else delete t.derived_from;
  }
  for (const x of m.mappings || []) for (const e of [x.target, ...x.sources]) e.tab = swap(e.tab)!;
}

export function moveTab(m: DataModel, id: string, to: number) {
  const tabs = m.tabs || [];
  const from = tabs.findIndex((t) => t.id === id);
  if (from === -1) return;
  const [t] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, t);
}

export function structuredCopy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/**
 * Copy entities (and the relationships among them, or to entities already in the target) from one tab view into
 * another (mutates `target`). With `rename`, clashing names get a suffix and internal references follow;
 * without, entities whose name the target already has are skipped.
 */
export function copyEntities(
  source: DataModel,
  names: string[],
  target: DataModel,
  opts: { rename: boolean; offset?: { x: number; y: number }; lineage?: boolean } = { rename: false },
): { added: string[]; skipped: string[] } {
  const want = new Set(names);
  const picked = source.entities.filter((e) => want.has(e.name));
  const taken = target.entities.map((e) => e.name);
  const map = new Map<string, string>();
  const skipped: string[] = [];
  for (const e of picked) {
    if (!taken.includes(e.name)) map.set(e.name, e.name);
    else if (opts.rename) map.set(e.name, uniqueName(`${e.name}_copy`, [...taken, ...map.values()]));
    else skipped.push(e.name);
    if (map.has(e.name)) taken.push(map.get(e.name)!);
  }
  const rn = (n: string) => map.get(n) ?? n;
  const added: string[] = [];
  for (const src of picked) {
    if (!map.has(src.name)) continue;
    const e: Entity = structuredCopy(src);
    e.name = rn(src.name);
    if (e.name !== src.name) e.display_name = `${src.display_name} Copy`;
    if (opts.lineage) e.derived_from = src.name;
    for (const a of e.attributes) if (a.reference) a.reference.entity = rn(a.reference.entity);
    for (const s of e.struct_types || []) for (const f of s.fields) if (f.reference) f.reference.entity = rn(f.reference.entity);
    if (e.dependent_reference) e.dependent_reference.parent = rn(e.dependent_reference.parent);
    if (e.ui && opts.offset) e.ui = { ...e.ui, x: e.ui.x + opts.offset.x, y: e.ui.y + opts.offset.y };
    if (e.ui) delete e.ui.hidden;
    target.entities.push(e);
    added.push(e.name);
  }
  const present = new Set(target.entities.map((e) => e.name));
  const addedSet = new Set(added);
  // Snapshot: source and target can be the same tab (paste), and the loop adds to the target.
  for (const r of [...source.relationships]) {
    const s = rn(r.source);
    const t = rn(r.target);
    if (!present.has(s) || !present.has(t) || (!addedSet.has(s) && !addedSet.has(t))) continue;
    const name = uniqueName(r.name, target.relationships.map((x) => x.name));
    target.relationships.push({ ...structuredCopy(r), name, source: s, target: t });
  }
  return { added, skipped };
}
