/** Shared with SQL import (src/core/interop). */
export { mapSqlType } from '../core';

export interface ParsedColumn {
  name: string;
  type?: string;
  description?: string;
}

/**
 * Parse pasted column lists: CREATE TABLE DDL, "name TYPE" lines, "name,type,description" CSV,
 * tab-separated rows copied from a spreadsheet, or bare names.
 */
export function parseColumns(text: string): ParsedColumn[] {
  let body = text;
  const ddl = text.match(/create\s+(?:or\s+replace\s+)?table[^(]*\(([\s\S]*)\)/i);
  if (ddl) body = ddl[1].replace(/\)[^)]*$/, '');
  const out: ParsedColumn[] = [];
  const lines = ddl ? splitTopLevel(body) : body.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim().replace(/,$/, '');
    if (!line || /^(primary|constraint|foreign|unique|key|index|check)\b/i.test(line) || line.startsWith('--')) continue;
    let parts: string[];
    if (line.includes('\t')) parts = line.split('\t').map((s) => s.trim());
    else if (!ddl && line.includes(',')) parts = line.split(',').map((s) => s.trim());
    else {
      const m = line.match(/^[`"[]?([A-Za-z_][\w]*)[`"\]]?\s*:?\s*([A-Za-z_][\w]*(?:\([^)]*\))?)?\s*(?:comment\s+'([^']*)')?(.*)$/i);
      if (!m) continue;
      parts = [m[1], m[2] || '', m[3] || ''];
    }
    const name = parts[0]?.replace(/[`"[\]]/g, '');
    if (!name || /^(name|column|column_name|attribute)$/i.test(name)) continue; // header row
    out.push({ name, type: parts[1] || undefined, description: parts[2] || undefined });
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function slugAttr(s: string) {
  return s
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
