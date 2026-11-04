// MCP server over stdio (newline-delimited JSON-RPC 2.0), so agents get EntityModel.com as typed tools:
//   node bin/em.mjs mcp [--allow-apply] [--author NAME]
// Hand-written instead of the SDK to keep bin/em.mjs dependency-free. Edits are proposals by default: they
// land in models/<id>/proposals/ and the UI shows them for review. --allow-apply adds apply_changes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  profileIssues,
  DOC_SECTIONS,
  SQL_DIALECTS,
  applyOps,
  buildDocTables,
  dependencyOrder,
  describeOp,
  diffTabs,
  diffToMarkdown,
  importModelText,
  issueCounts,
  listTabs,
  mergeModels,
  migrationSql,
  normalizeModel,
  planPull,
  deriveTab,
  applyFixes,
  matchTerm,
  newTerm,
  suggestLinks,
  syncPlan,
  autoMap,
  mappingCoverage,
  mappingsFor,
  mappingSql,
  resolveTab,
  serializeModel,
  tabView,
  tablesToMarkdown,
  toDbml,
  toMermaid,
  toDbt,
  toOdcs,
  toJsonSchema,
  toAvro,
  toSql,
  typeDisplay,
  validateModel,
  validateTabs,
  type DataModel,
  type DocSectionId,
  type Op,
  type SqlDialect,
  type TabKind,
} from '../src/core/index';
import { MODEL_FILE, deleteProposal, findRoot, listProposals, readGlossary, sha1, writeProposal } from '../src/server/workbench';
import { pullSnapshot } from './pull';
import { profileLive } from './profile';
import { writeback } from './writeback';

const PROTOCOL = '2025-06-18';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: any): string | Promise<string>;
}

const str = (description: string) => ({ type: 'string', description });
const MODEL = str('Model id: a folder name under models/ (see list_models).');
const TAB = str('Tab name or id. Default: the primary tab.');

const OPS_HELP = `Each op is an object with "op" and optional "tab". Ops:
add_entity {entity:{name, display_name?, entity_type?: "standard"|"reference", description?, attributes?: Attribute[]}} — without attributes you get <name>_id (PK) and <name>_name (label)
update_entity {entity, set:{display_name?, description?, entity_type?, color_code?, area?, dependent_reference?, notes?}}
rename_entity {entity, to}   delete_entity {entity}
add_attribute {entity, attribute:{name, type?, label?, description?, is_primary_key?, is_label?, required?, pii?, example?, is_array?, reference?:{entity, output_attribute}, struct_type?}, after?}
update_attribute {entity, attribute, set:{…}}   rename_attribute {entity, attribute, to}   delete_attribute {entity, attribute}   move_attribute {entity, attribute, after: name|null}
add_relationship {relationship:{source, target, name?, cardinality?: "1:1"|"1:N"|"N:1"|"N:N", forward_label?, reverse_label?, bidirectional?, foreign_key?, description?, attributes?: Attribute[]}}
update_relationship {relationship, set:{…}} — set.attributes replaces the relationship's own attributes (facts about the link, e.g. an enrollment's grade; simple types only): junction-table columns for N:N, child-table columns otherwise   rename_relationship {relationship, to}   delete_relationship {relationship}
set_reference_values {entity, values:[{attr: "value"}…], source?}
add_note {text}   set_hidden {entities:[…], hidden}   update_model {set:{title?, description?, organization?, version?, author?, status?}}
update_tab {tab, set:{name?, kind?, dialect?, description?}}   make_primary {tab}   delete_tab {tab}
add_tab {name, kind: "conceptual"|"logical"|"physical"|"variant", from?: tab, dialect?} — with "from", the new tab is derived (physical→logical etc.)
set_mapping {target:{tab, entity, attribute}, sources:[{tab, entity, attribute}], transform?, notes?, status?: "draft"|"approved"}   delete_mapping {target}
link_term {entity, attribute?, term:{id, name, definition, synonyms?}|null}   add_comment {target:{kind: "model"|"entity"|"relationship", name?, attribute?}, text, author}
Types: STRING BIGINT INT SMALLINT TINYINT DECIMAL (with precision, scale) DOUBLE FLOAT BOOLEAN DATE TIMESTAMP STRUCT REFERENCE_ENTITY. Attributes may also set unique: true. Names: ^[a-z][a-z0-9_]*$. Renames and deletes cascade.`;

const opsSchema = {
  type: 'array',
  description: OPS_HELP,
  items: { type: 'object', properties: { op: { type: 'string' }, tab: { type: 'string' } }, required: ['op'], additionalProperties: true },
};

export async function runMcp(opts: { allowApply: boolean; author: string }) {
  const root = findRoot();
  const modelsDir = join(root, 'models');
  const modelFile = (id: string) => {
    if (!id || !/^[a-z0-9][a-z0-9_-]{0,80}$/.test(id)) throw new Error(`Invalid model id "${id}".`);
    const f = join(modelsDir, id, MODEL_FILE);
    if (!existsSync(f)) throw new Error(`Model "${id}" not found. Use list_models.`);
    return f;
  };
  const load = (id: string) => normalizeModel(JSON.parse(readFileSync(modelFile(id), 'utf8')));
  const tabOf = (m: DataModel, ref?: string) => resolveTab(m, ref) || fail(`Tab "${ref}" not found. Tabs: ${listTabs(m).map((t) => t.name).join(', ')}`);
  const strip = <T>(x: T): T => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ui' ? undefined : v)));

  /** Check ops against a copy, then write a proposal (or apply). Returns the report the agent sees. */
  /** Set per call: trusted runs (--allow-apply) may pass apply: true to tools that otherwise only propose. */
  let applyThisCall = false;
  const submit = (id: string, title: string, rationale: string | undefined, ops: Op[], tab: string | undefined, apply: boolean) => {
    apply = apply || applyThisCall;
    if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty array.');
    const file = modelFile(id);
    const text = readFileSync(file, 'utf8');
    const doc = normalizeModel(JSON.parse(text));
    const r = applyOps(doc, ops, { tab });
    if (!r.ok) throw new Error(`${r.error}\nNothing was written. Fix that op and call again with the whole batch.`);
    const touched = new Set([tab ? tabOf(r.doc, tab) : 'main', ...ops.map((o) => (o.tab ? resolveTab(r.doc, o.tab) : undefined)).filter(Boolean)]);
    const checks = [...touched].map((t) => {
      const c = issueCounts(validateModel(tabView(r.doc, t!)));
      return `${listTabs(r.doc).find((x) => x.id === t)?.name}: ${c.error} error(s), ${c.warning} warning(s)`;
    });
    const lines = ops.map((o, i) => `${i + 1}. ${describeOp(o)}`).join('\n');
    if (apply) {
      writeFileSync(file, serializeModel({ ...r.doc, updated_at: new Date().toISOString() }));
      return `Applied ${ops.length} change(s) to ${id}:\n${lines}\nValidation after: ${checks.join('; ')}`;
    }
    const p = writeProposal(dirname(file), { title, rationale, author: opts.author, tab, base_hash: sha1(text), ops });
    return `Proposal ${p.id} saved for review (the person accepts or rejects it in EntityModel.com, or with \`em proposals ${id} --accept ${p.id}\`).\n${lines}\nValidation if accepted: ${checks.join('; ')}`;
  };

  /** Generated code for a tab, as the export tool returns it. */
  const exportText = (model: string, tab: string | undefined, format: string, dialect?: string): string => {
    const doc = load(model);
    const v = tabView(doc, tabOf(doc, tab));
    const d = (dialect || v.tab?.dialect || 'postgres') as SqlDialect;
    if (format === 'dbml') return toDbml(v);
    if (format === 'mermaid') return toMermaid(v);
    if (format === 'dbt') return toDbt(v, { dialect: d });
    if (format === 'odcs') return toOdcs(v, { dialect: d });
    if (format === 'jsonschema') return toJsonSchema(v);
    if (format === 'avro') return toAvro(v);
    return toSql(v, { dialect: d });
  };

  const saveExport = (model: string, file: string, text: string) => {
    const dir = join(dirname(modelFile(model)), 'exports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), text);
    return join('models', model, 'exports', file);
  };

  const tools: Tool[] = [
    {
      name: 'list_models',
      description: 'List the models in this EntityModel.com workbench, with tabs and size.',
      inputSchema: { type: 'object', properties: {} },
      run: () =>
        readdirSync(modelsDir)
          .filter((d) => existsSync(join(modelsDir, d, MODEL_FILE)))
          .map((d) => {
            const m = load(d);
            return `${d}: ${m.title} — ${listTabs(m).map((t) => `${t.name} [${t.kind}, ${t.entities} entities]`).join(', ')}`;
          })
          .join('\n') || 'No models yet.',
    },
    {
      name: 'get_model',
      description: 'Read a model tab. detail "summary" (default) is a compact text view of every entity, attribute and relationship; "full" is the tab as JSON (canvas positions omitted).',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, detail: { type: 'string', enum: ['summary', 'full'] } }, required: ['model'] },
      run: ({ model, tab, detail }) => {
        const doc = load(model);
        const v = tabView(doc, tabOf(doc, tab));
        if (detail === 'full') return JSON.stringify(strip({ ...v, tabs: listTabs(doc) }), null, 1);
        const out = [`${v.title} (${model}) — tab ${v.tab?.name} [${v.tab?.kind}]${v.description ? `\n${v.description}` : ''}`, `Tabs: ${listTabs(doc).map((t) => t.name).join(', ')}`, ''];
        for (const e of dependencyOrder(v)) {
          out.push(`[${e.entity_type}] ${e.name} "${e.display_name}"${e.dependent_reference ? ` depends on ${e.dependent_reference.parent}.${e.dependent_reference.linked_column}` : ''}${e.description ? ` — ${e.description}` : ''}`);
          for (const a of e.attributes) out.push(`  ${a.is_primary_key ? 'PK ' : a.is_label ? 'LB ' : '   '}${a.name} ${typeDisplay(a)}${a.reference ? ` → ${a.reference.entity}.${a.reference.output_attribute}` : ''}${a.required ? ' required' : ''}${a.pii ? ' pii' : ''}`);
          if (e.reference_values?.length) out.push(`  (${e.reference_values.length} values)`);
        }
        for (const r of v.relationships) out.push(`rel ${r.name}: ${r.source} -[${r.cardinality} ${r.forward_label}${r.foreign_key ? ` fk ${r.foreign_key}` : ''}]-> ${r.target}`);
        return out.join('\n');
      },
    },
    {
      name: 'get_entity',
      description: 'One entity as JSON, plus the relationships and references that touch it.',
      inputSchema: { type: 'object', properties: { model: MODEL, entity: str('Entity name.'), tab: TAB }, required: ['model', 'entity'] },
      run: ({ model, entity, tab }) => {
        const doc = load(model);
        const v = tabView(doc, tabOf(doc, tab));
        const e = v.entities.find((x) => x.name === entity) || fail(`Entity "${entity}" not found.`);
        const rels = v.relationships.filter((r) => r.source === entity || r.target === entity);
        const usedBy = v.entities.flatMap((x) => x.attributes.filter((a) => a.reference?.entity === entity).map((a) => `${x.name}.${a.name}`));
        return JSON.stringify(strip({ entity: e, relationships: rels, referenced_by: usedBy }), null, 1);
      },
    },
    {
      name: 'search',
      description: 'Find entities, attributes and relationships whose name, label or description contains the text (case-insensitive), across all tabs.',
      inputSchema: { type: 'object', properties: { model: MODEL, query: str('Text to look for.') }, required: ['model', 'query'] },
      run: ({ model, query }) => {
        const doc = load(model);
        const q = String(query).toLowerCase();
        const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(q));
        const out: string[] = [];
        for (const t of listTabs(doc)) {
          const v = tabView(doc, t.id);
          for (const e of v.entities) {
            if (has(e.name, e.display_name, e.description)) out.push(`[${t.name}] entity ${e.name}`);
            for (const a of e.attributes) if (has(a.name, a.label, a.description)) out.push(`[${t.name}] attribute ${e.name}.${a.name} ${typeDisplay(a)}`);
          }
          for (const r of v.relationships) if (has(r.name, r.forward_label, r.description)) out.push(`[${t.name}] relationship ${r.name}: ${r.source} → ${r.target}`);
        }
        return out.slice(0, 200).join('\n') || 'No matches.';
      },
    },
    {
      name: 'validate',
      description: 'Validation issues (errors, warnings, notes) for one tab, or every tab.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Tab name or id. Default: every tab.') }, required: ['model'] },
      run: ({ model, tab }) => {
        const doc = load(model);
        const ids = tab ? [tabOf(doc, tab)] : listTabs(doc).map((t) => t.id);
        const out = validateTabs(doc).map((i) => `${i.level.toUpperCase()} [${i.code}] ${i.message}`);
        for (const id of ids) {
          const issues = validateModel(tabView(doc, id));
          const c = issueCounts(issues);
          out.push(`== ${listTabs(doc).find((t) => t.id === id)?.name}: ${c.error} error(s), ${c.warning} warning(s), ${c.info} note(s)`);
          for (const i of issues) out.push(`${i.level.toUpperCase()} [${i.code}] ${i.message}${i.fix ? ' [fixable]' : ''}`);
        }
        return out.join('\n');
      },
    },
    {
      name: 'fix_issues',
      description: 'Propose the mechanical fixes that validation offers (issues marked [fixable]: naming-standard renames, PII flags). Optionally only some issue codes, e.g. ["std.abbrev"].',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, codes: { type: 'array', items: { type: 'string' } } }, required: ['model'] },
      run: ({ model, tab, codes }) => {
        const doc = load(model);
        const id = tabOf(doc, tab);
        const issues = validateModel(tabView(doc, id)).filter((i) => i.fix && (codes?.length ? codes.includes(i.code) : !i.suggested));
        const { ops } = applyFixes(JSON.parse(JSON.stringify(doc)), issues, id);
        if (!ops.length) return 'Nothing to fix mechanically.';
        return submit(model, `Fix ${ops.length} naming issue(s)`, 'Mechanical fixes from the model’s naming standards.', ops, undefined, false);
      },
    },
    {
      name: 'list_tabs',
      description: 'The diagram tabs of a model: conceptual, logical, physical and variant views, with lineage.',
      inputSchema: { type: 'object', properties: { model: MODEL }, required: ['model'] },
      run: ({ model }) => {
        const tabs = listTabs(load(model));
        const lines = tabs.map((t) => `${t.id}: "${t.name}" ${t.kind}, ${t.entities} entities${t.dialect ? `, ${t.dialect}` : ''}${t.derived_from ? `, derived from ${t.derived_from}` : ''}${t.id === 'main' ? ' (primary)' : ''}`);
        if (!tabs[0].entities) lines.push('The primary tab is empty: import into it (tab "main"), rename it with update_tab, or make another tab primary (make_primary) and delete it (delete_tab).');
        return lines.join('\n');
      },
    },
    {
      name: 'diff_tabs',
      description: 'What changed from tab A to tab B (renames are matched through derivation lineage), as Markdown.',
      inputSchema: { type: 'object', properties: { model: MODEL, a: str('From tab.'), b: str('To tab.') }, required: ['model', 'a', 'b'] },
      run: ({ model, a, b }) => {
        const doc = load(model);
        return diffToMarkdown(diffTabs(doc, tabOf(doc, a), tabOf(doc, b)));
      },
    },
    {
      name: 'migration_sql',
      description: 'DDL (ALTER/CREATE/DROP) that takes a database built from tab A to tab B.',
      inputSchema: { type: 'object', properties: { model: MODEL, a: str('From tab.'), b: str('To tab.'), dialect: { type: 'string', enum: SQL_DIALECTS.map((d) => d.id) } }, required: ['model', 'a', 'b'] },
      run: ({ model, a, b, dialect }) => {
        const doc = load(model);
        const bid = tabOf(doc, b);
        return migrationSql(doc, tabOf(doc, a), bid, (dialect || tabView(doc, bid).tab?.dialect || 'postgres') as SqlDialect);
      },
    },
    {
      name: 'sync_tabs',
      description: 'Propose bringing changes from a source tab into a tab derived from it (new entities, attributes, type changes, relationships), transformed the way the target was derived. Removals are only included when include_removals is true.',
      inputSchema: { type: 'object', properties: { model: MODEL, source: str('Source tab.'), target: str('Derived tab to update.'), include_removals: { type: 'boolean' } }, required: ['model', 'source', 'target'] },
      run: ({ model, source, target, include_removals }) => {
        const doc = load(model);
        const a = tabOf(doc, source);
        const b = tabOf(doc, target);
        const plan = syncPlan(doc, a, b).filter((c) => c.suggested || include_removals);
        if (!plan.length) return 'Already in sync.';
        const ops = plan.flatMap((c) => c.ops.map((o) => ({ ...o, tab: o.tab ?? b })));
        return submit(model, `Sync ${plan.length} change(s) from ${source}`, plan.map((c) => c.label).join('; ').slice(0, 600), ops, undefined, false);
      },
    },
    {
      name: 'get_mappings',
      description: 'Source-to-target mappings into a tab: coverage per entity and each mapped attribute with its sources and transform. With entity, also the dbt model SQL the mappings imply.',
      inputSchema: { type: 'object', properties: { model: MODEL, target: str('Target tab.'), entity: str('Optional target entity.') }, required: ['model', 'target'] },
      run: ({ model, target, entity }) => {
        const doc = load(model);
        const t = tabOf(doc, target);
        const cov = mappingCoverage(doc, t);
        const lines = [`${cov.mapped} of ${cov.total} attributes mapped (${cov.pct}%).`, ...cov.byEntity.map((x) => `${x.entity}: ${x.mapped}/${x.total}`), ''];
        for (const x of mappingsFor(doc, t).filter((x) => !entity || x.target.entity === entity))
          lines.push(`${x.target.entity}.${x.target.attribute} ← ${x.sources.map((s) => `${s.tab}:${s.entity}.${s.attribute}`).join(' + ') || '(none)'}${x.transform ? ` as ${x.transform}` : ''} [${x.status || 'draft'}]`);
        if (entity) lines.push('', mappingSql(doc, t, entity));
        return lines.join('\n');
      },
    },
    {
      name: 'auto_map',
      description: 'Propose mappings for unmapped target attributes, matched by derivation lineage, then by name. Refine with propose_changes using set_mapping ops.',
      inputSchema: { type: 'object', properties: { model: MODEL, source: str('Source tab.'), target: str('Target tab.') }, required: ['model', 'source', 'target'] },
      run: ({ model, source, target }) => {
        const doc = load(model);
        const found = autoMap(doc, tabOf(doc, source), tabOf(doc, target));
        if (!found.length) return 'No new matches.';
        return submit(model, `Map ${found.length} attribute(s) from ${source}`, undefined, found.map((x) => ({ op: 'set_mapping' as const, target: x.target, sources: x.sources, status: 'draft' as const })), undefined, false);
      },
    },
    {
      name: 'export',
      description: 'Generate code for a tab: SQL DDL (per dialect), DBML, Mermaid erDiagram, dbt schema.yml (with data tests), ODCS v3 data contract, JSON Schema or Avro.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, format: { type: 'string', enum: ['sql', 'dbml', 'mermaid', 'dbt', 'odcs', 'jsonschema', 'avro'] }, dialect: { type: 'string', enum: SQL_DIALECTS.map((d) => d.id) }, save: { type: 'boolean', description: 'Also write it to models/<id>/exports/ and return the path.' } }, required: ['model', 'format'] },
      run: ({ model, tab, format, dialect, save }) => {
        const text = exportText(model, tab, format, dialect);
        if (!save) return text;
        const ext: Record<string, string> = { sql: 'sql', dbml: 'dbml', mermaid: 'mmd', dbt: 'schema.yml', odcs: 'odcs.yaml', jsonschema: 'schema.json', avro: 'avsc' };
        const doc = load(model);
        const tid = tabOf(doc, tab);
        const file = saveExport(model, `${doc.name}${tid === 'main' ? '' : `-${tid}`}${format === 'sql' ? `.${dialect || tabView(doc, tid).tab?.dialect || 'postgres'}` : ''}.${ext[format] || 'txt'}`, text);
        return `Saved ${file} (${text.length} characters).`;
      },
    },
    {
      name: 'docs',
      description: `Design-doc tables for a tab as Markdown. Sections: ${DOC_SECTIONS.map((s) => s.id).join(', ')}.`,
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, sections: { type: 'array', items: { type: 'string' } } }, required: ['model'] },
      run: ({ model, tab, sections }) => {
        const doc = load(model);
        const v = tabView(doc, tabOf(doc, tab));
        return tablesToMarkdown(v, buildDocTables(v, { sections: sections as DocSectionId[] | undefined }));
      },
    },
    {
      name: 'propose_changes',
      description: `Suggest edits to a model as one reviewable proposal. The ops are checked against the model first; nothing changes until the person accepts. Put every change for one request in a single call.\n${OPS_HELP}`,
      inputSchema: { type: 'object', properties: { model: MODEL, title: str('Short title, e.g. "Add contract entities".'), rationale: str('Why, in a sentence or two.'), tab: str('Default tab for ops without one.'), ops: opsSchema }, required: ['model', 'title', 'ops'] },
      run: ({ model, title, rationale, tab, ops }) => submit(model, title, rationale, ops, tab, false),
    },
    {
      name: 'import_ddl',
      description: 'Propose adding tables from SQL DDL or DBML text to a tab (keys, foreign keys, lookup tables and link tables are recognized). Existing entities are left alone.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, text: str('CREATE TABLE statements or DBML.') }, required: ['model', 'text'] },
      run: ({ model, tab, text }) => {
        const doc = load(model);
        const tid = tabOf(doc, tab);
        // A physical tab is a faithful copy: link tables stay tables, so they can be mapped later.
        const r = importModelText(text, { keepJunctions: tabView(doc, tid).tab?.kind === 'physical' });
        const merged = mergeModels(tabView(doc, tid), r.model);
        const added = new Set(merged.added);
        const before = new Set(tabView(doc, tid).relationships.map((x) => x.name));
        const ops: Op[] = [
          ...merged.model.entities.filter((e) => added.has(e.name)).map((e) => ({ op: 'add_entity' as const, entity: e })),
          ...merged.model.relationships.filter((x) => !before.has(x.name)).map((x) => ({ op: 'add_relationship' as const, relationship: x })),
        ];
        if (!ops.length) return `Nothing to add${merged.skipped.length ? `; already present: ${merged.skipped.join(', ')}` : ''}.`;
        return submit(model, `Import ${merged.added.length} table(s)`, r.warnings.join(' ') || undefined, ops, tid, false);
      },
    },
    {
      name: 'derive_tab',
      description: 'Propose a new tab derived from another: kind "logical" (from physical: business names, FK columns → relationships, link tables → N:N, lookups → reference data), "physical" (FK columns, junction tables, dialect), "conceptual" (entities and relationships only) or "variant" (copy).',
      inputSchema: { type: 'object', properties: { model: MODEL, from: str('Source tab. Default: primary tab.'), kind: { type: 'string', enum: ['conceptual', 'logical', 'physical', 'variant'] }, name: str('New tab name.'), dialect: { type: 'string', enum: SQL_DIALECTS.map((d) => d.id) } }, required: ['model', 'kind', 'name'] },
      run: ({ model, from, kind, name, dialect }) => {
        // Say what the derivation does (renames, dropped columns, link tables), not only that a tab appears.
        const doc = load(model);
        const report = deriveTab(tabView(doc, tabOf(doc, from || 'main')), kind as TabKind, { physical: { dialect } }).report;
        const out = submit(model, `Derive ${kind} tab “${name}”`, report.lines.join(' '), [{ op: 'add_tab', name, kind: kind as TabKind, from: from || 'main', dialect }], undefined, false);
        const dropped = report.droppedColumns.length ? `\nDropped columns: ${report.droppedColumns.slice(0, 40).join(', ')}${report.droppedColumns.length > 40 ? ', …' : ''}` : '';
        return `${out}\nDerivation: ${report.lines.join(' ')}${dropped}`;
      },
    },
    {
      name: 'pull_schema',
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
      run: async ({ model, from, catalog, schema, profile, url, name }) => {
        const notes: string[] = [];
        const snap = await pullSnapshot({ from, catalog, schema, profile, url }, (s) => notes.push(s));
        const plan = planPull(load(model), snap, { name, profile });
        const report = submit(model, `Pull ${plan.tables} tables into “${plan.tabName}”`, plan.previous ? `New version of the schema pulled into “${plan.previous}”, for comparison.` : undefined, plan.ops, undefined, false);
        return [report, ...plan.warnings.map((w) => `note: ${w}`)].join('\n');
      },
    },
    {
      name: 'profile_data',
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
      run: async ({ model, tab, entities, sample, from, catalog, schema, profile, warehouse, url }) => {
        const doc = load(model);
        const id = tabOf(doc, tab);
        const notes: string[] = [];
        const r = await profileLive(doc, id, { from, catalog, schema, profile, warehouse, url, sample, entities }, (s) => notes.push(s));
        if (!r.ops.length) throw new Error(`No tables profiled.${r.skipped.length ? ` Skipped: ${r.skipped.join('; ')}` : ''}`);
        // The op list is one line per column: report the outcome, not every op.
        const out = submit(model, `Profile ${r.profiled} table(s)`, 'Measured from the database; counts and ranges only.', r.ops, id, false).split('\n');
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
        const doc = load(model);
        const notes: string[] = [];
        const r = await writeback(doc, tabOf(doc, tab), { from, catalog, schema, profile, warehouse, url, tags }, (s) => notes.push(s));
        if (!r.statements.length) return 'The catalog already has everything the model documents. Nothing to write.';
        return [`${r.statements.length} statement(s). Nothing was run; the person runs them with \`em writeback ${model}${tab ? ` --tab "${tab}"` : ''} --apply\`.`, ...notes.map((n) => `note: ${n}`), '```sql', ...r.statements.map((s) => `-- ${s.what}\n${s.sql}`), '```'].join('\n');
      },
    },
    {
      name: 'list_comments',
      description: 'Review comments on a model (open ones by default): what they are about, who said what, and replies. Work through them by proposing changes, then reply_comment.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Only this tab.'), include_resolved: { type: 'boolean' } }, required: ['model'] },
      run: ({ model, tab, include_resolved }) => {
        const doc = load(model);
        const t = tab ? tabOf(doc, tab) : undefined;
        const list = (doc.comments || []).filter((c) => (include_resolved || !c.resolved) && (!t || c.target.tab === t));
        if (!list.length) return 'No open comments.';
        return list
          .map((c) => [`[${c.id}] ${c.resolved ? '(resolved) ' : ''}${c.target.tab}:${c.target.kind}${c.target.name ? ` ${c.target.name}` : ''}${c.target.attribute ? `.${c.target.attribute}` : ''} — ${c.author}: ${c.text}`, ...(c.replies || []).map((r) => `    ↳ ${r.author}: ${r.text}`)].join('\n'))
          .join('\n');
      },
    },
    {
      name: 'reply_comment',
      description: 'Reply to a review comment (written straight to the model: replies are conversation, not design changes). Say what you proposed or why not; resolve only if the person asked you to.',
      inputSchema: { type: 'object', properties: { model: MODEL, id: str('Comment id.'), text: str('Reply.'), resolve: { type: 'boolean' } }, required: ['model', 'id', 'text'] },
      run: ({ model, id, text, resolve }) => {
        const file = modelFile(model);
        const doc = normalizeModel(JSON.parse(readFileSync(file, 'utf8')));
        const r = applyOps(doc, [{ op: 'reply_comment', id, text, author: opts.author }, ...(resolve ? [{ op: 'resolve_comment' as const, id, resolved: true }] : [])]);
        if (!r.ok) throw new Error(r.error);
        writeFileSync(file, serializeModel({ ...r.doc, updated_at: new Date().toISOString() }));
        return `Replied to ${id}${resolve ? ' and resolved it' : ''}.`;
      },
    },
    {
      name: 'search_glossary',
      description: 'The shared business glossary (all models): terms with definitions and synonyms, optionally filtered by text. With model, also the names in that model that match a term but are not linked yet.',
      inputSchema: { type: 'object', properties: { query: str('Text to look for.'), model: str('Optional model id, for link suggestions.'), tab: TAB } },
      run: ({ query, model, tab }) => {
        const terms = readGlossary(modelsDir).filter((t) => !query || `${t.name} ${t.definition} ${(t.synonyms || []).join(' ')}`.toLowerCase().includes(String(query).toLowerCase()));
        const out = terms.map((t) => `${t.name} [${t.status || 'draft'}]${t.synonyms?.length ? ` (aka ${t.synonyms.join(', ')})` : ''}: ${t.definition || '(no definition yet)'}`);
        if (model) {
          const doc = load(model);
          const sug = suggestLinks(tabView(doc, tabOf(doc, tab)), readGlossary(modelsDir));
          if (sug.length) out.push('', 'Unlinked names that match a term:', ...sug.map((x) => `  ${x.entity}${x.attribute ? `.${x.attribute}` : ''} → ${x.term.name}`));
        }
        return out.join('\n') || 'The glossary is empty.';
      },
    },
    {
      name: 'propose_terms',
      description: 'Propose business terms and links from entities/attributes to them, as one proposal. Existing terms (same name or synonym) are reused; new ones join the shared glossary when the person accepts.',
      inputSchema: {
        type: 'object',
        properties: {
          model: MODEL,
          tab: TAB,
          terms: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, definition: { type: 'string' }, synonyms: { type: 'array', items: { type: 'string' } } }, required: ['name', 'definition'] } },
          links: { type: 'array', description: 'Which entity/attribute each term names.', items: { type: 'object', properties: { entity: { type: 'string' }, attribute: { type: 'string' }, term: { type: 'string', description: 'Term name.' } }, required: ['entity', 'term'] } },
        },
        required: ['model', 'links'],
      },
      run: ({ model, tab, terms, links }) => {
        const shared = readGlossary(modelsDir);
        const fresh = (terms || []).map((t: any) => matchTerm(shared, t.name) || newTerm(t.name, t.definition, { synonyms: t.synonyms }));
        const all = [...fresh, ...shared];
        const ops: Op[] = (links || []).map((l: any) => {
          const term = all.find((t) => t.name.toLowerCase() === String(l.term).toLowerCase()) || matchTerm(all, l.term);
          if (!term) throw new Error(`Term "${l.term}" is neither in the glossary nor in terms.`);
          return { op: 'link_term' as const, entity: l.entity, attribute: l.attribute, term };
        });
        return submit(model, `Link ${ops.length} name(s) to glossary terms`, fresh.length ? `New terms: ${fresh.filter((t: any) => !shared.includes(t)).map((t: any) => t.name).join(', ') || 'none'}.` : undefined, ops, tab, false);
      },
    },
    {
      name: 'list_proposals',
      description: 'Pending proposals for a model (not yet accepted or rejected).',
      inputSchema: { type: 'object', properties: { model: MODEL }, required: ['model'] },
      run: ({ model }) => {
        const ps = listProposals(dirname(modelFile(model)));
        return ps.map((p) => `${p.id}: ${p.title} — ${p.ops.length} change(s) by ${p.author}, ${p.created_at}`).join('\n') || 'No pending proposals.';
      },
    },
    {
      name: 'withdraw_proposal',
      description: 'Delete one of your pending proposals (e.g. to replace it with a corrected one).',
      inputSchema: { type: 'object', properties: { model: MODEL, id: str('Proposal id.') }, required: ['model', 'id'] },
      run: ({ model, id }) => (deleteProposal(dirname(modelFile(model)), id) ? `Withdrew ${id}.` : `No proposal ${id}.`),
    },
  ];
  if (opts.allowApply) {
    // Trusted runs: the tools that normally propose can apply directly, so multi-step work chains.
    for (const t of tools)
      if (['import_ddl', 'derive_tab', 'auto_map', 'fix_issues', 'sync_tabs', 'pull_schema', 'profile_data', 'propose_terms'].includes(t.name))
        (t.inputSchema.properties as Record<string, unknown>).apply = { type: 'boolean', description: 'Apply directly instead of saving a proposal (allowed on this server).' };
    tools.push({
      name: 'accept_proposal',
      description: 'Apply a pending proposal (by id, see list_proposals) and remove it.',
      inputSchema: { type: 'object', properties: { model: MODEL, id: str('Proposal id.') }, required: ['model', 'id'] },
      run: ({ model, id }) => {
        const p = listProposals(dirname(modelFile(model))).find((x) => x.id === id) || fail(`No proposal ${id}.`);
        const out = submit(model, p.title, p.rationale, p.ops, p.tab, true);
        deleteProposal(dirname(modelFile(model)), id);
        return out;
      },
    });
  }
  if (opts.allowApply)
    tools.push({
      name: 'apply_changes',
      description: `Apply edits to a model directly (no review). Same ops as propose_changes; all-or-nothing.\n${OPS_HELP}`,
      inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Default tab for ops without one.'), ops: opsSchema }, required: ['model', 'ops'] },
      run: ({ model, tab, ops }) => submit(model, 'Direct edit', undefined, ops, tab, true),
    });

  const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (msg.id === undefined) continue; // notifications (initialized, cancelled) need no reply
    const reply = (result: unknown) => send({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        reply({
          protocolVersion: msg.params?.protocolVersion || PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'entity-modeler', version: '0.2.0' },
          instructions:
            'EntityModel.com data models (models/<id>/model.json). Read with get_model/get_entity/search, check with validate (fix_issues proposes the mechanical fixes), and change models only through propose_changes (or derive_tab / import_ddl / pull_schema / sync_tabs / auto_map / propose_terms), batching one request into one proposal. Review comments: list_comments, then propose fixes and reply_comment. The business glossary is shared across models: search_glossary. The person reviews proposals in the EntityModel.com UI.',
        });
        break;
      case 'ping':
        reply({});
        break;
      case 'tools/list':
        reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        break;
      case 'tools/call': {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Unknown tool ${msg.params?.name}` } });
          break;
        }
        try {
          applyThisCall = opts.allowApply && msg.params?.arguments?.apply === true;
          reply({ content: [{ type: 'text', text: await tool.run(msg.params?.arguments || {}) }] });
        } catch (e: any) {
          reply({ content: [{ type: 'text', text: e?.message || String(e) }], isError: true });
        }
        break;
      }
      default:
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  }
}

function fail(msg: string): never {
  throw new Error(msg);
}
