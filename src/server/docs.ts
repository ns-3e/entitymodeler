// Build-time documentation site: renders site/docs/**/*.md into static, JavaScript-free pages under /docs/,
// plus the files search engines and AI assistants read (sitemap.xml, llms.txt, llms-full.txt, a .md copy of
// every page). The same renderer serves them from the dev server, so `npm run dev` shows /docs/ too.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Marked, type Tokens } from 'marked';
import type { Plugin } from 'vite';
import { DIAGRAM_STYLE } from './diagram';
import { DIAGRAM_SLOT, example, type Example } from './examples';

const SITE = 'https://entitymodel.com';
/** Screenshots for the pages, served at /docs/images/ (taken by `npm run screenshots`). Set by docsFiles. */
let IMAGES = 'site/docs/images';
const REPO = 'https://github.com/ns-3e/entitymodeler';
/** Sidebar sections, in order. A page names its section in its front matter. */
const SECTIONS = ['Start here', 'Guides', 'Examples', 'Platforms', 'Compare', 'Reference', 'Learn'];
const FONTS: Record<string, string> = {
  'schibsted-grotesk-400.woff2': '@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-400-normal.woff2',
  'schibsted-grotesk-600.woff2': '@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff2',
  'dm-serif-display-400.woff2': '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2',
  'dm-serif-display-400-italic.woff2': '@fontsource/dm-serif-display/files/dm-serif-display-latin-400-italic.woff2',
  'ibm-plex-mono-400.woff2': '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
};

interface Page {
  /** '' for the docs home, otherwise e.g. 'getting-started' or 'learn/what-is-an-er-diagram'. */
  slug: string;
  /** Source path relative to the repo root, for "Edit this page". */
  source: string;
  title: string;
  /** The <title>; defaults to the page title. */
  seoTitle: string;
  description: string;
  section: string;
  order: number;
  updated: string;
  markdown: string;
  /** Pages with `model:` in their front matter show that model (see examples.ts). */
  example?: Example;
  /** The page has its own link-preview image in site/og/. */
  hasOg: boolean;
}

interface Faq {
  question: string;
  answer: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const anchor = (s: string) => stripTags(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pageUrl = (slug: string) => `/docs/${slug ? `${slug}/` : ''}`;
const mdUrl = (slug: string) => `/docs/${slug || 'index'}.md`;
/** A page's link-preview image in site/og/ (made by `npm run og-images`), e.g. examples--crm.jpg. */
const ogName = (slug: string) => `${(slug || 'index').replace(/\//g, '--')}.jpg`;

/** Last commit date of a file (YYYY-MM-DD), falling back to its modification time. */
function lastUpdated(file: string, root: string): string {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out;
  } catch {
    // not a git checkout
  }
  return statSync(file).mtime.toISOString().slice(0, 10);
}

/** `key: value` front matter between --- lines. */
function frontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { data, body: text.slice(m[0].length) };
}

function loadPages(root: string): Page[] {
  const dir = join(root, 'site/docs');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.md')) files.push(p);
    }
  };
  walk(dir);
  return files.map((file) => {
    const { data, body } = frontMatter(readFileSync(file, 'utf8'));
    const rel = relative(dir, file).replace(/\\/g, '/').replace(/\.md$/, '');
    const slug = rel.replace(/(^|\/)index$/, '');
    // `include:` pulls the body from another file (such as docs/model-format.md), dropping its own H1.
    const included = data.include ? readFileSync(join(root, data.include), 'utf8').replace(/^# .*\n+/, '') : '';
    const source = data.include || relative(root, file).replace(/\\/g, '/');
    if (!data.title || !data.description) throw new Error(`${source}: front matter needs title and description`);
    const markdown = (body.trim() + (included ? `\n\n${included.trim()}` : '')).trim() + '\n';
    const ex = data.model ? example(readFileSync(join(root, data.model), 'utf8'), markdown, slug) : undefined;
    return {
      slug,
      source,
      title: data.title,
      seoTitle: data.seo_title || data.title,
      description: data.description,
      section: data.section || 'Guides',
      order: Number(data.order ?? 100),
      updated: lastUpdated(join(root, source), root),
      markdown: ex?.markdown ?? markdown,
      example: ex,
      hasOg: existsSync(join(root, 'site/og', ogName(slug))),
    };
  });
}

/** Questions under a "Frequently asked questions" heading: each ### heading and the text after it. */
function faqs(markdown: string): Faq[] {
  const m = /^## Frequently asked questions\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown);
  if (!m) return [];
  return m[1]
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [question, ...rest] = block.split('\n');
      const answer = rest.join('\n').trim().replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*]/g, '');
      return { question: question.trim(), answer };
    })
    .filter((f) => f.answer);
}

/**
 * Pixel size of a WebP, JPEG or PNG under site/docs/images/, so the browser reserves its space before it loads.
 * A missing file fails the build, unless it is `optional` (then: undefined).
 */
function imageSize(href: string, optional = false): { width: number; height: number } | undefined {
  const m = /^\/docs\/images\/([\w.-]+)$/.exec(href);
  if (!m) return undefined;
  let b: Buffer;
  try {
    b = readFileSync(join(IMAGES, m[1]));
  } catch {
    if (optional) return undefined;
    throw new Error(`missing docs image ${href}`);
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    return undefined;
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // JPEG: walk the segments to the start-of-frame marker.
  for (let i = 2; i + 9 < b.length; ) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return undefined;
}

function render(markdown: string) {
  const toc: { id: string; text: string }[] = [];
  // The first image is often the largest thing in the first screen: load it straight away, the rest lazily.
  let images = 0;
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const html = this.parser.parseInline(tokens);
        const id = anchor(html);
        if (depth === 2) toc.push({ id, text: stripTags(html) });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`;
      },
      // A screenshot with a title becomes a captioned figure that links to the full-size image.
      // An image with a <name>-dark twin next to it switches to the twin in dark mode.
      image({ href, title, text }: Tokens.Image) {
        const size = imageSize(href);
        const dark = href.replace(/(\.\w+)$/, '-dark$1');
        const hasDark = dark !== href && imageSize(dark, true) !== undefined;
        const loading = images++ ? 'loading="lazy"' : 'fetchpriority="high"';
        let img = `<img src="${esc(href)}" alt="${esc(text)}"${size ? ` width="${size.width}" height="${size.height}"` : ''} ${loading} decoding="async" />`;
        if (hasDark) img = `<picture><source srcset="${esc(dark)}" media="(prefers-color-scheme: dark)" />${img}</picture>`;
        return title ? `<figure><a href="${esc(href)}">${img}</a><figcaption>${title}</figcaption></figure>` : img;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith(SITE);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${text}</a>`;
      },
    },
  });
  // Wide tables scroll on their own instead of widening the page.
  const html = (marked.parse(markdown, { async: false }) as string).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, toc };
}

function sorted(pages: Page[]): Page[] {
  const rank = (p: Page) => (SECTIONS.indexOf(p.section) + 1 || SECTIONS.length + 1) * 1000 + p.order;
  return [...pages].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

function jsonLd(page: Page, faq: Faq[]): string {
  const url = SITE + pageUrl(page.slug);
  const crumbs = [
    { name: 'EntityModel.com', url: `${SITE}/` },
    { name: 'Docs', url: `${SITE}/docs/` },
    ...(page.slug ? [{ name: page.title, url }] : []),
  ];
  const graph: object[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
    },
    {
      '@type': 'TechArticle',
      headline: page.title,
      description: page.description,
      url,
      dateModified: page.updated,
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'EntityModel.com', url: `${SITE}/` },
      about: { '@id': `${SITE}/#app` },
      publisher: { '@type': 'Organization', name: 'EntityModel.com', url: `${SITE}/`, logo: `${SITE}/icons/icon-512.png` },
    },
  ];
  if (!page.slug) graph.push(softwareApplication());
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

/** The product, described for search engines. index.html carries the same object. */
export function softwareApplication() {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE}/#app`,
    name: 'EntityModel.com',
    url: `${SITE}/`,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Data modeling tool',
    operatingSystem: 'Any (web browser)',
    description:
      'Free, open-source, browser-based entity-relationship data modeling tool: ERD diagrams, conceptual, logical and physical models, SQL DDL for PostgreSQL, MySQL, Snowflake and Databricks, DBML, Mermaid, dbt, data contracts and PDF design documents.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    codeRepository: REPO,
    image: `${SITE}/og-image.png`,
    screenshot: `${SITE}/og-image.png`,
  };
}

const LOGO = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect class="mark" width="32" height="32" rx="3"/><rect class="paper" x="6.5" y="7.5" width="11" height="7.5"/><rect x="14.5" y="17.5" width="11" height="7.5" fill="#f2a67c"/><path class="wire" d="M12 15v6.2h2.5" stroke-width="1.5" stroke-linecap="square" fill="none"/></svg>`;

function nav(pages: Page[], current: Page): string {
  return SECTIONS.map((section) => {
    const items = pages.filter((p) => p.section === section);
    if (!items.length) return '';
    const links = items
      .map((p) => `<li><a href="${pageUrl(p.slug)}"${p === current ? ' aria-current="page"' : ''}>${esc(p.slug ? p.title : 'Overview')}</a></li>`)
      .join('');
    return `<h2>${esc(section)}</h2><ul>${links}</ul>`;
  }).join('');
}

function pageHtml(page: Page, pages: Page[]): string {
  const { html: rendered, toc } = render(page.markdown);
  const html = page.example ? rendered.replace(DIAGRAM_SLOT, page.example.figure) : rendered;
  const faq = faqs(page.markdown);
  const i = pages.indexOf(page);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const url = SITE + pageUrl(page.slug);
  // Search results cut titles at about 60 characters: add the brand only when it fits.
  const branded = `${page.seoTitle} · EntityModel.com`;
  const title = page.slug && branded.length <= 65 ? branded : page.seoTitle;
  // Pages that open with their own summary paragraph don't repeat the description above it.
  const lede = page.markdown.startsWith('#') ? `<p class="lede">${esc(page.description)}</p>\n` : '';
  const tocHtml = toc.length > 2 ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${url}" />
<link rel="alternate" type="text/markdown" href="${SITE}${mdUrl(page.slug)}" title="This page as Markdown" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="stylesheet" href="/docs/docs.css" />
<link rel="preload" href="/docs/fonts/schibsted-grotesk-400.woff2" as="font" type="font/woff2" crossorigin />
<meta name="theme-color" content="#f4f3f0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#17181a" media="(prefers-color-scheme: dark)" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="EntityModel.com" />
<meta property="og:title" content="${esc(page.seoTitle)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SITE}${page.hasOg ? `/docs/og/${ogName(page.slug)}` : '/og-image.png'}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="article:modified_time" content="${page.updated}" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${jsonLd(page, faq)}</script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
  <a class="brand" href="/docs/">${LOGO}<span>EntityModel<em>.com</em></span><span class="tag">Docs</span></a>
  <nav aria-label="Site"><a href="${REPO}" rel="noopener">GitHub</a><a class="cta" href="/">Open the app</a></nav>
</header>
<div class="layout">
  <nav class="sidebar" aria-label="Documentation">${nav(pages, page)}</nav>
  <main id="content">
    <details class="mobile-nav"><summary>Contents</summary>${nav(pages, page)}</details>
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">EntityModel.com</a> / <a href="/docs/">Docs</a>${page.slug ? ` / <span>${esc(page.section)}</span>` : ''}</nav>
    <article>
      <h1>${esc(page.title)}</h1>
      ${lede}${html}
    </article>
    <nav class="pager" aria-label="Previous and next">${prev ? `<a class="prev" href="${pageUrl(prev.slug)}"><small>Previous</small>${esc(prev.slug ? prev.title : 'Overview')}</a>` : '<span></span>'}${next ? `<a class="next" href="${pageUrl(next.slug)}"><small>Next</small>${esc(next.title)}</a>` : ''}</nav>
    <footer class="foot">
      <p>Updated <time datetime="${page.updated}">${page.updated}</time> · <a href="${REPO}/blob/main/${page.source}" rel="noopener">Edit this page on GitHub</a> · <a href="${mdUrl(page.slug)}">Markdown</a></p>
      <p>© ${new Date().getFullYear()} <a href="https://advsys.io" rel="noopener">Smith Advanced Systems LLC</a>. EntityModel.com is free and open source under the MIT license.</p>
    </footer>
  </main>
  ${tocHtml}
</div>
</body>
</html>
`;
}

/** The page as Markdown, with its title and canonical URL, for /docs/<slug>.md and llms-full.txt. */
function pageMarkdown(page: Page): string {
  return `# ${page.title}\n\n> ${page.description}\n\nSource: ${SITE}${pageUrl(page.slug)}\n\n${page.markdown}`;
}

function llmsTxt(pages: Page[]): string {
  const lines = [
    '# EntityModel.com',
    '',
    '> EntityModel.com is a free, open-source (MIT) entity-relationship data modeling tool that runs in the browser at https://entitymodel.com with no account or install. It draws ER diagrams (crow\'s foot notation), keeps conceptual, logical and physical models as tabs of one model, imports SQL DDL, DBML and live database schemas, and exports SQL DDL (PostgreSQL, MySQL/MariaDB, Snowflake, Databricks), DBML, Mermaid, dbt schema.yml, ODCS data contracts, JSON Schema, Avro, PNG/SVG diagrams and PDF design documents.',
    '',
    `Models are single JSON files that also work with a zero-dependency CLI and an MCP server for AI agents such as Claude. Source code: ${REPO}`,
  ];
  for (const section of SECTIONS) {
    const items = pages.filter((p) => p.section === section);
    if (!items.length) continue;
    lines.push('', `## ${section}`, '');
    for (const p of items) lines.push(`- [${p.slug ? p.title : 'Documentation overview'}](${SITE}${mdUrl(p.slug)}): ${p.description}`);
  }
  lines.push('', '## Optional', '', `- [Full documentation in one file](${SITE}/llms-full.txt): every page above, concatenated`, `- [Source code and README](${REPO})`);
  return lines.join('\n') + '\n';
}

function sitemap(pages: Page[]): string {
  const newest = pages.map((p) => p.updated).sort().at(-1);
  const urls = [{ loc: `${SITE}/`, lastmod: newest }, ...pages.map((p) => ({ loc: SITE + pageUrl(p.slug), lastmod: p.updated }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/** Every generated file, keyed by its path in dist/ (no leading slash). */
export function docsFiles(root: string): Map<string, string | Buffer> {
  IMAGES = join(root, 'site/docs/images');
  const pages = sorted(loadPages(root));
  const files = new Map<string, string | Buffer>();
  for (const name of readdirSync(IMAGES)) if (/\.(webp|jpe?g|png)$/.test(name)) files.set(`docs/images/${name}`, readFileSync(join(IMAGES, name)));
  for (const page of pages) {
    files.set(`docs/${page.slug ? `${page.slug}/` : ''}index.html`, pageHtml(page, pages));
    files.set(mdUrl(page.slug).slice(1), pageMarkdown(page));
    if (page.hasOg) files.set(`docs/og/${ogName(page.slug)}`, readFileSync(join(root, 'site/og', ogName(page.slug))));
    if (page.example) {
      files.set(`docs/${page.slug}/model.json`, page.example.json);
      files.set(`docs/${page.slug}/diagram.svg`, page.example.svg);
    }
  }
  files.set('docs/docs.css', readFileSync(join(root, 'site/docs.css'), 'utf8') + DIAGRAM_STYLE);
  for (const [name, from] of Object.entries(FONTS)) files.set(`docs/fonts/${name}`, readFileSync(join(root, 'node_modules', from)));
  files.set('llms.txt', llmsTxt(pages));
  files.set('llms-full.txt', [llmsTxt(pages), ...pages.map(pageMarkdown)].join('\n\n---\n\n'));
  files.set('sitemap.xml', sitemap(pages));
  return files;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/**
 * A 1200×630 link-preview card for a page, served by the dev server at /docs-og/<slug> for
 * scripts/og-images.mjs to screenshot. /docs-og/ lists the slugs and file names.
 */
function ogCard(page: Page): string {
  const where = `entitymodel.com${pageUrl(page.slug)}`;
  const diagram = page.example ? `<div class="diagram">${page.example.figure.match(/<svg[\s\S]*<\/svg>/)![0]}</div>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><link rel="stylesheet" href="/docs/docs.css" />
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: var(--canvas); }
  .card { position: relative; box-sizing: border-box; width: 1200px; height: 630px; padding: 60px 72px 56px; display: flex; flex-direction: column; justify-content: space-between; border-bottom: 12px solid var(--accent); }
  .head { display: flex; align-items: center; gap: 16px; font: 400 32px/1 var(--display); color: var(--ink); }
  .head svg { width: 48px; height: 48px; }
  .head .mark { fill: var(--ink); } .head .paper { fill: var(--canvas); } .head .wire { stroke: var(--canvas); }
  .tag { margin-left: 8px; font: 600 15px/1 var(--font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); border: 1.5px solid var(--line-strong); padding: 7px 10px; }
  .body { max-width: ${page.example ? 620 : 1000}px; }
  h1 { margin: 0 0 20px; font: 400 ${page.title.length > (page.example ? 22 : 40) ? (page.example ? 54 : 60) : 72}px/1.06 var(--display); letter-spacing: -0.015em; color: var(--ink);
       display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  p { margin: 0; font: 400 25px/1.45 var(--font); color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .foot { display: flex; justify-content: space-between; font: 400 21px/1 var(--mono); color: var(--ink-3); }
  .foot b { font: 600 21px/1 var(--font); color: var(--ink-2); }
  .diagram { position: absolute; top: 140px; right: -40px; width: 560px; height: 350px; overflow: hidden; border: 1.5px solid var(--line-strong); background: var(--surface); box-shadow: 6px 6px 0 0 var(--ink); }
  .diagram svg { width: 100%; height: 100%; }
</style></head>
<body><div class="card">
  <div class="head">${LOGO.replace(' width="28" height="28"', '')}<span>EntityModel<em>.com</em></span><span class="tag">${esc(page.slug ? page.section : 'Docs')}</span></div>
  <div class="body"><h1>${esc(page.title)}</h1><p>${esc(page.description)}</p></div>
  <div class="foot"><span>${esc(where)}</span><b>Free · open source</b></div>
  ${diagram}
</div></body></html>
`;
}

export function docsSite(root: string): Plugin {
  return {
    name: 'em-docs-site',
    configureServer(server) {
      server.watcher.add(join(root, 'site'));
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = decodeURIComponent((req.url ?? '').split(/[?#]/)[0]);
        if (path.startsWith('/docs-og/')) {
          const pages = loadPages(root);
          const slug = path.slice('/docs-og/'.length).replace(/\/$/, '');
          if (!slug) return void res.writeHead(200, { 'Content-Type': TYPES.json }).end(JSON.stringify(pages.map((p) => ({ slug: p.slug || 'index', file: ogName(p.slug) }))));
          const page = pages.find((p) => (p.slug || 'index') === slug);
          return page ? void res.writeHead(200, { 'Content-Type': TYPES.html }).end(ogCard(page)) : next();
        }
        if (!/^\/(docs(\/|$)|llms(-full)?\.txt$|sitemap\.xml$)/.test(path)) return next();
        if (path.startsWith('/docs') && !/\.[a-z0-9]+$/.test(path) && !path.endsWith('/')) {
          res.writeHead(301, { Location: `${path}/` }).end();
          return;
        }
        const key = (path.endsWith('/') ? `${path}index.html` : path).slice(1);
        const body = docsFiles(root).get(key);
        if (body === undefined) return next();
        res.writeHead(200, { 'Content-Type': TYPES[key.split('.').pop()!] ?? 'application/octet-stream' }).end(body);
      });
    },
    generateBundle() {
      for (const [fileName, source] of docsFiles(root)) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
