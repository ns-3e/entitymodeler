// Performance check for large models: `npm run bench`. Generates synthetic physical models and times the
// core work the app does on load and on every edit. Budgets are what keeps the UI responsive at 2,000 tables.
import { produce } from 'immer';
import { autoLayout } from '../src/ui/canvas/layout';
import { STANDARD_PRESETS, addTab, applyFixes, autoMap, checkStandards, deriveTab, diffTabs, migrationSql, normalizeModel, serializeModel, syncPlan, tabView, toDbt, toSql, validateModel, validateTabs, withTab, MAIN_TAB, type DataModel } from '../src/core/index';

function synth(n: number): DataModel {
  const entities: any[] = [];
  const relationships: any[] = [];
  for (let i = 0; i < n; i++) {
    const name = `tbl_entity_${i}`;
    const attributes: any[] = [{ name: `ent_${i}_id`, label: 'ID', type: 'BIGINT', is_primary_key: true }, { name: `ent_${i}_nm`, label: 'Name', type: 'STRING', is_label: true }];
    for (let j = 0; j < 10; j++) attributes.push({ name: `col_${j}_amt`, label: `Col ${j}`, type: j % 2 ? 'DOUBLE' : 'STRING', description: j % 3 ? '' : 'Some column.' });
    attributes.push({ name: 'created_at', label: 'Created', type: 'TIMESTAMP' });
    if (i > 0) {
      const p = (i * 7919) % i;
      attributes.push({ name: `ent_${p}_id`, label: 'Parent', type: 'BIGINT' });
      relationships.push({ name: `r_${i}`, source: name, target: `tbl_entity_${p}`, cardinality: 'N:1', forward_label: 'Belongs To', reverse_label: 'Has', bidirectional: true, foreign_key: `ent_${p}_id`, attributes: [] });
    }
    entities.push({ name, display_name: `Entity ${i}`, entity_type: 'standard', color_code: '#2563EB', attributes, ui: { x: (i % 40) * 360, y: Math.floor(i / 40) * 420 } });
  }
  return normalizeModel({ format: 'entitymodeler', format_version: 1, name: 'bench', title: 'Bench', entities, relationships, hierarchies: [], areas: [], notes: [] });
}

function time(fn: () => unknown, runs = 5): number {
  fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

/** What every edit costs in the app: an immer update on the active tab, then validation of the result. */
function editCycle(doc: DataModel) {
  let d = doc;
  return () => {
    d = produce(d, (x) => withTab(x as DataModel, MAIN_TAB, (v) => void (v.entities[3].description = `${Math.random()}`)));
    validateTabs(d);
    validateModel(tabView(d));
  };
}

const BUDGET_EDIT_MS = 16; // one frame at 2,000 tables
let fail = false;
for (const n of process.argv.includes('--quick') ? [500, 2000] : [500, 2000, 5000]) {
  const doc = synth(n);
  const withLogical = (() => {
    const d = synth(n);
    addTab(d, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(d), 'logical').content);
    return d;
  })();
  const rows = {
    validate: time(() => validateModel(doc)),
    edit: time(editCycle(doc), 15),
    serialize: time(() => serializeModel(doc)),
    derive: time(() => deriveTab(tabView(doc), 'logical'), 3),
    diff: time(() => diffTabs(withLogical, MAIN_TAB, 'logical'), 3),
    sql: time(() => toSql(doc, { dialect: 'postgres' }), 3),
    dbt: time(() => toDbt(doc), 3),
    migrate: time(() => migrationSql(withLogical, MAIN_TAB, 'logical', 'postgres'), 1),
    sync: time(() => syncPlan(withLogical, MAIN_TAB, 'logical'), 1),
    automap: time(() => autoMap(withLogical, MAIN_TAB, 'logical'), 1),
    standards: time(() => checkStandards({ ...doc, standards: { logical: STANDARD_PRESETS.logical } }), 3),
    fixes: time(() => {
      const d = { ...structuredClone(doc), standards: { logical: STANDARD_PRESETS.logical } };
      applyFixes(d, checkStandards(d), MAIN_TAB);
    }, 1),
    layout: n <= 2000 ? time(() => autoLayout(doc, 'full'), 1) : NaN,
  };
  const fmt = (x: number) => (Number.isNaN(x) ? '   —' : x.toFixed(1).padStart(7));
  console.log(`${String(n).padStart(5)} entities  ${Object.entries(rows).map(([k, v]) => `${k} ${fmt(v)}ms`).join('  ')}  (${(serializeModel(doc).length / 1e6).toFixed(1)} MB)`);
  if (n === 2000 && rows.edit > BUDGET_EDIT_MS) {
    console.log(`  over budget: an edit at 2,000 entities takes ${rows.edit.toFixed(1)} ms (budget ${BUDGET_EDIT_MS} ms)`);
    fail = true;
  }
}
if (fail && process.argv.includes('--strict')) process.exit(1);
