// Design-doc tables. One generator feeds the UI Tables view, clipboard copy (HTML + text),
// Markdown/HTML downloads, the PDF and the CLI.
import { primaryKey, referenceUsages, resolveForeignKey, relationshipEnds, typeDisplay, labelAttribute } from './model';
import { columnValues, valueColumns } from './csv';
import { SOURCE_URL, type DataModel, type Entity } from './types';
import { endLabel, viewMappings } from './mappings';
import { termOf } from './glossary';

export interface DocTable {
  id: string;
  section: DocSectionId;
  title: string;
  caption?: string;
  /** Entity this table belongs to, if any (used for scoping). */
  entity?: string;
  columns: string[];
  rows: string[][];
  /** Relative column widths (optional). */
  widths?: number[];
}

export type DocSectionId =
  | 'overview'
  | 'attributes'
  | 'reference'
  | 'refvalues'
  | 'relationships'
  | 'hierarchies'
  | 'mappings'
  | 'glossary';

export const DOC_SECTIONS: { id: DocSectionId; title: string; description: string }[] = [
  { id: 'overview', title: 'Entity catalog', description: 'One row per entity: type, purpose, keys' },
  { id: 'attributes', title: 'Attribute dictionary', description: 'Per entity: every attribute' },
  { id: 'reference', title: 'Reference data', description: 'Reference lists, dependencies and where they are used' },
  { id: 'refvalues', title: 'Reference values', description: 'Per reference entity: the full list of values' },
  { id: 'relationships', title: 'Relationships', description: 'Typed connections between entities' },
  { id: 'hierarchies', title: 'Hierarchies', description: 'Levels and branches built from relationships' },
  { id: 'mappings', title: 'Source-to-target mappings', description: 'Per entity: where each attribute comes from, and how' },
  { id: 'glossary', title: 'Business glossary', description: 'The business terms this model uses, and where' },
];

export interface DocOptions {
  sections?: DocSectionId[];
  /** Restrict per-entity tables to these entities. */
  entities?: string[];
}

const typeName = (e: Entity) => (e.entity_type === 'reference' ? 'Reference' : 'Entity');

export function buildDocTables(m: DataModel, opts: DocOptions = {}): DocTable[] {
  const sections = new Set(opts.sections || DOC_SECTIONS.map((s) => s.id));
  const scope = (e: Entity) => !opts.entities || opts.entities.includes(e.name);
  const ordered = orderForDocs(m).filter(scope);
  const tables: DocTable[] = [];

  if (sections.has('overview')) {
    tables.push({
      id: 'overview',
      section: 'overview',
      title: 'Entity catalog',
      columns: ['Entity', 'Internal Name', 'Type', 'Description', 'Primary Key', 'Display Attribute', 'Attributes'],
      widths: [13, 13, 8, 28, 15, 15, 8],
      rows: ordered.map((e) => [e.display_name, e.name, typeName(e), e.description || '', primaryKey(e)?.name || '', labelAttribute(e)?.name || '', String(e.attributes.length)]),
    });
  }

  const entityByName = new Map(m.entities.map((x) => [x.name, x]));
  /** Example for an attribute: its own example, else the first values of the reference list it resolves to. */
  const exampleOf = (ex?: string, ref?: { entity: string; output_attribute: string }) => {
    if (ex) return ex;
    if (!ref) return '';
    const vals = columnValues(entityByName.get(ref.entity), ref.output_attribute);
    return vals.length ? vals.slice(0, 3).join(' · ') + (vals.length > 3 ? ' · …' : '') : '';
  };

  for (const e of ordered) {
    if (sections.has('attributes')) {
      const rows: string[][] = [];
      e.attributes.forEach((a, i) => {
        let refInfo = '';
        if (a.type === 'REFERENCE_ENTITY' && a.reference) refInfo = `→ ${a.reference.entity}.${a.reference.output_attribute}`;
        rows.push([
          String(i + 1),
          a.name,
          a.label,
          typeDisplay(a),
          [a.is_primary_key ? 'PK' : '', a.is_label ? 'Label' : '', a.required ? 'Required' : '', a.pii ? 'PII' : ''].filter(Boolean).join(', '),
          refInfo,
          exampleOf(a.example, a.type === 'REFERENCE_ENTITY' ? a.reference : undefined),
          // A blank description borrows the linked glossary term's definition.
          a.description || (termOf(m, a.term) ? `${termOf(m, a.term)!.name}: ${termOf(m, a.term)!.definition}` : ''),
        ]);
        if (a.type === 'STRUCT') {
          const st = e.struct_types?.find((s) => s.name === a.struct_type);
          for (const f of st?.fields || [])
            rows.push([
              '',
              `   ${a.name}.${f.name}`,
              f.label || '',
              f.type === 'REFERENCE_ENTITY' ? 'REFERENCE' : f.type,
              '',
              f.reference ? `→ ${f.reference.entity}.${f.reference.output_attribute}` : '',
              exampleOf(undefined, f.reference),
              f.description || '',
            ]);
        }
      });
      if (e.dependent_reference)
        rows.push(['', e.dependent_reference.linked_column, 'Parent reference (linked column)', 'STRING', 'Parent Ref', `→ ${e.dependent_reference.parent}`, '', 'Added automatically by Dependent Reference']);
      // Drop the Example column when nothing has one
      const hasExample = rows.some((r) => r[6]);
      if (!hasExample) rows.forEach((r) => r.splice(6, 1));
      tables.push({
        id: `attributes:${e.name}`,
        section: 'attributes',
        entity: e.name,
        title: `${e.display_name} attribute dictionary`,
        caption: e.description,
        columns: hasExample ? ['#', 'Attribute', 'Label', 'Data Type', 'Flags', 'Reference', 'Example', 'Description'] : ['#', 'Attribute', 'Label', 'Data Type', 'Flags', 'Reference', 'Description'],
        widths: hasExample ? [4, 17, 14, 12, 9, 16, 12, 16] : [4, 18, 16, 14, 10, 18, 20],
        rows,
      });
    }
  }

  if (sections.has('reference')) {
    const refs = ordered.filter((e) => e.entity_type === 'reference');
    if (refs.length)
      tables.push({
        id: 'reference',
        section: 'reference',
        title: 'Reference data',
        columns: ['Reference Entity', 'Primary Key', 'Attributes', 'Depends On', 'Values', 'Used By'],
        widths: [16, 12, 22, 15, 8, 27],
        rows: refs.map((e) => [
          e.display_name,
          primaryKey(e)?.name || '',
          e.attributes.map((a) => a.name).join(', '),
          e.dependent_reference ? `${e.dependent_reference.parent} via ${e.dependent_reference.linked_column}` : '',
          e.reference_values?.length ? String(e.reference_values.length) : '',
          referenceUsages(m, e.name)
            .map((u) => `${u.entity}.${u.attribute} (${u.output})`)
            .join(', '),
        ]),
      });
  }

  if (sections.has('refvalues'))
    for (const e of ordered.filter((x) => x.entity_type === 'reference' && x.reference_values?.length)) {
      const cols = valueColumns(e);
      tables.push({
        id: `refvalues:${e.name}`,
        section: 'refvalues',
        entity: e.name,
        title: `${e.display_name} values`,
        caption: [`${e.reference_values!.length} values`, e.reference_values_source && `Source: ${e.reference_values_source}`, e.dependent_reference && `${e.dependent_reference.linked_column} → ${e.dependent_reference.parent}`]
          .filter(Boolean)
          .join(' · '),
        columns: cols,
        rows: e.reference_values!.map((v) => cols.map((c) => v[c] ?? '')),
      });
    }

  if (sections.has('relationships') && m.relationships.length) {
    const ent = (n: string) => m.entities.find((e) => e.name === n)?.display_name || n;
    const rels = m.relationships.filter((r) => !opts.entities || opts.entities.includes(r.source) || opts.entities.includes(r.target));
    tables.push({
      id: 'relationships',
      section: 'relationships',
      title: 'Relationships',
      columns: ['Relationship', 'Source', 'Target', 'Cardinality', 'Forward Label', 'Reverse Label', 'Key', 'Attributes', 'Description'],
      rows: rels.map((r) => [
          r.name,
          ent(r.source),
          ent(r.target),
          r.cardinality,
          r.forward_label,
          r.bidirectional ? r.reverse_label || '' : '',
          relationshipEnds(r) ? (resolveForeignKey(m, r) ? `${relationshipEnds(r)!.child}.${resolveForeignKey(m, r)}` : '') : 'junction table',
          (r.attributes || []).map((a) => a.name).join(', '),
          r.description || '',
        ]),
    });
    // The relationships' own attributes, like an attribute dictionary: where each one is stored, its type, its meaning.
    const withAttrs = rels.filter((r) => r.attributes?.length);
    if (withAttrs.length)
      tables.push({
        id: 'relationship-attributes',
        section: 'relationships',
        title: 'Relationship attributes',
        caption: 'Facts about a link itself. They are stored on the junction table (N:N) or on the child entity.',
        columns: ['Relationship', 'Attribute', 'Type', 'Required', 'Stored on', 'Description'],
        rows: withAttrs.flatMap((r) =>
          r.attributes!.map((a) => [r.name, a.name, typeDisplay(a), a.required ? 'Yes' : '', relationshipEnds(r) ? ent(relationshipEnds(r)!.child) : 'junction table', a.description || '']),
        ),
      });
  }

  if (sections.has('hierarchies'))
    for (const h of m.hierarchies) {
      const rows: string[][] = [['1', h.root_branch_name || 'Root', h.root, '', '', '']];
      for (const l of [...h.levels].sort((a, b) => a.level - b.level))
        for (const b of l.branches) rows.push([String(l.level), b.name, b.entity, b.relationship, b.direction, b.parent_branch]);
      tables.push({
        id: `hierarchy:${h.name}`,
        section: 'hierarchies',
        title: `${h.display_name} hierarchy`,
        caption: [h.description, `Status: ${h.status}`, h.max_depth ? `Max depth ${h.max_depth}` : ''].filter(Boolean).join(' · '),
        columns: ['Level', 'Branch', 'Entity', 'Relationship', 'Direction', 'Parent Branch'],
        rows,
      });
    }

  if (sections.has('glossary') && m.glossary_snapshot?.length) {
    const usedBy = new Map<string, string[]>();
    for (const e of ordered) {
      if (e.term) usedBy.set(e.term, [...(usedBy.get(e.term) || []), e.name]);
      for (const a of e.attributes) if (a.term) usedBy.set(a.term, [...(usedBy.get(a.term) || []), `${e.name}.${a.name}`]);
    }
    const rows = m.glossary_snapshot.filter((t) => usedBy.has(t.id)).map((t) => [t.name, t.definition, (t.synonyms || []).join(', '), t.status || 'draft', (usedBy.get(t.id) || []).join(', ')]);
    if (rows.length) tables.push({ id: 'glossary', section: 'glossary', title: 'Business glossary', columns: ['Term', 'Definition', 'Synonyms', 'Status', 'Used by'], widths: [16, 36, 14, 10, 24], rows });
  }
  if (sections.has('mappings')) {
    const maps = viewMappings(m);
    for (const e of ordered) {
      const mine = maps.filter((x) => x.target.entity === e.name);
      if (!mine.length) continue;
      const byAttr = new Map(mine.map((x) => [x.target.attribute, x]));
      tables.push({
        id: `mappings-${e.name}`,
        section: 'mappings',
        entity: e.name,
        title: `${e.display_name} — source mappings`,
        columns: ['Attribute', 'Source', 'Transform', 'Status', 'Notes'],
        widths: [20, 26, 26, 10, 18],
        rows: e.attributes.map((a) => {
          const x = byAttr.get(a.name);
          return [a.name, x ? x.sources.map(endLabel).join(' + ') || '(derived)' : '—', x?.transform || (x ? 'direct' : ''), x?.status || (x ? 'draft' : 'unmapped'), x?.notes || ''];
        }),
      });
    }
  }
  return tables;
}

/** Entities first, then references — alphabetical inside, so docs read naturally. */
function orderForDocs(m: DataModel): Entity[] {
  const rank = { standard: 0, reference: 1 } as const;
  return [...m.entities].sort((a, b) => rank[a.entity_type] - rank[b.entity_type] || a.display_name.localeCompare(b.display_name));
}

// ---------- renderers ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

export function tableToMarkdown(t: DocTable): string {
  const lines = [`### ${t.title}`, ''];
  if (t.caption) lines.push(`_${t.caption}_`, '');
  lines.push(`| ${t.columns.map(mdCell).join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`);
  for (const r of t.rows) lines.push(`| ${r.map((c) => mdCell(c || '')).join(' | ')} |`);
  return lines.join('\n') + '\n';
}

export function tablesToMarkdown(m: DataModel, tables: DocTable[]): string {
  const out = [`# ${m.title} data model`, ''];
  const meta = [m.organization && `Organization: ${m.organization}`, m.version && `Version: ${m.version}`, m.author && `Author: ${m.author}`, `Generated: ${new Date().toISOString().slice(0, 10)}`].filter(Boolean);
  out.push(meta.join(' · '), '');
  if (m.description) out.push(m.description, '');
  let section = '';
  for (const t of tables) {
    if (t.section !== section) {
      section = t.section;
      out.push(`## ${DOC_SECTIONS.find((s) => s.id === section)?.title}`, '');
    }
    out.push(tableToMarkdown(t));
  }
  out.push('---', '', `_Made with [EntityModel.com](${SOURCE_URL})_`, '');
  return out.join('\n');
}

export function tableToTSV(t: DocTable): string {
  const clean = (s: string) => (s || '').replace(/[\t\n]/g, ' ');
  return [t.columns.map(clean).join('\t'), ...t.rows.map((r) => r.map(clean).join('\t'))].join('\n');
}

/** Theme for pasted tables. Inline styles only: Google Docs and Word drop <style> blocks on paste. */
export interface DocTheme {
  headerBg: string;
  headerFg: string;
  border: string;
  stripe: string;
  font: string;
  /** Titles. */
  display: string;
  /** Identifiers (attribute names). */
  mono: string;
  /** The heavy rule under table headers and section titles. */
  rule: string;
  /** Links. */
  accent: string;
  /** Headings and emphasis (text-strong). */
  ink: string;
  /** Body copy (text-body). */
  body: string;
  /** Captions and meta (text-muted). */
  muted: string;
}
/** EntityModel.com tokens (Skailr): grey header on an ink rule, warm neutrals, Schibsted Grotesk with
 *  DM Serif Display titles. Fonts fall back to Arial and Georgia where they aren't installed. */
export const DEFAULT_DOC_THEME: DocTheme = {
  headerBg: '#E9E8E4',
  headerFg: '#1F2124',
  border: '#DAD9D4',
  stripe: '#F4F3F0',
  font: "'Schibsted Grotesk', Arial, Helvetica, sans-serif",
  display: "'DM Serif Display', Georgia, 'Times New Roman', serif",
  mono: "'IBM Plex Mono', Consolas, 'Courier New', monospace",
  rule: '#1F2124',
  accent: '#3E6A8F',
  ink: '#1F2124',
  body: '#44474C',
  muted: '#5E6268',
};

export function tableToHTML(t: DocTable, theme: DocTheme = DEFAULT_DOC_THEME, withTitle = true): string {
  const cell = `border:1px solid ${theme.border};padding:5px 8px;font-family:${theme.font};font-size:9.5pt;color:${theme.body};vertical-align:top;`;
  const head = `${cell}background:${theme.headerBg};color:${theme.headerFg};border-bottom:1.5pt solid ${theme.rule};font-weight:600;font-size:8pt;letter-spacing:0.08em;text-transform:uppercase;text-align:left;`;
  const total = (t.widths || []).reduce((a, b) => a + b, 0);
  const parts: string[] = [];
  if (withTitle) {
    parts.push(`<p style="font-family:${theme.font};font-size:12pt;font-weight:600;color:${theme.ink};margin:14pt 0 4pt 0;">${esc(t.title)}</p>`);
    if (t.caption) parts.push(`<p style="font-family:${theme.font};font-size:9pt;color:${theme.muted};margin:0 0 6pt 0;">${esc(t.caption)}</p>`);
  }
  parts.push(`<table style="border-collapse:collapse;width:100%;border:1px solid ${theme.border};" cellpadding="0" cellspacing="0">`);
  parts.push('<thead><tr>');
  t.columns.forEach((c, i) => {
    const w = total && t.widths ? `width:${Math.round((t.widths[i] / total) * 100)}%;` : '';
    parts.push(`<th style="${head}${w}">${esc(c)}</th>`);
  });
  parts.push('</tr></thead><tbody>');
  t.rows.forEach((r, ri) => {
    const bg = ri % 2 ? `background:${theme.stripe};` : 'background:#FFFFFF;';
    parts.push('<tr>');
    r.forEach((c, ci) => {
      const key = (t.section === 'attributes' && ci === 1) ? `font-family:${theme.mono};color:${theme.ink};` : '';
      parts.push(`<td style="${cell}${bg}${key}">${esc(c || '').replace(/\n/g, '<br>')}</td>`);
    });
    parts.push('</tr>');
  });
  parts.push('</tbody></table>');
  return parts.join('');
}

export function tablesToHTMLDocument(m: DataModel, tables: DocTable[], theme: DocTheme = DEFAULT_DOC_THEME, diagramDataUrl?: string): string {
  const body: string[] = [];
  body.push(`<p style="font-family:${theme.font};font-size:8pt;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${theme.muted};margin:0 0 6pt 0;">Data model</p>`);
  body.push(`<h1 style="font-family:${theme.display};color:${theme.ink};font-size:30pt;font-weight:400;letter-spacing:-0.01em;margin:0 0 4pt 0;">${esc(m.title)}</h1>`);
  const meta = [m.organization && `Organization: ${m.organization}`, m.version && `Version ${m.version}`, m.author && `Author: ${m.author}`, `Generated ${new Date().toISOString().slice(0, 10)}`].filter(Boolean);
  body.push(`<p style="font-family:${theme.font};font-size:10pt;color:${theme.muted};margin:0 0 12pt 0;">${esc(meta.join(' · '))}</p>`);
  if (m.description) body.push(`<p style="font-family:${theme.font};font-size:10.5pt;line-height:1.6;color:${theme.body};">${esc(m.description)}</p>`);
  if (diagramDataUrl) body.push(`<img src="${diagramDataUrl}" alt="Data model diagram" style="max-width:100%;border:1px solid ${theme.border};margin:8pt 0;">`);
  let section = '';
  for (const t of tables) {
    if (t.section !== section) {
      section = t.section;
      body.push(
        `<h2 style="font-family:${theme.display};color:${theme.ink};font-size:20pt;font-weight:400;border-bottom:1.5pt solid ${theme.rule};padding-bottom:4pt;margin:28pt 0 6pt 0;">${esc(
          DOC_SECTIONS.find((s) => s.id === section)?.title || section,
        )}</h2>`,
      );
    }
    body.push(tableToHTML(t, theme));
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(m.title)} data model</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Mono&family=Schibsted+Grotesk:wght@400;600&display=swap">
</head><body style="max-width:1100px;margin:32px auto;padding:0 24px;background:#FFFFFF;">${body.join('\n')}<p style="font-family:${theme.font};font-size:8.5pt;color:${theme.muted};margin:28pt 0 0 0;border-top:1px solid ${theme.border};padding-top:8pt;">Made with <a href="${SOURCE_URL}" style="color:${theme.accent};text-decoration:none;">EntityModel.com</a></p></body></html>`;
}
