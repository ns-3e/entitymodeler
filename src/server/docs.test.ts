import { describe, expect, it } from 'vitest';
import { docsFiles } from './docs';

const files = docsFiles(process.cwd());
const pages = [...files].filter(([path]) => path.endsWith('index.html')) as [string, string][];
const text = (path: string) => String(files.get(path));

describe('docs site', () => {
  it('builds pages, sitemap and llms.txt', () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(text('llms.txt')).toMatch(/^# EntityModel\.com\n\n> /);
    for (const [path] of pages) expect(text('sitemap.xml')).toContain(`https://entitymodel.com/${path.replace(/index\.html$/, '')}<`);
  });

  it.each(pages)('%s has a short title, a description, a canonical URL and valid JSON-LD', (path, html) => {
    const title = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? '';
    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThanOrEqual(65);
    expect(html).toMatch(/<meta name="description" content="[^"]{50,}"/);
    expect(html).toContain(`<link rel="canonical" href="https://entitymodel.com/${path.replace(/index\.html$/, '')}"`);
    const og = /<meta property="og:image" content="https:\/\/entitymodel\.com\/(docs\/og\/[^"]+)"/.exec(html)?.[1];
    expect(og && files.has(og), 'its own link-preview image: run `npm run og-images` with the dev server up').toBe(true);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]);
    expect(ld['@graph'].map((g: { '@type': string }) => g['@type'])).toContain('BreadcrumbList');
  });

  it.each(pages)('%s links only to pages and anchors that exist', (_path, html) => {
    for (const [, href, hash] of html.matchAll(/href="(\/[^"#]*)(?:#([^"]*))?"/g)) {
      if (href === '/') continue;
      const target = href.endsWith('/') ? `${href.slice(1)}index.html` : href.slice(1);
      expect(files.has(target) || target.startsWith('icons/') || target === 'favicon.svg', `${href} exists`).toBe(true);
      if (hash && target.endsWith('.html')) expect(text(target), `#${hash} in ${href}`).toContain(`id="${hash}"`);
    }
  });
});
