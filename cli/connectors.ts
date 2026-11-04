// Live schema connectors for `em pull` (Node only, no dependencies). Credentials come from the environment or
// the platform's own CLI profile and are never written to the model.
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { catalogQuery, fromCatalogRows, fromUnityCatalog, parseResultSets, type CatalogScope, type CatalogSnapshot } from '../src/core/index';

const need = (v: string | undefined, what: string): string => {
  if (!v) throw new Error(what);
  return v;
};

// ---------------------------------------------------------------- Databricks (Unity Catalog REST)

/** Host and token: DATABRICKS_HOST/DATABRICKS_TOKEN, else a ~/.databrickscfg profile (PAT or `databricks auth token`). */
function databricksAuth(profile?: string): { host: string; token: string } {
  if (!profile && process.env.DATABRICKS_HOST && process.env.DATABRICKS_TOKEN) return { host: process.env.DATABRICKS_HOST, token: process.env.DATABRICKS_TOKEN };
  const name = profile || process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
  const cfgFile = process.env.DATABRICKS_CONFIG_FILE || join(homedir(), '.databrickscfg');
  const cfg: Record<string, string> = {};
  if (existsSync(cfgFile)) {
    let cur = '';
    for (const line of readFileSync(cfgFile, 'utf8').split('\n')) {
      const sec = line.match(/^\s*\[(.+?)\]\s*$/);
      if (sec) cur = sec[1];
      else if (cur === name) {
        const kv = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*$/);
        if (kv) cfg[kv[1]] = kv[2];
      }
    }
  }
  const host = need(process.env.DATABRICKS_HOST || cfg.host, `No Databricks host: set DATABRICKS_HOST, or add profile [${name}] to ${cfgFile} (\`databricks auth login\`).`);
  if (cfg.token) return { host, token: cfg.token };
  // OAuth profiles: the Databricks CLI mints a short-lived token.
  const r = spawnSync('databricks', ['auth', 'token', '--profile', name, '--output', 'json'], { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) throw new Error(`Could not get a Databricks token for profile ${name}: ${r.error?.message || r.stderr.trim() || 'databricks auth token failed'}. Set DATABRICKS_TOKEN or run \`databricks auth login --profile ${name}\`.`);
  return { host, token: JSON.parse(r.stdout).access_token };
}

async function getJson(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(url).pathname}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

export async function pullDatabricks(scope: CatalogScope & { profile?: string }, log: (s: string) => void): Promise<CatalogSnapshot> {
  const catalog = need(scope.catalog, '--catalog is required for Databricks.');
  const schema = need(scope.schema, '--schema is required.');
  const { host, token } = databricksAuth(scope.profile);
  const base = host.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  const names: string[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ catalog_name: catalog, schema_name: schema, max_results: '0', omit_columns: 'true', omit_properties: 'true', omit_username: 'true', ...(page ? { page_token: page } : {}) });
    const res = await getJson(`${base}/api/2.1/unity-catalog/tables?${q}`, token);
    for (const t of res.tables || []) if (!/VIEW/.test(t.table_type || '')) names.push(t.full_name || `${catalog}.${schema}.${t.name}`);
    page = res.next_page_token || undefined;
  } while (page);
  log(`Found ${names.length} tables in ${catalog}.${schema}; reading columns and keys…`);
  // ListTables leaves out table_constraints, so read each table (a few at a time).
  const full: any[] = [];
  for (let i = 0; i < names.length; i += 8)
    full.push(...(await Promise.all(names.slice(i, i + 8).map((n) => getJson(`${base}/api/2.1/unity-catalog/tables/${encodeURIComponent(n)}`, token)))));
  return fromUnityCatalog(full, { catalog, schema });
}

/** Runs one SQL statement and returns its rows by column name (values as strings, nulls as ''). */
export type SqlRunner = (sql: string) => Promise<Record<string, string>[]>;

/**
 * SQL on a Databricks SQL warehouse (Statement Execution API): --warehouse, DATABRICKS_WAREHOUSE_ID, else the
 * first running warehouse, else the first one (which starts it).
 */
export async function databricksSql(opts: { profile?: string; warehouse?: string }, log: (s: string) => void): Promise<SqlRunner> {
  const { host, token } = databricksAuth(opts.profile);
  const base = host.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  let warehouse = opts.warehouse || process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouse) {
    const list: any[] = (await getJson(`${base}/api/2.0/sql/warehouses`, token)).warehouses || [];
    const pick = list.find((w) => w.state === 'RUNNING') || list.find((w) => w.enable_serverless_compute) || list[0];
    if (!pick) throw new Error('No SQL warehouse in this workspace. Create one, or pass --warehouse <id>.');
    warehouse = pick.id as string;
    log(`Using SQL warehouse “${pick.name}” (${pick.state === 'RUNNING' ? 'running' : `${String(pick.state).toLowerCase()}, starting it`}). Pick another with --warehouse <id>.`);
  }
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } });
    const body = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${path}: ${body.slice(0, 300)}`);
    return JSON.parse(body);
  };
  return async (statement) => {
    let res = await call('/api/2.0/sql/statements', { method: 'POST', body: JSON.stringify({ statement, warehouse_id: warehouse, wait_timeout: '50s', on_wait_timeout: 'CONTINUE', format: 'JSON_ARRAY', disposition: 'INLINE' }) });
    while (res.status?.state === 'PENDING' || res.status?.state === 'RUNNING') {
      await new Promise((ok) => setTimeout(ok, 2000));
      res = await call(`/api/2.0/sql/statements/${res.statement_id}`);
    }
    if (res.status?.state !== 'SUCCEEDED') throw new Error(`Databricks SQL ${res.status?.state}: ${res.status?.error?.message || 'statement did not succeed'}`);
    const cols: string[] = (res.manifest?.schema?.columns || []).map((c: any) => c.name);
    const data: any[][] = [...(res.result?.data_array || [])];
    for (let link = res.result?.next_chunk_internal_link; link; ) {
      const chunk = await call(link);
      data.push(...(chunk.data_array || []));
      link = chunk.next_chunk_internal_link;
    }
    return data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? ''])));
  };
}

// ---------------------------------------------------------------- Snowflake (SQL API v2)

/** Key-pair JWT (RS256) per Snowflake's SQL API docs; account is the identifier without region, uppercased. */
export function snowflakeJwt(account: string, user: string, pem: string): string {
  const acct = (account.includes('.global') ? account : account.split('.')[0]).toUpperCase();
  const qualified = `${acct}.${user.toUpperCase()}`;
  const key = createPrivateKey(pem);
  const fp = createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('base64');
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: `${qualified}.SHA256:${fp}`, sub: qualified, iat: now, exp: now + 55 * 60 })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

export function snowflakeSql(scope: CatalogScope): SqlRunner {
  const env = process.env;
  const account = need(env.SNOWFLAKE_ACCOUNT, 'Set SNOWFLAKE_ACCOUNT (account identifier, e.g. myorg-myaccount).');
  const database = need(scope.catalog || env.SNOWFLAKE_DATABASE, '--catalog (the database) is required for Snowflake.');
  const schema = need(scope.schema || env.SNOWFLAKE_SCHEMA, '--schema is required.');
  let auth: { token: string; type: string };
  if (env.SNOWFLAKE_TOKEN) auth = { token: env.SNOWFLAKE_TOKEN, type: 'PROGRAMMATIC_ACCESS_TOKEN' };
  else {
    const pem = env.SNOWFLAKE_PRIVATE_KEY || (env.SNOWFLAKE_PRIVATE_KEY_PATH && readFileSync(env.SNOWFLAKE_PRIVATE_KEY_PATH, 'utf8'));
    auth = { token: snowflakeJwt(account, need(env.SNOWFLAKE_USER, 'Set SNOWFLAKE_USER for key-pair auth.'), need(pem || undefined, 'Set SNOWFLAKE_TOKEN (programmatic access token) or SNOWFLAKE_PRIVATE_KEY_PATH + SNOWFLAKE_USER.')), type: 'KEYPAIR_JWT' };
  }
  const base = `https://${account.toLowerCase()}.snowflakecomputing.com/api/v2/statements`;
  const headers = { Authorization: `Bearer ${auth.token}`, 'X-Snowflake-Authorization-Token-Type': auth.type, 'Content-Type': 'application/json', Accept: 'application/json' };
  const run = async (statement: string): Promise<Record<string, string>[]> => {
    let r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ statement, timeout: 120, database: database.toUpperCase(), schema: schema.toUpperCase(), warehouse: env.SNOWFLAKE_WAREHOUSE, role: env.SNOWFLAKE_ROLE }) });
    let res: any = await r.json().catch(() => ({}));
    // Long statements answer 202 with a handle to poll.
    for (let i = 0; r.status === 202 && i < 120; i++) {
      await new Promise((ok) => setTimeout(ok, 1000));
      r = await fetch(`${base}/${res.statementHandle}`, { headers });
      res = await r.json().catch(() => ({}));
    }
    if (!r.ok) throw new Error(`Snowflake ${r.status}: ${res.message || r.statusText}`);
    const cols: string[] = res.resultSetMetaData.rowType.map((c: any) => c.name);
    const data: any[][] = [...res.data];
    for (let p = 1; p < (res.resultSetMetaData.partitionInfo?.length || 1); p++) data.push(...(await (await fetch(`${base}/${res.statementHandle}?partition=${p}`, { headers })).json()).data);
    return data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i] ?? ''])));
  };
  return run;
}

export async function pullSnowflake(scope: CatalogScope, log: (s: string) => void): Promise<CatalogSnapshot> {
  const database = need(scope.catalog || process.env.SNOWFLAKE_DATABASE, '--catalog (the database) is required for Snowflake.');
  const schema = need(scope.schema || process.env.SNOWFLAKE_SCHEMA, '--schema is required.');
  const run = snowflakeSql({ catalog: database, schema });
  const [columnsSql, pkSql, fkSql] = catalogQuery('snowflake', { catalog: database, schema })
    .split(';')
    .map((x) => x.replace(/--.*$/gm, '').trim())
    .filter(Boolean);
  log(`Reading ${database}.${schema}…`);
  const rowsets = [await run(columnsSql), await run(pkSql), await run(fkSql)];
  return fromCatalogRows(rowsets, 'snowflake', { catalog: database, schema });
}

// ---------------------------------------------------------------- PostgreSQL (psql)

export function postgresSql(url?: string): SqlRunner {
  return async (sql) => {
    const r = spawnSync('psql', [...(url ? [url] : []), '-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new Error(`psql not found (${r.error.message}). Install the PostgreSQL client, or run the query elsewhere and pass --csv.`);
    if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.trim()}`);
    return parseResultSets(r.stdout)[0] || [];
  };
}

export async function pullPostgres(scope: CatalogScope & { url?: string }, log: (s: string) => void): Promise<CatalogSnapshot> {
  const schema = scope.schema || 'public';
  log(`Reading schema ${schema} with psql…`);
  const args = ['-X', '-q', '--csv', '-v', 'ON_ERROR_STOP=1', '-c', catalogQuery('postgres', { schema })];
  if (scope.url) args.unshift(scope.url);
  const r = spawnSync('psql', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`psql not found (${r.error.message}). Install the PostgreSQL client, or paste the query result instead (em catalog-query).`);
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.trim()}`);
  return fromCatalogRows(parseResultSets(r.stdout), 'postgres', { schema });
}
