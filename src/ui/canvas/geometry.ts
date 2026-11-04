// Shared node geometry: the entity node and the edges both use these numbers, so attribute-level
// edges land exactly on their rows. Keep in sync with .entity-node CSS.
import type { DataModel, Entity } from '../../core';
import type { Detail } from '../store';

export const NODE_WIDTH = 280;
export const HEADER_H = 58;
export const ROW_H = 24;
export const ROWS_PAD = 4;
export const FOOTER_H = 30;

export type RowKind = 'attr' | 'field' | 'linked';
export interface NodeRow {
  key: string;
  kind: RowKind;
  attr: string;
  field?: string;
}

/** Whether a STRUCT attribute's fields are folded into its own row on the diagram. */
export function isFolded(e: Entity, attr: string) {
  return !!e.ui?.folded?.includes(attr);
}

export function nodeRows(e: Entity, detail: Detail): NodeRow[] {
  if (detail === 'title') return [];
  const rows: NodeRow[] = [];
  if (e.dependent_reference) rows.push({ key: `linked:${e.dependent_reference.linked_column}`, kind: 'linked', attr: e.dependent_reference.linked_column });
  for (const a of e.attributes) {
    const keyish = a.is_primary_key || a.is_label || a.type === 'REFERENCE_ENTITY' || (a.type === 'STRUCT' && hasRefField(e, a.struct_type));
    if (detail === 'keys' && !keyish) continue;
    rows.push({ key: `attr:${a.name}`, kind: 'attr', attr: a.name });
    if (a.type === 'STRUCT' && isFolded(e, a.name)) continue;
    if (a.type === 'STRUCT' && detail === 'full') {
      const st = e.struct_types?.find((s) => s.name === a.struct_type);
      for (const f of st?.fields || []) rows.push({ key: `field:${a.name}.${f.name}`, kind: 'field', attr: a.name, field: f.name });
    }
    if (a.type === 'STRUCT' && detail === 'keys') {
      const st = e.struct_types?.find((s) => s.name === a.struct_type);
      for (const f of st?.fields || []) if (f.type === 'REFERENCE_ENTITY') rows.push({ key: `field:${a.name}.${f.name}`, kind: 'field', attr: a.name, field: f.name });
    }
  }
  return rows;
}

function hasRefField(e: Entity, structType?: string) {
  return !!e.struct_types?.find((s) => s.name === structType)?.fields.some((f) => f.type === 'REFERENCE_ENTITY');
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 480;

/** Node width sized to the longest row (attribute name + type/reference target), clamped. */
export function nodeWidth(e: Entity): number {
  const nameCh = (s: string) => s.length * 7; // JetBrains Mono 11.5px
  const sideCh = (s: string) => s.length * 6.4; // 10.5px
  let w = Math.max(e.display_name.length * 8.4 + 150, e.name.length * 6.6 + 130); // header: icon, badges
  const row = (name: string, side: string, indent = 0) => (w = Math.max(w, 44 + indent + nameCh(name) + 14 + sideCh(side)));
  if (e.dependent_reference) row(e.dependent_reference.linked_column, `↑ ${e.dependent_reference.parent}`);
  for (const a of e.attributes) {
    const side = a.type === 'REFERENCE_ENTITY' ? `→ ${a.reference?.entity || '?'}` : a.type === 'STRUCT' ? `${a.struct_type || 'STRUCT'}${a.is_array ? '[]' : ''}` : `${a.type}${a.is_array ? '[]' : ''}`;
    row(a.name, side, a.type === 'STRUCT' ? 26 : 0); // struct rows also carry the fold button
    if (a.type === 'STRUCT')
      for (const f of e.struct_types?.find((s) => s.name === a.struct_type)?.fields || [])
        row(f.name, f.type === 'REFERENCE_ENTITY' ? `→ ${f.reference?.entity || '?'}` : f.type, 14);
  }
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)) / 8) * 8;
}

export function hasFooter(e: Entity) {
  return !!e.reference_values?.length;
}

export function estimateNodeHeight(e: Entity, detail: Detail) {
  const rows = nodeRows(e, detail).length;
  return HEADER_H + (rows ? rows * ROW_H + ROWS_PAD * 2 : 0) + (hasFooter(e) ? FOOTER_H : 0);
}

/** Y offset (relative to node top) of a row's center; falls back to header center when the row is hidden. */
export function rowCenterY(e: Entity, detail: Detail, match: (r: NodeRow) => boolean): number {
  const rows = nodeRows(e, detail);
  const i = rows.findIndex(match);
  if (i === -1) return HEADER_H / 2;
  return HEADER_H + ROWS_PAD + i * ROW_H + ROW_H / 2;
}

export function entityColorMap(m: DataModel) {
  return new Map(m.entities.map((e) => [e.name, e.color_code]));
}
