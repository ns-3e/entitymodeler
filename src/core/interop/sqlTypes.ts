// SQL dialects: type mapping in both directions, identifier quoting and literals.
import { type Attribute, type DataModel, type Entity, type ScalarType, type StructField } from '../types';

export type SqlDialect = 'postgres' | 'mysql' | 'snowflake' | 'databricks';
export const SQL_DIALECTS: { id: SqlDialect; label: string }[] = [
  { id: 'postgres', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL / MariaDB' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'databricks', label: 'Databricks' },
];

/** Credit line written at the top of every generated file. */
export const MADE_WITH = 'Made with EntityModel.com';

// ---------- source type → model type ----------

export interface ParsedType {
  type: ScalarType | 'STRUCT';
  /** DECIMAL: digits and scale from NUMERIC(p,s). */
  precision?: number;
  scale?: number;
  is_array?: boolean;
  /** STRUCT<…> fields, when the source spelled them out. */
  fields?: { name: string; type: string }[];
  /** JSON-ish or untyped containers we flatten to STRING. */
  note?: string;
}

/** Map a source/SQL type name onto one of the model's scalar types. */
export function mapSqlType(raw: string | undefined): ScalarType {
  const t = (raw || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+UNSIGNED$/, '').trim();
  if (!t) return 'STRING';
  if (/^(STRING|VARCHAR|NVARCHAR|CHAR|NCHAR|TEXT|CLOB|VARCHAR2|NVARCHAR2|UUID|CHARACTER VARYING|CHARACTER|CITEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)$/.test(t)) return 'STRING';
  if (/^(BIGINT|LONG|INT8|BIGSERIAL|SERIAL8)$/.test(t)) return 'BIGINT';
  if (/^(INT|INTEGER|INT4|MEDIUMINT|SERIAL|SERIAL4)$/.test(t)) return 'INT';
  if (/^(SMALLINT|INT2|SHORT|SMALLSERIAL)$/.test(t)) return 'SMALLINT';
  if (/^(TINYINT|BYTE|BYTEINT)$/.test(t)) return /^TINYINT\(1\)/i.test(raw || '') ? 'BOOLEAN' : 'TINYINT';
  if (/^(DOUBLE|DOUBLE PRECISION|DECIMAL|NUMERIC|NUMBER|REAL|MONEY|FLOAT8|DEC)$/.test(t)) return 'DOUBLE';
  if (/^(FLOAT|FLOAT4)$/.test(t)) return 'FLOAT';
  if (/^(BOOLEAN|BOOL|BIT)$/.test(t)) return 'BOOLEAN';
  if (/^DATE$/.test(t)) return 'DATE';
  if (/^(TIMESTAMP|DATETIME|DATETIME2|SMALLDATETIME|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ|TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE|TIMESTAMP WITHOUT TIME ZONE)$/.test(t)) return 'TIMESTAMP';
  return 'STRING';
}

/** Full source type → model type, including arrays, STRUCT<…> and JSON-ish containers. */
export function parseSqlType(raw: string): ParsedType {
  let t = raw.trim().replace(/^"|"$/g, '');
  let is_array = false;
  if (/\[\s*\]$/.test(t)) {
    is_array = true;
    t = t.replace(/(\[\s*\])+$/, '').trim();
  }
  const arr = t.match(/^ARRAY\s*<([\s\S]*)>$/i);
  if (arr) {
    is_array = true;
    t = arr[1].trim();
  } else if (/^ARRAY$/i.test(t)) return { type: 'STRING', is_array: true, note: 'untyped ARRAY' };
  const st = t.match(/^STRUCT\s*<([\s\S]*)>$/i);
  if (st) return { type: 'STRUCT', is_array, fields: splitTopLevel(st[1]).map(parseStructField).filter((f): f is { name: string; type: string } => !!f) };
  if (/^(JSONB?|VARIANT|OBJECT|MAP\s*<.*>|HSTORE|XML)$/i.test(t)) return { type: 'STRING', is_array, note: t.toUpperCase().replace(/<.*$/, '') };
  const num = numericType(t);
  if (num) return { ...num, is_array };
  return { type: mapSqlType(t), is_array };
}

/**
 * DECIMAL / NUMERIC / NUMBER / MONEY with their arguments: whole numbers become the integer type that fits
 * (NUMBER(38,0) is how Snowflake writes BIGINT), fractions become DECIMAL(p,s).
 */
function numericType(t: string): Pick<ParsedType, 'type' | 'precision' | 'scale'> | null {
  const m = t.match(/^(DECIMAL|NUMERIC|NUMBER|DEC|MONEY|SMALLMONEY)\s*(?:\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\))?$/i);
  if (!m) return null;
  if (/MONEY/i.test(m[1])) return { type: 'DECIMAL', precision: 19, scale: 4 };
  const p = m[2] ? Number(m[2]) : undefined;
  const s = m[3] !== undefined ? Number(m[3]) : m[2] ? 0 : undefined;
  if (p !== undefined && s === 0) return { type: p <= 3 ? 'TINYINT' : p <= 5 ? 'SMALLINT' : p <= 10 ? 'INT' : 'BIGINT' };
  return { type: 'DECIMAL', ...(p !== undefined ? { precision: p } : {}), ...(s !== undefined ? { scale: s } : {}) };
}

/** The DECIMAL type for a dialect, with precision and scale. */
export function sqlDecimal(d: SqlDialect, precision = 18, scale = 2): string {
  const kw = d === 'postgres' ? 'NUMERIC' : d === 'snowflake' ? 'NUMBER' : 'DECIMAL';
  return `${kw}(${precision},${scale})`;
}

function parseStructField(s: string): { name: string; type: string } | null {
  const m = s.trim().match(/^[`"]?([A-Za-z_][\w]*)[`"]?\s*:?\s+([\s\S]+?)(?:\s+(?:NOT\s+NULL|COMMENT\s+'.*'))?$/i) || s.trim().match(/^[`"]?([A-Za-z_][\w]*)[`"]?\s*:\s*([\s\S]+)$/);
  return m ? { name: m[1], type: m[2].trim() } : null;
}

/** Split on top-level commas (outside (), <>, quotes). */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '<') depth++;
    else if (ch === ')' || ch === '>') depth--;
    if (ch === ',' && depth === 0 && !quote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------- model type → SQL type ----------

const SCALAR: Record<SqlDialect, Record<ScalarType, string>> = {
  postgres: { STRING: 'TEXT', BIGINT: 'BIGINT', INT: 'INTEGER', SMALLINT: 'SMALLINT', TINYINT: 'SMALLINT', DECIMAL: 'NUMERIC(18,2)', DOUBLE: 'DOUBLE PRECISION', FLOAT: 'REAL', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIMESTAMP: 'TIMESTAMP' },
  mysql: { STRING: 'VARCHAR(255)', BIGINT: 'BIGINT', INT: 'INT', SMALLINT: 'SMALLINT', TINYINT: 'TINYINT', DECIMAL: 'DECIMAL(18,2)', DOUBLE: 'DOUBLE', FLOAT: 'FLOAT', BOOLEAN: 'TINYINT(1)', DATE: 'DATE', TIMESTAMP: 'DATETIME' },
  snowflake: { STRING: 'VARCHAR', BIGINT: 'NUMBER(38,0)', INT: 'NUMBER(10,0)', SMALLINT: 'NUMBER(5,0)', TINYINT: 'NUMBER(3,0)', DECIMAL: 'NUMBER(18,2)', DOUBLE: 'FLOAT', FLOAT: 'FLOAT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIMESTAMP: 'TIMESTAMP_NTZ' },
  databricks: { STRING: 'STRING', BIGINT: 'BIGINT', INT: 'INT', SMALLINT: 'SMALLINT', TINYINT: 'TINYINT', DECIMAL: 'DECIMAL(18,2)', DOUBLE: 'DOUBLE', FLOAT: 'FLOAT', BOOLEAN: 'BOOLEAN', DATE: 'DATE', TIMESTAMP: 'TIMESTAMP' },
};

export function sqlScalar(t: ScalarType, d: SqlDialect): string {
  return SCALAR[d][t] || SCALAR[d].STRING;
}

/** The scalar type an attribute's values have (reference attributes take the referenced attribute's type). */
export function valueType(m: DataModel, a: Pick<Attribute, 'type' | 'reference'> | StructField): ScalarType {
  if (a.type === 'REFERENCE_ENTITY') {
    const ref = m.entities.find((e) => e.name === a.reference?.entity)?.attributes.find((x) => x.name === a.reference?.output_attribute);
    return ref && ref.type !== 'STRUCT' && ref.type !== 'REFERENCE_ENTITY' ? ref.type : 'STRING';
  }
  return a.type === 'STRUCT' ? 'STRING' : (a.type as ScalarType);
}

/** Precision and scale of a DECIMAL attribute (or of the attribute a reference stores). */
export function decimalOf(m: DataModel, a: Pick<Attribute, 'type' | 'reference' | 'precision' | 'scale'>): { precision?: number; scale?: number } {
  if (a.type === 'REFERENCE_ENTITY') {
    const ref = m.entities.find((e) => e.name === a.reference?.entity)?.attributes.find((x) => x.name === a.reference?.output_attribute);
    return { precision: ref?.precision, scale: ref?.scale };
  }
  return { precision: a.precision, scale: a.scale };
}

/** Column type for an attribute in a dialect, including STRUCTs and arrays. */
export function sqlColumnType(m: DataModel, e: Entity, a: Attribute, d: SqlDialect): string {
  let base: string;
  if (a.type === 'STRUCT') {
    const st = e.struct_types?.find((s) => s.name === a.struct_type);
    if (d === 'databricks') base = `STRUCT<${(st?.fields || []).map((f) => `${quoteIdent(f.name, d)}: ${sqlScalar(valueType(m, f), d)}`).join(', ')}>`;
    else base = d === 'postgres' ? 'JSONB' : d === 'mysql' ? 'JSON' : 'OBJECT';
    if (!a.is_array) return base;
    return d === 'databricks' ? `ARRAY<${base}>` : d === 'postgres' ? 'JSONB' : d === 'mysql' ? 'JSON' : 'ARRAY';
  }
  const vt = valueType(m, a);
  base = vt === 'DECIMAL' ? sqlDecimal(d, decimalOf(m, a).precision, decimalOf(m, a).scale) : sqlScalar(vt, d);
  if (!a.is_array) return base;
  return d === 'postgres' ? `${base}[]` : d === 'mysql' ? 'JSON' : d === 'snowflake' ? 'ARRAY' : `ARRAY<${base}>`;
}

// ---------- identifiers and literals ----------

const RESERVED = new Set(
  'all alter and any array as asc between both by case cast check collate column comment constraint create cross current_date current_time current_timestamp current_user database default delete desc distinct drop else end except exists false fetch for foreign from full grant group having in index inner insert intersect interval into is join key leading left like limit natural not null offset on or order outer primary range references right row rows schema select session_user set some table then to trailing true union unique update user using values view when where window with'.split(
    ' ',
  ),
);

/** Quote an identifier only when the dialect needs it (case, characters, reserved words). */
export function quoteIdent(name: string, d: SqlDialect): string {
  const plain = d === 'postgres' ? /^[a-z_][a-z0-9_]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (plain.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  if (d === 'mysql' || d === 'databricks') return '`' + name.replace(/`/g, '``') + '`';
  return '"' + name.replace(/"/g, '""') + '"';
}

/** Single-quoted string literal; MySQL, Snowflake and Databricks also treat backslash as an escape. */
export function sqlString(s: string, d: SqlDialect): string {
  const body = d === 'postgres' ? s : s.replace(/\\/g, '\\\\');
  return `'${body.replace(/'/g, "''")}'`;
}

/** Literal for a reference value of the given type; blank becomes NULL. */
export function sqlLiteral(v: string | undefined, t: ScalarType, d: SqlDialect): string {
  if (v === undefined || v === '') return 'NULL';
  if (/^(BIGINT|INT|SMALLINT|TINYINT|DECIMAL|DOUBLE|FLOAT)$/.test(t) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim())) return v.trim();
  if (t === 'BOOLEAN' && /^(true|false|1|0|yes|no|y|n)$/i.test(v.trim())) {
    const on = /^(true|1|yes|y)$/i.test(v.trim());
    return d === 'mysql' ? (on ? '1' : '0') : on ? 'TRUE' : 'FALSE';
  }
  return sqlString(v, d);
}
