// A scratch copy of the demo model for scripts that drive the app (screenshots, ui-audit): the demo plus a
// derived Physical tab with a few physical-only changes, mappings and physical naming standards, so tabs,
// compare, migration SQL, mappings and Issues all have something to show. models/ is git-ignored apart from
// the demo, so the copy never shows up in a commit; callers remove it with the returned function.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

const em = (...args) =>
  new Promise((ok, bad) => spawn(process.execPath, ['bin/em.mjs', ...args], { cwd: ROOT, stdio: 'ignore' }).on('exit', (c) => (c ? bad(new Error(`em ${args[0]} failed`)) : ok())));

/** Create models/<id>/ from the demo; returns a function that removes it. */
export async function makeDemoCopy(id, from = 'customer-demo') {
  const dir = new URL(`models/${id}/`, ROOT);
  const remove = () => rmSync(dir, { recursive: true, force: true });
  remove();
  mkdirSync(dir, { recursive: true });
  cpSync(new URL(`models/${from}/model.json`, ROOT), new URL('model.json', dir));
  await em('derive', id, '--kind', 'physical');
  await em('mappings', id, '--target', 'Physical', '--auto');
  const file = new URL('model.json', dir);
  const model = JSON.parse(readFileSync(file, 'utf8'));
  const physical = model.tabs.find((t) => t.id === 'physical');
  const customer = physical.entities.find((e) => e.name === 'customer');
  customer.attributes.push({ name: 'loyalty_points', type: 'INT', description: 'Points balance, refreshed nightly.' });
  customer.attributes.find((a) => a.name === 'phone').type = 'VARCHAR(40)';
  physical.entities.find((e) => e.name === 'account').attributes.push({ name: 'closed_on', type: 'DATE' });
  // Physical naming standards the derived tab doesn't meet yet, so Issues has findings to fix.
  model.standards = { physical: { attribute_case: 'upper_snake', reference_prefix: 'ref_', require_attribute_description: true } };
  writeFileSync(file, JSON.stringify(model, null, 2) + '\n');
  return remove;
}
