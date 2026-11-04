// Data profiling: what the rows in a pulled table actually look like (row count, nulls, distinct values, ranges,
// longest string). `profileQuery` writes one SQL statement per table, `fromProfileRows` reads its result (from a
// connector or a pasted CSV), `planProfile` turns results into update ops, and `profileIssues` flags where the
// data disagrees with the design. Only counts and ranges are kept, never sample values: models live in git. Columns
// that are or look personal keep no range either.
import type { CatalogPlatform, CatalogSnapshot, CatalogTable } from './interop/catalog';
import type { Op } from './operations';
import { looksPersonal } from './standards';
import type { AttributeProfile, DataModel, EntityProfile, Issue } from './types';

export interface ProfileOptions {
  /** Databricks catalog / Snowflake database / MySQL database. */
  catalog?: string;
  /** Read at most this many rows per table (0 or absent: all rows). */
  sample?: number;
  /** Where the query ran: Databricks and Snowflake estimate distinct counts on full-table scans. */
  platform?: CatalogPlatform;
}

/**
 * Whether distinct counts are estimates. A sample is small enough to count exactly, which matters: Databricks'
 * approx_count_distinct is off by about 5%, enough to make a unique key look like it repeats.
 */
export const approximateDistinct = (platform: CatalogPlatform | undefined, sample?: number) => !sample && (platform === 'databricks' || platform === 'snowflake');

export interface TableProfile {
  schema?: string;
  table: string;
  rows: number;
  sampled: boolean;
  approx?: boolean;
  columns: Map<string, AttributeProfile>;
}

type Kind = 'number' | 'date' | 'string' | 'bool' | 'other';
/** What can be measured for a column type: numbers and dates get ranges, strings a max length, complex types only nulls. */
function kindOf(type: string): Kind {
  const t = type.toLowerCase();
  if (/^(struct|array|map|variant|object|json|jsonb|binary|bytea|blob|geography|geometry|xml|interval|void)/.test(t) || /\[\]$/.test(t)) return 'other';
  if (/^bool/.test(t)) return 'bool';
  if (/^(tiny|small|medium|big)?int|^integer|^decimal|^numeric|^number|^double|^float|^real|^serial|^bigserial|^smallserial|^money/.test(t)) return 'number';
  if (/^(date|time|timestamp|datetime)/.test(t)) return 'date';
  if (/^(string|text|varchar|char|character|nvarchar|nchar|citext|uuid|tinytext|mediumtext|longtext|enum)/.test(t)) return 'string';
  return 'other';
}

const SQL: Record<CatalogPlatform, { q: (s: string) => string; distinct: (c: string) => string; str: (x: string) => string; len: (x: string) => string; text: string; int: string }> = {
  databricks: { q: (s) => `\`${s.replace(/`/g, '``')}\``, distinct: (c) => `approx_count_distinct(${c})`, str: (x) => `CAST(${x} AS STRING)`, len: (x) => `length(${x})`, text: 'STRING', int: 'BIGINT' },
  snowflake: { q: (s) => `"${s.replace(/"/g, '""')}"`, distinct: (c) => `APPROX_COUNT_DISTINCT(${c})`, str: (x) => `TO_VARCHAR(${x})`, len: (x) => `LENGTH(${x})`, text: 'VARCHAR', int: 'BIGINT' },
  postgres: { q: (s) => `"${s.replace(/"/g, '""')}"`, distinct: (c) => `COUNT(DISTINCT ${c})`, str: (x) => `CAST(${x} AS TEXT)`, len: (x) => `length(${x})`, text: 'TEXT', int: 'BIGINT' },
  mysql: { q: (s) => `\`${s.replace(/`/g, '``')}\``, distinct: (c) => `COUNT(DISTINCT ${c})`, str: (x) => `CAST(${x} AS CHAR)`, len: (x) => `CHAR_LENGTH(${x})`, text: 'CHAR', int: 'SIGNED' },
};
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * One statement for one table: a row per column with table_name, column_name, row_count, non_null,
 * distinct_count, min_value, max_value, max_length. With `sample`, it reads the first N rows only.
 */
export function profileQuery(platform: CatalogPlatform, t: Pick<CatalogTable, 'schema' | 'name' | 'columns'>, opts: ProfileOptions = {}): string {
  const d = SQL[platform];
  // Snowflake stores unquoted names upper-case: a database typed as `analytics` is ANALYTICS.
  const catalog = platform === 'postgres' ? undefined : platform === 'snowflake' && opts.catalog && /^[a-z_][a-z0-9_$]*$/.test(opts.catalog) ? opts.catalog.toUpperCase() : opts.catalog;
  const from = [catalog, t.schema, t.name].filter(Boolean).map((x) => d.q(x!)).join('.');
  const src = opts.sample ? `(SELECT * FROM ${from} LIMIT ${Math.floor(opts.sample)}) s` : `${from} s`;
  const nullText = `CAST(NULL AS ${d.text})`;
  const nullInt = `CAST(NULL AS ${d.int})`;
  // MySQL casts integers with SIGNED, which only works in CAST, not as a column type of NULL: plain NULL is fine there.
  const ni = platform === 'mysql' ? 'NULL' : nullInt;
  const selects = t.columns.map((c) => {
    const col = `s.${d.q(c.name)}`;
    const k = kindOf(c.type);
    const ranged = k === 'number' || k === 'date';
    return [
      `SELECT ${lit(t.name)} AS table_name, ${lit(c.name)} AS column_name, COUNT(*) AS row_count, COUNT(${col}) AS non_null`,
      `${k === 'other' ? ni : approximateDistinct(platform, opts.sample) ? d.distinct(col) : `COUNT(DISTINCT ${col})`} AS distinct_count`,
      `${ranged ? d.str(`MIN(${col})`) : nullText} AS min_value, ${ranged ? d.str(`MAX(${col})`) : nullText} AS max_value`,
      `${k === 'string' ? `MAX(${d.len(col)})` : ni} AS max_length FROM ${src}`,
    ].join(', ');
  });
  return `-- EntityModel.com: profile of ${t.name} (${t.columns.length} columns${opts.sample ? `, first ${opts.sample} rows` : ''}). Export the result as CSV.\n${selects.join('\nUNION ALL\n')};`;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' || /^null$/i.test(String(v)) ? undefined : Number(v));
const str = (v: unknown) => (v === null || v === undefined || v === '' || /^null$/i.test(String(v)) ? undefined : String(v));

/** Result rows (any number of tables) → per-table profiles. Header names are matched case-insensitively. */
export function fromProfileRows(rows: Record<string, unknown>[], opts: ProfileOptions = {}): TableProfile[] {
  const out = new Map<string, TableProfile>();
  for (const raw of rows) {
    const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), v]));
    const table = str(r.table_name);
    const column = str(r.column_name);
    if (!table || !column) continue;
    const rows_ = num(r.row_count) ?? 0;
    if (!out.has(table)) out.set(table, { table, rows: rows_, sampled: !!opts.sample && rows_ >= opts.sample, ...(approximateDistinct(opts.platform, opts.sample) ? { approx: true } : {}), columns: new Map() });
    const p: AttributeProfile = { non_null: num(r.non_null) ?? 0 };
    const distinct = num(r.distinct_count);
    if (distinct !== undefined) p.distinct = Math.min(distinct, p.non_null);
    const min = str(r.min_value);
    const max = str(r.max_value);
    if (min !== undefined) p.min = min;
    if (max !== undefined) p.max = max;
    const len = num(r.max_length);
    if (len !== undefined) p.max_length = len;
    out.get(table)!.columns.set(column, p);
  }
  return [...out.values()];
}

/** Compare names the way imports create them: case and punctuation don't matter. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The snapshot tables that correspond to entities in this view (by name, or schema-prefixed name). */
export function profileTargets(view: DataModel, snap: CatalogSnapshot, only?: string[]): { entity: string; table: CatalogTable }[] {
  const byKey = new Map<string, CatalogTable>();
  for (const t of snap.tables) {
    byKey.set(key(t.name), t);
    if (t.schema) byKey.set(key(`${t.schema}_${t.name}`), t);
  }
  const wanted = only?.length ? new Set(only) : undefined;
  return view.entities.flatMap((e) => {
    const table = byKey.get(key(e.name));
    return table && (!wanted || wanted.has(e.name)) ? [{ entity: e.name, table }] : [];
  });
}

/** Profiles → update ops on the view's entities and attributes (unmatched columns are ignored). */
export function planProfile(view: DataModel, targets: { entity: string; table: CatalogTable }[], profiles: TableProfile[], at = new Date().toISOString()): Op[] {
  const byTable = new Map(profiles.map((p) => [key(p.table), p]));
  const ops: Op[] = [];
  for (const { entity, table } of targets) {
    const p = byTable.get(key(table.name));
    const e = view.entities.find((x) => x.name === entity);
    if (!p || !e) continue;
    const ep: EntityProfile = { rows: p.rows, profiled_at: at, ...(p.sampled ? { sampled: true } : {}), ...(p.approx ? { approx_distinct: true } : {}) };
    ops.push({ op: 'update_entity', entity, set: { profile: ep } });
    const cols = new Map([...p.columns].map(([c, v]) => [key(c), v]));
    for (const a of e.attributes) {
      const ap = cols.get(key(a.name));
      if (!ap) continue;
      // A range is two real values: for a social security number or birth date that is personal data, so keep counts only.
      const keep = a.pii || looksPersonal(a.name) ? (({ min: _min, max: _max, ...rest }) => rest)(ap) : ap;
      ops.push({ op: 'update_attribute', entity, attribute: a.name, set: { profile: keep } });
    }
  }
  return ops;
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;

const KEYLIKE = /(^id$|_id$|_key$|key$|_no$|_num$|_code$|_uuid$|^uuid$)/i;

function keyCandidate(attrs: DataModel['entities'][number]['attributes'], rows: number, approx: boolean): string | undefined {
  const unique = attrs.filter((a) => {
    const p = a.profile;
    if (!p || p.non_null !== rows || p.distinct === undefined || a.type === 'REFERENCE_ENTITY') return false;
    return approx ? p.distinct >= rows * 0.9 : p.distinct === rows;
  });
  // Estimates can't tell a unique column from a nearly unique one: only trust a key-like name then.
  return (unique.find((a) => KEYLIKE.test(a.name)) ?? (approx ? undefined : unique.find((a) => !/(name|desc|comment|note|text)/i.test(a.name))))?.name;
}

/** Where profiled data disagrees with the design, or suggests a better one. */
export function profileIssues(m: DataModel): Issue[] {
  const issues: Issue[] = [];
  for (const e of m.entities) {
    const rows = e.profile?.rows;
    if (rows === 0) issues.push({ level: 'info', code: 'profile.empty_table', message: `${e.name} had no rows when it was profiled.`, target: { kind: 'entity', name: e.name } });
    if (!rows) continue;
    const pk = e.attributes.filter((a) => a.is_primary_key);
    const of = `of ${rows.toLocaleString('en-US')}${e.profile!.sampled ? ' sampled' : ''} rows`;
    // Exact counts: any repeat is a repeat. Estimates (full scans on Databricks/Snowflake) can be a few % low.
    const approx = !!e.profile!.approx_distinct;
    const repeats = (p: AttributeProfile) => p.distinct !== undefined && p.distinct < (approx ? p.non_null * 0.9 : p.non_null);
    const about = approx ? 'about ' : '';
    const alwaysSet: string[] = [];
    for (const a of e.attributes) {
      const p = a.profile;
      if (!p) continue;
      const target = { kind: 'entity' as const, name: e.name, tab: 'attributes', attribute: a.name };
      const nulls = rows - p.non_null;
      if (a.is_primary_key && nulls > 0) issues.push({ level: 'warning', code: 'profile.pk_null', message: `${e.name}.${a.name} is a primary key but is empty in ${pct(nulls, rows)} ${of}.`, target });
      if (pk.length === 1 && a.is_primary_key && repeats(p))
        issues.push({ level: 'warning', code: 'profile.pk_dupes', message: `${e.name}.${a.name} is the primary key but has ${about}${p.distinct!.toLocaleString('en-US')} distinct values in ${p.non_null.toLocaleString('en-US')} rows: it may not identify a row.`, target });
      if (a.unique && repeats(p))
        issues.push({ level: 'warning', code: 'profile.unique', message: `${e.name}.${a.name} is marked unique but repeats (${about}${p.distinct!.toLocaleString('en-US')} distinct in ${p.non_null.toLocaleString('en-US')} rows).`, target });
      if (a.required && !a.is_primary_key && nulls > 0)
        issues.push({ level: 'warning', code: 'profile.required_null', message: `${e.name}.${a.name} is required but empty in ${pct(nulls, rows)} ${of}.`, target });
      if (p.non_null === 0) issues.push({ level: 'info', code: 'profile.empty', message: `${e.name}.${a.name} has no value in any ${of}. Is it still used?`, target });
      else if (!a.required && !a.is_primary_key && nulls === 0 && rows >= 100) alwaysSet.push(a.name);
      if (!a.is_primary_key && !a.reference && a.type === 'STRING' && p.distinct !== undefined && p.distinct >= 2 && p.distinct <= 25 && p.non_null >= 200 && !/(_id|_key|_uuid|_hash)$/i.test(a.name))
        issues.push({ level: 'info', code: 'profile.reference_candidate', message: `${e.name}.${a.name} has only ${p.distinct} distinct values in ${p.non_null.toLocaleString('en-US')} rows: a candidate reference list.`, target });
    }
    // No primary key: suggest the column that has a value in every row and never repeats, preferring key-like names.
    const candidate = !pk.length && rows >= 2 ? keyCandidate(e.attributes, rows, approx) : undefined;
    if (candidate)
      issues.push({
        level: 'info',
        code: 'profile.key_candidate',
        message: `${e.name} has no primary key; ${candidate} has a value in every one ${of} and ${approx ? 'barely' : 'never'} repeats. It could be the key.`,
        target: { kind: 'entity', name: e.name, tab: 'attributes', attribute: candidate },
        fix: [{ op: 'update_attribute', entity: e.name, attribute: candidate, set: { is_primary_key: true, required: true } }],
        suggested: true,
      });
    // One note per table, not one per column: a fresh pull has nothing marked required.
    const req = alwaysSet.filter((n) => n !== candidate);
    if (req.length)
      issues.push({
        level: 'info',
        code: 'profile.always_set',
        message:
          req.length === 1
            ? `${e.name}.${req[0]} has a value in all ${of}; it could be required.`
            : `${req.length} columns of ${e.name} have a value in all ${of} and could be required: ${req.slice(0, 6).join(', ')}${req.length > 6 ? `, and ${req.length - 6} more` : ''}.`,
        target: req.length === 1 ? { kind: 'entity', name: e.name, tab: 'attributes', attribute: req[0] } : { kind: 'entity', name: e.name, tab: 'attributes' },
        fix: req.map((attribute) => ({ op: 'update_attribute' as const, entity: e.name, attribute, set: { required: true } })),
        suggested: true,
      });
  }
  return issues;
}
