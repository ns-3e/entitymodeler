// README, install-dialog and docs-site screenshots: drives headless Chrome against the dev server
// (`npm run dev`) and writes docs/images/ (README), public/screenshots/ (the manifest's screenshots, shown
// when someone installs the app) and site/docs/images/ (entitymodel.com/docs/, light and -dark versions).
// Run with `npm run screenshots`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './chrome.mjs';
import { makeDemoCopy } from './demo-copy.mjs';

const BASE = process.env.BASE || 'http://localhost:5180';
const MODEL = 'customer-demo';
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('../docs/images/', import.meta.url);
const INSTALL_OUT = new URL('../public/screenshots/', import.meta.url);
const DOCS = new URL('../site/docs/images/', import.meta.url);
mkdirSync(DOCS, { recursive: true });
// The docs shots use a scratch copy of the demo with a derived Physical tab (see demo-copy.mjs).
const SCRATCH = 'docs-shots';
const VIEW = { width: 1520, height: 900, deviceScaleFactor: 2, mobile: false };
/** Docs images are WebP at most this many pixels wide: sharp at the article's 760px column on 2× screens. */
const DOCS_WIDTH = 1600;

const SAMPLE_SQL = `CREATE TABLE supplier (
  supplier_id BIGINT PRIMARY KEY,
  supplier_name VARCHAR(200) NOT NULL,
  country_code CHAR(2)
);

CREATE TABLE purchase_order (
  po_id BIGINT PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES supplier (supplier_id),
  ordered_on DATE NOT NULL,
  total_amount NUMERIC(12, 2)
);`;

const { send, page, open, close } = await launch();
const openModel = (model) => open(`${BASE}/#/model/${model}`);
const theme = (value) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

/**
 * Capture the page (or `clip`, in CSS pixels) to `dir`/<file>: JPEG at full device resolution, or WebP scaled
 * down to DOCS_WIDTH. With `install`, also a 1x copy of the whole page for the manifest.
 */
async function shot(file, { dir = OUT, clip, install } = {}) {
  const webp = file.endsWith('.webp');
  const area = clip ?? { x: 0, y: 0, width: VIEW.width, height: VIEW.height };
  const scale = webp ? Math.min(1, DOCS_WIDTH / (area.width * VIEW.deviceScaleFactor)) : 1;
  const { data } = await send('Page.captureScreenshot', { format: webp ? 'webp' : 'jpeg', quality: webp ? 82 : 88, ...((clip || webp) && { clip: { ...area, scale } }) });
  writeFileSync(new URL(file, dir), Buffer.from(data, 'base64'));
  console.log(`wrote ${new URL(file, dir).pathname.slice(new URL(ROOT).pathname.length)}`);
  if (!install) return;
  const whole = { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: 1 / VIEW.deviceScaleFactor };
  const small = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: whole });
  writeFileSync(new URL(install, INSTALL_OUT), Buffer.from(small.data, 'base64'));
  console.log(`wrote public/screenshots/${install}`);
}
/** The area around an element (CSS pixels), for a shot of just a dialog or panel. */
async function around(selector, pad = 24) {
  const r = await page(`const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`);
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return { x, y, width: Math.min(VIEW.width - x, r.width + 2 * pad), height: Math.min(VIEW.height - y, r.height + 2 * pad) };
}
const RIGHT = { x: VIEW.width - 1000, y: 0, width: 1000, height: VIEW.height };

let removeCopy = () => {};
try {
  await send('Emulation.setDeviceMetricsOverride', VIEW);
  await theme('light');
  await openModel(MODEL);

  // 1. The app: the Customers area framed, the Customer entity open in the inspector.
  await frameCustomer();
  await shot('app.jpg', { install: 'app.jpg' });

  // 2. Export → Code with the PostgreSQL DDL preview.
  await page(`
    __click(__btn('Export', document.querySelector('.topbar')));
    await __wait(800);
    __click(__btn('Code', document.querySelector('.export-kinds')));
    await __wait(800);
    return true;
  `);
  await shot('export-code.jpg', { install: 'export.jpg' });

  // 3. The whole diagram as exported PNG: catch the download in the page instead of saving it.
  const png = await page(`
    __click(__btn('Diagram image', document.querySelector('.export-kinds')));
    await __wait(300);
    let url = null;
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () { if (this.download) url = this.href; };
    __click(__btn('Export', document.querySelector('.modal-foot')));
    for (let i = 0; i < 100 && !url; i++) await __wait(100);
    if (!url) throw new Error('no diagram export');
    const blob = await (await fetch(url)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  `);
  writeFileSync(new URL('diagram.png', OUT), Buffer.from(png, 'base64'));
  console.log('wrote docs/images/diagram.png');

  // 4. The docs, in both themes: the docs page swaps in the -dark file when the reader is in dark mode.
  removeCopy = await makeDemoCopy(SCRATCH);
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    await docsShots(mode === 'dark' ? '-dark' : '');
  }
} finally {
  removeCopy();
  await close();
}

/** Frame the Customers area and open the Customer entity's attributes in the inspector. */
async function frameCustomer() {
  await page(`
    __click([...document.querySelectorAll('.side-item')].find((b) => b.textContent.trim().startsWith('Customers')));
    await __wait(700);
    // Fill the canvas with Customers and Geography: zoom in a little (pinch) at the area's top, then
    // scroll it up under the toolbar.
    const pane = document.querySelector('.react-flow__pane');
    const box = pane.getBoundingClientRect();
    const area = document.querySelector('.area-node').getBoundingClientRect();
    const wheel = (o) => pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: box.left + box.width / 2, ...o }));
    wheel({ clientY: area.top, deltaY: -8, ctrlKey: true });
    await __wait(300);
    const bar = document.querySelector('.canvas-toolbar').getBoundingClientRect();
    wheel({ clientY: box.top + box.height / 2, deltaY: (document.querySelector('.area-node').getBoundingClientRect().top - bar.bottom - 16) * 2 });
    await __wait(400);
    const node = [...document.querySelectorAll('.entity-node')].find((n) => n.querySelector('.en-title')?.textContent === 'Customer');
    __click(node.querySelector('.en-header'));
    await __wait(500);
    __click(__btn('Attributes', document.querySelector('.inspector')));
    await __wait(300);
    document.activeElement?.blur();
    return true;
  `);
}

/** Every docs screenshot, named <name><suffix>.webp. */
async function docsShots(suffix) {
  const docs = (name, clip) => shot(`${name}${suffix}.webp`, { dir: DOCS, clip });
  const exportCode = (dialect) => `
    __click(__btn('Export', document.querySelector('.topbar')));
    await __wait(800);
    __click(__btn('Code', document.querySelector('.export-kinds')));
    await __wait(600);
    __select(document.querySelectorAll('.modal select')[1], '${dialect}');
    await __wait(600);
    return true;
  `;

  // The editor, as in the README.
  await openModel(SCRATCH);
  await page(`__click(document.querySelector('.dtab.kind-logical')); await __wait(800); return true;`);
  await frameCustomer();
  await docs('editor');

  // Export → Code: SQL DDL for each platform.
  for (const [dialect, name] of [['postgres', 'export-sql'], ['databricks', 'export-databricks'], ['snowflake', 'export-snowflake']]) {
    await openModel(SCRATCH);
    await page(exportCode(dialect));
    await docs(name, await around('.modal'));
  }

  // A reference entity's values in the inspector.
  await openModel(SCRATCH);
  await page(`
    __entity('Country');
    await __wait(500);
    __click(__btn('Values', document.querySelector('.inspector')));
    await __wait(400);
    document.activeElement?.blur();
    return true;
  `);
  await docs('reference-values', RIGHT);

  // Import: a SQL script pasted into the import dialog, tables detected.
  await openModel(SCRATCH);
  await page(`
    __click(document.querySelector('.topbar [title="Import SQL or DBML into this model"]'));
    await __wait(600);
    __type(document.querySelector('.modal textarea'), ${JSON.stringify(SAMPLE_SQL)});
    await __wait(800);
    document.activeElement?.blur();
    return true;
  `);
  await docs('import-sql', await around('.modal'));

  // Import → From a database: the metadata query for a Databricks catalog and schema.
  await openModel(SCRATCH);
  await page(`
    __click(document.querySelector('.topbar [title="Import SQL or DBML into this model"]'));
    await __wait(600);
    __click(__btn('From a database', document.querySelector('.modal')));
    await __wait(500);
    __select(document.querySelector('.modal select'), 'databricks');
    await __wait(300);
    const [catalog, schema] = document.querySelectorAll('.modal input.mono');
    __type(catalog, 'main');
    __type(schema, 'sales');
    await __wait(500);
    document.activeElement?.blur();
    return true;
  `);
  await docs('import-database', await around('.modal'));

  // Export → PDF design document options.
  await openModel(SCRATCH);
  await page(`
    __click(__btn('Export', document.querySelector('.topbar')));
    await __wait(800);
    __click(__btn('PDF', document.querySelector('.export-kinds')));
    await __wait(600);
    return true;
  `);
  await docs('export-pdf', await around('.modal'));

  // Each top-bar view, on the tab it is about: mappings live on the target tab, and the standards are physical.
  // The app remembers the active tab, so every view picks one.
  for (const [view, name, tab] of [['Tables', 'tables-view', 'logical'], ['Mappings', 'mappings', 'physical'], ['Issues', 'issues', 'physical']]) {
    await openModel(SCRATCH);
    await page(`__click(document.querySelector('.dtab.kind-${tab}')); await __wait(800); return true;`);
    await page(`__click(__btn('${view}', document.querySelector('.tb-views'))); await __wait(1000); return true;`);
    await docs(name);
  }
  await page(`__click(document.querySelector('.dtab.kind-logical')); await __wait(800); return true;`);

  // Compare the logical and physical tabs.
  await openModel(SCRATCH);
  await page(`
    __click(document.querySelector('.tabbar [title="Compare two tabs"]'));
    await __wait(800);
    // Main (logical) on the left, Physical on the right.
    if (document.querySelector('.compare-pick select').value === 'physical') __click(document.querySelector('.compare-pick [title="Swap"]'));
    await __wait(500);
    return true;
  `);
  await docs('compare-tabs', await around('.modal'));

  // The Ask Claude panel, and the command palette.
  await openModel(SCRATCH);
  await page(`__click(__btn('Ask Claude', document.querySelector('.topbar'))); await __wait(800); return true;`);
  await docs('ask-claude', RIGHT);
  await openModel(SCRATCH);
  await page(`__click(document.querySelector('.topbar [title^="Command palette"]')); await __wait(600); return true;`);
  await docs('command-palette', await around('.palette'));
}
