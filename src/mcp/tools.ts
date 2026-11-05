// The MCP tool catalog, shared by the stdio server (cli/mcp.ts) and the hosted one (cloud/src/mcp.ts). Everything goes
// through a ModelStore, and nothing here needs Node or a DOM. Edits are proposals by default: they wait for a person to
// accept them. Tools that write directly exist only when `allowApply` is set, and the hosted server checks scopes too.
import {
  DOC_SECTIONS,
  SQL_DIALECTS,
  applyFixes,
  applyOps,
  autoMap,
  buildDocTables,
  createModel,
  dependencyOrder,
  deriveTab,
  describeOp,
  diffTabs,
  diffToMarkdown,
  importModelText,
  issueCounts,
  listTabs,
  mappingCoverage,
  mappingSql,
  mappingsFor,
  matchTerm,
  mergeModels,
  migrationSql,
  newTerm,
  normalizeModel,
  resolveTab,
  serializeModel,
  suggestLinks,
  syncPlan,
  tablesToMarkdown,
  tabView,
  toAvro,
  toDbml,
  toDbt,
  toInternalName,
  toJsonSchema,
  toMermaid,
  toOdcs,
  toSql,
  typeDisplay,
  validateModel,
  validateTabs,
  type DataModel,
  type DocSectionId,
  type Op,
  type SqlDialect,
  type TabKind,
} from '../core/index';
import type { ModelStore } from './store';

/** What a tool does to the model: read it, suggest a change for review, or change it. The hosted server maps these to scopes. */
export type Need = 'read' | 'propose' | 'apply';

export interface CallContext {
  /** This call asked to apply directly, and the server allows it. */
  apply: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  needs: Need;
  /** Reaches a system outside this tool's store: a database or a catalog. */
  external?: boolean;
  /** Writes something despite needing only read access (a file next to the model). */
  writes?: boolean;
  run(args: any, call: CallContext): string | Promise<string>;
}

export const str = (description: string) => ({ type: 'string', description });

const OPS_HELP = `Each op is an object with "op" and optional "tab". Ops:
add_entity {entity:{name, display_name?, entity_type?: "standard"|"reference", description?, attributes?: Attribute[]}} — without attributes you get <name>_id (PK) and <name>_name (label)
update_entity {entity, set:{display_name?, description?, entity_type?, color_code?, area?, dependent_reference?, notes?}}
rename_entity {entity, to}   delete_entity {entity}
add_attribute {entity, attribute:{name, type?, label?, description?, is_primary_key?, is_label?, required?, pii?, example?, is_array?, reference?:{entity, output_attribute}, struct_type?}, after?}
update_attribute {entity, attribute, set:{…}}   rename_attribute {entity, attribute, to}   delete_attribute {entity, attribute}   move_attribute {entity, attribute, after: name|null}
add_relationship {relationship:{source, target, name?, cardinality?: "1:1"|"1:N"|"N:1"|"N:N", forward_label?, reverse_label?, bidirectional?, foreign_key?, required?, description?, attributes?: Attribute[]}}
update_relationship {relationship, set:{…}} — set.required: true means the child can't exist without the parent (NOT NULL foreign key); set.attributes replaces the relationship's own attributes (facts about the link, e.g. an enrollment's grade; simple types only): junction-table columns for N:N, child-table columns otherwise   rename_relationship {relationship, to}   delete_relationship {relationship}
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

/** A save can lose a race with someone's edit. Ops refer to things by name, so they are simply applied again on the newer version. */
const WRITE_ATTEMPTS = 3;

function fail(msg: string): never {
  throw new Error(msg);
}

export interface CatalogOptions {
  allowApply: boolean;
  /** Who proposals and comment replies are from. */
  author: string;
}

/** What the tools share, also for tools that only one server has. */
export interface Helpers {
  modelArg: ReturnType<typeof str>;
  tabArg: ReturnType<typeof str>;
  load(id: string): Promise<DataModel>;
  tabOf(m: DataModel, ref?: string): string;
  submit(id: string, title: string, rationale: string | undefined, ops: Op[], tab: string | undefined, apply: boolean): Promise<string>;
}

/** Tools that take `apply: true` when the server allows direct edits. */
const APPLYABLE = new Set(['import_ddl', 'derive_tab', 'auto_map', 'fix_issues', 'sync_tabs', 'pull_schema', 'profile_data', 'propose_terms']);

export function createCatalog(store: ModelStore, opts: CatalogOptions, extra?: (h: Helpers) => Tool[]): Tool[] {
  const MODEL = str(store.modelIdHelp);
  const TAB = str('Tab name or id. Default: the primary tab.');
  const load = async (id: string) => normalizeModel(JSON.parse((await store.read(id)).text));
  const tabOf = (m: DataModel, ref?: string) => resolveTab(m, ref) || fail(`Tab "${ref}" not found. Tabs: ${listTabs(m).map((t) => t.name).join(', ')}`);
  const strip = <T>(x: T): T => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ui' ? undefined : v)));

  /** Apply ops and save, starting over on the newer version if someone saved meanwhile. */
  const applyAndSave = async (id: string, ops: Op[], tab?: string) => {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const { text, rev } = await store.read(id);
      const r = applyOps(normalizeModel(JSON.parse(text)), ops, { tab });
      if (!r.ok) throw new Error(`${r.error}\nNothing was written. Fix that op and call again with the whole batch.`);
      const saved = await store.write(id, rev, serializeModel({ ...r.doc, updated_at: new Date().toISOString() }));
      if (saved.ok) return r.doc;
    }
    throw new Error(`Model "${id}" kept changing while saving. Nothing was written; try again.`);
  };

  /** Check ops against a copy, then write a proposal (or apply). Returns the report the agent sees. */
  const submit: Helpers['submit'] = async (id, title, rationale, ops, tab, apply) => {
    if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty array.');
    const { text } = await store.read(id);
    const r = applyOps(normalizeModel(JSON.parse(text)), ops, { tab });
    if (!r.ok) throw new Error(`${r.error}\nNothing was written. Fix that op and call again with the whole batch.`);
    if (tab) tabOf(r.doc, tab); // an unknown tab is refused before anything is written
    const lines = ops.map((o, i) => `${i + 1}. ${describeOp(o)}`).join('\n');
    const doc = apply ? await applyAndSave(id, ops, tab) : r.doc;
    const touched = new Set([tab ? tabOf(doc, tab) : 'main', ...ops.map((o) => (o.tab ? resolveTab(doc, o.tab) : undefined)).filter(Boolean)]);
    const checks = [...touched].map((t) => {
      const c = issueCounts(validateModel(tabView(doc, t!)));
      return `${listTabs(doc).find((x) => x.id === t)?.name}: ${c.error} error(s), ${c.warning} warning(s)`;
    });
    if (apply) return `Applied ${ops.length} change(s) to ${id}:\n${lines}\nValidation after: ${checks.join('; ')}`;
    const p = await store.proposals.add(id, { title, rationale, author: opts.author, tab, base_hash: await store.hash(text), ops });
    return `Proposal ${p.id} saved for review (${store.reviewHint(id, p.id)}).\n${lines}\nValidation if accepted: ${checks.join('; ')}`;
  };

  /** Generated code for a tab, as the export tool returns it. */
  const exportText = (doc: DataModel, tab: string | undefined, format: string, dialect?: string): string => {
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

  const glossary = store.glossary?.bind(store);
  const saveExport = store.saveExport?.bind(store);
  const dialects = SQL_DIALECTS.map((d) => d.id);

  const tools: Tool[] = [
    {
      name: 'list_models',
      needs: 'read',
      description: 'List the models you can reach here.',
      inputSchema: { type: 'object', properties: {} },
      run: async () =>
        (await store.list()).map((m) => `${m.id}: ${m.title}${m.workspace ? ` [workspace ${m.workspace}]` : ''}${m.tabs ? ` — ${m.tabs}` : ''}`).join('\n') || 'No models yet.',
    },
    {
      name: 'create_model',
      needs: 'propose',
      description: 'Start a new, empty model. It changes no existing model, so it needs no review. Use propose_changes or import_ddl to fill it in.',
      inputSchema: {
        type: 'object',
        properties: {
          title: str('Model title, e.g. "Order management".'),
          id: str('Short id (lowercase letters, digits, hyphens). Default: made from the title.'),
          organization: str('Organization (optional).'),
          ...(store.createNeedsWorkspace ? { workspace: str('Workspace id (see list_workspaces).') } : {}),
        },
        required: store.createNeedsWorkspace ? ['title', 'workspace'] : ['title'],
      },
      run: async ({ title, id, organization, workspace }) => {
        if (!title || typeof title !== 'string') throw new Error('A model needs a title.');
        const name = toInternalName(id || title);
        const made = await store.create(name.replace(/_/g, '-'), serializeModel(createModel(name, title, { organization: organization || '' })), { workspace });
        return `Created model ${made}.`;
      },
    },
    {
      name: 'get_model',
      needs: 'read',
      description: 'Read a model tab. detail "summary" (default) is a compact text view of every entity, attribute and relationship; "full" is the tab as JSON (canvas positions omitted).',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, detail: { type: 'string', enum: ['summary', 'full'] } }, required: ['model'] },
      run: async ({ model, tab, detail }) => {
        const doc = await load(model);
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
      needs: 'read',
      description: 'One entity as JSON, plus the relationships and references that touch it.',
      inputSchema: { type: 'object', properties: { model: MODEL, entity: str('Entity name.'), tab: TAB }, required: ['model', 'entity'] },
      run: async ({ model, entity, tab }) => {
        const doc = await load(model);
        const v = tabView(doc, tabOf(doc, tab));
        const e = v.entities.find((x) => x.name === entity) || fail(`Entity "${entity}" not found.`);
        const rels = v.relationships.filter((r) => r.source === entity || r.target === entity);
        const usedBy = v.entities.flatMap((x) => x.attributes.filter((a) => a.reference?.entity === entity).map((a) => `${x.name}.${a.name}`));
        return JSON.stringify(strip({ entity: e, relationships: rels, referenced_by: usedBy }), null, 1);
      },
    },
    {
      name: 'search',
      needs: 'read',
      description: 'Find entities, attributes and relationships whose name, label or description contains the text (case-insensitive), across all tabs.',
      inputSchema: { type: 'object', properties: { model: MODEL, query: str('Text to look for.') }, required: ['model', 'query'] },
      run: async ({ model, query }) => {
        const doc = await load(model);
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
      needs: 'read',
      description: 'Validation issues (errors, warnings, notes) for one tab, or every tab.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Tab name or id. Default: every tab.') }, required: ['model'] },
      run: async ({ model, tab }) => {
        const doc = await load(model);
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
      needs: 'propose',
      description: 'Propose the mechanical fixes that validation offers (issues marked [fixable]: naming-standard renames, PII flags). Optionally only some issue codes, e.g. ["std.abbrev"].',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, codes: { type: 'array', items: { type: 'string' } } }, required: ['model'] },
      run: async ({ model, tab, codes }, call) => {
        const doc = await load(model);
        const id = tabOf(doc, tab);
        const issues = validateModel(tabView(doc, id)).filter((i) => i.fix && (codes?.length ? codes.includes(i.code) : !i.suggested));
        const { ops } = applyFixes(JSON.parse(JSON.stringify(doc)), issues, id);
        if (!ops.length) return 'Nothing to fix mechanically.';
        return submit(model, `Fix ${ops.length} naming issue(s)`, 'Mechanical fixes from the model’s naming standards.', ops, undefined, call.apply);
      },
    },
    {
      name: 'list_tabs',
      needs: 'read',
      description: 'The diagram tabs of a model: conceptual, logical, physical and variant views, with lineage.',
      inputSchema: { type: 'object', properties: { model: MODEL }, required: ['model'] },
      run: async ({ model }) => {
        const tabs = listTabs(await load(model));
        const lines = tabs.map((t) => `${t.id}: "${t.name}" ${t.kind}, ${t.entities} entities${t.dialect ? `, ${t.dialect}` : ''}${t.derived_from ? `, derived from ${t.derived_from}` : ''}${t.id === 'main' ? ' (primary)' : ''}`);
        if (!tabs[0].entities) lines.push('The primary tab is empty: import into it (tab "main"), rename it with update_tab, or make another tab primary (make_primary) and delete it (delete_tab).');
        return lines.join('\n');
      },
    },
    {
      name: 'diff_tabs',
      needs: 'read',
      description: 'What changed from tab A to tab B (renames are matched through derivation lineage), as Markdown.',
      inputSchema: { type: 'object', properties: { model: MODEL, a: str('From tab.'), b: str('To tab.') }, required: ['model', 'a', 'b'] },
      run: async ({ model, a, b }) => {
        const doc = await load(model);
        return diffToMarkdown(diffTabs(doc, tabOf(doc, a), tabOf(doc, b)));
      },
    },
    {
      name: 'migration_sql',
      needs: 'read',
      description: 'DDL (ALTER/CREATE/DROP) that takes a database built from tab A to tab B.',
      inputSchema: { type: 'object', properties: { model: MODEL, a: str('From tab.'), b: str('To tab.'), dialect: { type: 'string', enum: dialects } }, required: ['model', 'a', 'b'] },
      run: async ({ model, a, b, dialect }) => {
        const doc = await load(model);
        const bid = tabOf(doc, b);
        return migrationSql(doc, tabOf(doc, a), bid, (dialect || tabView(doc, bid).tab?.dialect || 'postgres') as SqlDialect);
      },
    },
    {
      name: 'sync_tabs',
      needs: 'propose',
      description: 'Propose bringing changes from a source tab into a tab derived from it (new entities, attributes, type changes, relationships), transformed the way the target was derived. Removals are only included when include_removals is true.',
      inputSchema: { type: 'object', properties: { model: MODEL, source: str('Source tab.'), target: str('Derived tab to update.'), include_removals: { type: 'boolean' } }, required: ['model', 'source', 'target'] },
      run: async ({ model, source, target, include_removals }, call) => {
        const doc = await load(model);
        const a = tabOf(doc, source);
        const b = tabOf(doc, target);
        const plan = syncPlan(doc, a, b).filter((c) => c.suggested || include_removals);
        if (!plan.length) return 'Already in sync.';
        const ops = plan.flatMap((c) => c.ops.map((o) => ({ ...o, tab: o.tab ?? b })));
        return submit(model, `Sync ${plan.length} change(s) from ${source}`, plan.map((c) => c.label).join('; ').slice(0, 600), ops, undefined, call.apply);
      },
    },
    {
      name: 'get_mappings',
      needs: 'read',
      description: 'Source-to-target mappings into a tab: coverage per entity and each mapped attribute with its sources and transform. With entity, also the dbt model SQL the mappings imply.',
      inputSchema: { type: 'object', properties: { model: MODEL, target: str('Target tab.'), entity: str('Optional target entity.') }, required: ['model', 'target'] },
      run: async ({ model, target, entity }) => {
        const doc = await load(model);
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
      needs: 'propose',
      description: 'Propose mappings for unmapped target attributes, matched by derivation lineage, then by name. Refine with propose_changes using set_mapping ops.',
      inputSchema: { type: 'object', properties: { model: MODEL, source: str('Source tab.'), target: str('Target tab.') }, required: ['model', 'source', 'target'] },
      run: async ({ model, source, target }, call) => {
        const doc = await load(model);
        const found = autoMap(doc, tabOf(doc, source), tabOf(doc, target));
        if (!found.length) return 'No new matches.';
        return submit(model, `Map ${found.length} attribute(s) from ${source}`, undefined, found.map((x) => ({ op: 'set_mapping' as const, target: x.target, sources: x.sources, status: 'draft' as const })), undefined, call.apply);
      },
    },
    {
      name: 'export',
      needs: 'read',
      writes: !!saveExport,
      description: 'Generate code for a tab: SQL DDL (per dialect), DBML, Mermaid erDiagram, dbt schema.yml (with data tests), ODCS v3 data contract, JSON Schema or Avro.',
      inputSchema: {
        type: 'object',
        properties: {
          model: MODEL,
          tab: TAB,
          format: { type: 'string', enum: ['sql', 'dbml', 'mermaid', 'dbt', 'odcs', 'jsonschema', 'avro'] },
          dialect: { type: 'string', enum: dialects },
          ...(saveExport ? { save: { type: 'boolean', description: 'Also write it to models/<id>/exports/ and return the path.' } } : {}),
        },
        required: ['model', 'format'],
      },
      run: async ({ model, tab, format, dialect, save }) => {
        const doc = await load(model);
        const text = exportText(doc, tab, format, dialect);
        if (!save || !saveExport) return text;
        const ext: Record<string, string> = { sql: 'sql', dbml: 'dbml', mermaid: 'mmd', dbt: 'schema.yml', odcs: 'odcs.yaml', jsonschema: 'schema.json', avro: 'avsc' };
        const tid = tabOf(doc, tab);
        const file = await saveExport(model, `${doc.name}${tid === 'main' ? '' : `-${tid}`}${format === 'sql' ? `.${dialect || tabView(doc, tid).tab?.dialect || 'postgres'}` : ''}.${ext[format] || 'txt'}`, text);
        return `Saved ${file} (${text.length} characters).`;
      },
    },
    {
      name: 'docs',
      needs: 'read',
      description: `Design-doc tables for a tab as Markdown. Sections: ${DOC_SECTIONS.map((s) => s.id).join(', ')}.`,
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, sections: { type: 'array', items: { type: 'string' } } }, required: ['model'] },
      run: async ({ model, tab, sections }) => {
        const doc = await load(model);
        const v = tabView(doc, tabOf(doc, tab));
        return tablesToMarkdown(v, buildDocTables(v, { sections: sections as DocSectionId[] | undefined }));
      },
    },
    {
      name: 'propose_changes',
      needs: 'propose',
      description: `Suggest edits to a model as one reviewable proposal. The ops are checked against the model first; nothing changes until the person accepts. Put every change for one request in a single call.\n${OPS_HELP}`,
      inputSchema: { type: 'object', properties: { model: MODEL, title: str('Short title, e.g. "Add contract entities".'), rationale: str('Why, in a sentence or two.'), tab: str('Default tab for ops without one.'), ops: opsSchema }, required: ['model', 'title', 'ops'] },
      run: ({ model, title, rationale, tab, ops }) => submit(model, title, rationale, ops, tab, false),
    },
    {
      name: 'import_ddl',
      needs: 'propose',
      description: 'Propose adding tables from SQL DDL or DBML text to a tab (keys, foreign keys, lookup tables and link tables are recognized). Existing entities are left alone.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: TAB, text: str('CREATE TABLE statements or DBML.') }, required: ['model', 'text'] },
      run: async ({ model, tab, text }, call) => {
        const doc = await load(model);
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
        return submit(model, `Import ${merged.added.length} table(s)`, r.warnings.join(' ') || undefined, ops, tid, call.apply);
      },
    },
    {
      name: 'derive_tab',
      needs: 'propose',
      description: 'Propose a new tab derived from another: kind "logical" (from physical: business names, FK columns → relationships, link tables → N:N, lookups → reference data), "physical" (FK columns, junction tables, dialect), "conceptual" (entities and relationships only) or "variant" (copy).',
      inputSchema: { type: 'object', properties: { model: MODEL, from: str('Source tab. Default: primary tab.'), kind: { type: 'string', enum: ['conceptual', 'logical', 'physical', 'variant'] }, name: str('New tab name.'), dialect: { type: 'string', enum: dialects } }, required: ['model', 'kind', 'name'] },
      run: async ({ model, from, kind, name, dialect }, call) => {
        // Say what the derivation does (renames, dropped columns, link tables), not only that a tab appears.
        const doc = await load(model);
        const report = deriveTab(tabView(doc, tabOf(doc, from || 'main')), kind as TabKind, { physical: { dialect } }).report;
        const out = await submit(model, `Derive ${kind} tab “${name}”`, report.lines.join(' '), [{ op: 'add_tab', name, kind: kind as TabKind, from: from || 'main', dialect }], undefined, call.apply);
        const dropped = report.droppedColumns.length ? `\nDropped columns: ${report.droppedColumns.slice(0, 40).join(', ')}${report.droppedColumns.length > 40 ? ', …' : ''}` : '';
        return `${out}\nDerivation: ${report.lines.join(' ')}${dropped}`;
      },
    },
    {
      name: 'list_comments',
      needs: 'read',
      description: 'Review comments on a model (open ones by default): what they are about, who said what, and replies. Work through them by proposing changes, then reply_comment.',
      inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Only this tab.'), include_resolved: { type: 'boolean' } }, required: ['model'] },
      run: async ({ model, tab, include_resolved }) => {
        const doc = await load(model);
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
      needs: 'propose',
      description: 'Reply to a review comment (written straight to the model: replies are conversation, not design changes). Say what you proposed or why not; resolve only if the person asked you to.',
      inputSchema: { type: 'object', properties: { model: MODEL, id: str('Comment id.'), text: str('Reply.'), resolve: { type: 'boolean' } }, required: ['model', 'id', 'text'] },
      run: async ({ model, id, text, resolve }) => {
        await applyAndSave(model, [{ op: 'reply_comment', id, text, author: opts.author }, ...(resolve ? [{ op: 'resolve_comment' as const, id, resolved: true }] : [])]);
        return `Replied to ${id}${resolve ? ' and resolved it' : ''}.`;
      },
    },
    {
      name: 'list_proposals',
      needs: 'read',
      description: 'Pending proposals for a model (not yet accepted or rejected).',
      inputSchema: { type: 'object', properties: { model: MODEL }, required: ['model'] },
      run: async ({ model }) => {
        const ps = await store.proposals.list(model);
        return ps.map((p) => `${p.id}: ${p.title} — ${p.ops.length} change(s) by ${p.author}, ${p.created_at}`).join('\n') || 'No pending proposals.';
      },
    },
    {
      name: 'withdraw_proposal',
      needs: 'propose',
      description: 'Delete one of your pending proposals (e.g. to replace it with a corrected one).',
      inputSchema: { type: 'object', properties: { model: MODEL, id: str('Proposal id.') }, required: ['model', 'id'] },
      run: async ({ model, id }) => ((await store.proposals.remove(model, id)) ? `Withdrew ${id}.` : `No proposal ${id}.`),
    },
  ];

  if (glossary)
    tools.push(
      {
        name: 'search_glossary',
        needs: 'read',
        description: 'The shared business glossary (all models): terms with definitions and synonyms, optionally filtered by text. With model, also the names in that model that match a term but are not linked yet.',
        inputSchema: { type: 'object', properties: { query: str('Text to look for.'), model: str('Optional model id, for link suggestions.'), tab: TAB } },
        run: async ({ query, model, tab }) => {
          const shared = await glossary();
          const terms = shared.filter((t) => !query || `${t.name} ${t.definition} ${(t.synonyms || []).join(' ')}`.toLowerCase().includes(String(query).toLowerCase()));
          const out = terms.map((t) => `${t.name} [${t.status || 'draft'}]${t.synonyms?.length ? ` (aka ${t.synonyms.join(', ')})` : ''}: ${t.definition || '(no definition yet)'}`);
          if (model) {
            const doc = await load(model);
            const sug = suggestLinks(tabView(doc, tabOf(doc, tab)), shared);
            if (sug.length) out.push('', 'Unlinked names that match a term:', ...sug.map((x) => `  ${x.entity}${x.attribute ? `.${x.attribute}` : ''} → ${x.term.name}`));
          }
          return out.join('\n') || 'The glossary is empty.';
        },
      },
      {
        name: 'propose_terms',
        needs: 'propose',
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
        run: async ({ model, tab, terms, links }, call) => {
          const shared = await glossary();
          const fresh = (terms || []).map((t: any) => matchTerm(shared, t.name) || newTerm(t.name, t.definition, { synonyms: t.synonyms }));
          const all = [...fresh, ...shared];
          const ops: Op[] = (links || []).map((l: any) => {
            const term = all.find((t) => t.name.toLowerCase() === String(l.term).toLowerCase()) || matchTerm(all, l.term);
            if (!term) throw new Error(`Term "${l.term}" is neither in the glossary nor in terms.`);
            return { op: 'link_term' as const, entity: l.entity, attribute: l.attribute, term };
          });
          return submit(model, `Link ${ops.length} name(s) to glossary terms`, fresh.length ? `New terms: ${fresh.filter((t: any) => !shared.includes(t)).map((t: any) => t.name).join(', ') || 'none'}.` : undefined, ops, tab, call.apply);
        },
      },
    );

  if (extra) tools.push(...extra({ modelArg: MODEL, tabArg: TAB, load, tabOf, submit }));

  if (opts.allowApply) {
    // Trusted runs: the tools that normally propose can apply directly, so multi-step work chains.
    for (const t of tools) if (APPLYABLE.has(t.name)) (t.inputSchema.properties as Record<string, unknown>).apply = { type: 'boolean', description: 'Apply directly instead of saving a proposal (allowed on this server).' };
    tools.push(
      {
        name: 'accept_proposal',
        needs: 'apply',
        description: 'Apply a pending proposal (by id, see list_proposals) and remove it.',
        inputSchema: { type: 'object', properties: { model: MODEL, id: str('Proposal id.') }, required: ['model', 'id'] },
        run: async ({ model, id }) => {
          const p = (await store.proposals.list(model)).find((x) => x.id === id) || fail(`No proposal ${id}.`);
          const out = await submit(model, p.title, p.rationale, p.ops, p.tab, true);
          await store.proposals.remove(model, id);
          return out;
        },
      },
      {
        name: 'apply_changes',
        needs: 'apply',
        description: `Apply edits to a model directly (no review). Same ops as propose_changes; all-or-nothing.\n${OPS_HELP}`,
        inputSchema: { type: 'object', properties: { model: MODEL, tab: str('Default tab for ops without one.'), ops: opsSchema }, required: ['model', 'ops'] },
        run: ({ model, tab, ops }) => submit(model, 'Direct edit', undefined, ops, tab, true),
      },
    );
  }
  return tools;
}
