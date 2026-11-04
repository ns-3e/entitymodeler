import {
  FORMAT,
  FORMAT_VERSION,
  SOURCE_URL,
  type Attribute,
  type DataModel,
  type Entity,
  type EntityType,
  type ModelSummary,
  type Relationship,
} from './types';

/** Internal-name rule: lowercase, spaces -> underscores, strip anything outside a-z0-9_. */
export function toInternalName(display: string): string {
  return display
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** supplier_id -> Supplier ID */
export function toLabel(name: string): string {
  const upper = new Set(['id', 'pk', 'duns', 'ein', 'vat', 'sku', 'gtin', 'upc', 'iso', 'npi', 'url', 'ssn', 'pct', 'ppm', 'hq', 'erp', 'crm']);
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => (upper.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Entity colors: muted, distinct in lightness as well as hue, legible on light and dark canvases. */
export const ENTITY_COLORS = [
  '#3E6A8F',
  '#C9784E',
  '#7A5C8E',
  '#1F6366',
  '#4A4D52',
  '#9A4A10',
  '#5C7F9E',
  '#A2667A',
  '#5E7A5A',
  '#8C7A4B',
  '#A12F18',
  '#6B6E9A',
];
export const REFERENCE_COLORS = ['#3E6A8F', '#2F5D73', '#4E7C8C', '#5C7F9E', '#1F6366'];

export const AREA_COLORS = ['#3E6A8F', '#F2A67C', '#7A5C8E', '#1F6366', '#A9A9A5', '#8C7A4B', '#A2667A'];

/** Sticky-note papers: pale tints that keep dark ink readable in both themes. */
export const NOTE_COLORS = ['#F3EEDF', '#FBE3D3', '#E1E8EF', '#DCEAE6', '#ECE3F1', '#E6E5E1'];

export function nowIso(): string {
  return new Date().toISOString();
}

export function createModel(name: string, title: string, opts: Partial<DataModel> = {}): DataModel {
  const ts = nowIso();
  return {
    format: FORMAT,
    format_version: FORMAT_VERSION,
    source: SOURCE_URL,
    name,
    title,
    organization: '',
    description: '',
    version: '0.1',
    author: '',
    status: 'draft',
    created_at: ts,
    updated_at: ts,
    entities: [],
    relationships: [],
    hierarchies: [],
    areas: [],
    notes: [],
    ...opts,
  };
}

export function createEntity(model: DataModel, displayName: string, type: EntityType = 'standard'): Entity {
  const base = toInternalName(displayName) || 'entity';
  const name = uniqueName(base, model.entities.map((e) => e.name));
  const palette = type === 'reference' ? REFERENCE_COLORS : ENTITY_COLORS;
  const color = palette[model.entities.filter((e) => e.entity_type === type).length % palette.length];
  const pk: Attribute =
    type === 'reference'
      ? { name: `${name}_code`, label: `${toLabel(name)} Code`, type: 'STRING', is_primary_key: true, is_label: false }
      : { name: `${name}_id`, label: `${toLabel(name)} ID`, type: 'STRING', is_primary_key: true, is_label: false };
  const label: Attribute = { name: `${name}_name`, label: `${toLabel(name)} Name`, type: 'STRING', is_label: true };
  return {
    name,
    display_name: displayName,
    entity_type: type,
    description: '',
    color_code: color,
    attributes: [pk, label],
    struct_types: [],
    dependent_reference: null,
  };
}

export function createRelationship(model: DataModel, source: string, target: string): Relationship {
  const base = `${source}_to_${target}`.slice(0, 60);
  return {
    name: uniqueName(base, model.relationships.map((r) => r.name)),
    source,
    target,
    cardinality: source === target ? 'N:1' : 'N:1',
    forward_label: source === target ? 'Child Of' : 'Belongs To',
    reverse_label: source === target ? 'Parent Of' : 'Has',
    bidirectional: true,
    description: '',
    attributes: [],
  };
}

/** `base`, or `base_2`, `base_3`… — whichever is free. Pass a Set when calling in a loop. */
export function uniqueName(base: string, taken: string[] | Set<string>): string {
  const has = Array.isArray(taken) ? (n: string) => taken.includes(n) : (n: string) => taken.has(n);
  if (!has(base)) return base;
  let i = 2;
  while (has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// Fields from earlier versions of the format that the model no longer carries; dropped on load.
const OBSOLETE_MODEL_KEYS = ['settings', 'datasets'];
const OBSOLETE_ENTITY_KEYS = ['entity_subtype', 'storage_type', 'dataset_mappings', 'survivorship', 'validations', 'match', 'product_tiers', 'stub'];

/** Fill defaults so older or hand-written files load safely. Mutates and returns the model. */
export function normalizeModel(raw: any): DataModel {
  const m = raw as DataModel;
  // Header keys first, in a stable order, so the file reads the same however it was made.
  const rest = { ...raw };
  for (const k of Object.keys(raw)) delete raw[k];
  Object.assign(raw, { format: FORMAT, format_version: FORMAT_VERSION, source: SOURCE_URL }, rest, { format: FORMAT, format_version: FORMAT_VERSION, source: SOURCE_URL });
  m.title = m.title || m.name || 'Untitled model';
  m.name = m.name || toInternalName(m.title);
  if (raw.client !== undefined) {
    m.organization = m.organization || raw.client;
    delete raw.client;
  }
  for (const k of OBSOLETE_MODEL_KEYS) delete raw[k];
  m.entities = m.entities || [];
  m.relationships = m.relationships || [];
  m.hierarchies = m.hierarchies || [];
  m.areas = m.areas || [];
  m.notes = m.notes || [];
  m.created_at = m.created_at || nowIso();
  m.updated_at = m.updated_at || m.created_at;
  for (const t of m.tabs || []) {
    t.name = t.name || t.id;
    t.kind = t.kind || 'variant';
    for (const k of ['entities', 'relationships', 'hierarchies', 'areas', 'notes'] as const) t[k] = (t[k] || []) as any;
  }
  if (m.tabs && !m.tabs.length) delete m.tabs;
  for (const e of [...m.entities, ...(m.tabs || []).flatMap((t) => t.entities)]) {
    e.display_name = e.display_name || toLabel(e.name);
    if (e.entity_type !== 'reference') e.entity_type = 'standard';
    for (const k of OBSOLETE_ENTITY_KEYS) delete (e as any)[k];
    e.color_code = e.color_code || ENTITY_COLORS[0];
    e.attributes = e.attributes || [];
    e.struct_types = e.struct_types || [];
    for (const a of e.attributes) {
      a.label = a.label || toLabel(a.name);
      a.type = (a.type || 'STRING').toUpperCase() as any;
      delete (a as any).show_in_ui;
    }
  }
  for (const r of [...m.relationships, ...(m.tabs || []).flatMap((t) => t.relationships)]) {
    r.attributes = r.attributes || [];
    delete (r as any).datasets;
    r.bidirectional = r.bidirectional ?? !!r.reverse_label;
  }
  for (const h of [...m.hierarchies, ...(m.tabs || []).flatMap((t) => t.hierarchies)]) {
    h.levels = h.levels || [];
    h.status = h.status || 'draft';
  }
  return m;
}

/** List row for a stored model, read leniently from the raw JSON (older or hand-edited files included). */
export function summarizeModel(id: string, raw: any, fallbackUpdatedAt?: string): ModelSummary {
  const entities: any[] = raw?.entities || [];
  return {
    id,
    title: raw?.title || id,
    organization: raw?.organization || raw?.client || '',
    description: raw?.description || '',
    status: raw?.status || 'draft',
    version: raw?.version || '',
    updated_at: raw?.updated_at || fallbackUpdatedAt,
    entities: entities.length,
    standard: entities.filter((e) => e.entity_type !== 'reference').length,
    references: entities.filter((e) => e.entity_type === 'reference').length,
    relationships: (raw?.relationships || []).length,
    colors: entities.slice(0, 8).map((e) => e.color_code),
  };
}

/** Stable, readable serialization (2-space JSON, trailing newline). */
export function serializeModel(m: DataModel): string {
  return JSON.stringify(m, null, 2) + '\n';
}

/** `byName` (an index of m.entities) makes repeated lookups O(1) in bulk code; without it this is a scan. */
export function getEntity(m: DataModel, name: string | undefined | null, byName?: Map<string, Entity>): Entity | undefined {
  if (!name) return undefined;
  return byName ? byName.get(name) : m.entities.find((e) => e.name === name);
}

export function entityIndex(m: DataModel): Map<string, Entity> {
  return new Map(m.entities.map((e) => [e.name, e]));
}

export function primaryKey(e: Entity): Attribute | undefined {
  return e.attributes.find((a) => a.is_primary_key);
}

export function labelAttribute(e: Entity): Attribute | undefined {
  return e.attributes.find((a) => a.is_label);
}

/** Display form of an attribute type, e.g. ARRAY<STRUCT<address>> or REF → country.country_name. */
export function typeDisplay(a: Attribute): string {
  let t: string = a.type;
  if (a.type === 'DECIMAL') t = `DECIMAL(${a.precision ?? 18},${a.scale ?? 2})`;
  if (a.type === 'STRUCT') t = `STRUCT<${a.struct_type || '?'}>`;
  if (a.type === 'REFERENCE_ENTITY') t = 'REFERENCE';
  return a.is_array ? `ARRAY<${t}>` : t;
}

/**
 * Order entities so dependencies come first: reference parents before children,
 * reference entities before the entities that point at them.
 */
export function dependencyOrder(m: DataModel): Entity[] {
  const deps = new Map<string, Set<string>>();
  for (const e of m.entities) {
    const d = new Set<string>();
    if (e.dependent_reference?.parent) d.add(e.dependent_reference.parent);
    for (const a of e.attributes) if (a.reference?.entity) d.add(a.reference.entity);
    for (const s of e.struct_types || []) for (const f of s.fields) if (f.reference?.entity) d.add(f.reference.entity);
    d.delete(e.name);
    deps.set(e.name, d);
  }
  const typeRank = (e: Entity) => (e.entity_type === 'reference' ? 0 : 1);
  const pending = [...m.entities].sort((a, b) => typeRank(a) - typeRank(b));
  const done = new Set<string>();
  const out: Entity[] = [];
  while (pending.length) {
    const idx = pending.findIndex((e) => [...(deps.get(e.name) || [])].every((d) => done.has(d) || !m.entities.some((x) => x.name === d)));
    const [next] = pending.splice(idx === -1 ? 0 : idx, 1);
    out.push(next);
    done.add(next.name);
  }
  return out;
}

/** All attributes (and struct sub-fields) across the model that point at a reference entity. */
export function referenceUsages(m: DataModel, refEntity: string): { entity: string; attribute: string; output: string }[] {
  const out: { entity: string; attribute: string; output: string }[] = [];
  for (const e of m.entities) {
    for (const a of e.attributes) {
      if (a.type === 'REFERENCE_ENTITY' && a.reference?.entity === refEntity) out.push({ entity: e.name, attribute: a.name, output: a.reference.output_attribute });
      if (a.type === 'STRUCT') {
        const st = e.struct_types?.find((s) => s.name === a.struct_type);
        for (const f of st?.fields || [])
          if (f.reference?.entity === refEntity) out.push({ entity: e.name, attribute: `${a.name}.${f.name}`, output: f.reference.output_attribute });
      }
    }
  }
  return out;
}

/** For a relationship: the entity that holds the foreign key (child) and the one it points at (parent). N:N has neither. */
export function relationshipEnds(r: Relationship): { child: string; parent: string } | null {
  if (r.cardinality === 'N:N') return null;
  return r.cardinality === '1:N' ? { child: r.target, parent: r.source } : { child: r.source, parent: r.target };
}

/** The child attribute holding the parent's key: `foreign_key` when set, else a single unambiguous name match. */
export function resolveForeignKey(m: DataModel, r: Relationship, byName?: Map<string, Entity>): string | undefined {
  const ends = relationshipEnds(r);
  if (!ends) return undefined;
  const child = getEntity(m, ends.child, byName);
  if (!child) return undefined;
  if (r.foreign_key) return child.attributes.some((a) => a.name === r.foreign_key) ? r.foreign_key : undefined;
  return inferForeignKey(m, r, byName);
}

/** Guess the foreign-key attribute from naming conventions; undefined unless exactly one candidate fits. */
export function inferForeignKey(m: DataModel, r: Relationship, byName?: Map<string, Entity>): string | undefined {
  const ends = relationshipEnds(r);
  if (!ends) return undefined;
  const child = getEntity(m, ends.child, byName);
  const parent = getEntity(m, ends.parent, byName);
  const pk = parent && primaryKey(parent);
  if (!child || !parent || !pk) return undefined;
  // A single-column key is the child's own identity, not a reference; in a composite key (order_line:
  // order_id + line_number) a part can be the parent's key.
  const keys = child.attributes.filter((a) => a.is_primary_key);
  const own = keys.length === 1 ? keys[0].name : undefined;
  const names = ends.child === ends.parent ? [`parent_${pk.name}`, `parent_${parent.name}_id`, 'parent_id'] : [pk.name, `${parent.name}_${pk.name}`, `${parent.name}_id`];
  const hits = [...new Set(names)].filter((n) => n !== own && child.attributes.some((a) => a.name === n));
  return hits.length ? hits[0] : undefined;
}
