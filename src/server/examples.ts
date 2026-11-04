// Example model pages for the docs site: a page whose front matter names a `model:` file gets its diagram,
// data dictionary, reference values, PostgreSQL DDL and Mermaid source generated from that model.
import { deflateRawSync } from 'node:zlib';
import { SHARE_PREFIX, buildDocTables, normalizeModel, toMermaid, toSql, type DataModel, type DocTable } from '../core';
import { diagramSvg, standaloneSvg } from './diagram';

/** Where the generated sections go in the page's Markdown; appended at the end when the page has none. */
const SLOT = '<!-- example -->';
/** Replaced by the inline SVG in the HTML page (the Markdown copy keeps the comment). */
export const DIAGRAM_SLOT = '<!-- diagram -->';

export interface Example {
  model: DataModel;
  /** The page's Markdown with the generated sections in place. */
  markdown: string;
  /** The diagram figure, for DIAGRAM_SLOT. */
  figure: string;
  /** The full-size diagram file. */
  svg: string;
  json: string;
}

/**
 * The same "#/share/v1.…" fragment as encodeShareFragment in core, built with zlib so it runs synchronously
 * and on Node versions without CompressionStream("deflate-raw").
 */
function shareUrl(m: DataModel): string {
  const data = deflateRawSync(Buffer.from(JSON.stringify(m))).toString('base64url');
  return `https://entitymodel.com/${SHARE_PREFIX}v1.${data}`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function table(t: DocTable, drop: string[] = []): string {
  const keep = t.columns.map((c, i) => (drop.includes(c) ? -1 : i)).filter((i) => i >= 0);
  const head = `| ${keep.map((i) => t.columns[i]).join(' | ')} |\n| ${keep.map(() => '---').join(' | ')} |`;
  return `${head}\n${t.rows.map((r) => `| ${keep.map((i) => cell(r[i] ?? '')).join(' | ')} |`).join('\n')}`;
}

export function example(text: string, pageMarkdown: string, slug: string): Example {
  const model = normalizeModel(JSON.parse(text));
  const tables = buildDocTables(model, { sections: ['overview', 'attributes', 'relationships', 'refvalues'] });
  const of = (section: string) => tables.filter((t) => t.section === section);
  const counts = `${model.entities.filter((e) => e.entity_type !== 'reference').length} entities, ${model.entities.filter((e) => e.entity_type === 'reference').length} reference lists and ${model.relationships.length} relationships`;
  const sections = [
    `## Diagram`,
    `${model.title}: ${counts}. Each box is an entity with its attributes (PK marks the primary key); solid lines are relationships in crow's foot notation, dashed lines point to reference lists.`,
    DIAGRAM_SLOT,
    `**[Open this model in EntityModel.com](${shareUrl(model)})** to explore it, change it and export it. Nothing is uploaded: the model travels in the link. Or [download model.json](/docs/${slug}/model.json).`,
    `## Entities`,
    table(of('overview')[0], ['Internal Name']),
    `## Attributes`,
    ...of('attributes').flatMap((t) => [`### ${t.title.replace(/ attribute dictionary$/, '')}`, t.caption || '', table(t, ['#', 'Label'])]),
    `## Relationships`,
    table(of('relationships')[0]),
    ...(of('refvalues').length ? [`## Reference data`, ...of('refvalues').flatMap((t) => [`### ${t.title.replace(/ values$/, '')}`, t.caption || '', table(t)])] : []),
    `## SQL DDL (PostgreSQL)`,
    `Generated from the model. In the app, Export → Code also writes MySQL, Snowflake and Databricks DDL, DBML, dbt \`schema.yml\` and data contracts.`,
    '```sql\n' + toSql(model, { dialect: 'postgres', now: new Date(model.updated_at) }).trim() + '\n```',
    `## Mermaid`,
    `Paste into a \`mermaid\` code block on GitHub, GitLab or Notion to show the diagram there.`,
    '```mermaid\n' + toMermaid(model).trim() + '\n```',
  ].filter(Boolean);
  const generated = sections.join('\n\n');
  const markdown = pageMarkdown.includes(SLOT) ? pageMarkdown.replace(SLOT, generated) : `${pageMarkdown.trim()}\n\n${generated}\n`;
  const svg = diagramSvg(model, `Entity-relationship diagram: ${model.title}`);
  const full = `/docs/${slug}/diagram.svg`;
  const figure = `<figure class="erd"><a href="${full}" title="Open the full-size diagram">${svg}</a><figcaption><a href="${full}">Open the full-size diagram</a> (SVG)</figcaption></figure>`;
  return { model, markdown, figure, svg: standaloneSvg(svg), json: text };
}
