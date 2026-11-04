// em — EntityModel.com CLI. Bundled to bin/em.mjs (no dependencies needed at runtime).
//   node bin/em.mjs <command> [args]
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModelPdf, PDF_ASSET_FILES, type PdfAssets } from '../src/core/pdf';
import { deleteProposal, listProposals, readGlossary, sha1, writeGlossary, writeProposal } from '../src/server/workbench';
import { runMcp } from './mcp';
import { pullSnapshot } from './pull';
import { DEFAULT_SAMPLE, modelTables, profileFromCsv, profileLive, profileScope } from './profile';
import { writeback } from './writeback';
import {
  profileIssues,
  profileQuery,
  buildDocTables,
  createModel,
  dependencyOrder,
  issueCounts,
  normalizeModel,
  serializeModel,
  tablesToHTMLDocument,
  tablesToMarkdown,
  toInternalName,
  typeDisplay,
  validateModel,
  DOC_SECTIONS,
  parseDelimited,
  rowsToValues,
  valuesToCSV,
  importModelText,
  mergeModels,
  toSql,
  toDbml,
  toMermaid,
  toDbt,
  toOdcs,
  toJsonSchema,
  toAvro,
  SQL_DIALECTS,
  MAIN_TAB,
  TAB_KINDS,
  addTab,
  deleteTab,
  deriveTab,
  diffCounts,
  diffTabs,
  diffToMarkdown,
  listTabs,
  makePrimary,
  migrationSql,
  nowIso,
  resolveTab,
  tabView,
  updateTabMeta,
  validateTabs,
  withTab,
  applyOps,
  describeOp,
  planPull,
  applyFixes,
  syncPlan,
  applySync,
  autoMap,
  reviewModels,
  reviewToMarkdown,
  applyBatches,
  matchTerm,
  newTerm,
  suggestLinks,
  mergeTerms,
  refreshSnapshot,
  mappingCoverage,
  mappingsCsv,
  mappingSql,
  catalogQuery,
  CATALOG_PLATFORMS,
  type CatalogPlatform,
  type Op,
  type DataModel,
  type DocSectionId,
  type LogicalOptions,
  type PhysicalOptions,
  type SqlDialect,
  type TabKind,
} from '../src/core/index';

const MODEL_FILE = 'model.json';
const args = process.argv.slice(2);
const cmd = args.shift();

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function bool(name: string): boolean {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

/** --tab works on every command that reads or writes model content; default is the primary tab. */
const TAB = flag('tab');

function tabId(m: DataModel, ref: string | undefined = TAB): string {
  const id = resolveTab(m, ref);
  if (!id) fail(`Tab "${ref}" not found. Tabs: ${listTabs(m).map((t) => t.name).join(', ')}`);
  return id!;
}
/** The --tab view of a model file. */
function view(m: DataModel): DataModel {
  return tabView(m, tabId(m));
}
function tabLabel(m: DataModel, id: string) {
  const t = listTabs(m).find((x) => x.id === id)!;
  return `${t.name} (${t.kind})`;
}

const EXPORT_FORMATS = ['sql', 'dbml', 'mermaid', 'dbt', 'odcs', 'jsonschema', 'avro'];
const EXPORT_EXT: Record<string, string> = { sql: 'sql', dbml: 'dbml', mermaid: 'mmd', dbt: 'schema.yml', odcs: 'odcs.yaml', jsonschema: 'schema.json', avro: 'avsc' };
export function exportText(m: DataModel, format: string, dialect: SqlDialect, values = true): string {
  if (format === 'dbml') return toDbml(m);
  if (format === 'mermaid') return toMermaid(m);
  if (format === 'dbt') return toDbt(m, { dialect });
  if (format === 'odcs') return toOdcs(m, { dialect });
  if (format === 'jsonschema') return toJsonSchema(m);
  if (format === 'avro') return toAvro(m);
  return toSql(m, { dialect, includeValues: values });
}

function findRoot(): string {
  let d = process.cwd();
  for (;;) {
    if (existsSync(join(d, 'models')) && existsSync(join(d, 'package.json'))) return d;
    const up = dirname(d);
    if (up === d) return process.cwd();
    d = up;
  }
}
const ROOT = findRoot();
const MODELS = join(ROOT, 'models');

function resolveModelPath(ref: string | undefined): string {
  if (!ref) fail('Missing model name or path. Run `em list` to see models.');
  const candidates = [resolve(ref!), join(MODELS, ref!), join(MODELS, ref!, MODEL_FILE), join(resolve(ref!), MODEL_FILE)];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  fail(`Model "${ref}" not found (looked in ${MODELS}).`);
  return '';
}
function load(path: string): DataModel {
  return normalizeModel(JSON.parse(readFileSync(path, 'utf8')));
}
function save(path: string, m: DataModel) {
  m.updated_at = new Date().toISOString();
  writeFileSync(path, serializeModel(m));
}
function exportsDir(modelPath: string) {
  const d = join(dirname(modelPath), 'exports');
  mkdirSync(d, { recursive: true });
  return d;
}
function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}
const stamp = () => new Date().toISOString().slice(0, 10);

/** PDF fonts from src/core/assets (next to bin/). Missing files fall back to Helvetica. */
function pdfAssets(): PdfAssets {
  const dir = fileURLToPath(new URL('../src/core/assets/', import.meta.url));
  const out: PdfAssets = {};
  for (const [k, f] of Object.entries(PDF_ASSET_FILES)) if (existsSync(join(dir, f))) out[k as keyof PdfAssets] = new Uint8Array(readFileSync(join(dir, f)));
  if (!out.regular) console.warn(`PDF fonts not found in ${dir}; using Helvetica.`);
  return out;
}

/** Newest diagram PNG the UI saved to models/<id>/exports/, if any. */
function latestDiagram(modelPath: string): string | undefined {
  const dir = join(dirname(modelPath), 'exports');
  if (!existsSync(dir)) return undefined;
  const pngs = readdirSync(dir)
    .filter((f) => /diagram.*\.png$/i.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return pngs[0];
}

async function main() {
  switch (cmd) {
    case 'list': {
      if (!existsSync(MODELS)) return console.log('No models/ folder.');
      for (const d of readdirSync(MODELS)) {
        const p = join(MODELS, d, MODEL_FILE);
        if (!existsSync(p)) continue;
        const m = load(p);
        console.log(`${d.padEnd(28)} ${m.title}${m.organization ? ` (${m.organization})` : ''} — ${m.entities.length} entities, ${m.relationships.length} relationships, updated ${m.updated_at.slice(0, 10)}`);
      }
      return;
    }
    case 'new': {
      const title = flag('title');
      const organization = flag('org');
      const raw = args.shift() || title;
      if (!raw) fail('Usage: em new <folder-name> [--title "Title"] [--org "Organization"]');
      const name = toInternalName(raw!).replace(/_/g, '-');
      const dir = join(MODELS, name);
      if (existsSync(join(dir, MODEL_FILE))) fail(`Model ${name} already exists.`);
      mkdirSync(join(dir, 'inputs'), { recursive: true });
      const m = createModel(toInternalName(raw!), title || raw!, { organization: organization || '' });
      save(join(dir, MODEL_FILE), m);
      console.log(`Created ${join(dir, MODEL_FILE)}\nPut source material (DDL, CSV headers, specs) in ${join(dir, 'inputs')}/`);
      return;
    }
    case 'validate': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const showInfo = bool('all');
      const fix = bool('fix');
      const dry = bool('dry-run');
      if (fix) {
        // Apply every mechanical fix (naming standards) per tab; descriptions and the like stay for a person.
        let total = 0;
        for (const id of TAB ? [tabId(m)] : listTabs(m).map((t) => t.id)) {
          const r = applyFixes(m, validateModel(tabView(m, id)).filter((i) => !i.suggested), id);
          total += r.applied;
          for (const o of r.ops) console.log(`${dry ? 'would ' : ''}${describeOp(o)}`);
        }
        if (!dry && total) save(p, m);
        console.log(`${dry ? 'Would apply' : 'Applied'} ${total} fix(es).${dry ? '' : ' Re-run validate to see what is left.'}`);
        return;
      }
      // Every tab unless --tab picks one; each tab is its own diagram with its own rules (conceptual relaxes attributes).
      const ids = TAB ? [tabId(m)] : listTabs(m).map((t) => t.id);
      const multi = listTabs(m).length > 1;
      let total = { error: 0, warning: 0, info: 0 };
      const tabIssues = validateTabs(m);
      for (const i of tabIssues) console.log(`${i.level.toUpperCase().padEnd(7)} [${i.code}] ${i.message}`);
      for (const id of ids) {
        const issues = validateModel(tabView(m, id));
        const c = issueCounts(issues);
        if (multi) console.log(`\n== tab ${tabLabel(m, id)}: ${c.error} error(s), ${c.warning} warning(s)`);
        for (const i of issues) if (i.level !== 'info' || showInfo) console.log(`${i.level.toUpperCase().padEnd(7)} [${i.code}] ${i.message}`);
        total = { error: total.error + c.error, warning: total.warning + c.warning, info: total.info + c.info };
      }
      const tc = issueCounts(tabIssues);
      total.error += tc.error;
      total.warning += tc.warning;
      console.log(`\n${total.error} error(s), ${total.warning} warning(s), ${total.info} note(s)${multi && !TAB ? ` across ${ids.length} tabs` : ''}${showInfo ? '' : ' (use --all to list notes)'}`);
      if (total.error) process.exit(2);
      return;
    }
    case 'fmt': {
      const p = resolveModelPath(args.shift());
      save(p, load(p));
      console.log(`Normalized ${p}`);
      return;
    }
    case 'summary': {
      const p = resolveModelPath(args.shift());
      const doc = load(p);
      const m = view(doc);
      console.log(`${m.title} (${m.name})${m.organization ? ` — ${m.organization}` : ''}  v${m.version || '?'}`);
      if (listTabs(doc).length > 1) console.log(`Tabs: ${listTabs(doc).map((t) => `${t.name} [${t.kind}, ${t.entities}]${t.id === tabId(doc) ? ' ←' : ''}`).join(' · ')}`);
      console.log(`Entities: ${m.entities.length} · Relationships: ${m.relationships.length} · Hierarchies: ${m.hierarchies.length}\n`);
      for (const e of dependencyOrder(m)) {
        console.log(`[${e.entity_type}] ${e.display_name} (${e.name})${e.dependent_reference ? ` depends on ${e.dependent_reference.parent}.${e.dependent_reference.linked_column}` : ''}`);
        for (const a of e.attributes)
          console.log(
            `    ${a.is_primary_key ? 'PK ' : a.is_label ? 'LB ' : '   '}${a.name.padEnd(28)} ${typeDisplay(a)}${a.reference ? ` → ${a.reference.entity}.${a.reference.output_attribute}` : ''}`,
          );
        if (e.reference_values?.length) console.log(`    values: ${e.reference_values.length}`);
      }
      for (const r of m.relationships) console.log(`rel ${r.name}: ${r.source} -[${r.cardinality} ${r.forward_label}]-> ${r.target}`);
      return;
    }
    case 'export': {
      const p = resolveModelPath(args.shift());
      const format = flag('format') || 'sql';
      const m = view(load(p));
      const dialect = (flag('dialect') || m.tab?.dialect || 'postgres') as SqlDialect;
      const out = flag('out');
      const noValues = bool('no-values');
      const toStdout = bool('stdout');
      if (!EXPORT_FORMATS.includes(format)) fail(`--format must be one of ${EXPORT_FORMATS.join(', ')}.`);
      if (format === 'sql' && !SQL_DIALECTS.some((d) => d.id === dialect)) fail(`--dialect must be one of ${SQL_DIALECTS.map((d) => d.id).join(', ')}.`);
      const text = exportText(m, format, dialect, !noValues);
      if (toStdout) return void process.stdout.write(text);
      const suffix = TAB ? `-${tabId(load(p))}` : '';
      const file = out || join(exportsDir(p), `${m.name}${suffix}${format === 'sql' ? `.${dialect}` : ''}.${EXPORT_EXT[format]}`);
      writeFileSync(file, text);
      console.log(`Wrote ${file}`);
      return;
    }
    case 'import': {
      const ref = args.shift();
      const src = args.shift();
      const create = bool('create');
      const title = flag('title');
      if (!ref || !src) fail('Usage: em import <model> <file.sql|file.dbml> [--create] [--title T]');
      const text = readFileSync(resolve(src!), 'utf8');
      // Into a physical tab, link tables stay tables (a faithful copy); otherwise they become N:N relationships.
      const physicalTarget = !create && view(load(resolveModelPath(ref))).tab?.kind === 'physical';
      const r = importModelText(text, { format: /\.dbml$/i.test(src!) ? 'dbml' : /\.(sql|ddl)$/i.test(src!) ? 'sql' : undefined, title: title || basename(src!).replace(/\.[^.]+$/, ''), keepJunctions: physicalTarget });
      let p: string;
      let m: DataModel;
      if (create) {
        const name = toInternalName(ref!).replace(/_/g, '-');
        p = join(MODELS, name, MODEL_FILE);
        if (existsSync(p)) fail(`Model ${name} already exists. Drop --create to add the tables to it.`);
        mkdirSync(join(MODELS, name, 'inputs'), { recursive: true });
        m = { ...r.model, name: toInternalName(ref!) };
        console.log(`Created ${p} from ${r.format.toUpperCase()}: ${m.entities.length} tables, ${m.relationships.length} relationships`);
      } else {
        p = resolveModelPath(ref);
        m = load(p);
        const id = tabId(m);
        const merged = mergeModels(tabView(m, id), r.model);
        withTab(m, id, (v) => Object.assign(v, { entities: merged.model.entities, relationships: merged.model.relationships }));
        console.log(`Added ${merged.added.length} table(s) to tab ${tabLabel(m, id)}${merged.skipped.length ? `; skipped existing: ${merged.skipped.join(', ')}` : ''}`);
      }
      save(p, m);
      for (const w of r.warnings) console.log(`note: ${w}`);
      const c = issueCounts(validateModel(view(m)));
      console.log(`${c.error} error(s), ${c.warning} warning(s) — run: node bin/em.mjs validate ${basename(dirname(p))}`);
      return;
    }
    case 'docs': {
      const p = resolveModelPath(args.shift());
      const format = flag('format') || 'md';
      const sections = flag('sections')?.split(',') as DocSectionId[] | undefined;
      const entities = flag('entities')?.split(',');
      const out = flag('out');
      const m = view(load(p));
      const tables = buildDocTables(m, { sections, entities });
      if (format === 'pdf') {
        const diagramFlag = flag('diagram');
        const diagram = diagramFlag ? resolve(diagramFlag) : bool('no-diagram') ? undefined : latestDiagram(p);
        const pageSize = flag('page-size') === 'a4' ? 'a4' : 'letter';
        const file = out || join(exportsDir(p), `${m.name}-data-model-${stamp()}.pdf`);
        writeFileSync(file, buildModelPdf(m, tables, { pageSize, diagramPng: diagram ? new Uint8Array(readFileSync(diagram)) : undefined, assets: pdfAssets() }));
        console.log(`Wrote ${file} (${tables.length} tables, ${diagram ? `diagram: ${basename(diagram)}` : 'no diagram — export a PNG from the UI or pass --diagram F.png'})`);
        return;
      }
      const text = format === 'html' ? tablesToHTMLDocument(m, tables) : tablesToMarkdown(m, tables);
      if (bool('stdout')) return void process.stdout.write(text);
      const file = out || join(exportsDir(p), `${m.name}-data-model.${format === 'html' ? 'html' : 'md'}`);
      writeFileSync(file, text);
      console.log(`Wrote ${file} (${tables.length} tables)`);
      return;
    }
    case 'values': {
      const p = resolveModelPath(args.shift());
      const entityName = args.shift();
      const append = bool('append');
      const out = flag('out');
      const exportCsv = bool('export');
      const file = args.shift();
      const doc = load(p);
      const m = view(doc);
      const e = m.entities.find((x) => x.name === entityName);
      if (!e) fail(`Entity ${entityName} not found. Usage: em values <model> <reference-entity> <file.csv|.tsv> [--append] | --export [--out F]`);
      if (exportCsv) {
        const csv = valuesToCSV(e!);
        if (out) writeFileSync(out, csv);
        else process.stdout.write(csv);
        return;
      }
      if (!file) fail('Provide a CSV/TSV file, or --export.');
      const { values, header, unknown } = rowsToValues(e!, parseDelimited(readFileSync(resolve(file!), 'utf8')));
      e!.reference_values = append ? [...(e!.reference_values || []), ...values] : values;
      save(p, doc);
      console.log(`${append ? 'Appended' : 'Loaded'} ${values.length} value(s) into ${e!.name}${header ? ' (header matched by name)' : ' (columns by position)'}${unknown.length ? `; ignored columns: ${unknown.join(', ')}` : ''}. Total: ${e!.reference_values.length}`);
      return;
    }
    case 'tabs': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const kind = flag('kind') as TabKind | undefined;
      if (kind && !TAB_KINDS.some((k) => k.id === kind)) fail(`--kind must be one of ${TAB_KINDS.map((k) => k.id).join(', ')}.`);
      const add = flag('add');
      const rename = flag('rename');
      const remove = flag('remove');
      const primary = flag('primary');
      if (add) {
        const id = addTab(m, { name: add, kind: kind || 'variant' });
        save(p, m);
        console.log(`Added empty tab "${add}" (id ${id}). Fill it with: em import <model> <file.sql> --tab ${id}, or edit tabs[] in the file.`);
      } else if (rename) {
        const id = tabId(m, rename);
        const to = args.shift();
        if (!to) fail('Usage: em tabs <model> --rename <tab> <new name>');
        updateTabMeta(m, id, { name: to });
        save(p, m);
        console.log(`Renamed tab to "${to}".`);
      } else if (remove) {
        deleteTab(m, tabId(m, remove));
        save(p, m);
        console.log(`Removed tab "${remove}".`);
      } else if (primary) {
        makePrimary(m, tabId(m, primary));
        save(p, m);
        console.log(`"${primary}" is now the primary tab (the top-level content).`);
      } else if (kind) {
        updateTabMeta(m, tabId(m), { kind });
        save(p, m);
        console.log(`Tab ${tabLabel(m, tabId(m))} kind set.`);
      } else
        for (const t of listTabs(m))
          console.log(
            `${t.id.padEnd(18)} ${t.name.padEnd(22)} ${t.kind.padEnd(11)} ${String(t.entities).padStart(4)} entities${t.dialect ? ` · ${t.dialect}` : ''}${t.derived_from ? ` · from ${t.derived_from}` : ''}${t.id === MAIN_TAB ? ' · primary' : ''}`,
          );
      return;
    }
    case 'derive': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const kind = (flag('kind') || 'logical') as TabKind;
      if (!TAB_KINDS.some((k) => k.id === kind)) fail(`--kind must be one of ${TAB_KINDS.map((k) => k.id).join(', ')}.`);
      const from = tabId(m, flag('from') || TAB);
      const name = flag('name');
      const dialect = flag('dialect') as SqlDialect | undefined;
      const dry = bool('dry-run');
      const off = (k: string) => bool(`no-${k}`);
      const logical: Partial<LogicalOptions> = {
        businessNames: !off('business-names'),
        dropTechnical: !off('drop-technical'),
        dropForeignKeys: !off('drop-fks'),
        collapseJunctions: !off('collapse-junctions'),
        detectReferences: !off('detect-references'),
        inferRelationships: !off('infer-relationships'),
      };
      const physical: Partial<PhysicalOptions> = { dialect, addForeignKeys: !off('add-fks'), resolveManyToMany: !off('junctions'), flattenStructs: bool('flatten-structs'), auditColumns: bool('audit-columns') };
      const { content, report } = deriveTab(tabView(m, from), kind, { logical, physical });
      for (const l of report.lines) console.log(`- ${l}`);
      if (dry) return void console.log(`(dry run: ${content.entities.length} entities, ${content.relationships.length} relationships; nothing written)`);
      const id = addTab(m, { name: name || TAB_KINDS.find((k) => k.id === kind)!.label, kind, derived_from: from, derived_at: nowIso(), ...(kind === 'physical' && dialect ? { dialect } : {}) }, content);
      save(p, m);
      const c = issueCounts(validateModel(tabView(m, id)));
      console.log(`Created tab ${tabLabel(m, id)} (id ${id}) from ${tabLabel(m, from)}: ${content.entities.length} entities, ${content.relationships.length} relationships. ${c.error} error(s), ${c.warning} warning(s).`);
      return;
    }
    case 'diff': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const a = tabId(m, args.shift());
      const b = tabId(m, args.shift());
      const d = diffTabs(m, a, b);
      if (flag('format') === 'json') return void console.log(JSON.stringify(d, null, 2));
      process.stdout.write(diffToMarkdown(d));
      const c = diffCounts(d);
      console.log(`\n${c.added} added, ${c.removed} removed, ${c.changed} changed`);
      return;
    }
    case 'sync': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const a = tabId(m, args.shift());
      const b = tabId(m, args.shift());
      const all = bool('all');
      const doApply = bool('apply');
      const propose = bool('propose');
      const plan = syncPlan(m, a, b);
      if (!plan.length) return void console.log(`${tabLabel(m, b)} is in sync with ${tabLabel(m, a)}.`);
      const chosen = plan.filter((c) => all || c.suggested);
      for (const c of plan) console.log(`${chosen.includes(c) ? '[x]' : '[ ]'} ${c.label}`);
      if (propose) {
        const ops = chosen.flatMap((c) => c.ops.map((o) => ({ ...o, tab: o.tab ?? b })));
        const prop = writeProposal(dirname(p), { title: `Sync ${chosen.length} change(s) into ${tabLabel(m, b)}`, author: process.env.USER || 'cli', base_hash: sha1(readFileSync(p, 'utf8')), ops });
        return void console.log(`Saved proposal ${prop.id}.`);
      }
      if (!doApply) return void console.log(`\n${chosen.length} of ${plan.length} would apply. Run with --apply (add --all to include removals), or --propose.`);
      const r = applySync(m, chosen, b);
      save(p, m);
      console.log(`Applied ${r.applied} change(s)${r.skipped ? `, skipped ${r.skipped}` : ''}.`);
      return;
    }
    case 'glossary': {
      const sub = args.shift();
      const terms = readGlossary(MODELS);
      if (sub === 'add') {
        const name = args.shift();
        if (!name) fail('Usage: em glossary add "Term" --definition "…" [--synonyms a,b]');
        if (matchTerm(terms, name!)) fail(`"${name}" is already a term (or a synonym of one).`);
        writeGlossary(MODELS, [...terms, newTerm(name!, flag('definition') || '', { synonyms: flag('synonyms')?.split(',').map((x) => x.trim()) })]);
        console.log(`Added "${name}".`);
      } else if (sub === 'suggest' || sub === 'link') {
        const p = resolveModelPath(args.shift());
        const m = load(p);
        const id = tabId(m);
        const sug = suggestLinks(tabView(m, id), terms);
        for (const x of sug) console.log(`${x.entity}${x.attribute ? `.${x.attribute}` : ''} → ${x.term.name}`);
        if (sub === 'link' && sug.length) {
          const r = applyBatches(m, sug.map((x) => [{ op: 'link_term', entity: x.entity, attribute: x.attribute, term: x.term }]), id);
          save(p, m);
          console.log(`Linked ${r.applied}.`);
        } else if (!sug.length) console.log('Nothing to link.');
      } else if (sub === 'sync') {
        // Shared glossary ← model snapshot (newer wins), then model snapshot ← shared glossary.
        const p = resolveModelPath(args.shift());
        const m = load(p);
        const merged = mergeTerms(terms, m.glossary_snapshot || []);
        writeGlossary(MODELS, merged);
        if (refreshSnapshot(m, merged)) save(p, m);
        console.log(`Glossary has ${merged.length} terms; the model carries ${m.glossary_snapshot?.length || 0}.`);
      } else {
        for (const t of terms) console.log(`${t.name.padEnd(28)} ${(t.status || 'draft').padEnd(10)} ${t.definition}`);
        if (!terms.length) console.log('The glossary is empty. Add a term: em glossary add "Customer" --definition "…"');
      }
      return;
    }
    case 'review': {
      // Compare model files against a git ref (default: where this branch left the default branch).
      const baseRef = flag('base') || 'origin/main';
      const headRef = flag('head');
      const format = flag('format') || 'md';
      const out = flag('out');
      const failOnErrors = bool('fail-on-errors');
      const only = flag('models')?.split(',');
      const dialect = flag('dialect') as SqlDialect | undefined;
      const git = (...a: string[]) => {
        const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        return r.status === 0 ? r.stdout : null;
      };
      const head = headRef || 'HEAD';
      const base = (git('merge-base', baseRef, head) || '').trim() || baseRef;
      if (!git('rev-parse', '--verify', `${base}^{commit}`)) fail(`Unknown git ref "${baseRef}". Pass --base <ref>.`);
      const changed = new Set(
        [
          ...(git('diff', '--name-only', base, ...(headRef ? [headRef] : []), '--', 'models') || '').split('\n'),
          ...(headRef ? [] : (git('ls-files', '--others', '--exclude-standard', '--', 'models') || '').split('\n')),
        ].filter((f) => /^models\/[^/]+\/model\.json$/.test(f) && (!only || only.includes(f.split('/')[1]))),
      );
      const read = (ref: string | null, f: string) => {
        const text = ref ? git('show', `${ref}:${f}`) : existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : null;
        return text ? normalizeModel(JSON.parse(text)) : null;
      };
      const reviews = [...changed].sort().map((f) => reviewModels(f, read(base, f), read(headRef || null, f), { dialect }));
      const text = format === 'json' ? JSON.stringify(reviews, null, 2) + '\n' : reviewToMarkdown(reviews);
      if (out) writeFileSync(out, text);
      else process.stdout.write(text);
      if (failOnErrors && reviews.some((r) => r.tabs.some((t) => t.errors[1] > 0))) process.exit(2);
      return;
    }
    case 'mappings': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const target = tabId(m, flag('target') || TAB);
      const source = flag('source');
      const format = flag('format') || 'summary';
      const out = flag('out');
      if (bool('auto')) {
        const src = tabId(m, source || listTabs(m).find((t) => t.id === target)?.derived_from);
        const found = autoMap(m, src, target);
        m.mappings = [...(m.mappings || []), ...found];
        if (found.length) save(p, m);
        console.log(`Auto-mapped ${found.length} attribute(s) from ${tabLabel(m, src)} into ${tabLabel(m, target)}.`);
      }
      const cov = mappingCoverage(m, target);
      let text: string;
      if (format === 'csv') text = mappingsCsv(m, target);
      else if (format === 'dbt') text = tabView(m, target).entities.map((e) => `-- models/${e.name}.sql\n${mappingSql(m, target, e.name)}`).join('\n');
      else if (format === 'md') text = tablesToMarkdown(tabView(m, target), buildDocTables(tabView(m, target), { sections: ['mappings'] }));
      else text = cov.byEntity.map((x) => `${x.entity.padEnd(32)} ${x.mapped}/${x.total}`).join('\n') + `\n\n${cov.mapped} of ${cov.total} attributes mapped (${cov.pct}%).`;
      if (out) {
        writeFileSync(out, text);
        console.log(`Wrote ${out}`);
      } else process.stdout.write(text.endsWith('\n') ? text : text + '\n');
      return;
    }
    case 'migrate': {
      const p = resolveModelPath(args.shift());
      const m = load(p);
      const a = tabId(m, args.shift());
      const b = tabId(m, args.shift());
      const dialect = (flag('dialect') || tabView(m, b).tab?.dialect || 'postgres') as SqlDialect;
      if (!SQL_DIALECTS.some((d) => d.id === dialect)) fail(`--dialect must be one of ${SQL_DIALECTS.map((d) => d.id).join(', ')}.`);
      const sql = migrationSql(m, a, b, dialect);
      const out = flag('out');
      if (bool('stdout') || !out) return void process.stdout.write(sql + '\n');
      writeFileSync(out, sql + '\n');
      console.log(`Wrote ${out}`);
      return;
    }
    case 'catalog-query': {
      const platform = (flag('platform') || flag('from') || 'postgres') as CatalogPlatform;
      if (!CATALOG_PLATFORMS.some((x) => x.id === platform)) fail(`--platform must be one of ${CATALOG_PLATFORMS.map((x) => x.id).join(', ')}.`);
      console.log(catalogQuery(platform, { catalog: flag('catalog'), schema: flag('schema') }));
      return;
    }
    case 'pull': {
      const p = resolveModelPath(args.shift());
      const name = flag('name');
      const propose = bool('propose');
      const saveSnap = flag('save-snapshot');
      const profile = flag('profile');
      const snap = await pullSnapshot(
        { from: flag('from'), csv: flag('csv'), snapshot: flag('snapshot'), platform: flag('platform'), catalog: flag('catalog'), schema: flag('schema'), profile, url: flag('url') },
        (s) => console.log(s),
      );
      if (saveSnap) writeFileSync(saveSnap, JSON.stringify(snap, null, 2) + '\n');
      const text = readFileSync(p, 'utf8');
      const doc = normalizeModel(JSON.parse(text));
      const plan = planPull(doc, snap, { name, profile });
      for (const w of plan.warnings) console.log(`note: ${w}`);
      const r = applyOps(doc, plan.ops);
      if (!r.ok) fail(r.error);
      if (propose) {
        const prop = writeProposal(dirname(p), { title: `Pull ${plan.tables} tables into “${plan.tabName}”`, author: process.env.USER || 'cli', base_hash: sha1(text), ops: plan.ops });
        console.log(`Saved proposal ${prop.id}.`);
      } else save(p, r.doc);
      const id = resolveTab(r.doc, plan.tabName)!;
      const c = issueCounts(validateModel(tabView(r.doc, id)));
      console.log(`${propose ? 'Proposed' : 'Pulled'} ${plan.tables} tables into tab “${plan.tabName}”. ${c.error} error(s), ${c.warning} warning(s).`);
      if (plan.previous) {
        const d = diffCounts(diffTabs(r.doc, plan.previous, id));
        console.log(`Since “${tabLabel(r.doc, plan.previous)}”: ${d.added} added, ${d.removed} removed, ${d.changed} changed. See: em diff ${basename(dirname(p))} ${plan.previous} ${id}`);
      }
      return;
    }
    case 'profile': {
      const p = resolveModelPath(args.shift());
      const doc = load(p);
      const id = tabId(doc);
      const sampleFlag = flag('sample');
      const sample = sampleFlag === undefined ? DEFAULT_SAMPLE : Number(sampleFlag);
      const entities = flag('entities')?.split(',').map((x) => x.trim()).filter(Boolean);
      const src = { from: flag('from') || flag('platform'), catalog: flag('catalog'), schema: flag('schema'), profile: flag('profile'), warehouse: flag('warehouse'), url: flag('url'), sample, entities };
      const csv = flag('csv');
      const propose = bool('propose');
      if (bool('query')) {
        // The paste path: one statement per table, to run in any SQL tool and save the results as CSV.
        const s = profileScope(doc, id, src);
        for (const { table } of modelTables(tabView(doc, id), entities, s.from)) console.log(profileQuery(s.from as CatalogPlatform, table, { catalog: s.catalog, sample }) + '\n');
        return;
      }
      const r = csv ? { ...profileFromCsv(doc, id, csv, sample), skipped: [] as string[] } : await profileLive(doc, id, src, (s) => console.log(s));
      if (!r.ops.length) fail(`No tables profiled.${r.skipped.length ? ` Skipped: ${r.skipped.join('; ')}` : ''}`);
      const text = readFileSync(p, 'utf8');
      const res = applyOps(doc, r.ops, { tab: id });
      if (!res.ok) fail(res.error);
      if (propose) {
        const prop = writeProposal(dirname(p), { title: `Profile ${r.profiled} table(s)`, author: process.env.USER || 'cli', tab: id, base_hash: sha1(text), ops: r.ops });
        console.log(`Saved proposal ${prop.id}.`);
      } else save(p, res.doc);
      if (r.skipped.length) console.log(`Not profiled: ${r.skipped.join('; ')}`);
      const found = profileIssues(tabView(res.doc, id));
      console.log(`${propose ? 'Proposed profiles for' : 'Profiled'} ${r.profiled} table(s). ${found.length} finding(s)${found.length ? ':' : '.'}`);
      for (const i of found.slice(0, 40)) console.log(`  ${i.level.padEnd(7)} ${i.message}`);
      if (found.length > 40) console.log(`  … ${found.length - 40} more: em validate ${basename(dirname(p))} --all`);
      return;
    }
    case 'writeback': {
      const p = resolveModelPath(args.shift());
      const doc = load(p);
      const id = tabId(doc);
      const apply = bool('apply');
      const out = flag('out');
      const src = { from: flag('from'), catalog: flag('catalog'), schema: flag('schema'), profile: flag('profile'), warehouse: flag('warehouse'), url: flag('url'), tags: !bool('no-tags'), apply };
      const r = await writeback(doc, id, src, (s) => console.log(s));
      if (!r.statements.length) return void console.log('The catalog already has everything the model documents. Nothing to write.');
      const sql = r.statements.map((s) => `-- ${s.what}\n${s.sql}`).join('\n');
      if (out) writeFileSync(out, sql + '\n');
      if (!apply) {
        if (!out) console.log(sql);
        console.log(`\n${r.statements.length} statement(s)${out ? ` written to ${out}` : ''}. Nothing was run: review them, then add --apply to run them.`);
        return;
      }
      console.log(`Ran ${r.applied} of ${r.statements.length} statement(s).`);
      for (const f of r.failed) console.log(`  failed: ${f}`);
      if (r.failed.length) process.exitCode = 1;
      return;
    }
    case 'mcp':
      // stdout is the protocol channel: nothing else may print to it.
      return runMcp({ allowApply: bool('allow-apply'), author: flag('author') || 'Claude' });
    case 'apply': {
      const p = resolveModelPath(args.shift());
      const src = args.shift();
      const direct = bool('apply');
      if (!src) fail('Usage: em apply <model> <ops.json | -> [--apply] [--title T] [--rationale R] [--tab T]');
      const raw = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(src!), 'utf8'));
      const ops: Op[] = Array.isArray(raw) ? raw : raw.ops;
      const title = flag('title') || raw.title || `${ops.length} change(s)`;
      const rationale = flag('rationale') || raw.rationale;
      const text = readFileSync(p, 'utf8');
      const r = applyOps(normalizeModel(JSON.parse(text)), ops, { tab: TAB });
      if (!r.ok) fail(r.error);
      ops.forEach((o, i) => console.log(`${String(i + 1).padStart(3)}. ${describeOp(o)}`));
      if (direct) {
        save(p, r.doc);
        console.log(`Applied ${ops.length} change(s).`);
      } else {
        const prop = writeProposal(dirname(p), { title, rationale, author: flag('author') || process.env.USER || 'cli', tab: TAB, base_hash: sha1(text), ops });
        console.log(`Saved proposal ${prop.id}. Review it in the UI, or: em proposals ${basename(dirname(p))} --accept ${prop.id}`);
      }
      const c = issueCounts(validateModel(view(r.doc)));
      console.log(`Validation ${direct ? 'now' : 'if accepted'}: ${c.error} error(s), ${c.warning} warning(s)`);
      return;
    }
    case 'proposals': {
      const p = resolveModelPath(args.shift());
      const dir = dirname(p);
      const accept = flag('accept');
      const reject = flag('reject');
      const show = flag('show');
      const find = (id: string) => listProposals(dir).find((x) => x.id === id) || fail(`No proposal ${id}.`);
      if (accept) {
        const prop = find(accept);
        const text = readFileSync(p, 'utf8');
        if (prop.base_hash && prop.base_hash !== sha1(text)) console.log('note: the model changed since this proposal was made; applying by name.');
        const r = applyOps(normalizeModel(JSON.parse(text)), prop.ops, { tab: prop.tab });
        if (!r.ok) fail(r.error);
        save(p, r.doc);
        deleteProposal(dir, prop.id);
        console.log(`Accepted ${prop.id}: ${prop.ops.length} change(s) applied.`);
      } else if (reject) {
        if (!deleteProposal(dir, reject)) fail(`No proposal ${reject}.`);
        console.log(`Rejected ${reject}.`);
      } else if (show) {
        const prop = find(show);
        console.log(`${prop.title} — by ${prop.author}, ${prop.created_at}${prop.rationale ? `\n${prop.rationale}` : ''}`);
        prop.ops.forEach((o, i) => console.log(`${String(i + 1).padStart(3)}. ${describeOp(o)}`));
      } else {
        const list = listProposals(dir);
        if (!list.length) console.log('No pending proposals.');
        for (const x of list) console.log(`${x.id}  ${x.title} — ${x.ops.length} change(s) by ${x.author}`);
      }
      return;
    }
    case 'sections':
      for (const s of DOC_SECTIONS) console.log(`${s.id.padEnd(14)} ${s.title} — ${s.description}`);
      return;
    default:
      console.log(`em — EntityModel.com CLI

  list                                   List models in models/
  new <name> [--title T] [--org O]       Create models/<name>/model.json
  summary <model>                        Compact text view of a model
  validate <model> [--all]               Check modeling rules and naming standards (exit 2 on errors)
  validate <model> --fix [--dry-run]     Apply the mechanical fixes (renames, PII flags) the checks offer
  fmt <model>                            Normalize and re-save the model file
  docs <model> [--format md|html|pdf] [--sections a,b] [--entities x,y] [--out F] [--stdout]
                                         Design-doc tables
       [--diagram F.png] [--no-diagram] [--page-size letter|a4]
                                         PDF only; default diagram is the newest exports/*diagram*.png
  values <model> <entity> <file.csv> [--append]
                                         Load a reference entity's values from CSV/TSV (header = attribute names)
  values <model> <entity> --export [--out F]
                                         Write values as CSV
  export <model> --format sql|dbml|mermaid|dbt|odcs|jsonschema|avro [--dialect postgres|mysql|snowflake|databricks]
         [--no-values] [--out F | --stdout]
                                         SQL DDL, DBML, Mermaid, dbt schema.yml, ODCS data contract,
                                         JSON Schema or Avro (--dialect sets SQL/dbt/ODCS column types)
  import <model> <file.sql|file.dbml> [--create] [--title T]
                                         Add tables from SQL DDL or DBML (or create a model with --create)
  sections                               List doc table sections

Tabs (diagrams inside one model: conceptual, logical, physical, variants)
  tabs <model>                           List tabs
  tabs <model> --add NAME [--kind K]     Add an empty tab (kind: conceptual|logical|physical|variant)
  tabs <model> --rename TAB NEW | --remove TAB | --primary TAB | --tab TAB --kind K
  derive <model> --kind logical|physical|conceptual|variant [--from TAB] [--name N] [--dry-run]
         logical:  [--no-business-names] [--no-drop-technical] [--no-drop-fks] [--no-collapse-junctions]
                   [--no-detect-references] [--no-infer-relationships]
         physical: [--dialect D] [--no-add-fks] [--no-junctions] [--flatten-structs] [--audit-columns]
                                         New tab transformed from another (lineage kept for diff/migrate)
  diff <model> <tabA> <tabB> [--format json]
                                         What changed from A to B (renames tracked through lineage)
  migrate <model> <tabA> <tabB> [--dialect D] [--out F]
                                         ALTER/CREATE/DROP DDL taking a database from A to B
  glossary [add "Term" --definition D [--synonyms a,b] | suggest <model> | link <model> | sync <model>]
                                         The shared business glossary (models/_glossary.json)
  review [--base REF] [--head REF] [--models a,b] [--format md|json] [--dialect D] [--fail-on-errors] [--out F]
                                         What changed in model files since REF (default origin/main): per tab,
                                         validation before/after, migration SQL. For pull-request comments.
  mappings <model> --target T [--source S] [--auto] [--format summary|md|csv|dbt] [--out F]
                                         Source-to-target mappings: coverage, the doc table, CSV, or dbt
                                         model SQL; --auto maps by lineage, then names
  sync <model> <source> <target> [--apply [--all] | --propose]
                                         Bring source changes into a derived tab, transformed the way it
                                         was derived (removals only with --all)

Live schemas (credentials from env or the platform CLI profile; never stored)
  pull <model> --from databricks --catalog C --schema S [--profile P]
  pull <model> --from snowflake --catalog DB --schema S        (SNOWFLAKE_ACCOUNT + SNOWFLAKE_TOKEN, or
                                                               SNOWFLAKE_USER + SNOWFLAKE_PRIVATE_KEY_PATH)
  pull <model> --from postgres [--url postgres://…] [--schema public]   (uses psql)
  pull <model> --csv result.csv[,keys.csv] --platform P [--catalog C] [--schema S]
  pull <model> --snapshot snap.json      [--name TAB] [--propose] [--save-snapshot F]
                                         First pull: a Physical tab; later pulls: a dated version tab
                                         derived from the previous one (diff/migrate show the drift)
  catalog-query --platform P [--catalog C] [--schema S]
                                         The metadata query to run yourself (then pull --csv)
  profile <model> [--tab T] [--sample N] [--entities a,b] [--warehouse ID] [--propose]
                                         Measure the tab's tables (rows, nulls, distinct values, ranges,
                                         longest string) where it was pulled from, or --from/--catalog/
                                         --schema; first 100,000 rows per table unless --sample 0.
                                         Findings show in validate (e.g. a key that repeats)
  profile <model> --query [--platform P] The statements to run yourself (then profile --csv results.csv)
  writeback <model> [--tab T] [--out F] [--no-tags] [--apply]
                                         Put the model's descriptions (and on Databricks, PII and
                                         glossary tags) into the catalog the tab was pulled from. Prints
                                         only what differs; --apply runs it. Never removes anything

Agents
  mcp [--allow-apply] [--author NAME]    MCP server on stdio (see .mcp.json); edits become proposals
  apply <model> <ops.json|-> [--apply] [--title T] [--tab T]
                                         Typed operations as a proposal (default) or applied directly
  proposals <model> [--show ID | --accept ID | --reject ID]
                                         Pending proposals

--tab TAB  selects the tab for summary, validate, docs, export, import and values (default: primary tab;
           validate checks every tab when --tab is not given).
<model> is a folder name under models/ or a path to a model .json file.`);
  }
}

main().catch((e) => fail(e?.message || String(e)));
