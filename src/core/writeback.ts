// Write-back: put what the model documents (table and column descriptions; on Databricks, PII and glossary
// tags) into the live catalog the tab was pulled from. Statements are planned against a fresh snapshot, so only
// differences are written, and nothing the catalog has is ever removed: a blank description in the model
// leaves the catalog's comment alone.
import type { CatalogPlatform, CatalogSnapshot } from './interop/catalog';
import { quoteIdent, sqlString } from './interop/sqlTypes';
import { profileTargets } from './profile';
import { termOf } from './glossary';
import type { DataModel } from './types';

export interface WritebackStatement {
  sql: string;
  /** What it changes, in words: "orders.status: description", for review before running. */
  what: string;
}

/** Unity Catalog column tags as information_schema.column_tags returns them, for comparing before tagging. */
export function columnTagsQuery(catalog: string, schema: string): string {
  return `SELECT table_name, column_name, tag_name, tag_value FROM ${quoteIdent(catalog, 'databricks')}.information_schema.column_tags WHERE schema_name = ${sqlString(schema, 'databricks')}`;
}

/** Rows of `columnTagsQuery` → the snapshot's per-table `tags` (column → tag → value). */
export function addColumnTags(snap: CatalogSnapshot, rows: Record<string, string>[]): void {
  for (const r of rows) {
    const t = snap.tables.find((x) => x.name.toLowerCase() === String(r.table_name).toLowerCase());
    if (!t) continue;
    ((t.tags ??= {})[r.column_name] ??= {})[r.tag_name] = r.tag_value ?? '';
  }
}

/** Tags the model implies for a column (Databricks): `pii` and `business_term`. */
function modelTags(m: DataModel, a: DataModel['entities'][number]['attributes'][number]): Record<string, string> {
  const out: Record<string, string> = {};
  if (a.pii) out.pii = 'true';
  const term = termOf(m, a.term);
  if (term) out.business_term = term.name;
  return out;
}

const same = (a: string | undefined, b: string | undefined) => (a || '').trim() === (b || '').trim();

export function writebackPlan(view: DataModel, snap: CatalogSnapshot, opts: { catalog?: string; tags?: boolean } = {}): WritebackStatement[] {
  const platform: CatalogPlatform = snap.platform;
  if (platform === 'mysql') throw new Error('Write-back supports Databricks, Snowflake and PostgreSQL. MySQL column comments need the full column definition.');
  // Real names from the snapshot. Snowflake upper-cases unquoted names, so quote anything that isn't upper-case already.
  const q = (n: string) => (platform === 'snowflake' ? (/^[A-Z_][A-Z0-9_$]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`) : quoteIdent(n, platform));
  const catalog = platform === 'postgres' ? undefined : opts.catalog ?? snap.catalog;
  const tableRef = (schema: string | undefined, name: string) => [catalog, schema ?? snap.schema, name].filter(Boolean).map((x) => q(x!)).join('.');
  const lit = (s: string) => sqlString(s, platform);
  const out: WritebackStatement[] = [];

  for (const { entity, table } of profileTargets(view, snap)) {
    const e = view.entities.find((x) => x.name === entity)!;
    const ref = tableRef(table.schema, table.name);
    if (e.description && !same(e.description, table.comment)) out.push({ sql: `COMMENT ON TABLE ${ref} IS ${lit(e.description)};`, what: `${table.name}: table description` });
    const cols = new Map(table.columns.map((c) => [c.name.toLowerCase().replace(/[^a-z0-9]/g, ''), c]));
    for (const a of e.attributes) {
      const c = cols.get(a.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (!c) continue;
      if (a.description && !same(a.description, c.comment))
        out.push({
          sql: platform === 'databricks' ? `ALTER TABLE ${ref} ALTER COLUMN ${q(c.name)} COMMENT ${lit(a.description)};` : `COMMENT ON COLUMN ${ref}.${q(c.name)} IS ${lit(a.description)};`,
          what: `${table.name}.${c.name}: description`,
        });
      if (platform !== 'databricks' || opts.tags === false) continue;
      const have = table.tags?.[c.name] || {};
      const missing = Object.entries(modelTags(view, a)).filter(([k, v]) => have[k] !== v);
      if (missing.length)
        out.push({ sql: `ALTER TABLE ${ref} ALTER COLUMN ${q(c.name)} SET TAGS (${missing.map(([k, v]) => `${lit(k)} = ${lit(v)}`).join(', ')});`, what: `${table.name}.${c.name}: tags ${missing.map(([k]) => k).join(', ')}` });
    }
  }
  return out;
}
