// Cascading model edits. All functions mutate the model in place (use inside an immer draft).
import { relationshipEnds } from './model';
import { viewTabId } from './tabs';
import type { DataModel, Entity, MappingEnd } from './types';

/** Mapping ends in this view's tab, so renames and deletes can keep mappings pointing at the right things. */
function mappingEnds(m: DataModel): MappingEnd[] {
  const tab = viewTabId(m);
  return (m.mappings || []).flatMap((x) => [x.target, ...x.sources]).filter((e) => e.tab === tab);
}
/** Comment targets in this view's tab (renames keep comments attached). */
function commentTargets(m: DataModel) {
  const tab = viewTabId(m);
  return (m.comments || []).map((c) => c.target).filter((t) => t.tab === tab);
}
function dropMappings(m: DataModel, gone: (e: MappingEnd) => boolean) {
  if (!m.mappings?.length) return;
  const tab = viewTabId(m);
  const hit = (e: MappingEnd) => e.tab === tab && gone(e);
  m.mappings = m.mappings.filter((x) => !hit(x.target)).map((x) => (x.sources.some(hit) ? { ...x, sources: x.sources.filter((e) => !hit(e)) } : x));
}

function eachReference(m: DataModel, fn: (ref: { entity: string; output_attribute: string }) => void) {
  for (const e of m.entities) {
    for (const a of e.attributes) if (a.reference) fn(a.reference);
    for (const s of e.struct_types || []) for (const f of s.fields) if (f.reference) fn(f.reference);
  }
}

export function renameEntity(m: DataModel, from: string, to: string) {
  if (from !== to) renameEntities(m, new Map([[from, to]]));
}

/**
 * Rename many entities in one pass over the model (bulk renames would otherwise cascade once per entity).
 * Every reference, relationship, hierarchy, mapping and comment follows. Names map old → new.
 */
export function renameEntities(m: DataModel, names: Map<string, string>) {
  for (const [a, b] of [...names]) if (a === b) names.delete(a);
  if (!names.size) return;
  const to = (n: string) => names.get(n) ?? n;
  for (const e of m.entities) if (names.has(e.name)) e.name = names.get(e.name)!;
  eachReference(m, (r) => {
    if (names.has(r.entity)) r.entity = to(r.entity);
  });
  for (const x of m.entities) if (x.dependent_reference && names.has(x.dependent_reference.parent)) x.dependent_reference.parent = to(x.dependent_reference.parent);
  for (const r of m.relationships) {
    if (names.has(r.source)) r.source = to(r.source);
    if (names.has(r.target)) r.target = to(r.target);
  }
  for (const h of m.hierarchies) {
    if (names.has(h.root)) h.root = to(h.root);
    for (const l of h.levels) for (const b of l.branches) if (names.has(b.entity)) b.entity = to(b.entity);
  }
  for (const end of mappingEnds(m)) if (names.has(end.entity)) end.entity = to(end.entity);
  for (const t of commentTargets(m)) if (t.kind === 'entity' && t.name && names.has(t.name)) t.name = to(t.name);
}

/** Rename an attribute and every place that refers to it. */
export function renameAttribute(m: DataModel, entityName: string, from: string, to: string) {
  if (from !== to) renameAttributes(m, new Map([[entityName, new Map([[from, to]])]]));
}

/** Rename many attributes (entity → old → new) in one pass over the model, cascading like renameAttribute. */
export function renameAttributes(m: DataModel, renames: Map<string, Map<string, string>>) {
  const of = (entity: string, attr: string | undefined) => (attr === undefined ? undefined : renames.get(entity)?.get(attr));
  for (const e of m.entities) {
    const map = renames.get(e.name);
    if (!map) continue;
    for (const a of e.attributes) if (map.has(a.name)) a.name = map.get(a.name)!;
    for (const [from, to] of map) renameValueKey(e, from, to);
    if (e.ui?.folded) e.ui.folded = e.ui.folded.map((n) => map.get(n) ?? n);
  }
  for (const end of mappingEnds(m)) {
    const n = of(end.entity, end.attribute);
    if (n) end.attribute = n;
  }
  for (const t of commentTargets(m)) {
    const n = t.kind === 'entity' && t.name ? of(t.name, t.attribute) : undefined;
    if (n) t.attribute = n;
  }
  for (const r of m.relationships) {
    const child = r.foreign_key ? relationshipEnds(r)?.child : undefined;
    const n = child ? of(child, r.foreign_key) : undefined;
    if (n) r.foreign_key = n;
  }
  // Other entities that read these attributes as a reference output / linked column.
  eachReference(m, (r) => {
    const n = of(r.entity, r.output_attribute);
    if (n) r.output_attribute = n;
  });
  for (const x of m.entities) {
    const d = x.dependent_reference;
    const n = d ? of(d.parent, d.linked_column) : undefined;
    if (d && n) {
      const from = d.linked_column;
      d.linked_column = n;
      renameValueKey(x, from, n);
    }
  }
}

export function deleteEntity(m: DataModel, name: string) {
  m.entities = m.entities.filter((e) => e.name !== name);
  for (const e of m.entities) {
    for (const a of e.attributes)
      if (a.reference?.entity === name) {
        a.reference = undefined;
        a.type = 'STRING';
      }
    for (const s of e.struct_types || [])
      for (const f of s.fields)
        if (f.reference?.entity === name) {
          f.reference = undefined;
          f.type = 'STRING';
        }
    if (e.dependent_reference?.parent === name) e.dependent_reference = null;
  }
  const deadRels = new Set(m.relationships.filter((r) => r.source === name || r.target === name).map((r) => r.name));
  m.relationships = m.relationships.filter((r) => !deadRels.has(r.name));
  m.hierarchies = m.hierarchies.filter((h) => h.root !== name);
  for (const h of m.hierarchies)
    for (const l of h.levels) l.branches = l.branches.filter((b) => b.entity !== name && !deadRels.has(b.relationship));
  dropMappings(m, (e) => e.entity === name);
}

export function deleteAttribute(m: DataModel, entityName: string, attr: string) {
  const e = m.entities.find((x) => x.name === entityName);
  if (!e) return;
  e.attributes = e.attributes.filter((a) => a.name !== attr);
  for (const v of e.reference_values || []) delete v[attr];
  if (e.ui?.folded) {
    e.ui.folded = e.ui.folded.filter((n) => n !== attr);
    if (!e.ui.folded.length) delete e.ui.folded;
  }
  for (const r of m.relationships) if (r.foreign_key === attr && relationshipEnds(r)?.child === entityName) delete r.foreign_key;
  dropMappings(m, (end) => end.entity === entityName && end.attribute === attr);
}

export function renameRelationship(m: DataModel, from: string, to: string) {
  const r = m.relationships.find((x) => x.name === from);
  if (!r || from === to) return;
  r.name = to;
  for (const h of m.hierarchies) for (const l of h.levels) for (const b of l.branches) if (b.relationship === from) b.relationship = to;
  for (const t of commentTargets(m)) if (t.kind === 'relationship' && t.name === from) t.name = to;
}

export function deleteRelationship(m: DataModel, name: string) {
  m.relationships = m.relationships.filter((r) => r.name !== name);
  for (const h of m.hierarchies) for (const l of h.levels) l.branches = l.branches.filter((b) => b.relationship !== name);
}

function renameValueKey(e: Entity, from: string, to: string) {
  for (const v of e.reference_values || [])
    if (from in v) {
      v[to] = v[from];
      delete v[from];
    }
}

/**
 * Add an imported model's entities and relationships to `base` (returns a new model). Entities whose name is
 * already taken are skipped — the existing one is kept and imported references to that name now point at it.
 */
export function mergeModels(base: DataModel, incoming: DataModel): { model: DataModel; added: string[]; skipped: string[] } {
  const model: DataModel = JSON.parse(JSON.stringify(base));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const e of incoming.entities) {
    if (model.entities.some((x) => x.name === e.name)) skipped.push(e.name);
    else {
      const copy = JSON.parse(JSON.stringify(e));
      delete copy.ui;
      model.entities.push(copy);
      added.push(e.name);
    }
  }
  const names = new Set(model.entities.map((e) => e.name));
  for (const r of incoming.relationships) {
    if (!names.has(r.source) || !names.has(r.target)) continue;
    if (!added.includes(r.source) && !added.includes(r.target)) continue; // both ends pre-existed: leave their links alone
    let name = r.name;
    for (let i = 2; model.relationships.some((x) => x.name === name); i++) name = `${r.name}_${i}`;
    model.relationships.push({ ...JSON.parse(JSON.stringify(r)), name });
  }
  return { model, added, skipped };
}
