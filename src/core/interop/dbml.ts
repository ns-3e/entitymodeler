// DBML (dbdiagram.io) in both directions. https://dbml.dbdiagram.io/docs/
import type { Attribute, DataModel, Entity } from '../types';
import { relationalPlan } from './relational';
import { buildModel, tokenizeSql, type ImportResult, type PColumn, type PFk, type PTable, type Tok } from './sqlParse';
import { MADE_WITH, valueType, decimalOf } from './sqlTypes';

const DBML_TYPE: Record<string, string> = { STRING: 'varchar', BIGINT: 'bigint', INT: 'int', SMALLINT: 'smallint', TINYINT: 'tinyint', DECIMAL: 'decimal', DOUBLE: 'double', FLOAT: 'float', BOOLEAN: 'boolean', DATE: 'date', TIMESTAMP: 'timestamp' };
/** Tables in this group are imported as reference entities. */
const REFERENCE_GROUP = 'Reference data';

const ident = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
const note = (s: string) => (s.includes('\n') ? `'''${s.replace(/'''/g, "\\'''")}'''` : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

function dbmlType(m: DataModel, e: Entity, a: Attribute): string {
  const vt = valueType(m, a);
  const dec = decimalOf(m, a);
  const base = a.type === 'STRUCT' ? `struct<${a.struct_type || e.name}>` : vt === 'DECIMAL' ? `decimal(${dec.precision ?? 18},${dec.scale ?? 2})` : DBML_TYPE[vt] || 'varchar';
  const t = a.is_array ? `${base}[]` : base;
  return /^[a-z_]+$/.test(t) ? t : `"${t}"`;
}

export function toDbml(m: DataModel, now = new Date()): string {
  const plan = relationalPlan(m);
  const out: string[] = [`// ${m.title} — data model`, `// ${MADE_WITH}`, `// Generated ${now.toISOString().slice(0, 10)}`, ''];
  out.push(`Project ${ident(m.name)} {`, `  Note: ${note([m.description, MADE_WITH].filter(Boolean).join('\n\n'))}`, '}', '');
  for (const t of plan.tables) {
    const color = t.entity && !t.relationship ? ` [headercolor: ${t.entity.color_code}]` : '';
    out.push(`Table ${ident(t.name)}${color} {`);
    const singlePk = t.pk.length === 1;
    for (const c of t.columns) {
      const text = c.attr.description || c.origin;
      const settings = [singlePk && c.pk ? 'pk' : '', c.notNull && !(singlePk && c.pk) ? 'not null' : '', t.unique.includes(c.name) ? 'unique' : '', text ? `note: ${note(text)}` : ''].filter(Boolean).join(', ');
      out.push(`  ${ident(c.name)} ${dbmlType(m, c.entity, c.attr)}${settings ? ` [${settings}]` : ''}`);
    }
    if (t.pk.length > 1) out.push('', '  indexes {', `    (${t.pk.map(ident).join(', ')}) [pk]`, '  }');
    const values = t.relationship ? undefined : t.entity?.reference_values;
    if (values?.length) out.push('', `  // ${values.length} reference values in the model (not part of DBML)`);
    if (t.description) out.push('', `  Note: ${note(t.description)}`);
    out.push('}', '');
  }
  const junctions = new Set(plan.tables.filter((t) => t.relationship).map((t) => t.name));
  for (const fk of plan.foreignKeys) {
    // Name refs after their relationship (round-trips the relationship name), except a junction table's two refs.
    const nm = fk.kind === 'relationship' && fk.relationship && !junctions.has(fk.table) ? ` ${ident(fk.relationship)}` : '';
    const op = m.relationships.find((r) => r.name === fk.relationship)?.cardinality === '1:1' ? '-' : '>';
    out.push(`Ref${nm}: ${ident(fk.table)}.${ident(fk.column)} ${op} ${ident(fk.refTable)}.${ident(fk.refColumn)}`);
  }
  if (plan.notes.length) out.push('', '// Reference lookups stored by value:', ...plan.notes.map((n) => `//   ${n}`));
  const refs = m.entities.filter((e) => e.entity_type === 'reference');
  if (refs.length) out.push('', `TableGroup ${ident(REFERENCE_GROUP)} {`, ...refs.map((e) => `  ${ident(e.name)}`), '}');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------- DBML → model ----------

export function fromDbml(text: string, opts: { title?: string; keepJunctions?: boolean } = {}): ImportResult {
  const warnings: string[] = [];
  // In DBML "#" starts colours (not comments) and "[…]" holds settings (not quoted names).
  const toks = tokenizeSql(normalizeDbml(text), { hashComments: false, brackets: false });
  const tables: PTable[] = [];
  const fks: PFk[] = [];
  const reference = new Set<string>();
  const colors = new Map<string, string>();
  const enums = new Map<string, string[]>();
  const aliases = new Map<string, string>();
  let projectNote = '';

  const word = (t: Tok | undefined, w: string) => !!t && t.k === 'id' && t.v.toLowerCase() === w;
  const sym = (t: Tok | undefined, v: string) => !!t && t.k === 'sym' && t.v === v;
  const nameAt = (j: number) => (toks[j] && (toks[j].k === 'id' || toks[j].k === 'qid') ? toks[j].v : '');
  const noteText = (j: number) => (toks[j]?.k === 'str' ? toks[j].v : '');
  /** Index of the "}" closing the "{" at j. */
  const closing = (j: number) => {
    let depth = 0;
    for (let k = j; k < toks.length; k++) {
      if (sym(toks[k], '{')) depth++;
      if (sym(toks[k], '}') && --depth === 0) return k;
    }
    return toks.length;
  };
  /** "[a, b: c]" at j → the settings as token lists, and the index after "]". */
  const settings = (j: number): { items: Tok[][]; next: number } => {
    if (!sym(toks[j], '[')) return { items: [], next: j };
    const items: Tok[][] = [[]];
    let k = j + 1;
    for (; k < toks.length && !sym(toks[k], ']'); k++) {
      if (sym(toks[k], ',')) items.push([]);
      else items[items.length - 1].push(toks[k]);
    }
    return { items: items.filter((x) => x.length), next: k + 1 };
  };
  /** [schema.]table.column at j. */
  const endpoint = (j: number) => {
    const parts: string[] = [];
    while (nameAt(j)) {
      parts.push(nameAt(j++));
      if (sym(toks[j], '.')) j++;
      else break;
    }
    const table = parts.length >= 2 ? parts[parts.length - 2] : '';
    return { table: aliases.get(table) || table, column: parts[parts.length - 1] || '', next: j };
  };
  const operator = (j: number) => (sym(toks[j], '<') && sym(toks[j + 1], '>') ? { op: '<>', next: j + 2 } : { op: toks[j]?.v || '', next: j + 1 });
  const addRef = (a: { table: string; column: string }, op: string, b: { table: string; column: string }, relName?: string) => {
    if (!a.table || !b.table) return;
    if (op === '>') fks.push({ table: a.table, columns: [a.column], refTable: b.table, refColumns: [b.column], relName });
    else if (op === '<') fks.push({ table: b.table, columns: [b.column], refTable: a.table, refColumns: [a.column], relName });
    else if (op === '-') fks.push({ table: a.table, columns: [a.column], refTable: b.table, refColumns: [b.column], relName, oneToOne: true });
    else if (op === '<>') warnings.push(`Many-to-many ${a.table}.${a.column} <> ${b.table}.${b.column} was skipped: add it as an N:N relationship.`);
  };

  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (word(t, 'table')) {
      const head = endpoint(i + 1);
      const name = head.column;
      let j = head.next;
      if (word(toks[j], 'as')) {
        aliases.set(nameAt(j + 1), name);
        j += 2;
      }
      const ts = settings(j);
      for (const s of ts.items) if (word(s[0], 'headercolor')) colors.set(name.toLowerCase(), s.slice(2).map((x) => x.v).join(''));
      j = ts.next;
      const end = closing(j);
      const table: PTable = { name, columns: [], pk: [], rows: [] };
      let k = j + 1;
      while (k < end) {
        if (word(toks[k], 'note') && sym(toks[k + 1], ':')) {
          table.comment = noteText(k + 2);
          k += 3;
        } else if (word(toks[k], 'note') && sym(toks[k + 1], '{')) {
          const e2 = closing(k + 1);
          table.comment = noteText(k + 2);
          k = e2 + 1;
        } else if (word(toks[k], 'indexes') && sym(toks[k + 1], '{')) {
          const e2 = closing(k + 1);
          for (let x = k + 2; x < e2; x++) {
            if (!sym(toks[x], '(')) continue;
            const cols: string[] = [];
            let y = x + 1;
            for (; y < e2 && !sym(toks[y], ')'); y++) if (nameAt(y)) cols.push(nameAt(y));
            const st = settings(y + 1);
            if (st.items.some((s) => word(s[0], 'pk') || (word(s[0], 'primary') && word(s[1], 'key')))) table.pk = cols;
            x = st.next - 1;
          }
          k = e2 + 1;
        } else if (nameAt(k)) {
          const col: PColumn = { name: nameAt(k), type: '', notNull: false, pk: false, unique: false };
          k++;
          // The type runs to the settings "[" or the end of the line.
          const typeToks: Tok[] = [];
          let depth = 0;
          while (k < end && (depth > 0 || (!sym(toks[k], '[') && !(typeToks.length && toks[k].nl)))) {
            if (sym(toks[k], '(')) depth++;
            if (sym(toks[k], ')')) depth--;
            typeToks.push(toks[k++]);
          }
          col.type = typeToks.map((x) => x.v).join('') || 'varchar';
          const st = settings(k);
          k = st.next;
          for (const s of st.items) {
            if (word(s[0], 'pk') || (word(s[0], 'primary') && word(s[1], 'key'))) col.pk = true;
            else if (word(s[0], 'not') && word(s[1], 'null')) col.notNull = true;
            else if (word(s[0], 'unique')) col.unique = true;
            else if (word(s[0], 'note')) col.comment = s.find((x) => x.k === 'str')?.v;
            else if (word(s[0], 'ref')) {
              const at = s.findIndex((x) => x.k === 'sym' && ['<', '>', '-'].includes(x.v));
              if (at === -1) continue;
              const op = sym(s[at], '<') && sym(s[at + 1], '>') ? '<>' : s[at].v;
              const parts = s.slice(at + op.length).filter((x) => x.k !== 'sym').map((x) => x.v);
              const table2 = parts[parts.length - 2] || '';
              addRef({ table: name, column: col.name }, op, { table: aliases.get(table2) || table2, column: parts[parts.length - 1] || '' });
            }
          }
          table.columns.push(col);
          if (col.pk) table.pk.push(col.name);
        } else k++;
      }
      tables.push(table);
      i = end + 1;
    } else if (word(t, 'ref')) {
      let j = i + 1;
      let relName: string | undefined;
      if (nameAt(j) && (sym(toks[j + 1], ':') || sym(toks[j + 1], '{'))) relName = nameAt(j++);
      if (sym(toks[j], ':')) {
        const a = endpoint(j + 1);
        const { op, next } = operator(a.next);
        const b = endpoint(next);
        addRef(a, op, b, relName);
        i = settings(b.next).next;
      } else if (sym(toks[j], '{')) {
        const end = closing(j);
        const a = endpoint(j + 1);
        const { op, next } = operator(a.next);
        addRef(a, op, endpoint(next), relName);
        i = end + 1;
      } else i = j + 1;
    } else if (word(t, 'enum')) {
      const head = endpoint(i + 1);
      const end = closing(head.next);
      const values: string[] = [];
      for (let k = head.next + 1; k < end; k++) {
        if (sym(toks[k], '[')) k = settings(k).next - 1; // value settings, e.g. [note: '…']
        else if (nameAt(k) || toks[k].k === 'str') values.push(toks[k].v);
      }
      enums.set(head.column, values);
      i = end + 1;
    } else if (word(t, 'tablegroup')) {
      const head = endpoint(i + 1);
      const j = toks.findIndex((x, k) => k > i && sym(x, '{'));
      const end = closing(j);
      if (/reference|lookup|code/i.test(head.column)) for (let k = j + 1; k < end; k++) if (nameAt(k)) reference.add(nameAt(k).toLowerCase());
      i = end + 1;
    } else if (word(t, 'project')) {
      const j = toks.findIndex((x, k) => k > i && sym(x, '{'));
      const end = closing(j);
      for (let k = j + 1; k < end; k++) if (word(toks[k], 'note') && sym(toks[k + 1], ':')) projectNote = noteText(k + 2);
      i = end + 1;
    } else i++;
  }

  // Enums become reference entities; columns typed with an enum become lookups to it.
  for (const [name, values] of enums) {
    const key = `${name}_code`;
    tables.push({ name, columns: [{ name: key, type: 'varchar', notNull: true, pk: true, unique: false }], pk: [key], rows: values.map((v) => ({ [key]: v })), comment: `Values of the ${name} enum.` });
    for (const t of tables)
      for (const c of t.columns)
        if (c.type.toLowerCase() === name.toLowerCase()) {
          c.type = 'varchar';
          fks.push({ table: t.name, columns: [c.name], refTable: name, refColumns: [key] });
        }
  }

  const validColors = new Map([...colors].filter(([, c]) => /^#[0-9a-f]{6}$/i.test(c)));
  const model = buildModel(tables, fks, warnings, opts.title || 'Imported model', { reference, colors: validColors, keepJunctions: opts.keepJunctions });
  if (projectNote) model.description = projectNote.replace(MADE_WITH, '').trim();
  if (!tables.length) warnings.unshift('No Table blocks found.');
  return { model, warnings };
}

/** Strip // comments and turn '''multi-line''' notes into ordinary quoted strings for the shared tokenizer. */
function normalizeDbml(src: string): string {
  const TRIPLE = "'''";
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (src.startsWith(TRIPLE, i)) {
      const end = src.indexOf(TRIPLE, i + 3);
      const body = src.slice(i + 3, end === -1 ? src.length : end).trim();
      out += `'${body.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
      i = end === -1 ? src.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else out += c;
  }
  return out;
}
