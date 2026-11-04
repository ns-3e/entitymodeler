// Live schemas → model. A CatalogSnapshot is what any database tells us about its tables: columns, comments,
// primary and foreign keys. It comes from a connector (CLI: Databricks Unity Catalog REST, Snowflake SQL API,
// psql) or from pasting the result of `catalogQuery` run in any SQL tool. `fromCatalog` then reuses the DDL
// importer's model builder, so lookup tables, link tables and dependent lists are recognized the same way.
import { buildModel, type PColumn, type PFk, type PTable, type ImportResult } from './sqlParse';
import { parseDelimited } from '../csv';

export type CatalogPlatform = 'databricks' | 'snowflake' | 'postgres' | 'mysql';
export const CATALOG_PLATFORMS: { id: CatalogPlatform; label: string; scope: string }[] = [
  { id: 'databricks', label: 'Databricks (Unity Catalog)', scope: 'catalog.schema' },
  { id: 'snowflake', label: 'Snowflake', scope: 'database.schema' },
  { id: 'postgres', label: 'PostgreSQL', scope: 'schema' },
  { id: 'mysql', label: 'MySQL / MariaDB', scope: 'database' },
];

export interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
  ordinal?: number;
}
export interface CatalogForeignKey {
  name?: string;
  columns: string[];
  ref_schema?: string;
  ref_table: string;
  ref_columns: string[];
}
export interface CatalogTable {
  schema?: string;
  name: string;
  comment?: string;
  columns: CatalogColumn[];
  primary_key: string[];
  foreign_keys: CatalogForeignKey[];
  /** Column tags (Databricks) or labels, by column name. */
  tags?: Record<string, Record<string, string>>;
}
export interface CatalogSnapshot {
  platform: CatalogPlatform;
  /** Catalog/database the tables came from, when the platform has one. */
  catalog?: string;
  schema?: string;
  captured_at: string;
  tables: CatalogTable[];
}

export interface CatalogScope {
  /** Databricks catalog / Snowflake database / MySQL database. */
  catalog?: string;
  schema?: string;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

/**
 * One row per column with its table, comments, key position and the foreign key it belongs to. The result
 * columns are the same on every platform (table_schema, table_name, table_comment, column_name,
 * ordinal_position, data_type, is_nullable, column_comment, pk_position, fk_name, ref_schema, ref_table,
 * ref_column), so `fromCatalogRows` reads any of them.
 */
export function catalogQuery(platform: CatalogPlatform, scope: CatalogScope): string {
  const schema = scope.schema || (platform === 'postgres' ? 'public' : '');
  if (platform === 'postgres')
    return `-- EntityModel.com: PostgreSQL catalog for schema ${schema}. Export the result as CSV.
SELECT c.table_schema, c.table_name, obj_description(pc.oid, 'pg_class') AS table_comment,
       c.column_name, c.ordinal_position, format_type(a.atttypid, a.atttypmod) AS data_type, c.is_nullable,
       col_description(pc.oid, a.attnum) AS column_comment, pk.pk_position,
       fk.fk_name, fk.ref_schema, fk.ref_table, fk.ref_column
FROM information_schema.columns c
JOIN pg_namespace pn ON pn.nspname = c.table_schema
JOIN pg_class pc ON pc.relnamespace = pn.oid AND pc.relname = c.table_name AND pc.relkind IN ('r', 'p')
JOIN pg_attribute a ON a.attrelid = pc.oid AND a.attname = c.column_name
LEFT JOIN (
  SELECT k.table_schema, k.table_name, k.column_name, k.ordinal_position AS pk_position
  FROM information_schema.table_constraints t
  JOIN information_schema.key_column_usage k ON k.constraint_schema = t.constraint_schema AND k.constraint_name = t.constraint_name
  WHERE t.constraint_type = 'PRIMARY KEY'
) pk ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name
LEFT JOIN (
  SELECT k.table_schema, k.table_name, k.column_name, rc.constraint_name AS fk_name,
         r.table_schema AS ref_schema, r.table_name AS ref_table, r.column_name AS ref_column
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage k ON k.constraint_schema = rc.constraint_schema AND k.constraint_name = rc.constraint_name
  JOIN information_schema.key_column_usage r ON r.constraint_schema = rc.unique_constraint_schema AND r.constraint_name = rc.unique_constraint_name
       AND r.ordinal_position = k.position_in_unique_constraint
) fk ON fk.table_schema = c.table_schema AND fk.table_name = c.table_name AND fk.column_name = c.column_name
WHERE c.table_schema = ${lit(schema)}
ORDER BY c.table_name, c.ordinal_position;`;

  if (platform === 'mysql') {
    const db = scope.catalog || scope.schema || '';
    return `-- EntityModel.com: MySQL catalog for database ${db}. Export the result as CSV.
SELECT c.table_schema, c.table_name, t.table_comment, c.column_name, c.ordinal_position, c.column_type AS data_type,
       c.is_nullable, c.column_comment,
       CASE WHEN k.constraint_name = 'PRIMARY' THEN k.ordinal_position END AS pk_position,
       f.constraint_name AS fk_name, f.referenced_table_schema AS ref_schema, f.referenced_table_name AS ref_table,
       f.referenced_column_name AS ref_column
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
LEFT JOIN information_schema.key_column_usage k ON k.table_schema = c.table_schema AND k.table_name = c.table_name
     AND k.column_name = c.column_name AND k.constraint_name = 'PRIMARY'
LEFT JOIN information_schema.key_column_usage f ON f.table_schema = c.table_schema AND f.table_name = c.table_name
     AND f.column_name = c.column_name AND f.referenced_table_name IS NOT NULL
WHERE c.table_schema = ${lit(db)}
ORDER BY c.table_name, c.ordinal_position;`;
  }

  // Databricks Unity Catalog and Snowflake both have an ANSI information_schema per catalog/database.
  const cat = scope.catalog ? `${ident(scope.catalog)}.` : '';
  const is = `${cat}information_schema`;
  if (platform === 'snowflake')
    // Snowflake records keys but its information_schema has no key-column views: run the two SHOW
    // statements too and paste their results below the first (or let `em pull --from snowflake` do it).
    return `-- EntityModel.com: Snowflake catalog for ${scope.catalog || '<database>'}.${schema}. Export each result as CSV.
SELECT c.table_schema, c.table_name, t.comment AS table_comment, c.column_name, c.ordinal_position, c.data_type,
       c.is_nullable, c.comment AS column_comment
FROM ${is}.columns c
JOIN ${is}.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
WHERE c.table_schema = ${lit(schema.toUpperCase())}
ORDER BY c.table_name, c.ordinal_position;
-- Keys (optional, paste each result too):
SHOW PRIMARY KEYS IN SCHEMA ${cat}${ident(schema)};
SHOW IMPORTED KEYS IN SCHEMA ${cat}${ident(schema)};`;

  return `-- EntityModel.com: Databricks Unity Catalog for ${scope.catalog || '<catalog>'}.${schema}. Download the result as CSV.
SELECT c.table_schema, c.table_name, t.comment AS table_comment, c.column_name, c.ordinal_position,
       c.full_data_type AS data_type, c.is_nullable, c.comment AS column_comment, pk.ordinal_position AS pk_position,
       fk.constraint_name AS fk_name, ref.table_schema AS ref_schema, ref.table_name AS ref_table, ref.column_name AS ref_column
FROM ${is}.columns c
JOIN ${is}.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type <> 'VIEW'
LEFT JOIN (
  SELECT k.table_schema, k.table_name, k.column_name, k.ordinal_position
  FROM ${is}.table_constraints tc
  JOIN ${is}.key_column_usage k ON k.constraint_schema = tc.constraint_schema AND k.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name
LEFT JOIN ${is}.key_column_usage fk ON fk.table_schema = c.table_schema AND fk.table_name = c.table_name AND fk.column_name = c.column_name
     AND fk.position_in_unique_constraint IS NOT NULL
LEFT JOIN ${is}.referential_constraints rc ON rc.constraint_schema = fk.constraint_schema AND rc.constraint_name = fk.constraint_name
LEFT JOIN ${is}.key_column_usage ref ON ref.constraint_schema = rc.unique_constraint_schema AND ref.constraint_name = rc.unique_constraint_name
     AND ref.ordinal_position = fk.position_in_unique_constraint
WHERE c.table_schema = ${lit(schema)}
ORDER BY c.table_name, c.ordinal_position;`;
}

type Row = Record<string, string>;
const low = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase().replace(/^"|"$/g, ''), (v ?? '').trim()]));
const blank = (v: string | undefined) => !v || /^(null|\\N)$/i.test(v);

/**
 * Snapshot from result rows. Each rowset is one pasted/queried result: the column query above, or Snowflake's
 * SHOW PRIMARY KEYS / SHOW IMPORTED KEYS output (recognized by their headers).
 */
export function fromCatalogRows(rowsets: Row[][], platform: CatalogPlatform, scope: CatalogScope = {}): CatalogSnapshot {
  const tables = new Map<string, CatalogTable>();
  const key = (schema: string | undefined, table: string) => `${(schema || '').toLowerCase()}.${table.toLowerCase()}`;
  const table = (schema: string | undefined, name: string) => {
    const k = key(schema, name);
    if (!tables.has(k)) tables.set(k, { schema: schema || undefined, name, columns: [], primary_key: [], foreign_keys: [] });
    return tables.get(k)!;
  };
  const pkPos = new Map<string, Map<string, number>>();
  const fkParts = new Map<string, { t: CatalogTable; name?: string; ref_schema?: string; ref_table: string; parts: { col: string; ref: string; seq: number }[] }>();
  const addFk = (t: CatalogTable, name: string | undefined, refSchema: string | undefined, refTable: string, col: string, refCol: string, seq: number) => {
    const k = `${key(t.schema, t.name)}|${name || `${col}>${refTable}`}`;
    if (!fkParts.has(k)) fkParts.set(k, { t, name, ref_schema: refSchema, ref_table: refTable, parts: [] });
    const f = fkParts.get(k)!;
    if (!f.parts.some((p) => p.col === col && p.ref === refCol)) f.parts.push({ col, ref: refCol, seq });
  };
  const setPk = (t: CatalogTable, col: string, pos: number) => {
    const k = key(t.schema, t.name);
    if (!pkPos.has(k)) pkPos.set(k, new Map());
    pkPos.get(k)!.set(col, pos);
  };

  for (const raw of rowsets) {
    const rows = raw.map(low);
    const h = new Set(Object.keys(rows[0] || {}));
    if (h.has('fk_table_name') && h.has('pk_table_name')) {
      // Snowflake SHOW IMPORTED KEYS
      for (const r of rows) addFk(table(r.fk_schema_name, r.fk_table_name), r.fk_name, r.pk_schema_name, r.pk_table_name, r.fk_column_name, r.pk_column_name, Number(r.key_sequence) || 1);
    } else if (h.has('key_sequence') && h.has('column_name') && h.has('table_name') && !h.has('data_type')) {
      // Snowflake SHOW PRIMARY KEYS
      for (const r of rows) setPk(table(r.schema_name, r.table_name), r.column_name, Number(r.key_sequence) || 1);
    } else if (h.has('table_name') && h.has('column_name')) {
      for (const r of rows) {
        const t = table(r.table_schema, r.table_name);
        if (!blank(r.table_comment)) t.comment = r.table_comment;
        if (!t.columns.some((c) => c.name === r.column_name))
          t.columns.push({ name: r.column_name, type: r.data_type || 'STRING', nullable: !/^(no|false|n|0)$/i.test(r.is_nullable || 'yes'), comment: blank(r.column_comment) ? undefined : r.column_comment, ordinal: Number(r.ordinal_position) || undefined });
        if (!blank(r.pk_position)) setPk(t, r.column_name, Number(r.pk_position) || 1);
        if (!blank(r.ref_table) && !blank(r.ref_column)) addFk(t, blank(r.fk_name) ? undefined : r.fk_name, blank(r.ref_schema) ? undefined : r.ref_schema, r.ref_table, r.column_name, r.ref_column, t.columns.length);
      }
    }
  }
  for (const [k, cols] of pkPos) {
    const t = tables.get(k);
    if (t) t.primary_key = [...cols].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  }
  for (const f of fkParts.values()) {
    const parts = f.parts.sort((a, b) => a.seq - b.seq);
    f.t.foreign_keys.push({ name: f.name, columns: parts.map((p) => p.col), ref_schema: f.ref_schema, ref_table: f.ref_table, ref_columns: parts.map((p) => p.ref) });
  }
  // Key-only rowsets can mention tables outside the column query's scope; keep tables that have columns.
  const out = [...tables.values()].filter((t) => t.columns.length);
  for (const t of out) t.columns.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  return { platform, catalog: scope.catalog, schema: scope.schema || out[0]?.schema, captured_at: new Date().toISOString(), tables: out };
}

/** Snapshot → model, with the same recognition rules as SQL DDL import. Tables from several schemas are prefixed when names clash. */
export function fromCatalog(s: CatalogSnapshot, opts: { title?: string } = {}): ImportResult {
  const warnings: string[] = [];
  const counts = new Map<string, number>();
  for (const t of s.tables) counts.set(t.name.toLowerCase(), (counts.get(t.name.toLowerCase()) || 0) + 1);
  const nameOf = (schema: string | undefined, table: string) => (counts.get(table.toLowerCase())! > 1 && schema ? `${schema}_${table}` : table);
  const known = new Set(s.tables.map((t) => `${(t.schema || '').toLowerCase()}.${t.name.toLowerCase()}`));
  const tables: PTable[] = s.tables.map((t) => ({
    name: nameOf(t.schema, t.name),
    comment: t.comment,
    pk: t.primary_key,
    rows: [],
    columns: t.columns.map((c): PColumn => ({ name: c.name, type: c.type, notNull: !c.nullable, pk: t.primary_key.includes(c.name), unique: false, comment: c.comment })),
  }));
  const fks: PFk[] = [];
  for (const t of s.tables)
    for (const f of t.foreign_keys) {
      const refSchema = f.ref_schema || t.schema;
      if (!known.has(`${(refSchema || '').toLowerCase()}.${f.ref_table.toLowerCase()}`) && !s.tables.some((x) => x.name.toLowerCase() === f.ref_table.toLowerCase())) {
        warnings.push(`${t.name}.${f.columns.join(', ')} references ${refSchema ? `${refSchema}.` : ''}${f.ref_table}, which is outside the pulled schema.`);
        continue;
      }
      fks.push({ table: nameOf(t.schema, t.name), columns: f.columns, refTable: nameOf(refSchema, f.ref_table), refColumns: f.ref_columns, name: f.name });
    }
  const where = [s.catalog, s.schema].filter(Boolean).join('.');
  const model = buildModel(tables, fks, warnings, opts.title || where || 'Database schema');
  if (!s.tables.length) warnings.unshift('No tables in the result. Check the catalog/schema name and that the query ran against it.');
  return { model, warnings };
}

/** Unity Catalog REST TableInfo objects (GET /api/2.1/unity-catalog/tables/{full_name}) → snapshot. */
export function fromUnityCatalog(tables: any[], scope: CatalogScope): CatalogSnapshot {
  const out: CatalogTable[] = [];
  for (const t of tables) {
    if (/VIEW/.test(t.table_type || '')) continue;
    const ct: CatalogTable = {
      schema: t.schema_name,
      name: t.name,
      comment: t.comment || undefined,
      columns: [...(t.columns || [])]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((c) => ({ name: c.name, type: c.type_text || c.type_name || 'STRING', nullable: c.nullable !== false, comment: c.comment || undefined, ordinal: c.position })),
      primary_key: [],
      foreign_keys: [],
    };
    for (const k of t.table_constraints || []) {
      if (k.primary_key_constraint) ct.primary_key = k.primary_key_constraint.child_columns || [];
      const f = k.foreign_key_constraint;
      if (f?.parent_table) {
        const parts = String(f.parent_table).split('.');
        ct.foreign_keys.push({ name: f.name, columns: f.child_columns || [], ref_schema: parts.length > 1 ? parts[parts.length - 2] : undefined, ref_table: parts[parts.length - 1], ref_columns: f.parent_columns || [] });
      }
    }
    out.push(ct);
  }
  return { platform: 'databricks', catalog: scope.catalog, schema: scope.schema, captured_at: new Date().toISOString(), tables: out };
}

/**
 * Pasted or downloaded query results (CSV or TSV, header row first) → rowsets. Several results can be pasted
 * one after another, separated by a blank line (Snowflake's column query plus its two SHOW results).
 */
export function parseResultSets(text: string): Record<string, string>[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => parseDelimited(block.trim()).filter((r) => r.some((c) => c.trim())))
    .filter((rows) => rows.length > 1)
    .map(([header, ...rows]) => rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))));
}
