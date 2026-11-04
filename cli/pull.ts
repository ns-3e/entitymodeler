// Where a pull's snapshot comes from: a live connector, saved query results (CSV/TSV), or a saved snapshot.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_PLATFORMS, fromCatalogRows, parseResultSets, type CatalogPlatform, type CatalogSnapshot } from '../src/core/index';
import { pullDatabricks, pullPostgres, pullSnowflake } from './connectors';

export interface PullSource {
  from?: string;
  csv?: string;
  snapshot?: string;
  platform?: string;
  catalog?: string;
  schema?: string;
  profile?: string;
  url?: string;
}

export async function pullSnapshot(src: PullSource, log: (s: string) => void): Promise<CatalogSnapshot> {
  if (src.snapshot) return JSON.parse(readFileSync(resolve(src.snapshot), 'utf8'));
  if (src.csv) {
    const platform = (src.platform || src.from || 'postgres') as CatalogPlatform;
    if (!CATALOG_PLATFORMS.some((p) => p.id === platform)) throw new Error(`--platform must be one of ${CATALOG_PLATFORMS.map((p) => p.id).join(', ')}.`);
    const rowsets = src.csv.split(',').flatMap((f) => parseResultSets(readFileSync(resolve(f.trim()), 'utf8')));
    return fromCatalogRows(rowsets, platform, { catalog: src.catalog, schema: src.schema });
  }
  switch (src.from) {
    case 'databricks':
      return pullDatabricks({ catalog: src.catalog, schema: src.schema, profile: src.profile }, log);
    case 'snowflake':
      return pullSnowflake({ catalog: src.catalog, schema: src.schema }, log);
    case 'postgres':
      return pullPostgres({ schema: src.schema, url: src.url }, log);
    default:
      throw new Error('Say where to pull from: --from databricks|snowflake|postgres, --csv results.csv --platform P, or --snapshot snap.json.');
  }
}
