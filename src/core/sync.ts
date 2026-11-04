// Sync a derived tab with its source: derive the source again the way the target was made, match through
// lineage (derived_from), and list each difference as a change with the ops that bring it over. Additions and
// type changes are on by default; things the source dropped are flagged, never removed unless chosen.
import { deriveTab } from './derive';
import { typeDisplay, uniqueName } from './model';
import { applyBatches, type Op } from './operations';
import { structuredCopy, tabView } from './tabs';
import type { Attribute, DataModel, Entity, Relationship } from './types';

export type SyncKind = 'entity_added' | 'attribute_added' | 'attribute_changed' | 'relationship_added' | 'attribute_removed' | 'entity_removed';

export interface SyncChange {
  id: string;
  kind: SyncKind;
  /** Target-side entity the change is about. */
  entity: string;
  label: string;
  ops: Op[];
  /** Pre-selected in the UI; removals are not. */
  suggested: boolean;
}

const matchKey = (x: { name: string; derived_from?: string }) => x.derived_from || x.name;

function strip(e: Entity): Entity {
  const c = structuredCopy(e);
  delete c.ui;
  return c;
}

export function syncPlan(doc: DataModel, sourceTab: string, targetTab: string): SyncChange[] {
  const S = tabView(doc, sourceTab);
  const T = tabView(doc, targetTab);
  const kind = T.tab?.kind || 'logical';
  const D = deriveTab(S, kind, { physical: { dialect: T.tab?.dialect } }).content;
  const changes: SyncChange[] = [];

  // D (fresh derivation) ↔ T (the target as people edited it), through the source names both carry.
  const tByKey = new Map(T.entities.map((e) => [matchKey(e), e]));
  const dToT = new Map<string, string>();
  for (const de of D.entities) {
    const te = tByKey.get(matchKey(de)) || T.entities.find((x) => x.name === de.name);
    if (te) dToT.set(de.name, te.name);
  }
  const taken = new Set(T.entities.map((e) => e.name));
  const added = new Map<string, string>();
  for (const de of D.entities) {
    if (dToT.has(de.name)) continue;
    const name = uniqueName(de.name, [...taken]);
    taken.add(name);
    added.set(de.name, name);
  }
  const nameInT = (d: string) => dToT.get(d) ?? added.get(d);
  const relNames = new Set(T.relationships.map((r) => r.name));
  const hasRel = (s: string, t: string, card: Relationship['cardinality']) =>
    T.relationships.some((r) => (r.source === s && r.target === t) || (r.source === t && r.target === s && (card === 'N:N' || card === '1:1')));
  const relOp = (r: Relationship): Op => {
    const name = uniqueName(r.name, [...relNames]);
    relNames.add(name);
    const copy = structuredCopy(r);
    return { op: 'add_relationship', relationship: { ...copy, name, source: nameInT(r.source)!, target: nameInT(r.target)! } };
  };

  // New entities, with the relationships that come with them.
  for (const de of D.entities) {
    const name = added.get(de.name);
    if (!name) continue;
    const e = strip(de);
    e.name = name;
    // References and dependent lists point at target names.
    for (const a of e.attributes) if (a.reference) a.reference.entity = nameInT(a.reference.entity) || a.reference.entity;
    if (e.dependent_reference) e.dependent_reference.parent = nameInT(e.dependent_reference.parent) || e.dependent_reference.parent;
    const ops: Op[] = [{ op: 'add_entity', entity: e }];
    changes.push({ id: `e+${name}`, kind: 'entity_added', entity: name, label: `New entity ${name} (${e.attributes.length} attributes)`, ops, suggested: true });
  }

  // Attribute-level changes on entities both sides have.
  for (const de of D.entities) {
    const tn = dToT.get(de.name);
    if (!tn) continue;
    const te = T.entities.find((x) => x.name === tn)!;
    const tAttr = new Map(te.attributes.map((a) => [matchKey(a), a]));
    const dKeys = new Set(de.attributes.map(matchKey));
    let prev: string | null = null;
    for (const da of de.attributes) {
      const ta = tAttr.get(matchKey(da)) || te.attributes.find((x) => x.name === da.name);
      if (!ta) {
        if (te.attributes.some((x) => x.name.toLowerCase() === da.name.toLowerCase())) continue;
        const a: Attribute = structuredCopy(da);
        if (a.reference) a.reference.entity = nameInT(a.reference.entity) || a.reference.entity;
        changes.push({
          id: `a+${tn}.${da.name}`,
          kind: 'attribute_added',
          entity: tn,
          label: `${tn}: new attribute ${da.name} (${typeDisplay(da)})`,
          ops: [{ op: 'add_attribute', entity: tn, attribute: a, ...(prev ? { after: prev } : {}) }],
          suggested: true,
        });
      } else {
        const diffs: string[] = [];
        const set: Partial<Attribute> = {};
        if (typeDisplay(da) !== typeDisplay(ta) && da.type !== 'REFERENCE_ENTITY' && ta.type !== 'REFERENCE_ENTITY') {
          diffs.push(`${typeDisplay(ta)} → ${typeDisplay(da)}`);
          Object.assign(set, { type: da.type, is_array: da.is_array || undefined, ...(da.struct_type ? { struct_type: da.struct_type } : {}) });
        }
        if (!!da.is_primary_key !== !!ta.is_primary_key) {
          diffs.push(da.is_primary_key ? 'now a primary key' : 'no longer a primary key');
          set.is_primary_key = !!da.is_primary_key || undefined;
        }
        if (diffs.length)
          changes.push({ id: `a~${tn}.${ta.name}`, kind: 'attribute_changed', entity: tn, label: `${tn}.${ta.name}: ${diffs.join(', ')}`, ops: [{ op: 'update_attribute', entity: tn, attribute: ta.name, set }], suggested: true });
        prev = ta.name;
      }
      if (!ta) prev = da.name;
    }
    for (const ta of te.attributes)
      if (ta.derived_from && !dKeys.has(ta.derived_from) && !de.attributes.some((x) => x.name === ta.name))
        changes.push({ id: `a-${tn}.${ta.name}`, kind: 'attribute_removed', entity: tn, label: `${tn}.${ta.name}: gone from the source`, ops: [{ op: 'delete_attribute', entity: tn, attribute: ta.name }], suggested: false });
  }

  // Relationships between entities the target has (or is getting) that it lacks.
  for (const r of D.relationships) {
    const s = nameInT(r.source);
    const t = nameInT(r.target);
    if (!s || !t || hasRel(s, t, r.cardinality)) continue;
    const viaNew = added.has(r.source) ? r.source : added.has(r.target) ? r.target : undefined;
    changes.push({
      id: `r+${s}>${t}:${r.name}`,
      kind: 'relationship_added',
      entity: viaNew ? added.get(viaNew)! : s,
      label: `New relationship ${s} → ${t} (${r.cardinality})`,
      ops: [relOp(r)],
      suggested: true,
    });
  }

  // Entities the source no longer has.
  const dKeys = new Set(D.entities.map(matchKey));
  for (const te of T.entities)
    if (te.derived_from && !dKeys.has(te.derived_from) && !D.entities.some((x) => x.name === te.name))
      changes.push({ id: `e-${te.name}`, kind: 'entity_removed', entity: te.name, label: `${te.name}: gone from the source`, ops: [{ op: 'delete_entity', entity: te.name }], suggested: false });

  return changes;
}

/** Apply chosen sync changes to the target tab (in place; immer drafts fine). New entities go first so their relationships resolve. */
export function applySync(doc: DataModel, changes: SyncChange[], targetTab: string) {
  const order: SyncKind[] = ['entity_added', 'attribute_added', 'attribute_changed', 'relationship_added', 'attribute_removed', 'entity_removed'];
  const sorted = [...changes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return applyBatches(doc, sorted.map((c) => c.ops), targetTab);
}
