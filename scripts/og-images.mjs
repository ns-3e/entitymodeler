// Link-preview images for the docs: drives headless Chrome against the dev server (`npm run dev`),
// screenshots each page's 1200×630 card (/docs-og/<slug>) and writes site/og/*.jpg.
// Run with `npm run og-images` after adding a docs page or changing a title or description; pages without
// an image use public/og-image.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, sleep } from './chrome.mjs';

const BASE = process.env.BASE || 'http://localhost:5180';
const OUT = new URL('../site/og/', import.meta.url);
const only = process.argv.slice(2);

const { send, close } = await launch({ port: 9335 });
try {
  const cards = await (await fetch(`${BASE}/docs-og/`)).json();
  mkdirSync(OUT, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  for (const { slug, file } of cards) {
    if (only.length && !only.includes(slug)) continue;
    await send('Page.navigate', { url: `${BASE}/docs-og/${slug}` });
    await sleep(400);
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    writeFileSync(new URL(file, OUT), Buffer.from(data, 'base64'));
    console.log(`wrote site/og/${file}`);
  }
} finally {
  await close();
}
