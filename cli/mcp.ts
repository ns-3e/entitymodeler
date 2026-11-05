// MCP server over stdio (newline-delimited JSON-RPC 2.0), so agents get EntityModel.com as typed tools:
//   node bin/em.mjs mcp [--allow-apply] [--author NAME] [--models-dir DIR]
// The tools and protocol are shared with the hosted server (src/mcp/). This file adds what only a local process can
// do: models/ as the store, and tools that use this machine's database credentials. Edits are proposals by default:
// they land in models/<id>/proposals/ and the UI shows them for review. --allow-apply adds apply_changes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { applyOps, listTabs, normalizeModel, planPull, profileIssues, tabView } from '../src/core/index';
import { handleRpc } from '../src/mcp/rpc';
import type { ModelStore } from '../src/mcp/store';
import { createCatalog, str, type Tool } from '../src/mcp/tools';
import { MODEL_FILE, deleteProposal, findRoot, listProposals, readGlossary, sha1, writeProposal } from '../src/server/workbench';
import { pullSnapshot } from './pull';
import { profileLive } from './profile';
import { writeback } from './writeback';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

const INSTRUCTIONS =
  'EntityModel.com data models (models/<id>/model.json). Read with get_model/get_entity/search, check with validate (fix_issues proposes the mechanical fixes), and change models only through propose_changes (or derive_tab / import_ddl / pull_schema / sync_tabs / auto_map / propose_terms), batching one request into one proposal. Start a new model with create_model. Review comments: list_comments, then propose fixes and reply_comment. The business glossary is shared across models: search_glossary. The person reviews proposals in the EntityModel.com UI.';

/** The models folder: --models-dir or EM_MODELS_DIR, else models/ in the nearest workbench or the current folder. */
export function resolveModelsDir(flag?: string): string {
  const chosen = flag || process.env.EM_MODELS_DIR;
  return chosen ? resolve(chosen) : join(findRoot(), 'models');
}

function fileStore(modelsDir: string): ModelStore {
  const dirOf = (id: string) => {
    if (!id || !ID_RE.test(id)) throw new Error(`Invalid model id "${id}".`);
    return join(modelsDir, id);
  };
  const fileOf = (id: string) => {
    const f = join(dirOf(id), MODEL_FILE);
    if (!existsSync(f)) throw new Error(`Model "${id}" not found. Use list_models.`);
    return f;
  };
  return {
    modelIdHelp: 'Model id: a folder name under models/ (see list_models).',
    async list() {
      if (!existsSync(modelsDir)) return [];
      return readdirSync(modelsDir)
        .filter((d) => existsSync(join(modelsDir, d, MODEL_FILE)))
        .map((d) => {
          const m = normalizeModel(JSON.parse(readFileSync(join(modelsDir, d, MODEL_FILE), 'utf8')));
          return { id: d, title: m.title, tabs: listTabs(m).map((t) => `${t.name} [${t.kind}, ${t.entities} entities]`).join(', ') };
        });
    },
    async read(id) {
      const text = readFileSync(fileOf(id), 'utf8');
      return { text, rev: sha1(text) };
    },
    async write(id, rev, text) {
      const f = fileOf(id);
      if (sha1(readFileSync(f, 'utf8')) !== rev) return { ok: false, reason: 'conflict' };
      writeFileSync(f, text);
      return { ok: true };
    },
    async create(id, text) {
      const dir = dirOf(id);
      if (existsSync(join(dir, MODEL_FILE))) throw new Error(`Model "${id}" already exists.`);
      mkdirSync(join(dir, 'inputs'), { recursive: true });
      writeFileSync(join(dir, MODEL_FILE), text);
      return id;
    },
    hash: sha1,
    reviewHint: (model, proposal) => `the person accepts or rejects it in EntityModel.com, or with \`em proposals ${model} --accept ${proposal}\``,
    proposals: {
      list: async (model) => listProposals(dirname(fileOf(model))),
      add: async (model, p) => writeProposal(dirname(fileOf(model)), p),
      remove: async (model, id) => deleteProposal(dirname(fileOf(model)), id),
    },
    glossary: async () => readGlossary(modelsDir),
    async saveExport(model, file, text) {
      const dir = join(dirname(fileOf(model)), 'exports');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), text);
      return join(relative(process.cwd(), modelsDir) || '.', model, 'exports', file);
    },
  };
}

export async function runMcp(opts: { allowApply: boolean; author: string; modelsDir?: string }) {
  const store = fileStore(resolveModelsDir(opts.modelsDir));
  const tools = createCatalog(store, opts, ({ modelArg: MODEL, tabArg: TAB, load, tabOf, submit }): Tool[] => [
    {
      name: 'pull_schema',
      needs: 'propose',
      external: true,
      description:
        'Propose a tab with the live schema of a database (tables, columns, comments, primary and foreign keys). The first pull of a source becomes a Physical tab; later pulls a dated version tab derived from the previous one, so diff_tabs and migration_sql show the drift. Credentials come from the environment or the platform CLI profile on this machine.',
      inputSchema: {
        type: 'object',
        properties: {
          model: MODEL,
          from: { type: 'string', enum: ['databricks', 'snowflake', 'postgres'] },
          catalog: str('Databricks catalog or Snowflake database.'),
          schema: str('Schema name.'),
          profile: str('Databricks CLI profile (optional).'),
          url: str('PostgreSQL connection URL (optional; PG* environment variables otherwise).'),
          name: str('Tab name (optional).'),
        },
        required: ['model', 'from', 'schema'],
      },
      run: async ({ model, from, catalog, schema, profile, url, name }, call) => {
        const notes: string[] = [];
        const snap = await pullSnapshot({ from, catalog, schema, profile, url }, (s) => notes.push(s));
        const plan = planPull(await load(model), snap, { name, profile });
        const report = await submit(model, `Pull ${plan.tables} tables into “${plan.tabName}”`, plan.previous ? `New version of the schema pulled into “${plan.previous}”, for comparison.` : undefined, plan.ops, undefined, call.apply);
        return [report, ...plan.warnings.map((w) => `note: ${w}`)].join('\n');
      },
    },
    {
      name: 'profile_data',
      needs: 'propose',
      external: true,
      description:
        'Propose data profiles for a tab pulled from a database: row counts, nulls, distinct values, min/max for numbers and dates, longest string (never sample values). Runs one query per table where the tab was pulled from (Databricks needs a SQL warehouse). Returns what the data says about the design: keys that repeat or are empty, empty columns, columns that could be required, candidate reference lists.',
      inputSchema: {
        type: 'object',
        properties: {
          model: MODEL,
          tab: TAB,
          entities: { type: 'array', items: { type: 'string' }, description: 'Only these entities (default: all that match a table).' },
          sample: { type: 'number', description: 'Rows per table (default 100000; 0 reads every row, which can be slow and costly on big tables).' },
          from: { type: 'string', enum: ['databricks', 'snowflake', 'postgres'], description: 'Only when the tab has no recorded source.' },
          catalog: str('Databricks catalog or Snowflake database (default: the tab’s source).'),
          schema: str('Schema (default: the tab’s source).'),
          profile: str('Databricks CLI profile (optional).'),
          warehouse: str('Databricks SQL warehouse id (optional; default the first running one).'),
          url: str('PostgreSQL connection URL (optional).'),
        },
        required: ['model'],
      },
      run: async ({ model, tab, entities, sample, from, catalog, schema, profile, warehouse, url }, call) => {
        const doc = await load(model);
        const id = tabOf(doc, tab);
        const notes: string[] = [];
        const r = await profileLive(doc, id, { from, catalog, schema, profile, warehouse, url, sample, entities }, (s) => notes.push(s));
        if (!r.ops.length) throw new Error(`No tables profiled.${r.skipped.length ? ` Skipped: ${r.skipped.join('; ')}` : ''}`);
        // The op list is one line per column: report the outcome, not every op.
        const out = (await submit(model, `Profile ${r.profiled} table(s)`, 'Measured from the database; counts and ranges only.', r.ops, id, call.apply)).split('\n');
        const found = profileIssues(tabView(applyOps(doc, r.ops, { tab: id }).doc, id));
        return [
          out[0],
          out[out.length - 1],
          `Profiled ${r.profiled} table(s).${r.skipped.length ? ` Not profiled: ${r.skipped.join('; ')}` : ''}`,
          ...notes.map((n) => `note: ${n}`),
          found.length ? `Findings (${found.length}):\n${found.slice(0, 60).map((f) => `- [${f.level}] ${f.message}`).join('\n')}` : 'No findings: the data matches the design.',
        ].join('\n');
      },
    },
    {
      name: 'plan_writeback',
      needs: 'read',
      external: true,
      description:
        'The SQL that would put the model’s table and column descriptions (and on Databricks, PII and business_term tags) into the live catalog the tab was pulled from. Compares with the catalog first, so it lists only what differs, and never removes anything. Read-only: show the statements to the person, who runs them with `em writeback <model> --apply`.',
      inputSchema: {
        type: 'object',
        properties: {
          model: MODEL,
          tab: TAB,
          tags: { type: 'boolean', description: 'Include Databricks tags (default true).' },
          from: { type: 'string', enum: ['databricks', 'snowflake', 'postgres'], description: 'Only when the tab has no recorded source.' },
          catalog: str('Databricks catalog or Snowflake database (default: the tab’s source).'),
          schema: str('Schema (default: the tab’s source).'),
          profile: str('Databricks CLI profile (optional).'),
          warehouse: str('Databricks SQL warehouse id, used to read current tags (optional).'),
          url: str('PostgreSQL connection URL (optional).'),
        },
        required: ['model'],
      },
      run: async ({ model, tab, tags, from, catalog, schema, profile, warehouse, url }) => {
        const doc = await load(model);
        const notes: string[] = [];
        const r = await writeback(doc, tabOf(doc, tab), { from, catalog, schema, profile, warehouse, url, tags }, (s) => notes.push(s));
        if (!r.statements.length) return 'The catalog already has everything the model documents. Nothing to write.';
        return [`${r.statements.length} statement(s). Nothing was run; the person runs them with \`em writeback ${model}${tab ? ` --tab "${tab}"` : ''} --apply\`.`, ...notes.map((n) => `note: ${n}`), '```sql', ...r.statements.map((s) => `-- ${s.what}\n${s.sql}`), '```'].join('\n');
      },
    },
  ]);
  const server = { name: 'entity-modeler', version: '0.3.0', instructions: INSTRUCTIONS, tools, allowApply: opts.allowApply };

  const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const { body } = await handleRpc(server, msg);
    if (body) send(body);
  }
}
