// Minimal CSV/TSV handling for reference values (RFC 4180 quoting).
import type { Entity, ReferenceValue } from './types';

/** Parse CSV or TSV (auto-detected from the first line). Returns rows of cells. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n', 1)[0] || '';
  const delim = first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes(';') ? ';' : first.includes('|') ? '|' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** Columns a reference entity's values carry: the dependent-reference linked column first, then attributes. */
export function valueColumns(e: Entity): string[] {
  const cols = e.attributes.filter((a) => a.type !== 'STRUCT').map((a) => a.name);
  if (e.dependent_reference?.linked_column && !cols.includes(e.dependent_reference.linked_column)) cols.unshift(e.dependent_reference.linked_column);
  return cols;
}

/**
 * Turn pasted/imported rows into values for an entity. A first row whose cells match column names
 * (case-insensitive) is treated as a header and used to map columns; otherwise columns are positional.
 */
export function rowsToValues(e: Entity, rows: string[][]): { values: ReferenceValue[]; header: boolean; unknown: string[] } {
  const cols = valueColumns(e);
  if (!rows.length) return { values: [], header: false, unknown: [] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const head = rows[0];
  const matches = head.filter((h) => cols.some((c) => norm(c) === norm(h))).length;
  const header = matches > 0 && matches >= Math.ceil(head.length / 2);
  const mapping = header ? head.map((h) => cols.find((c) => norm(c) === norm(h)) || null) : head.map((_, i) => cols[i] || null);
  const unknown = header ? head.filter((_, i) => !mapping[i]) : [];
  const body = header ? rows.slice(1) : rows;
  const values = body.map((r) => {
    const v: ReferenceValue = {};
    r.forEach((cell, i) => {
      const c = mapping[i];
      if (c && cell !== '') v[c] = cell;
    });
    return v;
  });
  return { values: values.filter((v) => Object.keys(v).length), header, unknown };
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** CSV with exact attribute names as headers, so it round-trips through rowsToValues. */
export function valuesToCSV(e: Entity, includeLinked = true): string {
  const cols = valueColumns(e).filter((c) => includeLinked || c !== e.dependent_reference?.linked_column);
  const lines = [cols.map(csvCell).join(',')];
  for (const v of e.reference_values || []) lines.push(cols.map((c) => csvCell(v[c] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

/** Distinct values of one column of a reference entity (for previews and pickers). */
export function columnValues(e: Entity | undefined, column: string | undefined): string[] {
  if (!e?.reference_values?.length || !column) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of e.reference_values) {
    const x = v[column];
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export function previewList(values: string[], max = 8): string {
  if (!values.length) return '';
  return values.slice(0, max).join(' · ') + (values.length > max ? ` · … (+${values.length - max})` : '');
}
