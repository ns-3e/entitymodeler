// Model → SQL DDL for PostgreSQL, MySQL/MariaDB, Snowflake and Databricks.
import { valueColumns } from '../csv';
import { dependencyOrder } from '../model';
import { termOf } from '../glossary';
import type { DataModel } from '../types';
import { relationalPlan, type RelColumn, type RelTable } from './relational';
import { MADE_WITH, SQL_DIALECTS, quoteIdent, sqlColumnType, sqlLiteral, sqlString, valueType, type SqlDialect } from './sqlTypes';

export interface SqlOptions {
  dialect: SqlDialect;
  /** INSERT statements for reference entities that have values. Default true. */
  includeValues?: boolean;
  /** Optional schema prefix for every table. */
  schema?: string;
  now?: Date;
}

export function toSql(m: DataModel, opts: SqlOptions): string {
  const d = opts.dialect;
  const q = (n: string) => quoteIdent(n, d);
  const tbl = (n: string) => (opts.schema ? `${q(opts.schema)}.${q(n)}` : q(n));
  const plan = relationalPlan(m);
  const out: string[] = [];
  const date = (opts.now || new Date()).toISOString().slice(0, 10);

  out.push(`-- ${m.title} — data model`);
  out.push(`-- ${SQL_DIALECTS.find((x) => x.id === d)!.label} DDL, generated ${date}`);
  out.push(`-- ${MADE_WITH}`);
  if (d === 'snowflake' || d === 'databricks') out.push(`-- Note: ${d === 'snowflake' ? 'Snowflake' : 'Databricks'} records primary and foreign keys but does not enforce them.`);
  out.push('');

  for (const t of plan.tables) out.push(createTable(t), '');

  if (plan.foreignKeys.length || plan.tables.some((t) => t.unique.length)) {
    out.push('-- Keys between tables');
    for (const t of plan.tables) for (const u of t.unique) out.push(`ALTER TABLE ${tbl(t.name)} ADD CONSTRAINT ${q(`uq_${t.name}_${u}`.slice(0, 60))} UNIQUE (${q(u)});`);
    for (const fk of plan.foreignKeys) out.push(`ALTER TABLE ${tbl(fk.table)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${tbl(fk.refTable)} (${q(fk.refColumn)});`);
    out.push('');
  }
  // Databricks: Unity Catalog tags mark personal data so governance (masking, access) can act on it.
  // Business glossary terms become tags too, so the catalog can be searched by business meaning.
  const tagsOf = (c: RelColumn) => [...(c.attr.pii ? ["'pii' = 'true'"] : []), ...(termOf(m, c.attr.term) ? [`'business_term' = ${sqlString(termOf(m, c.attr.term)!.name, d)}`] : [])];
  const tagged = d === 'databricks' ? plan.tables.flatMap((t) => t.columns.filter((c) => tagsOf(c).length).map((c) => `ALTER TABLE ${tbl(t.name)} ALTER COLUMN ${q(c.name)} SET TAGS (${tagsOf(c).join(', ')});`)) : [];
  if (tagged.length) out.push('-- Tags', ...tagged, '');
  if (plan.notes.length) {
    out.push('-- Reference lookups stored by value (no foreign key possible):');
    for (const n of plan.notes) out.push(`--   ${n}`);
    out.push('');
  }

  if (opts.includeValues !== false) {
    const refs = dependencyOrder(m).filter((e) => e.entity_type === 'reference' && e.reference_values?.length);
    if (refs.length) out.push('-- Reference values');
    for (const e of refs) {
      const t = plan.tables.find((x) => x.name === e.name)!;
      const cols = valueColumns(e).filter((c) => t.columns.some((x) => x.name === c));
      const types = cols.map((c) => valueType(m, t.columns.find((x) => x.name === c)!.attr));
      const rows = e.reference_values!.map((v) => `  (${cols.map((c, i) => sqlLiteral(v[c], types[i], d)).join(', ')})`);
      out.push(`INSERT INTO ${tbl(e.name)} (${cols.map(q).join(', ')}) VALUES\n${rows.join(',\n')};`, '');
    }
  }
  if (m.hierarchies.length) {
    out.push('-- Hierarchies (navigation over the relationships above):');
    for (const h of m.hierarchies) out.push(`--   ${h.display_name}: root ${h.root}, ${h.levels.length + 1} level(s)`);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

  function columnDef(c: RelColumn): string {
    const parts = [`  ${q(c.name)} ${sqlColumnType(m, c.entity, c.attr, d)}`];
    if (c.notNull) parts.push('NOT NULL');
    const comment = c.attr.description || c.origin;
    if (comment && d !== 'postgres') parts.push(`COMMENT ${sqlString(comment, d)}`);
    return parts.join(' ');
  }

  function createTable(t: RelTable): string {
    const lines = t.columns.map(columnDef);
    if (t.pk.length) lines.push(d === 'databricks' ? `  CONSTRAINT ${q(`pk_${t.name}`.slice(0, 60))} PRIMARY KEY (${t.pk.map(q).join(', ')})` : `  PRIMARY KEY (${t.pk.map(q).join(', ')})`);
    const head = t.relationship ? `-- Junction table for relationship ${t.relationship}\n` : t.entity?.entity_type === 'reference' ? `-- Reference list: ${t.entity.display_name}\n` : '';
    let sql = `${head}CREATE TABLE ${tbl(t.name)} (\n${lines.join(',\n')}\n)`;
    const desc = t.description;
    if (d === 'mysql') sql += desc ? ` COMMENT=${sqlString(desc, d)};` : ';';
    else if (d === 'snowflake') sql += desc ? ` COMMENT = ${sqlString(desc, d)};` : ';';
    else if (d === 'databricks') sql += ` USING DELTA${desc ? ` COMMENT ${sqlString(desc, d)}` : ''};`;
    else {
      sql += ';';
      const comments: string[] = [];
      if (desc) comments.push(`COMMENT ON TABLE ${tbl(t.name)} IS ${sqlString(desc, d)};`);
      for (const c of t.columns) {
        const text = c.attr.description || c.origin;
        if (text) comments.push(`COMMENT ON COLUMN ${tbl(t.name)}.${q(c.name)} IS ${sqlString(text, d)};`);
      }
      if (comments.length) sql += '\n' + comments.join('\n');
    }
    return sql;
  }
}
