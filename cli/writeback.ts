// `em writeback` and the plan_writeback tool: compare what the model documents with the live catalog the tab was
// pulled from, and write the differences (descriptions; PII and glossary tags on Databricks) back as SQL.
import { addColumnTags, columnTagsQuery, tabView, writebackPlan, type CatalogPlatform, type DataModel, type WritebackStatement } from '../src/core/index';
import { databricksSql, postgresSql, snowflakeSql, type SqlRunner } from './connectors';
import { profileScope, type ProfileSource } from './profile';
import { pullSnapshot } from './pull';

export interface WritebackResult {
  statements: WritebackStatement[];
  /** Set when the statements were run. */
  applied?: number;
  failed: string[];
}

export async function writeback(doc: DataModel, tab: string, src: ProfileSource & { apply?: boolean; tags?: boolean }, log: (s: string) => void): Promise<WritebackResult> {
  const s = profileScope(doc, tab, src);
  const platform = s.from as CatalogPlatform;
  const snap = await pullSnapshot({ from: s.from, catalog: s.catalog, schema: s.schema, profile: s.profile, url: s.url }, log);
  let run: SqlRunner | undefined;
  const runner = async () =>
    (run ??= platform === 'databricks' ? await databricksSql({ profile: s.profile, warehouse: s.warehouse }, log) : platform === 'snowflake' ? snowflakeSql({ catalog: s.catalog, schema: s.schema }) : postgresSql(s.url));
  // Unity Catalog's REST API leaves tags out: read them so only missing tags are set.
  if (platform === 'databricks' && src.tags !== false && s.catalog && s.schema) {
    try {
      addColumnTags(snap, await (await runner())(columnTagsQuery(s.catalog, s.schema)));
    } catch (e) {
      log(`Could not read current tags (${(e as Error).message.split('\n')[0].slice(0, 160)}); every model tag is listed.`);
    }
  }
  const statements = writebackPlan(tabView(doc, tab), snap, { catalog: s.catalog, tags: src.tags });
  if (!src.apply || !statements.length) return { statements, failed: [] };
  const exec = await runner();
  const failed: string[] = [];
  let applied = 0;
  for (const st of statements) {
    try {
      await exec(st.sql);
      applied++;
    } catch (e) {
      failed.push(`${st.what}: ${(e as Error).message.split('\n')[0].slice(0, 200)}`);
    }
  }
  return { statements, applied, failed };
}
