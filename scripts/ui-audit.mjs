// Layout audit: drives headless Chrome against the dev server (`npm run dev`), opens every dialog, view,
// panel and inspector tab at a few window sizes, and reports
//   - overflow: an element sticking out of its dialog, panel or bar (not counting scroll boxes);
//   - spill: text running out of its own element (an element squeezed narrower than its words);
//   - cramped: a text field or select too narrow to use (under 48px);
//   - collapsed: a textarea shown shorter than its rows (a class that fixes the height);
//   - sideways: a scroll box inside a dialog, panel or bar scrolling sideways (content too wide for it), other
//     than boxes meant to (code, text boxes, wide tables);
//   - page-scroll: the page itself scrolling sideways.
// Run with `npm run ui-audit` (or `npm run ui-audit -- <words>` for the states whose label contains them);
// exits 1 when it finds something. Uses a scratch copy of the demo (demo-copy.mjs).
import { launch } from './chrome.mjs';
import { makeDemoCopy } from './demo-copy.mjs';

const BASE = process.env.BASE || 'http://localhost:5180';
const SCRATCH = 'ui-audit';
const SIZES = [
  { width: 1520, height: 900 },
  { width: 1024, height: 720 },
];

/** Runs in the page: what's wrong with the layout right now. */
const CHECK = `
  const out = [];
  const name = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ' "' + text + '"' : '');
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const scrolls = (el) => /auto|scroll/.test(getComputedStyle(el).overflowX) || /auto|scroll/.test(getComputedStyle(el).overflowY);
  // Boxes their content must stay inside. The canvas is left out: entities live wherever they are dragged.
  const BOXES = '.modal, .palette, .inspector, .agent-panel, .sidebar, .topbar, .tabbar, .menu, .context-menu, .tables-side, .issues-view, .mappings-view, .glossary-view';
  const boxes = [...document.querySelectorAll(BOXES)].filter(visible);
  // Each element is checked against its nearest box only (a dialog can sit inside the top bar's markup).
  const own = (box) => [...box.querySelectorAll('*')].filter((el) => el.parentElement.closest(BOXES) === box);
  for (const box of boxes) {
    const B = box.getBoundingClientRect();
    for (const el of own(box)) {
      if (!visible(el) || el.closest('svg') || el.closest('.react-flow')) continue;
      // Inside a scroll box (other than the box itself) is fine: the box scrolls.
      let p = el.parentElement, inScroller = false;
      while (p && p !== box) { if (scrolls(p)) { inScroller = true; break; } p = p.parentElement; }
      if (inScroller) continue;
      const r = el.getBoundingClientRect();
      const over = Math.max(B.left - r.left, r.right - B.right);
      if (over > 2) out.push({ kind: 'overflow', box: name(box), el: name(el), px: Math.round(over) });
    }
  }
  // Boxes meant to scroll sideways: code, text boxes, wide tables and grids, the tab strip.
  const WIDE = 'pre, textarea, code, table, .table-wrap, .code-preview, .tabbar, .tables-doc, .values-grid, .attr-grid';
  for (const box of boxes) {
    for (const el of [box, ...own(box)]) {
      if (!visible(el) || !scrolls(el) || el.matches(WIDE) || el.closest('.react-flow')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && !/hidden|clip/.test(getComputedStyle(el).overflowX)) out.push({ kind: 'sideways', box: name(box), el: name(el), px: el.scrollWidth - el.clientWidth });
    }
  }
  for (const box of boxes) {
    for (const el of own(box)) {
      if (!visible(el) || el.closest('svg') || el.closest('.react-flow')) continue;
      const cs = getComputedStyle(el);
      if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), select') && el.getBoundingClientRect().width < 48) {
        out.push({ kind: 'cramped', box: name(box), el: name(el), px: Math.round(el.getBoundingClientRect().width) });
        continue;
      }
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
        out.push({ kind: 'spill', box: name(box), el: name(el), px: el.scrollWidth - el.clientWidth });
    }
  }
  for (const ta of document.querySelectorAll('textarea')) {
    if (!visible(ta)) continue;
    const rows = Number(ta.getAttribute('rows') || 2);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || parseFloat(getComputedStyle(ta).fontSize) * 1.4;
    if (ta.clientHeight < Math.min(rows, 3) * lh * 0.9) out.push({ kind: 'collapsed', el: name(ta), px: Math.round(ta.clientHeight) });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'page-scroll', el: 'document', px: document.documentElement.scrollWidth - innerWidth });
  // An element and its children usually overflow together: report only the outermost.
  return out.filter((o, i) => !out.slice(0, i).some((p) => p.kind === o.kind && p.box === o.box && o.el.startsWith(p.el.split(' ')[0]) && p.px >= o.px));
`;

/** UI states: [label, URL hash, page body that gets there]. Every state starts from a fresh load. */
const M = `#/model/${SCRATCH}`;
const tab = (kind) => `__click(document.querySelector('.dtab.kind-${kind}')); await __wait(600);`;
const exportKind = (kind) => `__click(__btn('Export', document.querySelector('.topbar'))); await __wait(700); __click(__btn('${kind}', document.querySelector('.export-kinds'))); await __wait(500);`;
const importDb = (platform) =>
  `__click(document.querySelector('.topbar [title="Import SQL or DBML into this model"]')); await __wait(500); __click(__btn('From a database', document.querySelector('.modal'))); await __wait(400); __select(document.querySelector('.modal select'), '${platform}'); await __wait(400);`;
const entityTab = (entity, t) => `__entity('${entity}'); await __wait(500); __click(__btn('${t}', document.querySelector('.inspector'))); await __wait(400);`;
const STATES = [
  ['home', '#/', ''],
  ['home: new model', '#/', `__click(__btn('New model')); await __wait(500);`],
  ['home: import SQL', '#/', `__click(__btn('Import SQL')); await __wait(500);`],
  ['home: design with Claude', '#/', `__click(__btn('Design with Claude')); await __wait(500);`],
  ['diagram + model properties', M, tab('logical')],
  ['entity: general', M, entityTab('Customer', 'General')],
  ['entity: attributes', M, entityTab('Customer', 'Attributes')],
  ['entity: attribute expanded', M, entityTab('Customer', 'Attributes') + `__click(document.querySelector('.inspector .attr-row button, .inspector [title^="Expand"], .inspector .chev')); await __wait(400);`],
  ['entity: structs', M, entityTab('Customer', 'Structs')],
  ['reference: values', M, entityTab('Country', 'Values')],
  ['reference: paste values', M, entityTab('Country', 'Values') + `__click(__btn('Paste', document.querySelector('.inspector'))); await __wait(500);`],
  ['entity: paste columns', M, entityTab('Customer', 'Attributes') + `__click(__btn('Paste columns', document.querySelector('.inspector'))); await __wait(500);`],
  ['relationship', M, `__click([...document.querySelectorAll('.side-item')].find((b) => b.textContent.trim().startsWith('held_by'))); await __wait(500);`],
  ['physical tab', M, tab('physical')],
  ['tables view', M, tab('logical') + `__click(__btn('Tables', document.querySelector('.tb-views'))); await __wait(800);`],
  ['mappings view', M, tab('physical') + `__click(__btn('Mappings', document.querySelector('.tb-views'))); await __wait(800);`],
  ['mappings: dbt SQL', M, tab('physical') + `__click(__btn('Mappings', document.querySelector('.tb-views'))); await __wait(800); __click(__btn('dbt model SQL')); await __wait(500);`],
  ['glossary view', M, `__click(__btn('Glossary', document.querySelector('.tb-views'))); await __wait(800);`],
  ['issues view', M, tab('physical') + `__click(__btn('Issues', document.querySelector('.tb-views'))); await __wait(800);`],
  ['export: diagram image', M, exportKind('Diagram image')],
  ['export: PDF', M, exportKind('PDF')],
  ['export: code', M, exportKind('Code')],
  ['export: model file', M, exportKind('Model file')],
  ['import: SQL', M, `__click(document.querySelector('.topbar [title="Import SQL or DBML into this model"]')); await __wait(500);`],
  ...['databricks', 'snowflake', 'postgres', 'mysql'].map((p) => [`import: database (${p})`, M, importDb(p)]),
  ['connect agent', M, `(await import('/src/ui/dialogs.ts')).useDialogs.getState().open({ agents: true }); await __wait(500);`],
  ['share', M, `__click(__btn('Share', document.querySelector('.topbar'))); await __wait(500);`],
  ['ask Claude', M, `__click(__btn('Ask Claude', document.querySelector('.topbar'))); await __wait(600);`],
  ['command palette', M, `__click(document.querySelector('.topbar [title^="Command palette"]')); await __wait(500);`],
  ['new tab', M, `__click(document.querySelector('.tabbar .dtab-add')); await __wait(500);`],
  ['tab menu', M, tab('physical') + `__click(document.querySelector('.dtab.active .dtab-menu-btn')); await __wait(400);`],
  ['compare: differences', M, `__click(document.querySelector('.tabbar [title="Compare two tabs"]')); await __wait(600);`],
  ['compare: migration SQL', M, `__click(document.querySelector('.tabbar [title="Compare two tabs"]')); await __wait(600); __click(__btn('Migration SQL', document.querySelector('.modal'))); await __wait(500);`],
  ['compare: sync', M, tab('physical') + `__click(document.querySelector('.tabbar [title="Compare two tabs"]')); await __wait(600); if (document.querySelector('.compare-pick select').value === 'physical') __click(document.querySelector('.compare-pick [title="Swap"]')); await __wait(300); __click(__btn('Sync from source', document.querySelector('.modal'))); await __wait(500);`],
  ['entity context menu', M, `const n = document.querySelector('.entity-node .en-header'); const r = n.getBoundingClientRect(); n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 })); await __wait(400);`],
];

const only = process.argv.slice(2).join(' ');
const states = only ? STATES.filter(([label]) => label.includes(only)) : STATES;

const { send, page, open, close } = await launch({ port: 9334 });
const removeCopy = await makeDemoCopy(SCRATCH);
const found = [];
const skipped = [];
try {
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
    for (const [label, hash, body] of states) {
      await open(`${BASE}/${hash}`, 1800);
      try {
        await page(`${body} return true;`);
      } catch (e) {
        skipped.push(`${label} @${size.width}: ${e.message.split('\n')[0]}`);
        continue;
      }
      for (const issue of await page(CHECK)) found.push({ state: label, size: `${size.width}×${size.height}`, ...issue });
    }
  }
} finally {
  removeCopy();
  await close();
}

for (const f of found) console.log(`${f.kind.padEnd(11)} ${f.size.padEnd(9)} ${f.state.padEnd(28)} ${f.el}${f.box ? ` in ${f.box}` : ''} (${f.px}px)`);
for (const s of skipped) console.log(`skipped     ${s}`);
console.log(`\n${found.length} finding(s) across ${states.length} states × ${SIZES.length} sizes; ${skipped.length} state(s) could not be reached.`);
process.exitCode = found.length ? 1 : 0;
