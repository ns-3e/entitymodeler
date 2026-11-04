// SQL DDL → model. Tolerant by design: unknown statements and clauses are skipped (with a warning), never fatal.
// Handles PostgreSQL, MySQL/MariaDB, Snowflake, Databricks/Spark and most ANSI-ish DDL.
import { ENTITY_COLORS, REFERENCE_COLORS, createModel, normalizeModel, toInternalName, toLabel, uniqueName } from '../model';
import type { Attribute, DataModel, Entity, Relationship, StructType } from '../types';
import { parseSqlType } from './sqlTypes';
import { isTechnicalColumn } from '../derive';

export interface ImportResult {
  model: DataModel;
  warnings: string[];
}

// ---------- tokenizer ----------

/** A token; `nl` marks the first token on a line (DBML is line-oriented). */
export type Tok = { k: 'id' | 'qid' | 'str' | 'num' | 'sym'; v: string; nl?: boolean };

/** `hashComments`: MySQL # comments; `brackets`: SQL Server [quoted identifiers]. Both default on; DBML turns them off. */
export function tokenizeSql(src: string, opts: { hashComments?: boolean; brackets?: boolean } = {}): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  let lineStart = true;
  const emit = (t: Tok) => {
    if (lineStart) t.nl = true;
    lineStart = false;
    out.push(t);
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      if (c === '\n') lineStart = true;
      i++;
    } else if (c === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '#' && opts.hashComments !== false && (i === 0 || /[\s;]/.test(src[i - 1]))) {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
    } else if (c === "'") {
      let s = '';
      i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") (s += "'"), (i += 2);
        else if (src[i] === '\\' && i + 1 < n) (s += src[i + 1] === 'n' ? '\n' : src[i + 1]), (i += 2);
        else if (src[i] === "'") {
          i++;
          break;
        } else s += src[i++];
      }
      emit({ k: 'str', v: s });
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(src.slice(i))) {
      const tag = src.slice(i).match(/^\$[A-Za-z_]*\$/)![0];
      const e = src.indexOf(tag, i + tag.length);
      emit({ k: 'str', v: src.slice(i + tag.length, e === -1 ? n : e) });
      i = e === -1 ? n : e + tag.length;
    } else if (c === '"' || c === '`') {
      let s = '';
      i++;
      while (i < n) {
        if (src[i] === c && src[i + 1] === c) (s += c), (i += 2);
        else if (src[i] === c) {
          i++;
          break;
        } else s += src[i++];
      }
      emit({ k: 'qid', v: s });
    } else if (c === '[' && opts.brackets !== false && src[i + 1] !== ']' && /^\[[^\]\n]+\]/.test(src.slice(i))) {
      const e = src.indexOf(']', i);
      emit({ k: 'qid', v: src.slice(i + 1, e) });
      i = e + 1;
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^(\d*\.?\d+(?:[eE][-+]?\d+)?)/)!;
      emit({ k: 'num', v: m[1] });
      i += m[1].length;
    } else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_\u0080-￿][\w$\u0080-￿]*/)!;
      emit({ k: 'id', v: m[0] });
      i += m[0].length;
    } else {
      emit({ k: 'sym', v: c });
      i++;
    }
  }
  return out;
}

const isKw = (t: Tok | undefined, ...words: string[]) => !!t && t.k === 'id' && words.includes(t.v.toUpperCase());
const isSym = (t: Tok | undefined, s: string) => !!t && t.k === 'sym' && t.v === s;
const isName = (t: Tok | undefined) => !!t && (t.k === 'id' || t.k === 'qid');

/** Split a token list on top-level separators (outside parentheses and type angle brackets). */
function splitTokens(toks: Tok[], sep: string): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let paren = 0;
  let angle = 0;
  toks.forEach((t, i) => {
    if (isSym(t, '(')) paren++;
    else if (isSym(t, ')')) paren--;
    else if (isSym(t, '<') && (angle > 0 || isKw(toks[i - 1], 'STRUCT', 'ARRAY', 'MAP'))) angle++;
    else if (isSym(t, '>') && angle > 0) angle--;
    if (isSym(t, sep) && paren === 0 && angle === 0) {
      out.push(cur);
      cur = [];
    } else cur.push(t);
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Tokens back to compact text, e.g. DECIMAL(10,2), STRUCT<a:INT,b:STRING>, TIMESTAMP WITH TIME ZONE. */
function joinTokens(toks: Tok[]): string {
  let s = '';
  toks.forEach((t, i) => {
    const prev = toks[i - 1];
    const word = t.k !== 'sym';
    if (i && word && prev.k !== 'sym') s += ' ';
    s += t.k === 'qid' ? t.v : t.v;
  });
  return s;
}

/** Read a possibly qualified name (a.b.c); returns all parts and the index after it. */
function readName(toks: Tok[], i: number): { parts: string[]; next: number } {
  const parts: string[] = [];
  while (isName(toks[i])) {
    parts.push(toks[i].v);
    i++;
    if (isSym(toks[i], '.')) i++;
    else break;
  }
  return { parts, next: i };
}

/** Tokens inside the parenthesis group starting at i (toks[i] must be "("); next = index after ")". */
function readGroup(toks: Tok[], i: number): { inner: Tok[]; next: number } {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (isSym(toks[j], '(')) depth++;
    if (isSym(toks[j], ')') && --depth === 0) return { inner: toks.slice(i + 1, j), next: j + 1 };
  }
  return { inner: toks.slice(i + 1), next: toks.length };
}

const nameList = (toks: Tok[]) => splitTokens(toks, ',').map((p) => p.find(isName)?.v).filter((x): x is string => !!x);

// ---------- statements ----------

export interface PColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
  unique: boolean;
  comment?: string;
}
export interface PFk {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  /** Constraint name (fk_<relationship> names the relationship). */
  name?: string;
  /** Explicit relationship name (DBML "Ref name: …"). */
  relName?: string;
  oneToOne?: boolean;
}
export interface PTable {
  name: string;
  columns: PColumn[];
  pk: string[];
  comment?: string;
  rows: Record<string, string>[];
}

const TYPE_WORD = /^(VARCHAR|NVARCHAR|CHAR|NCHAR|TEXT|STRING|INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|NUMBER|FLOAT|DOUBLE|REAL|BOOLEAN|BOOL|DATE|TIMESTAMP|DATETIME|UUID|JSON|JSONB|VARIANT|BINARY|VARBINARY|BLOB)$/i;

/** Is the definition at i a table-level constraint/index rather than a column? (Columns named like keywords are usually quoted.) */
function isTableConstraint(def: Tok[], i: number): boolean {
  const h = def[i];
  const nx = def[i + 1];
  if (!h || h.k !== 'id') return false;
  if (isKw(h, 'PRIMARY', 'FOREIGN', 'CHECK', 'FULLTEXT', 'SPATIAL')) return true;
  if (isKw(h, 'UNIQUE')) return isSym(nx, '(') || isKw(nx, 'KEY', 'INDEX') || (isName(nx) && isSym(def[i + 2], '('));
  if (isKw(h, 'KEY', 'INDEX')) return isSym(nx, '(') || (isName(nx) && !TYPE_WORD.test(nx.v) && isSym(def[i + 2], '('));
  if (isKw(h, 'EXCLUDE')) return isKw(nx, 'USING') || isSym(nx, '(');
  if (isKw(h, 'PERIOD')) return isKw(nx, 'FOR');
  if (isKw(h, 'LIKE')) return isName(nx);
  return false;
}

const COLUMN_STOP = ['NOT', 'NULL', 'PRIMARY', 'REFERENCES', 'DEFAULT', 'COMMENT', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'GENERATED', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'IDENTITY', 'COLLATE', 'ON', 'MASKING', 'ENCODE', 'AS', 'TAG', 'WITH'];
const keyOf = (s: string) => s.toLowerCase();

export function fromSql(text: string, opts: { title?: string; keepJunctions?: boolean } = {}): ImportResult {
  const warnings: string[] = [];
  const tables = new Map<string, PTable>();
  const fks: PFk[] = [];
  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) || 0) + 1);

  for (const stmt of splitTokens(tokenizeSql(text), ';')) {
    if (!stmt.length) continue;
    try {
      if (isKw(stmt[0], 'CREATE')) {
        let i = 1;
        while (isKw(stmt[i], 'OR', 'REPLACE', 'TEMP', 'TEMPORARY', 'TRANSIENT', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'EXTERNAL', 'VOLATILE')) i++;
        if (!isKw(stmt[i], 'TABLE')) {
          skip(`CREATE ${stmt[i]?.v.toUpperCase() || ''}`.trim());
          continue;
        }
        i++;
        if (isKw(stmt[i], 'IF')) i += 3; // IF NOT EXISTS
        const nm = readName(stmt, i);
        i = nm.next;
        if (!isSym(stmt[i], '(')) {
          skip('CREATE TABLE … AS / LIKE');
          continue;
        }
        const g = readGroup(stmt, i);
        const t: PTable = { name: nm.parts[nm.parts.length - 1], columns: [], pk: [], rows: [] };
        for (const def of splitTokens(g.inner, ',')) parseDefinition(def, t);
        const rest = stmt.slice(g.next);
        const c = rest.findIndex((x) => isKw(x, 'COMMENT'));
        if (c !== -1) t.comment = rest.slice(c + 1).find((x) => x.k === 'str')?.v;
        tables.set(keyOf(t.name), t);
      } else if (isKw(stmt[0], 'ALTER') && isKw(stmt[1], 'TABLE')) {
        let i = 2;
        while (isKw(stmt[i], 'ONLY', 'IF', 'EXISTS')) i++;
        const nm = readName(stmt, i);
        const table = nm.parts[nm.parts.length - 1];
        for (const action of splitTokens(stmt.slice(nm.next), ',')) {
          if (!isKw(action[0], 'ADD')) continue;
          const t = tables.get(keyOf(table)) || { name: table, columns: [], pk: [], rows: [] };
          parseDefinition(action.slice(isKw(action[1], 'COLUMN') ? 2 : 1), t, true);
        }
      } else if (isKw(stmt[0], 'COMMENT') && isKw(stmt[1], 'ON')) {
        const what = stmt[2]?.v.toUpperCase();
        const nm = readName(stmt, 3);
        const str = stmt.slice(nm.next).find((x) => x.k === 'str')?.v;
        if (what === 'TABLE') {
          const t = tables.get(keyOf(nm.parts[nm.parts.length - 1]));
          if (t) t.comment = str;
        } else if (what === 'COLUMN') {
          const t = tables.get(keyOf(nm.parts[nm.parts.length - 2] || ''));
          const col = t?.columns.find((x) => keyOf(x.name) === keyOf(nm.parts[nm.parts.length - 1]));
          if (col) col.comment = str;
        }
      } else if (isKw(stmt[0], 'INSERT')) {
        let i = 1;
        while (isKw(stmt[i], 'INTO', 'IGNORE', 'OVERWRITE', 'TABLE')) i++;
        const nm = readName(stmt, i);
        const t = tables.get(keyOf(nm.parts[nm.parts.length - 1]));
        i = nm.next;
        let cols = t?.columns.map((c) => c.name) || [];
        if (isSym(stmt[i], '(')) {
          const g = readGroup(stmt, i);
          cols = nameList(g.inner);
          i = g.next;
        }
        if (!t || !isKw(stmt[i], 'VALUES')) {
          skip('INSERT');
          continue;
        }
        i++;
        while (isSym(stmt[i], '(')) {
          const g = readGroup(stmt, i);
          const vals = splitTokens(g.inner, ',').map(literal);
          const row: Record<string, string> = {};
          cols.forEach((c, k) => {
            if (vals[k] !== undefined) row[c] = vals[k]!;
          });
          t.rows.push(row);
          i = g.next;
          if (isSym(stmt[i], ',')) i++;
        }
      } else skip(stmt[0].v.toUpperCase());
    } catch (e: any) {
      warnings.push(`Could not read a statement starting "${joinTokens(stmt.slice(0, 6))}…": ${e.message}`);
    }
  }

  function parseDefinition(def: Tok[], t: PTable, alter = false) {
    let i = 0;
    let constraintName: string | undefined;
    const constraintNamed = isKw(def[0], 'CONSTRAINT');
    if (constraintNamed) {
      constraintName = def[1]?.v;
      i = 2;
    }
    const head = def[i];
    if (constraintNamed || isTableConstraint(def, i)) {
      if (isKw(head, 'PRIMARY')) {
        const p = def.findIndex((x) => isSym(x, '('));
        if (p !== -1) t.pk = nameList(readGroup(def, p).inner);
      } else if (isKw(head, 'FOREIGN')) {
        const p = def.findIndex((x) => isSym(x, '('));
        const g = readGroup(def, p);
        const r = def.findIndex((x) => isKw(x, 'REFERENCES'));
        const nm = readName(def, r + 1);
        const rp = isSym(def[nm.next], '(') ? nameList(readGroup(def, nm.next).inner) : [];
        fks.push({ table: t.name, columns: nameList(g.inner), refTable: nm.parts[nm.parts.length - 1], refColumns: rp, name: constraintName });
      } else if (isKw(head, 'UNIQUE')) {
        const p = def.findIndex((x) => isSym(x, '('));
        const cols = p === -1 ? [] : nameList(readGroup(def, p).inner);
        if (cols.length === 1) t.columns.filter((c) => keyOf(c.name) === keyOf(cols[0])).forEach((c) => (c.unique = true));
      }
      return;
    }
    if (alter) return; // ALTER TABLE … ADD COLUMN is not needed for model import
    if (!isName(head)) return;
    const col: PColumn = { name: head.v, type: '', notNull: false, pk: false, unique: false };
    i++;
    const typeToks: Tok[] = [];
    let angle = 0;
    while (i < def.length) {
      const tk = def[i];
      if (angle === 0 && typeToks.length && (isKw(tk, ...COLUMN_STOP) || (isKw(tk, 'CHARACTER') && isKw(def[i + 1], 'SET')))) {
        // TIMESTAMP WITH TIME ZONE is part of the type, not a clause
        if (!(isKw(tk, 'WITH') && isKw(def[i + 1], 'TIME', 'LOCAL'))) break;
      }
      if (isSym(tk, '<')) angle++;
      if (isSym(tk, '>')) angle--;
      typeToks.push(tk);
      i++;
    }
    col.type = joinTokens(typeToks) || 'STRING';
    while (i < def.length) {
      const tk = def[i];
      if (isKw(tk, 'NOT') && isKw(def[i + 1], 'NULL')) (col.notNull = true), (i += 2);
      else if (isKw(tk, 'PRIMARY')) (col.pk = true), (i += isKw(def[i + 1], 'KEY') ? 2 : 1);
      else if (isKw(tk, 'UNIQUE')) (col.unique = true), i++;
      else if (isKw(tk, 'COMMENT')) {
        i++;
        if (isSym(def[i], '=')) i++;
        if (def[i]?.k === 'str') col.comment = def[i++].v;
      } else if (isKw(tk, 'REFERENCES')) {
        const nm = readName(def, i + 1);
        i = nm.next;
        let refCols: string[] = [];
        if (isSym(def[i], '(')) {
          const g = readGroup(def, i);
          refCols = nameList(g.inner);
          i = g.next;
        }
        fks.push({ table: t.name, columns: [col.name], refTable: nm.parts[nm.parts.length - 1], refColumns: refCols });
      } else if (isSym(tk, '(')) i = readGroup(def, i).next;
      else i++;
    }
    t.columns.push(col);
    if (col.pk && !t.pk.includes(col.name)) t.pk.push(col.name);
  }

  function literal(toks: Tok[]): string | undefined {
    if (!toks.length || isKw(toks[0], 'NULL')) return undefined;
    if (toks.length === 1 && (toks[0].k === 'str' || toks[0].k === 'num')) return toks[0].v;
    if (toks.length === 2 && isSym(toks[0], '-') && toks[1].k === 'num') return `-${toks[1].v}`;
    if (toks.length === 1 && isKw(toks[0], 'TRUE', 'FALSE')) return toks[0].v.toLowerCase();
    const str = toks.find((x) => x.k === 'str');
    return str ? str.v : joinTokens(toks);
  }

  if (skipped.size) warnings.push(`Skipped: ${[...skipped].map(([k, n]) => `${n}× ${k}`).join(', ')}.`);
  const model = buildModel([...tables.values()], fks, warnings, opts.title || 'Imported model', { keepJunctions: opts.keepJunctions });
  if (!tables.size) warnings.unshift('No CREATE TABLE statements found.');
  return { model, warnings };
}

// ---------- tables + keys → model ----------

const REF_NAME = /^(ref|lkp|lookup|lu)_|_(type|types|status|statuses|code|codes|category|categories|lookup)$/i;

/** `keepJunctions`: keep link tables as tables (a faithful physical copy) instead of N:N relationships. */
export function buildModel(tables: PTable[], fks: PFk[], warnings: string[], title: string, opts: { reference?: Set<string>; colors?: Map<string, string>; keepJunctions?: boolean } = {}): DataModel {
  const model = createModel(toInternalName(title) || 'imported_model', title);
  const byTable = new Map<string, PTable>(tables.map((t) => [keyOf(t.name), t]));
  const entityOf = new Map<string, Entity>();
  const attrOf = (table: string, col: string) => entityOf.get(keyOf(table))?.attributes.find((a) => keyOf(a.name) === keyOf(col));

  // Junction tables (PK = exactly two foreign keys, at most two other columns) become N:N relationships.
  const junctions = new Set<string>();
  for (const t of tables) {
    const own = fks.filter((f) => keyOf(f.table) === keyOf(t.name) && f.columns.length === 1);
    const pk = t.pk.map(keyOf).sort();
    const fkCols = own.map((f) => keyOf(f.columns[0])).sort();
    if (!opts.keepJunctions && own.length === 2 && pk.length === 2 && pk.join() === fkCols.join() && t.columns.length - 2 <= 2 && own.every((f) => byTable.has(keyOf(f.refTable)))) junctions.add(keyOf(t.name));
  }

  let std = 0;
  let ref = 0;
  for (const t of tables) {
    if (junctions.has(keyOf(t.name))) continue;
    const isRef = REF_NAME.test(t.name) || t.rows.length > 0 || !!opts.reference?.has(keyOf(t.name));
    const name = uniqueName(toInternalName(t.name) || 'table', model.entities.map((e) => e.name));
    const struct_types: StructType[] = [];
    const attributes: Attribute[] = t.columns.map((c) => toAttribute(c, t, struct_types));
    const e: Entity = {
      name,
      display_name: toLabel(name),
      entity_type: isRef ? 'reference' : 'standard',
      description: t.comment || '',
      color_code: opts.colors?.get(keyOf(t.name)) || (isRef ? REFERENCE_COLORS[ref++ % REFERENCE_COLORS.length] : ENTITY_COLORS[std++ % ENTITY_COLORS.length]),
      attributes,
      struct_types,
      dependent_reference: null,
    };
    if (!attributes.some((a) => a.is_primary_key)) warnings.push(`${t.name}: no primary key.`);
    // The display attribute: a name-like column, never a foreign key (a key to another table names that table).
    const fkCols = new Set(fks.filter((f) => keyOf(f.table) === keyOf(t.name)).flatMap((f) => f.columns.map(keyOf)));
    const plain = (a: Attribute) => !a.is_primary_key && !fkCols.has(keyOf(a.name)) && !isTechnicalColumn(a.name);
    const label =
      attributes.find((a) => plain(a) && /(^|_)(name|title|label)$/i.test(a.name)) ||
      attributes.find((a) => plain(a) && /(name|nm|desc|title)/i.test(a.name)) ||
      attributes.find((a) => plain(a) && a.type === 'STRING') ||
      attributes.find((a) => a.is_primary_key && !fkCols.has(keyOf(a.name))) ||
      attributes.find((a) => a.is_primary_key);
    if (label) label.is_label = true;
    if (isRef && t.rows.length)
      e.reference_values = t.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [attributes.find((a) => keyOf(a.name) === keyOf(k))?.name || k, v])));
    model.entities.push(e);
    entityOf.set(keyOf(t.name), e);
  }

  const relNames = () => model.relationships.map((r) => r.name);
  const relName = (fk: PFk, fallback: string) => {
    const fromConstraint = fk.relName ? toInternalName(fk.relName) : fk.name && /^fk_/i.test(fk.name) ? toInternalName(fk.name.slice(3)) : '';
    return uniqueName(fromConstraint && /^[a-z]/.test(fromConstraint) ? fromConstraint : fallback, relNames());
  };

  for (const fk of fks) {
    if (fk.columns.length !== 1) {
      warnings.push(`${fk.table}: composite foreign key (${fk.columns.join(', ')}) → ${fk.refTable} skipped.`);
      continue;
    }
    if (junctions.has(keyOf(fk.table))) continue;
    const child = entityOf.get(keyOf(fk.table));
    const parent = entityOf.get(keyOf(fk.refTable));
    const attr = attrOf(fk.table, fk.columns[0]);
    if (!child || !attr) continue;
    if (!parent) {
      warnings.push(`${fk.table}.${fk.columns[0]} references ${fk.refTable}, which is not in the script.`);
      continue;
    }
    const parentPk = parent.attributes.find((a) => a.is_primary_key);
    const refCol = fk.refColumns[0] ? parent.attributes.find((a) => keyOf(a.name) === keyOf(fk.refColumns[0])) : parentPk;
    if (!refCol) continue;
    const toParentKey = refCol === parentPk;
    if (child.entity_type === 'reference' && parent.entity_type === 'reference' && toParentKey && !child.dependent_reference && !attr.is_primary_key && child !== parent) {
      // Country → State → City: the child carries the parent's key as its linked column.
      child.dependent_reference = { parent: parent.name, linked_column: refCol.name };
      child.attributes = child.attributes.filter((a) => a !== attr);
      for (const v of child.reference_values || []) if (attr.name !== refCol.name && attr.name in v) (v[refCol.name] = v[attr.name]), delete v[attr.name];
      continue;
    }
    if (parent.entity_type === 'reference' && !attr.is_primary_key) {
      attr.type = 'REFERENCE_ENTITY';
      attr.reference = { entity: parent.name, output_attribute: refCol.name };
      continue;
    }
    const self = child === parent;
    const oneToOne = fk.oneToOne || (attr.is_primary_key && child.attributes.filter((a) => a.is_primary_key).length === 1) || byTable.get(keyOf(fk.table))?.columns.find((c) => keyOf(c.name) === keyOf(attr.name))?.unique;
    const r: Relationship = {
      name: relName(fk, `${child.name}_to_${parent.name}`),
      source: child.name,
      target: parent.name,
      cardinality: oneToOne ? '1:1' : 'N:1',
      forward_label: self ? 'Child Of' : 'Belongs To',
      reverse_label: self ? 'Parent Of' : 'Has',
      bidirectional: true,
      description: '',
      foreign_key: attr.name,
      attributes: [],
    };
    model.relationships.push(r);
  }

  for (const jk of junctions) {
    const t = byTable.get(jk)!;
    const [a, b] = fks.filter((f) => keyOf(f.table) === jk);
    const s = entityOf.get(keyOf(a.refTable));
    const g = entityOf.get(keyOf(b.refTable));
    if (!s || !g) continue;
    const extra = t.columns.filter((c) => !t.pk.map(keyOf).includes(keyOf(c.name)));
    const structs: StructType[] = [];
    model.relationships.push({
      name: uniqueName(toInternalName(t.name), relNames()),
      source: s.name,
      target: g.name,
      cardinality: 'N:N',
      forward_label: toLabel(t.name),
      bidirectional: false,
      description: t.comment || '',
      attributes: extra.map((c) => toAttribute(c, t, structs)),
    });
  }

  return normalizeModel(model);
}

function attrName(col: string): string {
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(col)) return col;
  const s = col.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^[^A-Za-z]+/, '').replace(/_+$/, '');
  return s || 'column';
}

function toAttribute(c: PColumn, t: PTable, structs: StructType[]): Attribute {
  const name = attrName(c.name);
  const pt = parseSqlType(c.type);
  const a: Attribute = { name, label: toLabel(name), type: pt.type === 'STRUCT' ? 'STRUCT' : pt.type };
  if (pt.precision !== undefined) a.precision = pt.precision;
  if (pt.scale !== undefined) a.scale = pt.scale;
  if (pt.is_array) a.is_array = true;
  if (t.pk.some((p) => keyOf(p) === keyOf(c.name))) a.is_primary_key = true;
  else if (c.notNull) a.required = true;
  if (c.unique && !a.is_primary_key) a.unique = true;
  const desc = [c.comment, pt.note && `Source type ${pt.note}.`].filter(Boolean).join(' ');
  if (desc) a.description = desc;
  if (pt.type === 'STRUCT') {
    const st = uniqueName(name, structs.map((s) => s.name));
    structs.push({ name: st, fields: (pt.fields || []).map((f) => { const ft = parseSqlType(f.type); return { name: attrName(f.name), type: ft.type === 'STRUCT' ? 'STRING' : ft.type }; }) });
    a.struct_type = st;
  }
  return a;
}
