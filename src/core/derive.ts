// Derive one tab's content from another: physical → logical (business names, relationships instead of FK columns,
// junction tables as N:N, lookup tables as reference data), logical → physical (FK columns, junction tables),
// and → conceptual (entities and relationships only). Every derived entity and attribute records `derived_from`,
// so tabs can be compared later.
import { REFERENCE_COLORS, entityIndex, getEntity, primaryKey, relationshipEnds, resolveForeignKey, toLabel, uniqueName, inferForeignKey } from './model';
import { keyColumnName } from './interop/relational';
import { deleteRelationship, renameAttributes, renameEntities } from './ops';
import { structuredCopy } from './tabs';
import type { Attribute, DataModel, Entity, ModelContent, Relationship, TabKind } from './types';

export interface LogicalOptions {
  /** Expand abbreviations, strip table prefixes (tbl_, dim_, stg_…) and singularize entity names. */
  businessNames: boolean;
  /** Drop audit, ETL and SCD columns (created_at, etl_batch_id, row_hash, is_current…). */
  dropTechnical: boolean;
  /** Relationships stand for foreign keys: drop FK columns a relationship already covers. */
  dropForeignKeys: boolean;
  /** Pure link tables (two foreign keys, nothing else) become N:N relationships. */
  collapseJunctions: boolean;
  /** Lookup tables (country_code, order_status, lkp_…) become reference entities, their FKs reference attributes. */
  detectReferences: boolean;
  /** Add N:1 relationships for <entity>_id columns that match another entity's key but have none. */
  inferRelationships: boolean;
}

export interface PhysicalOptions {
  dialect?: 'postgres' | 'mysql' | 'snowflake' | 'databricks';
  /** Add a foreign-key column for every relationship that has none, and set `foreign_key`. */
  addForeignKeys: boolean;
  /** N:N relationships become junction tables with two N:1 relationships. */
  resolveManyToMany: boolean;
  /** Single (non-array) STRUCT attributes become prefixed columns. */
  flattenStructs: boolean;
  /** Add created_at / updated_at to every table that lacks them. */
  auditColumns: boolean;
}

export const DEFAULT_LOGICAL: LogicalOptions = { businessNames: true, dropTechnical: true, dropForeignKeys: true, collapseJunctions: true, detectReferences: true, inferRelationships: true };
export const DEFAULT_PHYSICAL: PhysicalOptions = { addForeignKeys: true, resolveManyToMany: true, flattenStructs: false, auditColumns: false };

export interface DeriveReport {
  /** One line per kind of change, for previews and CLI output. */
  lines: string[];
  renamedEntities: [string, string][];
  renamedAttributes: number;
  droppedColumns: string[];
  junctions: string[];
  references: string[];
  relationshipsAdded: string[];
}

/** "1 entity", "3 entities". */
function s(n: number, word: string): string {
  return `${n} ${n === 1 ? word : word.endsWith('y') ? word.slice(0, -1) + 'ies' : word + 's'}`;
}

function newReport(): DeriveReport {
  return { lines: [], renamedEntities: [], renamedAttributes: 0, droppedColumns: [], junctions: [], references: [], relationshipsAdded: [] };
}

/** Header + copied content with lineage set, ready to transform with the single-tab ops. */
function lineageCopy(src: DataModel): DataModel {
  const { tabs: _t, ...rest } = src;
  const m: DataModel = structuredCopy({ ...rest });
  for (const e of m.entities) {
    // A new tab starts with everything visible.
    if (e.ui) delete e.ui.hidden;
    e.derived_from = e.name;
    for (const a of e.attributes) a.derived_from = a.name;
  }
  return m;
}

function contentOf(m: DataModel): ModelContent {
  return { entities: m.entities, relationships: m.relationships, hierarchies: m.hierarchies, areas: m.areas, notes: m.notes };
}

export function deriveTab(src: DataModel, kind: TabKind, opts: { logical?: Partial<LogicalOptions>; physical?: Partial<PhysicalOptions> } = {}): { content: ModelContent; report: DeriveReport } {
  if (kind === 'logical') return deriveLogical(src, { ...DEFAULT_LOGICAL, ...opts.logical });
  if (kind === 'physical') return derivePhysical(src, { ...DEFAULT_PHYSICAL, ...opts.physical });
  if (kind === 'conceptual') return deriveConceptual(src);
  const m = lineageCopy(src);
  return { content: contentOf(m), report: { ...newReport(), lines: [`Copied ${m.entities.length} entities and ${m.relationships.length} relationships.`] } };
}

// ---------------------------------------------------------------- physical → logical

const TECHNICAL = [
  /^(created|updated|modified|inserted|deleted|changed|last_updated|last_modified)_(at|on|by|date|dt|ts|time|timestamp|user|user_id)$/,
  /^(create|update|insert|modify|mod|upd|ins|crt|chg)_(dt|ts|date|time|timestamp|user|by)$/,
  /^(etl|dw|dwh|edw|meta|sys|audit|ingest|ingestion|load|_)_\w+$/,
  /_(loaded_at|load_ts|load_dt|load_date|batch_id|run_id|job_id|row_hash|hash_key|hashdiff|checksum|ingested_at|ingest_ts)$/,
  /^(row_hash|record_hash|hash_diff|hashdiff|load_date|load_ts|load_dt|batch_id|run_id|row_version|rowversion|version_no|record_version|is_deleted|deleted_flag|delete_flag|is_current|current_flag|current_ind|record_source|source_system|src_sys_cd|dw_insert_ts|dw_update_ts|row_num|rownum)$/,
  /^(valid|effective|eff|scd)_(from|to|start|end)(_(dt|date|ts|timestamp))?$/,
  /^_[a-z]/,
];
export const isTechnicalColumn = (name: string) => TECHNICAL.some((re) => re.test(name.toLowerCase()));

export const ABBREVIATIONS: Record<string, string> = {
  acct: 'account', addr: 'address', adr: 'address', amt: 'amount', avg: 'average', bal: 'balance', cat: 'category',
  ccy: 'currency', cd: 'code', cntry: 'country', cnt: 'count', ctry: 'country', curr: 'currency', cust: 'customer',
  dept: 'department', desc: 'description', descr: 'description', dob: 'date_of_birth', dt: 'date', eff: 'effective',
  emp: 'employee', fname: 'first_name', flg: 'flag', grp: 'group', ind: 'indicator', inv: 'invoice', lang: 'language',
  lname: 'last_name', loc: 'location', mgr: 'manager', mth: 'month', msg: 'message', nbr: 'number', nm: 'name',
  num: 'number', ord: 'order', org: 'organization', pct: 'percent', pmt: 'payment', prod: 'product', pymt: 'payment',
  qty: 'quantity', seq: 'sequence', src: 'source', sts: 'status', stat: 'status', supp: 'supplier', suppl: 'supplier',
  svc: 'service', tel: 'telephone', tgt: 'target', tot: 'total', trans: 'transaction', trx: 'transaction',
  ts: 'timestamp', txn: 'transaction', typ: 'type', tz: 'time_zone', vend: 'vendor', ver: 'version', whse: 'warehouse',
  wk: 'week', yr: 'year',
};
const TABLE_PREFIX = /^(tbl|tb|t|dim|d|fact|fct|f|stg|src|raw|lkp|lu|ref|vw|v|bronze|silver|gold|ods|hub|sat|lnk)_(?=[a-z])/;
const TABLE_SUFFIX = /_(tbl|table|dim|fact|fct|lkp|lookup|lu|master|mstr|mst|ref|xref)$/;
const REFERENCE_NAME = /^(lkp|lu|ref|lookup|code|cd)_|_(type|types|status|statuses|code|codes|category|categories|lookup|lkp|lu|ref|reason|reasons|class)$/;

export function expandWords(name: string): string {
  return name
    .split('_')
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join('_');
}

/** order_lines → order_line, categories → category; leaves status, address, analysis alone. */
export function singularize(word: string): string {
  if (/(ss|us|is|ics|news|series|data|media)$/.test(word) || word.length < 4) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/(xes|ches|shes|sses|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Business name for a table: strip platform prefixes/suffixes, expand abbreviations, singularize the last word. */
export function logicalEntityName(name: string): string {
  let n = name.toLowerCase();
  for (let i = 0; i < 2 && TABLE_PREFIX.test(n); i++) n = n.replace(TABLE_PREFIX, '');
  n = n.replace(TABLE_SUFFIX, '');
  n = expandWords(n);
  const parts = n.split('_');
  parts[parts.length - 1] = singularize(parts[parts.length - 1]);
  return parts.join('_') || name;
}

export function logicalAttributeName(name: string): string {
  return expandWords(name.toLowerCase());
}

function deriveLogical(src: DataModel, o: LogicalOptions): { content: ModelContent; report: DeriveReport } {
  const m = lineageCopy(src);
  const rep = newReport();

  if (o.inferRelationships) {
    const byName = entityIndex(m);
    const covered = new Set(m.relationships.map((r) => `${relationshipEnds(r)?.child}.${resolveForeignKey(m, r, byName)}`));
    // Column name → entities whose key it names (<pk>, <entity>_<pk>, <entity>_id), in model order.
    const keyOwners = new Map<string, Entity[]>();
    for (const p of m.entities) {
      const pk = primaryKey(p);
      if (!pk) continue;
      for (const k of new Set([keyColumnName(p, pk), `${p.name}_id`])) keyOwners.set(k, [...(keyOwners.get(k) || []), p]);
    }
    const relNames = new Set(m.relationships.map((r) => r.name));
    for (const child of m.entities) {
      const own = new Set(child.attributes.filter((a) => a.is_primary_key).map((a) => a.name));
      for (const a of child.attributes) {
        if (a.type === 'REFERENCE_ENTITY' || a.type === 'STRUCT' || a.is_array || covered.has(`${child.name}.${a.name}`)) continue;
        if (own.has(a.name) && own.size === 1) continue;
        const parent = keyOwners.get(a.name)?.find((p) => p.name !== child.name);
        if (!parent) continue;
        const name = uniqueName(`${child.name}_${parent.name}`, relNames);
        relNames.add(name);
        m.relationships.push({ name, source: child.name, target: parent.name, cardinality: 'N:1', forward_label: 'Belongs To', reverse_label: 'Has', bidirectional: true, description: '', foreign_key: a.name, attributes: [] });
        covered.add(`${child.name}.${a.name}`);
        rep.relationshipsAdded.push(`${child.name} → ${parent.name} (${a.name})`);
      }
    }
  }

  if (o.dropTechnical)
    for (const e of m.entities) {
      const keep = (a: Attribute) => a.is_primary_key || a.is_label || !isTechnicalColumn(a.name);
      for (const a of e.attributes) if (!keep(a)) rep.droppedColumns.push(`${e.name}.${a.name}`);
      e.attributes = e.attributes.filter(keep);
    }

  if (o.collapseJunctions) collapseJunctions(m, rep);

  if (o.detectReferences) {
    const byName = entityIndex(m);
    const asChild = new Set<string>();
    const asParent = new Map<string, Relationship[]>();
    for (const r of m.relationships) {
      const ends = relationshipEnds(r);
      if (!ends) continue;
      asChild.add(ends.child);
      asParent.set(ends.parent, [...(asParent.get(ends.parent) || []), r]);
    }
    const gone = new Set<string>();
    for (const e of m.entities) {
      if (e.entity_type === 'reference' || !REFERENCE_NAME.test(e.name)) continue;
      const pk = e.attributes.filter((a) => a.is_primary_key);
      // A code list: one key, a handful of descriptive columns, and nothing of its own that points elsewhere.
      if (pk.length !== 1 || e.attributes.length > 6 || asChild.has(e.name)) continue;
      e.entity_type = 'reference';
      e.color_code = REFERENCE_COLORS[rep.references.length % REFERENCE_COLORS.length];
      if (!e.attributes.some((a) => a.is_label)) {
        const label = e.attributes.find((a) => !a.is_primary_key && /(name|desc|description|label|title)$/.test(a.name)) || e.attributes.find((a) => !a.is_primary_key && a.type === 'STRING');
        if (label) label.is_label = true;
      }
      // Each FK into the list becomes a reference attribute; the relationship goes away.
      for (const r of asParent.get(e.name) || []) {
        const ends = relationshipEnds(r)!;
        const child = byName.get(ends.child);
        const fk = resolveForeignKey(m, r, byName);
        const attr = child?.attributes.find((a) => a.name === fk);
        if (!child || !attr || attr.is_primary_key || ends.child === e.name) continue;
        attr.type = 'REFERENCE_ENTITY';
        attr.reference = { entity: e.name, output_attribute: pk[0].name };
        gone.add(r.name);
      }
      rep.references.push(e.name);
    }
    if (gone.size) {
      m.relationships = m.relationships.filter((r) => !gone.has(r.name));
      for (const h of m.hierarchies) for (const l of h.levels) l.branches = l.branches.filter((b) => !gone.has(b.relationship));
    }
  }

  if (o.dropForeignKeys) {
    const byName = entityIndex(m);
    for (const r of m.relationships) {
      const ends = relationshipEnds(r);
      const fk = resolveForeignKey(m, r, byName);
      const child = ends && byName.get(ends.child);
      const a = fk && child?.attributes.find((x) => x.name === fk);
      // Identifying relationships keep the key column (it is part of the child's identity), and say which it is.
      if (a && (a.is_primary_key || a.is_label)) {
        r.foreign_key = a.name;
        continue;
      }
      delete r.foreign_key;
      if (!child || !a) continue;
      child.attributes = child.attributes.filter((x) => x !== a);
      rep.droppedColumns.push(`${child.name}.${a.name} (foreign key → ${r.name})`);
    }
  }

  if (o.businessNames) {
    // Work out every rename first, then apply them in one pass each (a cascade per rename is quadratic).
    const names = new Set(m.entities.map((e) => e.name));
    const entityRenames = new Map<string, string>();
    for (const e of m.entities) {
      const next = logicalEntityName(e.name);
      if (next === e.name || !/^[a-z][a-z0-9_]*$/.test(next) || names.has(next)) continue;
      names.delete(e.name);
      names.add(next);
      entityRenames.set(e.name, next);
      rep.renamedEntities.push([e.name, next]);
      // Display names someone wrote stay; ones generated from the table name follow the new name.
      if (!e.display_name || e.display_name === toLabel(e.name) || e.display_name === e.name) e.display_name = toLabel(next);
    }
    renameEntities(m, entityRenames);
    const attrRenames = new Map<string, Map<string, string>>();
    for (const e of m.entities) {
      const taken = new Set(e.attributes.map((a) => a.name));
      const map = new Map<string, string>();
      for (const a of e.attributes) {
        const next = logicalAttributeName(a.name);
        if (next === a.name || taken.has(next)) continue;
        taken.delete(a.name);
        taken.add(next);
        map.set(a.name, next);
        if (!a.label || a.label === toLabel(a.name) || a.label === a.name) a.label = toLabel(next);
        rep.renamedAttributes++;
      }
      if (map.size) attrRenames.set(e.name, map);
    }
    renameAttributes(m, attrRenames);
  }

  if (rep.renamedEntities.length || rep.renamedAttributes) rep.lines.push(`Business names: ${s(rep.renamedEntities.length, 'entity')} and ${s(rep.renamedAttributes, 'attribute')} renamed.`);
  if (rep.relationshipsAdded.length) rep.lines.push(`Inferred ${s(rep.relationshipsAdded.length, 'relationship')} from key column names.`);
  if (rep.junctions.length) rep.lines.push(`Collapsed ${s(rep.junctions.length, 'link table')} into N:N relationships: ${rep.junctions.join(', ')}.`);
  if (rep.references.length) rep.lines.push(`Treated ${s(rep.references.length, 'lookup table')} as reference data: ${rep.references.join(', ')}.`);
  const fks = rep.droppedColumns.filter((c) => c.includes('(foreign key')).length;
  if (fks) rep.lines.push(`Replaced ${s(fks, 'foreign-key column')} with their relationships.`);
  if (rep.droppedColumns.length - fks) rep.lines.push(`Dropped ${s(rep.droppedColumns.length - fks, 'technical column')} (audit, ETL, SCD).`);
  if (!rep.lines.length) rep.lines.push('Copied as is: nothing physical-specific was found.');
  return { content: contentOf(m), report: rep };
}

/** Link tables: child of exactly two relationships whose FKs are all it holds (besides a surrogate key). */
function collapseJunctions(m: DataModel, rep: DeriveReport) {
  const byName = entityIndex(m);
  // Indexes kept current as link tables collapse, so each check is O(1) instead of a scan.
  const childOf = new Map<string, Relationship[]>();
  const parentCount = new Map<string, number>();
  const bump = (n: string, d: number) => parentCount.set(n, (parentCount.get(n) || 0) + d);
  for (const r of m.relationships) {
    const ends = relationshipEnds(r);
    if (ends && r.source !== r.target) childOf.set(ends.child, [...(childOf.get(ends.child) || []), r]);
    if (ends) bump(ends.parent, 1);
    else (bump(r.source, 1), r.target !== r.source && bump(r.target, 1));
  }
  const referenced = new Set(m.entities.flatMap((x) => x.attributes.map((a) => a.reference?.entity).filter((n): n is string => !!n)));
  const roots = new Set(m.hierarchies.map((h) => h.root));
  const removed = new Set<Entity>();
  const deadRels = new Set<string>();
  const relNames = new Set(m.relationships.map((r) => r.name));
  for (const e of m.entities) {
    if (e.entity_type === 'reference') continue;
    const asChild = (childOf.get(e.name) || []).filter((r) => !deadRels.has(r.name));
    if (asChild.length !== 2 || parentCount.get(e.name) || referenced.has(e.name) || roots.has(e.name)) continue;
    const fks = asChild.map((r) => resolveForeignKey(m, r, byName));
    if (fks.some((f) => !f)) continue;
    const rest = e.attributes.filter((a) => !fks.includes(a.name) && !(a.is_primary_key && !fks.includes(a.name) && /(_id|_key|_sk)$/.test(a.name)) && !isTechnicalColumn(a.name));
    if (rest.length) continue;
    const [p1, p2] = asChild.map((r) => relationshipEnds(r)!.parent);
    for (const r of asChild) {
      deadRels.add(r.name);
      bump(relationshipEnds(r)!.parent, -1);
    }
    removed.add(e);
    const name = uniqueName(e.name, relNames);
    relNames.add(name);
    m.relationships.push({
      name,
      source: p1,
      target: p2,
      cardinality: 'N:N',
      forward_label: 'Related To',
      reverse_label: 'Related From',
      bidirectional: true,
      description: e.description || `Was link table ${e.name}.`,
      attributes: [],
    });
    bump(p1, 1);
    if (p2 !== p1) bump(p2, 1);
    rep.junctions.push(e.name);
  }
  if (!removed.size) return;
  m.entities = m.entities.filter((x) => !removed.has(x));
  m.relationships = m.relationships.filter((r) => !deadRels.has(r.name));
  for (const h of m.hierarchies) for (const l of h.levels) l.branches = l.branches.filter((b) => !deadRels.has(b.relationship));
}

// ---------------------------------------------------------------- logical → physical

function derivePhysical(src: DataModel, o: PhysicalOptions): { content: ModelContent; report: DeriveReport } {
  const m = lineageCopy(src);
  const rep = newReport();
  let fkAdded = 0;
  let flattened = 0;
  let audit = 0;

  if (o.resolveManyToMany)
    for (const r of [...m.relationships]) {
      if (r.cardinality !== 'N:N') continue;
      const s = getEntity(m, r.source);
      const t = getEntity(m, r.target);
      const spk = s && primaryKey(s);
      const tpk = t && primaryKey(t);
      if (!s || !t || !spk || !tpk) continue;
      // A link table keeps its name (customer_products); a verb-like relationship name (supplied_by) gives way
      // to what the table links (product_supplier).
      const verb = /^(has|is|belongs|contains|owns|holds|uses|links)_|_(by|of|to|for|in|with|from|on|at|has)$/.test(r.name);
      const name = uniqueName(verb && s !== t ? `${s.name}_${t.name}` : r.name, m.entities.map((e) => e.name));
      const a = keyColumnName(s, spk);
      const b = s === t ? `related_${spk.name}` : uniqueName(keyColumnName(t, tpk), [a]);
      const j: Entity = {
        name,
        display_name: toLabel(name),
        entity_type: 'standard',
        description: r.description || `Links ${s.display_name} and ${t.display_name} (${r.forward_label || r.name}).`,
        color_code: s.color_code,
        attributes: [
          { name: a, label: toLabel(a), type: spk.type, is_primary_key: true, required: true, description: `${s.display_name} key` },
          { name: b, label: toLabel(b), type: tpk.type, is_primary_key: true, required: true, description: `${t.display_name} key` },
          ...(r.attributes || []).map((x) => ({ ...x, is_primary_key: false })),
        ],
        struct_types: [],
        dependent_reference: null,
      };
      if (s.ui && t.ui) j.ui = { x: Math.round((s.ui.x + t.ui.x) / 2 / 8) * 8, y: Math.round(((s.ui.y + t.ui.y) / 2 + 160) / 8) * 8 };
      m.entities.push(j);
      deleteRelationship(m, r.name);
      const rel = (to: Entity, fk: string, suffix: string): Relationship => ({
        name: uniqueName(`${name}_${suffix}`, m.relationships.map((x) => x.name)),
        source: name,
        target: to.name,
        cardinality: 'N:1',
        forward_label: 'Links',
        reverse_label: 'Linked By',
        bidirectional: true,
        description: '',
        foreign_key: fk,
        attributes: [],
      });
      m.relationships.push(rel(s, a, s.name));
      m.relationships.push(rel(t, b, s === t ? 'related' : t.name));
      rep.junctions.push(name);
    }

  if (o.addForeignKeys)
    for (const r of m.relationships) {
      const ends = relationshipEnds(r);
      if (!ends) continue;
      const child = getEntity(m, ends.child);
      const parent = getEntity(m, ends.parent);
      const pk = parent && primaryKey(parent);
      if (!child || !parent || !pk) continue;
      const existing = r.foreign_key && child.attributes.some((a) => a.name === r.foreign_key) ? r.foreign_key : inferForeignKey(m, r);
      if (existing) {
        r.foreign_key = existing;
        continue;
      }
      const name = uniqueName(ends.child === ends.parent ? `parent_${pk.name}` : keyColumnName(parent, pk), child.attributes.map((a) => a.name));
      const at = child.attributes.findIndex((a) => !a.is_primary_key);
      const col: Attribute = { name, label: toLabel(name), type: pk.type, description: `${parent.display_name} (${r.forward_label || r.name})` };
      child.attributes.splice(at === -1 ? child.attributes.length : at, 0, col);
      r.foreign_key = name;
      fkAdded++;
    }

  if (o.flattenStructs)
    for (const e of m.entities) {
      const out: Attribute[] = [];
      for (const a of e.attributes) {
        const st = a.type === 'STRUCT' && !a.is_array ? e.struct_types?.find((s) => s.name === a.struct_type) : undefined;
        if (!st) {
          out.push(a);
          continue;
        }
        for (const f of st.fields) {
          const name = uniqueName(`${a.name}_${f.name}`, [...e.attributes.map((x) => x.name), ...out.map((x) => x.name)]);
          out.push({ name, label: toLabel(name), type: f.type, reference: f.reference, description: f.description, derived_from: a.derived_from });
        }
        flattened++;
      }
      e.attributes = out;
      e.struct_types = (e.struct_types || []).filter((s) => out.some((a) => a.struct_type === s.name));
    }

  if (o.auditColumns)
    for (const e of m.entities) {
      if (e.entity_type === 'reference') continue;
      for (const n of ['created_at', 'updated_at'])
        if (!e.attributes.some((a) => a.name === n)) {
          e.attributes.push({ name: n, label: toLabel(n), type: 'TIMESTAMP', required: n === 'created_at', description: n === 'created_at' ? 'When the row was created.' : 'When the row last changed.' });
          audit++;
        }
    }

  if (rep.junctions.length) rep.lines.push(`Resolved ${s(rep.junctions.length, 'N:N relationship')} into junction tables: ${rep.junctions.join(', ')}.`);
  if (fkAdded) rep.lines.push(`Added ${s(fkAdded, 'foreign-key column')}.`);
  if (flattened) rep.lines.push(`Flattened ${s(flattened, 'struct')} into columns.`);
  if (audit) rep.lines.push(`Added ${s(audit, 'audit column')}.`);
  if (o.dialect) rep.lines.push(`Target platform: ${o.dialect}.`);
  if (!rep.lines.length) rep.lines.push('Copied as is: every relationship already has its key column.');
  return { content: contentOf(m), report: rep };
}

// ---------------------------------------------------------------- → conceptual

function deriveConceptual(src: DataModel): { content: ModelContent; report: DeriveReport } {
  const m = lineageCopy(src);
  const rep = newReport();
  collapseJunctions(m, rep);
  const refs = m.entities.filter((e) => e.entity_type === 'reference').map((e) => e.name);
  m.entities = m.entities.filter((e) => e.entity_type !== 'reference');
  const keep = new Set(m.entities.map((e) => e.name));
  m.relationships = m.relationships.filter((r) => keep.has(r.source) && keep.has(r.target));
  for (const r of m.relationships) {
    delete r.foreign_key;
    r.attributes = [];
  }
  for (const e of m.entities) {
    e.attributes = [];
    e.struct_types = [];
  }
  const rels = new Set(m.relationships.map((r) => r.name));
  m.hierarchies = m.hierarchies.filter((h) => keep.has(h.root) && h.levels.every((l) => l.branches.every((b) => rels.has(b.relationship) && keep.has(b.entity))));
  rep.lines.push(`${s(m.entities.length, 'entity')} and ${s(m.relationships.length, 'relationship')}, without attributes.`);
  if (refs.length) rep.lines.push(`Left out ${s(refs.length, 'reference list')}.`);
  if (rep.junctions.length) rep.lines.push(`Collapsed ${s(rep.junctions.length, 'link table')} into N:N relationships.`);
  return { content: contentOf(m), report: rep };
}
