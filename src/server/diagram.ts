// Static ER diagram as inline SVG for the docs site: the app's own layout (autoLayout) and node geometry,
// drawn without a browser. Colors come from the page's CSS variables, so the diagram follows dark mode.
import type { DataModel, Entity, Relationship } from '../core';
import { autoLayout } from '../ui/canvas/layout';
import { HEADER_H, ROWS_PAD, ROW_H, estimateNodeHeight, nodeRows, nodeWidth, rowCenterY } from '../ui/canvas/geometry';

const PAD = 24;

/** Diagram styles, appended to docs.css and embedded in the standalone .svg. Uses the docs color tokens. */
export const DIAGRAM_STYLE = `
.erd-svg .box { fill: var(--surface); stroke: var(--line-strong); }
.erd-svg .name { font: 600 14px var(--font); fill: var(--ink); }
.erd-svg .id, .erd-svg .attr, .erd-svg .type { font: 11.5px var(--mono); }
.erd-svg .id, .erd-svg .type { fill: var(--ink-3); }
.erd-svg .attr { fill: var(--ink-2); }
.erd-svg .attr.label { fill: var(--ink); text-decoration: underline; text-decoration-color: var(--line-strong); }
.erd-svg .pk { font: 600 9px var(--font); fill: var(--key); }
.erd-svg .badge { font: 600 9px var(--font); letter-spacing: 0.06em; fill: var(--ink-3); }
.erd-svg .foot { font: 11px var(--font); fill: var(--ink-3); }
.erd-svg .rule { stroke: var(--line); }
.erd-svg .line, .erd-svg .mark { fill: none; stroke: var(--ink-2); stroke-width: 1.25; }
.erd-svg .rel-label { font: 11px var(--font); fill: var(--ink-3); paint-order: stroke; stroke: var(--canvas); stroke-width: 4px; stroke-linejoin: round; }
.erd-svg .ref-line { fill: none; stroke: var(--line-strong); stroke-dasharray: 4 4; }
.erd-svg .ref-dot { fill: var(--line-strong); }
.erd-svg .rel:hover .line, .erd-svg .rel:hover .mark { stroke: var(--ink); stroke-width: 2; }
`;

/** Token values for the standalone file, which has no page around it. Keep in step with site/docs.css. */
const TOKENS = `svg { --canvas: #f4f3f0; --surface: #fafaf8; --ink: #1f2124; --ink-2: #44474c; --ink-3: #5e6268; --line: #dad9d4; --line-strong: #bdbcb6; --key: #9a4a10;
  --font: 'Schibsted Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif; --mono: 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace; background: var(--canvas); }
@media (prefers-color-scheme: dark) { svg { --canvas: #17181a; --surface: #1f2023; --ink: #f1f0ec; --ink-2: #c9c8c4; --ink-3: #a1a19d; --line: #34353a; --line-strong: #4e5056; --key: #f2a67c; } }`;

/** The diagram as a self-contained .svg file, at full size. */
export const standaloneSvg = (svg: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace(/^<svg ([^>]*)>/, '<svg $1><style>' + TOKENS + DIAGRAM_STYLE + '</style>')}\n`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Box {
  e: Entity;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Y of an attribute's row (absolute), or the header's middle when the row isn't drawn. */
const rowY = (b: Box, attr?: string) => b.y + rowCenterY(b.e, 'full', (r) => r.kind === 'attr' && r.attr === attr);

function box(b: Box): string {
  const e = b.e;
  const ref = e.entity_type === 'reference';
  const out = [
    `<g class="entity${ref ? ' ref' : ''}"><title>${esc(e.display_name)}${e.description ? `: ${esc(e.description)}` : ''}</title>`,
    `<rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`,
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="4" fill="${esc(e.color_code || '#4A4D52')}"/>`,
    `<text class="name" x="${b.x + 14}" y="${b.y + 28}">${esc(e.display_name)}</text>`,
    `<text class="id" x="${b.x + 14}" y="${b.y + 46}">${esc(e.name)}</text>`,
  ];
  if (ref) out.push(`<text class="badge" x="${b.x + b.w - 14}" y="${b.y + 28}" text-anchor="end">REFERENCE</text>`);
  const rows = nodeRows(e, 'full');
  if (rows.length) out.push(`<line class="rule" x1="${b.x}" y1="${b.y + HEADER_H}" x2="${b.x + b.w}" y2="${b.y + HEADER_H}"/>`);
  rows.forEach((r, i) => {
    const y = b.y + HEADER_H + ROWS_PAD + i * ROW_H + ROW_H / 2 + 4;
    if (r.kind === 'linked') {
      out.push(`<text class="attr" x="${b.x + 34}" y="${y}">${esc(r.attr)}</text><text class="type" x="${b.x + b.w - 14}" y="${y}" text-anchor="end">↑ ${esc(e.dependent_reference?.parent || '')}</text>`);
      return;
    }
    const a = e.attributes.find((x) => x.name === r.attr);
    if (!a) return;
    const f = r.kind === 'field' ? e.struct_types?.find((s) => s.name === a.struct_type)?.fields.find((x) => x.name === r.field) : undefined;
    const item = f || a;
    const side = item.type === 'REFERENCE_ENTITY' ? `→ ${item.reference?.entity || '?'}` : item.type === 'STRUCT' ? `${a.struct_type}${a.is_array ? '[]' : ''}` : `${item.type}${!f && a.is_array ? '[]' : ''}`;
    const mark = !f && a.is_primary_key ? 'PK' : '';
    if (mark) out.push(`<text class="pk" x="${b.x + 12}" y="${y}">${mark}</text>`);
    out.push(`<text class="attr${!f && a.is_label ? ' label' : ''}" x="${b.x + (f ? 48 : 34)}" y="${y}">${esc(f ? f.name : a.name)}</text>`);
    out.push(`<text class="type" x="${b.x + b.w - 14}" y="${y}" text-anchor="end">${esc(side)}</text>`);
  });
  if (e.reference_values?.length) out.push(`<text class="foot" x="${b.x + 14}" y="${b.y + b.h - 10}">${e.reference_values.length} values</text>`);
  out.push('</g>');
  return out.join('');
}

/** Crow's foot end mark at (x, y); dx is the direction the line leaves the box (+1 right, -1 left). */
function endMark(x: number, y: number, dx: number, many: boolean): string {
  if (many) return `<path class="mark" d="M${x} ${y - 7}L${x + dx * 14} ${y}L${x} ${y + 7}M${x} ${y}H${x + dx * 14}"/><path class="mark" d="M${x + dx * 18} ${y - 6}V${y + 6}"/>`;
  return `<path class="mark" d="M${x + dx * 10} ${y - 6}V${y + 6}M${x + dx * 15} ${y - 6}V${y + 6}"/>`;
}

function relationship(r: Relationship, s: Box, t: Box): string {
  const manyAtSource = r.cardinality === 'N:1' || r.cardinality === 'N:N';
  const manyAtTarget = r.cardinality === '1:N' || r.cardinality === 'N:N';
  // The key column sits on the child: the source for N:1 and 1:1, the target for 1:N.
  const childIsSource = r.cardinality !== '1:N';
  const sy = childIsSource ? rowY(s, r.foreign_key) : rowY(s, s.e.attributes.find((a) => a.is_primary_key)?.name);
  const ty = childIsSource ? rowY(t, t.e.attributes.find((a) => a.is_primary_key)?.name) : rowY(t, r.foreign_key);
  const title = `<title>${esc(`${s.e.display_name} ${r.forward_label || r.name} ${t.e.display_name} (${r.cardinality})`)}</title>`;
  if (s === t) {
    const x = s.x + s.w;
    const pk = rowY(s, s.e.attributes.find((a) => a.is_primary_key)?.name);
    return `<g class="rel">${title}<path class="line" d="M${x} ${sy}C${x + 70} ${sy} ${x + 70} ${pk} ${x} ${pk}"/>${endMark(x, sy, 1, manyAtSource)}${endMark(x, pk, 1, false)}<text class="rel-label" x="${x + 58}" y="${(sy + pk) / 2 + 4}">${esc(r.forward_label || r.name)}</text></g>`;
  }
  // Leave from the facing sides; when the boxes overlap horizontally, go round the right-hand side.
  let x1: number, x2: number, d1: number, d2: number;
  if (s.x + s.w + 24 <= t.x) [x1, d1, x2, d2] = [s.x + s.w, 1, t.x, -1];
  else if (t.x + t.w + 24 <= s.x) [x1, d1, x2, d2] = [s.x, -1, t.x + t.w, 1];
  else [x1, d1, x2, d2] = [s.x + s.w, 1, t.x + t.w, 1];
  const bend = Math.max(48, Math.abs(x2 - x1) / 2);
  const path = `M${x1} ${sy}C${x1 + d1 * bend} ${sy} ${x2 + d2 * bend} ${ty} ${x2} ${ty}`;
  const lx = (x1 + x2) / 2 + (d1 === d2 ? d1 * bend * 0.75 : 0);
  const ly = (sy + ty) / 2;
  return `<g class="rel">${title}<path class="line" d="${path}"/>${endMark(x1, sy, d1, manyAtSource)}${endMark(x2, ty, d2, manyAtTarget)}<text class="rel-label" x="${lx}" y="${ly - 6}" text-anchor="middle">${esc(r.forward_label || r.name)}</text></g>`;
}

/** Dashed line from a reference attribute's row to the reference list it uses. */
function reference(from: Box, attr: string, to: Box): string {
  const y1 = rowY(from, attr);
  const y2 = to.y + HEADER_H / 2;
  const right = from.x + from.w <= to.x;
  const x1 = right ? from.x + from.w : from.x;
  const x2 = right ? to.x : to.x + to.w;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
  return `<path class="ref-line" d="M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}"/><circle class="ref-dot" cx="${x2}" cy="${y2}" r="3"/>`;
}

/** The model's primary tab as an ER diagram. */
export function diagramSvg(m: DataModel, title: string): string {
  const pos = autoLayout(m, 'full');
  const boxes = new Map<string, Box>();
  for (const e of m.entities) {
    const p = pos.get(e.name);
    if (p) boxes.set(e.name, { e, x: p.x, y: p.y, w: nodeWidth(e), h: estimateNodeHeight(e, 'full') });
  }
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x)) - PAD;
  const minY = Math.min(...all.map((b) => b.y)) - PAD;
  const maxX = Math.max(...all.map((b) => b.x + b.w)) + PAD + 70;
  const maxY = Math.max(...all.map((b) => b.y + b.h)) + PAD;
  const refs: string[] = [];
  for (const b of all)
    for (const a of b.e.attributes) {
      const to = a.type === 'REFERENCE_ENTITY' && a.reference ? boxes.get(a.reference.entity) : undefined;
      if (to) refs.push(reference(b, a.name, to));
    }
  const rels = m.relationships.map((r) => (boxes.has(r.source) && boxes.has(r.target) ? relationship(r, boxes.get(r.source)!, boxes.get(r.target)!) : ''));
  const w = Math.round(maxX - minX);
  const h = Math.round(maxY - minY);
  return `<svg class="erd-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${Math.round(minX)} ${Math.round(minY)} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">${refs.join('')}${rels.join('')}${all.map(box).join('')}</svg>`;
}
