// `em profile` and the profile_data tool: read the tab's tables from the database (or saved results), measure
// them with one query per table, and turn the numbers into update ops on the tab's entities and attributes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromProfileRows, parseResultSets, planProfile, profileQuery, profileTargets, tabView, type CatalogPlatform, type CatalogTable, type DataModel, type Op } from '../src/core/index';
import { databricksSql, postgresSql, snowflakeSql, type SqlRunner } from './connectors';
import { pullSnapshot } from './pull';

export interface ProfileSource {
  from?: string;
  catalog?: string;
  schema?: string;
  /** Databricks CLI profile. */
  profile?: string;
  warehouse?: string;
  url?: string;
  /** Rows per table (default 100,000; 0 reads every row). */
  sample?: number;
  entities?: string[];
}

export const DEFAULT_SAMPLE = 100_000;

/** Where the tab came from (`em pull` records it), overridden by explicit options. */
export function profileScope(doc: DataModel, tab: string, src: ProfileSource): Required<Pick<ProfileSource, 'from'>> & ProfileSource {
  const meta = tabView(doc, tab).tab?.source;
  const from = src.from || meta?.platform;
  if (!from) throw new Error('This tab was not pulled from a database: say where its tables are with --from databricks|snowflake|postgres --catalog C --schema S.');
  return { ...src, from, catalog: src.catalog ?? meta?.catalog, schema: src.schema ?? meta?.schema, profile: src.profile ?? (from === meta?.platform ? meta?.profile : undefined) };
}

/** The tab's entities as tables with the model's own column types, for the paste path (no connection). */
export function modelTables(view: DataModel, only?: string[], platform?: string): { entity: string; table: CatalogTable }[] {
  // Snowflake keeps unquoted names upper-case; the query quotes names, so match that.
  const n = (s: string) => (platform === 'snowflake' ? s.toUpperCase() : s);
  return view.entities
    .filter((e) => !only?.length || only.includes(e.name))
    .map((e) => ({ entity: e.name, table: { schema: view.tab?.source?.schema, name: n(e.name), columns: e.attributes.filter((a) => a.type !== 'REFERENCE_ENTITY' || a.reference).map((a) => ({ name: n(a.name), type: a.type, nullable: !a.required })), primary_key: [], foreign_keys: [] } }));
}

export async function profileLive(doc: DataModel, tab: string, src: ProfileSource, log: (s: string) => void): Promise<{ ops: Op[]; profiled: number; skipped: string[] }> {
  const s = profileScope(doc, tab, src);
  const platform = s.from as CatalogPlatform;
  const view = tabView(doc, tab);
  // Read the schema first: exact table and column names and database types.
  const snap = await pullSnapshot({ from: s.from, catalog: s.catalog, schema: s.schema, profile: s.profile, url: s.url }, log);
  const targets = profileTargets(view, snap, s.entities);
  const skipped = view.entities.filter((e) => (!s.entities?.length || s.entities.includes(e.name)) && !targets.some((t) => t.entity === e.name)).map((e) => e.name);
  const run: SqlRunner =
    platform === 'databricks' ? await databricksSql({ profile: s.profile, warehouse: s.warehouse }, log) : platform === 'snowflake' ? snowflakeSql({ catalog: s.catalog, schema: s.schema }) : postgresSql(s.url);
  const sample = s.sample ?? DEFAULT_SAMPLE;
  log(`Profiling ${targets.length} table(s)${sample ? `, first ${sample.toLocaleString('en-US')} rows each` : ', every row'}…`);
  const rows: Record<string, string>[] = [];
  const queue = [...targets];
  let done = 0;
  // A few tables at a time: warehouses queue the rest anyway.
  await Promise.all(
    Array.from({ length: platform === 'postgres' ? 1 : 4 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          rows.push(...(await run(profileQuery(platform, t.table, { catalog: s.catalog, sample }))));
        } catch (e) {
          skipped.push(`${t.entity} (${(e as Error).message.split('\n')[0].slice(0, 160)})`);
        }
        if (++done % 10 === 0) log(`  ${done}/${targets.length}`);
      }
    }),
  );
  const ops = planProfile(view, targets, fromProfileRows(rows, { sample, platform }));
  return { ops, profiled: ops.filter((o) => o.op === 'update_entity').length, skipped };
}

/** Saved query results (CSV/TSV of the statements `em profile --query` prints) → ops. */
export function profileFromCsv(doc: DataModel, tab: string, files: string, sample: number): { ops: Op[]; profiled: number } {
  const view = tabView(doc, tab);
  const rows = files.split(',').flatMap((f) => parseResultSets(readFileSync(resolve(f.trim()), 'utf8')).flat());
  const ops = planProfile(view, modelTables(view), fromProfileRows(rows, { sample, platform: view.tab?.source?.platform }));
  return { ops, profiled: ops.filter((o) => o.op === 'update_entity').length };
}
