// Compare two tabs: entities, attributes and relationships added, removed, renamed or changed. When one tab was
// derived from the other, `derived_from` lineage matches renamed things; otherwise matching is by name.
// `migrationSql` turns the difference between two physical tabs into ALTER/CREATE/DROP statements.
import { typeDisplay } from './model';
import { relationalPlan, type RelTable } from './interop/relational';
import { MADE_WITH, quoteIdent, sqlColumnType, type SqlDialect } from './interop/sqlTypes';
import { listTabs, tabView } from './tabs';
import type { Attribute, DataModel, Entity, Relationship } from './types';

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface AttrChange {
  change: ChangeKind;
  /** Name in tab B (or A, for removed). */
  name: string;
  /** Name in tab A, when it differs (rename). */
  from?: string;
  details: string[];
}

export interface EntityChange {
  change: ChangeKind;
  name: string;
  from?: string;
  details: string[];
  attributes: AttrChange[];
}

export interface RelChange {
  change: ChangeKind;
  name: string;
  from?: string;
  details: string[];
}

export interface TabDiff {
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** How things were matched. */
  matching: 'lineage' | 'name';
  entities: EntityChange[];
  relationships: RelChange[];
  unchanged: number;
}

/** For each B name, the A name it corresponds to. */
function matcher<T extends { name: string; derived_from?: string }>(aItems: T[], bItems: T[], dir: 'b-from-a' | 'a-from-b' | 'none') {
  const aNames = new Set(aItems.map((x) => x.name));
  const map = new Map<string, string>();
  const used = new Set<string>();
  if (dir === 'b-from-a') for (const b of bItems) if (b.derived_from && aNames.has(b.derived_from) && !used.has(b.derived_from)) map.set(b.name, b.derived_from), used.add(b.derived_from);
  if (dir === 'a-from-b') {
    const bNames = new Set(bItems.map((x) => x.name));
    for (const a of aItems) if (a.derived_from && bNames.has(a.derived_from) && !map.has(a.derived_from)) map.set(a.derived_from, a.name), used.add(a.name);
  }
  for (const b of bItems) if (!map.has(b.name) && aNames.has(b.name) && !used.has(b.name)) map.set(b.name, b.name), used.add(b.name);
  return map;
}

export type LineageDir = 'b-from-a' | 'a-from-b' | 'none';

function lineageDir(m: DataModel, aId: string, bId: string): LineageDir {
  const tabs = listTabs(m);
  if (tabs.find((t) => t.id === bId)?.derived_from === aId) return 'b-from-a';
  if (tabs.find((t) => t.id === aId)?.derived_from === bId) return 'a-from-b';
  return 'none';
}

function attrDetails(a: Attribute, b: Attribute, refName: (n: string) => string): string[] {
  const d: string[] = [];
  if (typeDisplay(a) !== typeDisplay(b)) d.push(`type ${typeDisplay(a)} → ${typeDisplay(b)}`);
  if (!!a.is_primary_key !== !!b.is_primary_key) d.push(b.is_primary_key ? 'now primary key' : 'no longer primary key');
  if (!!a.required !== !!b.required) d.push(b.required ? 'now required' : 'now optional');
  if (!!a.pii !== !!b.pii) d.push(b.pii ? 'now PII' : 'no longer PII');
  if (a.reference && b.reference && (refName(a.reference.entity) !== b.reference.entity || a.reference.output_attribute !== b.reference.output_attribute))
    d.push(`reference ${a.reference.entity}.${a.reference.output_attribute} → ${b.reference.entity}.${b.reference.output_attribute}`);
  return d;
}

export function diffTabs(m: DataModel, aId: string, bId: string): TabDiff {
  const tabs = listTabs(m);
  const label = (id: string) => ({ id, name: tabs.find((t) => t.id === id)?.name || id });
  return diffViews(tabView(m, aId), tabView(m, bId), lineageDir(m, aId, bId), label(aId), label(bId));
}

/**
 * Compare two single-tab models. `dir` says which side was derived from the other (lineage matching), or
 * 'none' to match by name — e.g. a model before and after a proposal.
 */
export function diffViews(A: DataModel, B: DataModel, dir: LineageDir, a: TabDiff['a'] = { id: 'a', name: 'Before' }, b: TabDiff['b'] = { id: 'b', name: 'After' }): TabDiff {
  const emap = matcher(A.entities, B.entities, dir);
  const toB = new Map([...emap].map(([b, a]) => [a, b]));
  const refName = (aName: string) => toB.get(aName) ?? aName;
  const aByName = new Map(A.entities.map((e) => [e.name, e]));
  const entities: EntityChange[] = [];
  let unchanged = 0;

  for (const eb of B.entities) {
    const an = emap.get(eb.name);
    const ea = an ? aByName.get(an) : undefined;
    if (!ea) {
      entities.push({ change: 'added', name: eb.name, details: [`${eb.attributes.length} attributes`], attributes: [] });
      continue;
    }
    const ch = diffEntity(ea, eb, dir, refName);
    if (ch.details.length || ch.attributes.length || ea.name !== eb.name) entities.push({ ...ch, change: 'changed', name: eb.name, from: ea.name !== eb.name ? ea.name : undefined });
    else unchanged++;
  }
  const matchedA = new Set(emap.values());
  for (const ea of A.entities) if (!matchedA.has(ea.name)) entities.push({ change: 'removed', name: ea.name, details: [], attributes: [] });

  const relationships: RelChange[] = [];
  const relKey = (r: Relationship, side: 'a' | 'b') => (side === 'a' ? `${refName(r.source)}|${refName(r.target)}` : `${r.source}|${r.target}`);
  const usedA = new Set<string>();
  // Indexes instead of scans: big tabs have thousands of relationships.
  const aRelByName = new Map(A.relationships.map((r) => [r.name, r]));
  const aRelByKey = new Map<string, Relationship[]>();
  for (const r of A.relationships) aRelByKey.set(relKey(r, 'a'), [...(aRelByKey.get(relKey(r, 'a')) || []), r]);
  for (const rb of B.relationships) {
    const byName = aRelByName.get(rb.name);
    const ra = (byName && !usedA.has(byName.name) ? byName : undefined) || aRelByKey.get(relKey(rb, 'b'))?.find((x) => !usedA.has(x.name));
    if (!ra) {
      relationships.push({ change: 'added', name: rb.name, details: [`${rb.source} → ${rb.target} (${rb.cardinality})`] });
      continue;
    }
    usedA.add(ra.name);
    const d: string[] = [];
    if (relKey(ra, 'a') !== relKey(rb, 'b')) d.push(`ends ${ra.source} → ${ra.target} became ${rb.source} → ${rb.target}`);
    if (ra.cardinality !== rb.cardinality) d.push(`cardinality ${ra.cardinality} → ${rb.cardinality}`);
    if ((ra.foreign_key || '') !== (rb.foreign_key || '')) d.push(`foreign key ${ra.foreign_key || '(none)'} → ${rb.foreign_key || '(none)'}`);
    if (!!ra.required !== !!rb.required) d.push(rb.required ? 'optional → required' : 'required → optional');
    if (ra.forward_label !== rb.forward_label) d.push(`label "${ra.forward_label}" → "${rb.forward_label}"`);
    // The relationship's own attributes (by name: they have no lineage of their own).
    const raAttrs = new Map((ra.attributes || []).map((x) => [x.name, x]));
    const rbAttrs = new Map((rb.attributes || []).map((x) => [x.name, x]));
    for (const [n, x] of rbAttrs) {
      const old = raAttrs.get(n);
      if (!old) d.push(`attribute ${n} added (${typeDisplay(x)})`);
      else if (typeDisplay(old) !== typeDisplay(x) || !!old.required !== !!x.required)
        d.push(`attribute ${n}: ${typeDisplay(old)}${old.required ? ' required' : ''} → ${typeDisplay(x)}${x.required ? ' required' : ''}`);
    }
    for (const n of raAttrs.keys()) if (!rbAttrs.has(n)) d.push(`attribute ${n} removed`);
    if (d.length || ra.name !== rb.name) relationships.push({ change: 'changed', name: rb.name, from: ra.name !== rb.name ? ra.name : undefined, details: d });
  }
  for (const ra of A.relationships) if (!usedA.has(ra.name)) relationships.push({ change: 'removed', name: ra.name, details: [`${ra.source} → ${ra.target} (${ra.cardinality})`] });

  return { a, b, matching: dir === 'none' ? 'name' : 'lineage', entities, relationships, unchanged };
}

function diffEntity(ea: Entity, eb: Entity, dir: 'b-from-a' | 'a-from-b' | 'none', refName: (n: string) => string): Omit<EntityChange, 'change' | 'name' | 'from'> {
  const details: string[] = [];
  if (ea.entity_type !== eb.entity_type) details.push(`${ea.entity_type} → ${eb.entity_type}`);
  if (ea.display_name !== eb.display_name) details.push(`display name "${ea.display_name}" → "${eb.display_name}"`);
  const amap = matcher(ea.attributes, eb.attributes, dir);
  const attributes: AttrChange[] = [];
  for (const b of eb.attributes) {
    const an = amap.get(b.name);
    const a = an ? ea.attributes.find((x) => x.name === an) : undefined;
    if (!a) attributes.push({ change: 'added', name: b.name, details: [typeDisplay(b)] });
    else {
      const d = attrDetails(a, b, refName);
      if (d.length || a.name !== b.name) attributes.push({ change: 'changed', name: b.name, from: a.name !== b.name ? a.name : undefined, details: d });
    }
  }
  const matched = new Set(amap.values());
  for (const a of ea.attributes) if (!matched.has(a.name)) attributes.push({ change: 'removed', name: a.name, details: [typeDisplay(a)] });
  return { details, attributes };
}

export function diffCounts(d: TabDiff) {
  const all = [...d.entities, ...d.relationships];
  return { added: all.filter((x) => x.change === 'added').length, removed: all.filter((x) => x.change === 'removed').length, changed: all.filter((x) => x.change === 'changed').length };
}

export function diffToMarkdown(d: TabDiff): string {
  const out = [`# ${d.a.name} → ${d.b.name}`, '', `Matched by ${d.matching === 'lineage' ? 'derivation lineage' : 'name'}. ${d.unchanged} entities unchanged.`, ''];
  const sym = { added: '+', removed: '−', changed: '~' };
  if (d.entities.length) out.push('## Entities', '');
  for (const e of d.entities) {
    out.push(`- ${sym[e.change]} **${e.name}**${e.from ? ` (was ${e.from})` : ''}${e.details.length ? ` — ${e.details.join('; ')}` : ''}`);
    for (const a of e.attributes) out.push(`  - ${sym[a.change]} \`${a.name}\`${a.from ? ` (was \`${a.from}\`)` : ''}${a.details.length ? ` — ${a.details.join('; ')}` : ''}`);
  }
  if (d.relationships.length) out.push('', '## Relationships', '');
  for (const r of d.relationships) out.push(`- ${sym[r.change]} **${r.name}**${r.from ? ` (was ${r.from})` : ''}${r.details.length ? ` — ${r.details.join('; ')}` : ''}`);
  if (!d.entities.length && !d.relationships.length) out.push('No differences.');
  return out.join('\n') + '\n';
}

/**
 * DDL that takes a database built from tab A to tab B. Tables and columns are matched like `diffTabs` (lineage
 * first), so renames become RENAME statements instead of drop + create.
 */
export function migrationSql(m: DataModel, aId: string, bId: string, dialect: SqlDialect): string {
  const A = tabView(m, aId);
  const B = tabView(m, bId);
  const dir = lineageDir(m, aId, bId);
  const pa = relationalPlan(A);
  const pb = relationalPlan(B);
  const emap = matcher(A.entities, B.entities, dir);
  const q = (n: string) => quoteIdent(n, dialect);
  const out: string[] = [];
  const tabs = listTabs(m);
  out.push(`-- Migration: ${tabs.find((t) => t.id === aId)?.name} → ${tabs.find((t) => t.id === bId)?.name} (${dialect})`);
  out.push(`-- ${MADE_WITH}`);
  out.push('-- Review before running: data in dropped columns and tables is lost.', '');

  const aTableByEntity = new Map(pa.tables.filter((t) => t.entity && !t.relationship).map((t) => [t.entity!.name, t]));
  const aTableByName = new Map(pa.tables.map((t) => [t.name, t]));
  const tableA = (tb: RelTable) => (tb.entity && !tb.relationship ? aTableByEntity.get(emap.get(tb.entity.name) ?? '') : aTableByName.get(tb.name));
  const colType = (t: RelTable, c: RelTable['columns'][number], model: DataModel) => sqlColumnType(model, c.entity, c.attr, dialect);
  const matchedA = new Set<string>();

  for (const tb of pb.tables) {
    const ta = tableA(tb);
    if (!ta) {
      const cols = tb.columns.map((c) => `  ${q(c.name)} ${colType(tb, c, B)}${c.notNull ? ' NOT NULL' : ''}`);
      if (tb.pk.length) cols.push(`  PRIMARY KEY (${tb.pk.map(q).join(', ')})`);
      out.push(`CREATE TABLE ${q(tb.name)} (\n${cols.join(',\n')}\n);`, '');
      continue;
    }
    matchedA.add(ta.name);
    const stmts: string[] = [];
    if (ta.name !== tb.name) stmts.push(`ALTER TABLE ${q(ta.name)} RENAME TO ${q(tb.name)};`);
    const t = q(tb.name);
    const cmap = matcher(
      ta.columns.map((c) => ({ name: c.name, derived_from: c.attr.derived_from })),
      tb.columns.map((c) => ({ name: c.name, derived_from: c.attr.derived_from })),
      dir,
    );
    for (const cb of tb.columns) {
      const an = cmap.get(cb.name);
      const ca = an ? ta.columns.find((c) => c.name === an) : undefined;
      if (!ca) {
        stmts.push(`ALTER TABLE ${t} ADD COLUMN ${q(cb.name)} ${colType(tb, cb, B)};`);
        continue;
      }
      if (ca.name !== cb.name) stmts.push(`ALTER TABLE ${t} RENAME COLUMN ${q(ca.name)} TO ${q(cb.name)};`);
      const [ta1, tb1] = [colType(ta, ca, A), colType(tb, cb, B)];
      if (ta1 !== tb1) stmts.push(alterType(t, q(cb.name), tb1, dialect));
    }
    const matchedCols = new Set(cmap.values());
    for (const ca of ta.columns) if (!matchedCols.has(ca.name)) stmts.push(`ALTER TABLE ${t} DROP COLUMN ${q(ca.name)};`);
    if (stmts.length) out.push(...stmts, '');
  }
  for (const ta of pa.tables) if (!matchedA.has(ta.name)) out.push(`DROP TABLE ${q(ta.name)};`, '');

  // Foreign keys, compared by what they connect.
  const fkKey = (f: { table: string; column: string; refTable: string; refColumn: string }) => `${f.table}.${f.column}>${f.refTable}.${f.refColumn}`;
  const bKeys = new Set(pb.foreignKeys.map(fkKey));
  const renamedTables = new Map(pb.tables.map((tb) => [tableA(tb)?.name, tb.name]));
  const aKeys = new Map(pa.foreignKeys.map((f) => [fkKey({ ...f, table: renamedTables.get(f.table) ?? f.table, refTable: renamedTables.get(f.refTable) ?? f.refTable }), f]));
  const fkOut: string[] = [];
  for (const [k, f] of aKeys) if (!bKeys.has(k) && matchedA.has(f.table)) fkOut.push(`ALTER TABLE ${q(renamedTables.get(f.table) ?? f.table)} DROP CONSTRAINT ${q(f.name)};`);
  for (const f of pb.foreignKeys) if (!aKeys.has(fkKey(f))) fkOut.push(`ALTER TABLE ${q(f.table)} ADD CONSTRAINT ${q(f.name)} FOREIGN KEY (${q(f.column)}) REFERENCES ${q(f.refTable)} (${q(f.refColumn)});`);
  if (fkOut.length) out.push('-- Foreign keys', ...fkOut, '');
  if (out.length === 4) out.push('-- No differences.');
  return out.join('\n');
}

function alterType(table: string, col: string, type: string, d: SqlDialect): string {
  if (d === 'mysql') return `ALTER TABLE ${table} MODIFY COLUMN ${col} ${type};`;
  if (d === 'snowflake') return `ALTER TABLE ${table} ALTER COLUMN ${col} SET DATA TYPE ${type};`;
  if (d === 'databricks') return `-- ${table}.${col}: type change to ${type} needs a table rewrite (ALTER COLUMN TYPE only widens some types).`;
  return `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${type};`;
}
