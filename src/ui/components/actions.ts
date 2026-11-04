import { copyEntities, createEntity, deleteEntity, deleteRelationship, structuredCopy, tabView, uid, withTab, AREA_COLORS, NOTE_COLORS, type DataModel, type EntityType } from '../../core';
import { bridge, fitDiagram } from '../canvas/bridge';
import { autoLayout, autoLayoutAsync } from '../canvas/layout';
import { nodeWidth } from '../canvas/geometry';
import { useStore } from '../store';

function viewportCenter() {
  const rf = bridge.rf;
  const el = document.querySelector('.react-flow') as HTMLElement | null;
  if (!rf || !el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

export function addEntityAtCenter(type: EntityType, at?: { x: number; y: number }) {
  const { update, select, setView } = useStore.getState();
  setView('diagram');
  const c = at || viewportCenter();
  let name = '';
  update((m) => {
    const label = type === 'reference' ? 'New Reference' : 'New Entity';
    const e = createEntity(m, label, type);
    // offset if something is already at the center
    const taken = (x: number, y: number) => m.entities.some((o) => o.ui && Math.abs(o.ui.x - x) < 40 && Math.abs(o.ui.y - y) < 40);
    let x = Math.round(c.x - 140);
    let y = Math.round(c.y - 60);
    while (taken(x, y)) {
      x += 32;
      y += 32;
    }
    e.ui = { x, y };
    m.entities.push(e);
    name = e.name;
  });
  select({ kind: 'entity', name, tab: 'general' });
}

export function addArea(at?: { x: number; y: number }) {
  const { update, select } = useStore.getState();
  const c = at || viewportCenter();
  const id = uid('area');
  update((m) => {
    m.areas.push({ id, name: `Subject Area ${m.areas.length + 1}`, color: AREA_COLORS[m.areas.length % AREA_COLORS.length], x: Math.round(c.x - 300), y: Math.round(c.y - 200), w: 600, h: 400 });
  });
  select({ kind: 'area', id });
}

export function addNote(at?: { x: number; y: number }) {
  const { update, select } = useStore.getState();
  const c = at || viewportCenter();
  const id = uid('note');
  update((m) => {
    m.notes.push({ id, text: 'Note', x: Math.round(c.x - 110), y: Math.round(c.y - 40), w: 220, color: NOTE_COLORS[0] });
  });
  select({ kind: 'note', id });
}

/** Split canvas node ids (entity:x, area:id, note:id) by kind. */
export function idsByKind(ids: string[]) {
  const out = { entity: [] as string[], area: [] as string[], note: [] as string[] };
  for (const id of ids) {
    const i = id.indexOf(':');
    const kind = id.slice(0, i) as keyof typeof out;
    if (kind in out) out[kind].push(id.slice(i + 1));
  }
  return out;
}

/** Entity names currently selected on the canvas (or the inspector's entity). */
export function selectedEntities(): string[] {
  const { multi, selection } = useStore.getState();
  const names = idsByKind(multi).entity;
  if (!names.length && selection.kind === 'entity') return [selection.name];
  return names;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Delete whatever is selected: canvas items (several at once), or the relationship/hierarchy in the inspector. Undoable. */
export function deleteSelection() {
  const { selection, multi, update, select, toast } = useStore.getState();
  const ids = idsByKind(multi);
  const count = ids.entity.length + ids.area.length + ids.note.length;
  if (count) {
    update((m) => {
      for (const n of ids.entity) deleteEntity(m, n);
      m.areas = m.areas.filter((a) => !ids.area.includes(a.id));
      m.notes = m.notes.filter((a) => !ids.note.includes(a.id));
    });
    const what = count === 1 && ids.entity.length ? `“${ids.entity[0]}”` : plural(count, 'item');
    toast(`Deleted ${what}. Undo with ⌘Z.`);
  } else if (selection.kind === 'relationship') {
    update((m) => deleteRelationship(m, selection.name));
    toast(`Deleted relationship “${selection.name}”. Undo with ⌘Z.`);
  } else if (selection.kind === 'hierarchy') {
    update((m) => void (m.hierarchies = m.hierarchies.filter((h) => h.name !== selection.name)));
    toast(`Deleted hierarchy “${selection.name}”. Undo with ⌘Z.`);
  } else return false;
  select({ kind: 'model' });
  return true;
}

/** Fold or show one STRUCT attribute's fields on the diagram. */
export function toggleFold(entity: string, attr: string) {
  useStore.getState().update((m) => {
    const e = m.entities.find((x) => x.name === entity);
    if (!e?.ui) return;
    const set = new Set(e.ui.folded);
    if (set.has(attr)) set.delete(attr);
    else set.add(attr);
    writeFolded(e, set);
  });
}

/** Fold (or show) the fields of every STRUCT attribute, on the given entities or all of them. */
export function setAllFolded(folded: boolean, entities?: string[]) {
  const only = entities && new Set(entities);
  useStore.getState().update((m) => {
    for (const e of m.entities) {
      if (!e.ui || (only && !only.has(e.name))) continue;
      writeFolded(e, new Set(folded ? e.attributes.filter((a) => a.type === 'STRUCT').map((a) => a.name) : []));
    }
  });
}

/** Whether any of the given entities (default: all) has a STRUCT attribute. */
export function hasStructs(m: DataModel, entities?: string[]) {
  const only = entities && new Set(entities);
  return m.entities.some((e) => (!only || only.has(e.name)) && e.attributes.some((a) => a.type === 'STRUCT'));
}

function writeFolded(e: DataModel['entities'][number], set: Set<string>) {
  const folded = e.attributes.filter((a) => a.type === 'STRUCT' && set.has(a.name)).map((a) => a.name);
  if (folded.length) e.ui!.folded = folded;
  else delete e.ui!.folded;
}

/** Hide entities from the diagram (they stay in the model, the tables and the docs). */
export function setHidden(names: string[], hidden: boolean) {
  if (!names.length) return;
  const set = new Set(names);
  useStore.getState().update((m) => {
    for (const e of m.entities) {
      if (!set.has(e.name) || !e.ui || !!e.ui.hidden === hidden) continue;
      if (hidden) e.ui.hidden = true;
      else delete e.ui.hidden;
    }
  });
  if (hidden) {
    useStore.getState().setMulti([]);
    useStore.getState().toast(`Hid ${plural(names.length, 'entity', 'entities')}. Shift+H shows all.`);
  }
}

export function hideSelection() {
  setHidden(selectedEntities(), true);
}

export function showAll() {
  const m = useStore.getState().model;
  if (m) setHidden(m.entities.filter((e) => e.ui?.hidden).map((e) => e.name), false);
}

/** Hide everything except the selected entities (and, optionally, what they connect to). */
export function isolate(names: string[], withNeighbors = false) {
  const m = useStore.getState().model;
  if (!m || !names.length) return;
  const keep = new Set(withNeighbors ? neighbors(m, names) : names);
  useStore.getState().update((d) => {
    for (const e of d.entities) {
      if (!e.ui) continue;
      if (keep.has(e.name)) delete e.ui.hidden;
      else e.ui.hidden = true;
    }
  });
  setTimeout(() => fitDiagram(useStore.getState().model!, useStore.getState().display.detail, { padding: 0.15 }), 60);
}

/** The entities plus everything one relationship, reference or dependency away. */
export function neighbors(m: DataModel, names: string[]): string[] {
  const out = new Set(names);
  for (const r of m.relationships) {
    if (names.includes(r.source)) out.add(r.target);
    if (names.includes(r.target)) out.add(r.source);
  }
  for (const e of m.entities) {
    const refs = [...e.attributes.map((a) => a.reference?.entity), ...(e.struct_types || []).flatMap((s) => s.fields.map((f) => f.reference?.entity)), e.dependent_reference?.parent];
    if (names.includes(e.name)) refs.forEach((r) => r && out.add(r));
    if (refs.some((r) => r && names.includes(r))) out.add(e.name);
  }
  return [...out];
}

export function selectAll() {
  const m = useStore.getState().model;
  if (m) useStore.getState().setMulti(m.entities.filter((e) => !e.ui?.hidden).map((e) => `entity:${e.name}`));
}

// ---- clipboard (in-app; survives tab switches, so it also moves entities between tabs) ----

let clipboard: { source: DataModel; names: string[] } | null = null;
export const hasClipboard = () => !!clipboard?.names.length;

export function copySelection() {
  const { model, toast } = useStore.getState();
  const names = selectedEntities();
  if (!model || !names.length) return false;
  clipboard = { source: structuredCopy(model), names };
  toast(`Copied ${names.length === 1 ? `“${names[0]}”` : `${names.length} entities`}. Paste with ⌘V, here or in another tab.`);
  return true;
}

/** Paste the clipboard into the active tab; clashing names get a _copy suffix. */
export function paste(at?: { x: number; y: number }) {
  if (!clipboard) return;
  const { update, setMulti, toast } = useStore.getState();
  const src = clipboard;
  const placed = src.source.entities.filter((e) => src.names.includes(e.name) && e.ui);
  let offset = { x: 40, y: 40 };
  if (at && placed.length) {
    const minX = Math.min(...placed.map((e) => e.ui!.x));
    const minY = Math.min(...placed.map((e) => e.ui!.y));
    offset = { x: Math.round(at.x - minX), y: Math.round(at.y - minY) };
  }
  let added: string[] = [];
  update((m) => {
    added = copyEntities(src.source, src.names, m, { rename: true, offset }).added;
  });
  setMulti(added.map((n) => `entity:${n}`));
  if (added.length) toast(`Pasted ${added.length === 1 ? `“${added[0]}”` : `${added.length} entities`}.`, 'success');
}

export function duplicateSelection() {
  const { model, update, setMulti } = useStore.getState();
  const names = selectedEntities();
  if (!model || !names.length) return;
  let added: string[] = [];
  update((m) => {
    added = copyEntities(structuredCopy(model), names, m, { rename: true, offset: { x: 40, y: 40 } }).added;
  });
  setMulti(added.map((n) => `entity:${n}`));
}

/** Copy entities into another tab. Names that tab already has are skipped, so this also fills gaps. */
export function copyToTab(names: string[], tabId: string) {
  const { model, updateDoc, toast } = useStore.getState();
  if (!model || !names.length) return;
  let res = { added: [] as string[], skipped: [] as string[] };
  updateDoc((d) => withTab(d, tabId, (v) => void (res = copyEntities(model, names, v, { rename: false }))));
  const doc = useStore.getState().doc!;
  const tabName = tabView(doc, tabId).tab?.name || tabId;
  toast(
    `${res.added.length ? `Copied ${res.added.length} to “${tabName}”.` : `Nothing copied to “${tabName}”.`}${res.skipped.length ? ` ${res.skipped.length} already there: ${res.skipped.slice(0, 3).join(', ')}${res.skipped.length > 3 ? '…' : ''}.` : ''}`,
    res.added.length ? 'success' : 'info',
  );
}

export function setColor(names: string[], color: string) {
  const set = new Set(names);
  useStore.getState().update((m) => {
    for (const e of m.entities) if (set.has(e.name)) e.color_code = color;
  });
}

/** Lay out just these entities, keeping them where they are as a group. */
export function arrangeSelection(names: string[]) {
  const { model, display, update } = useStore.getState();
  if (!model || names.length < 2) return;
  const pos = autoLayout(model, display.detail, names);
  const cur = model.entities.filter((e) => names.includes(e.name) && e.ui);
  const minX = Math.min(...cur.map((e) => e.ui!.x));
  const minY = Math.min(...cur.map((e) => e.ui!.y));
  let pMinX = Infinity;
  let pMinY = Infinity;
  pos.forEach((p) => ((pMinX = Math.min(pMinX, p.x)), (pMinY = Math.min(pMinY, p.y))));
  update((m) => {
    for (const e of m.entities) {
      const p = pos.get(e.name);
      if (p) e.ui = { ...(e.ui || {}), x: Math.round(p.x - pMinX + minX), y: Math.round(p.y - pMinY + minY) };
    }
  });
}

/** Full re-layout of all entities (toolbar action). */
export async function applyFullLayout() {
  const { model, display, toast } = useStore.getState();
  if (!model) return;
  if (model.entities.length > 300) toast(`Laying out ${model.entities.length} entities…`);
  const pos = await autoLayoutAsync(model, display.detail);
  // The model may have changed while the layout ran: apply to what is there now (one undo step).
  useStore.getState().update((d) => {
    for (const e of d.entities) {
      const p = pos.get(e.name);
      if (p) e.ui = { ...(e.ui || {}), x: p.x, y: p.y };
    }
  });
  setTimeout(() => fitDiagram(useStore.getState().model!, useStore.getState().display.detail, { duration: 400 }), 80);
}

/** Select an entity and bring it into view, showing it first if it was hidden. */
export function focusEntity(name: string, attribute?: string) {
  const { model, select, setView } = useStore.getState();
  const e = model?.entities.find((x) => x.name === name);
  if (!e) return;
  if (e.ui?.hidden) setHidden([name], false);
  setView('diagram');
  select(attribute ? { kind: 'entity', name, tab: 'attributes', attribute } : { kind: 'entity', name });
  // After the view (re)mounts the canvas.
  setTimeout(() => {
    if (e.ui && bridge.rf) bridge.rf.setCenter(e.ui.x + nodeWidth(e) / 2, e.ui.y + 120, { zoom: Math.max(bridge.rf.getZoom(), 0.9), duration: 400 });
  }, 30);
}
