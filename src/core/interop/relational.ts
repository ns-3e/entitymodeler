// The relational shape of a model, shared by the SQL and DBML writers: tables (entities plus N:N junctions),
// their columns (attributes plus generated key columns) and every foreign key.
import { dependencyOrder, entityIndex, getEntity, primaryKey, relationshipEnds, resolveForeignKey, toLabel, uniqueName } from '../model';
import type { Attribute, DataModel, Entity } from '../types';

export interface RelColumn {
  name: string;
  /** The attribute (real, or synthesized for generated key columns) — carries type, flags and description. */
  attr: Attribute;
  /** Entity whose struct_types resolve STRUCT columns. */
  entity: Entity;
  pk: boolean;
  notNull: boolean;
  /** Why the column exists when it is not a model attribute. */
  origin?: string;
}

export interface RelTable {
  name: string;
  entity?: Entity;
  /** Set for N:N junction tables. */
  relationship?: string;
  description?: string;
  columns: RelColumn[];
  pk: string[];
  /** Columns with a UNIQUE constraint (1:1 relationship keys). */
  unique: string[];
}

export interface RelForeignKey {
  name: string;
  table: string;
  column: string;
  refTable: string;
  refColumn: string;
  kind: 'relationship' | 'reference' | 'dependent';
  /** Relationship name (kind = relationship). */
  relationship?: string;
}

export interface RelPlan {
  tables: RelTable[];
  foreignKeys: RelForeignKey[];
  /** Links that cannot be a foreign key (e.g. a reference stored by name), as "table.column → target". */
  notes: string[];
}

/** Name for a column holding `parent`'s key: the PK name when it already says which entity it is, else parent_pk. */
export function keyColumnName(parent: Entity, pk: Attribute): string {
  return pk.name.toLowerCase().startsWith(parent.name.toLowerCase()) ? pk.name : `${parent.name}_${pk.name}`;
}

export function relationalPlan(m: DataModel): RelPlan {
  const byName = entityIndex(m);
  const tables = new Map<string, RelTable>();
  const foreignKeys: RelForeignKey[] = [];
  const notes: string[] = [];
  const fkNames = new Set<string>();
  const fkName = (base: string) => {
    const n = uniqueName(base.slice(0, 60), fkNames);
    fkNames.add(n);
    return n;
  };
  const col = (e: Entity, a: Attribute, origin?: string): RelColumn => ({ name: a.name, attr: a, entity: e, pk: !!a.is_primary_key, notNull: !!a.is_primary_key || !!a.required, origin });
  const addColumn = (t: RelTable, base: string, like: Attribute, description: string, origin: string): string => {
    const name = uniqueName(base, t.columns.map((c) => c.name));
    t.columns.push(col(t.entity!, { name, label: toLabel(name), type: like.type === 'STRUCT' ? 'STRING' : like.type, reference: like.reference, description }, origin));
    return name;
  };

  for (const e of dependencyOrder(m)) {
    tables.set(e.name, {
      name: e.name,
      entity: e,
      description: e.description,
      columns: e.attributes.map((a) => col(e, a)),
      pk: e.attributes.filter((a) => a.is_primary_key).map((a) => a.name),
      unique: e.attributes.filter((a) => a.unique && !a.is_primary_key && a.type !== 'STRUCT' && !a.is_array).map((a) => a.name),
    });
  }

  for (const e of m.entities) {
    const t = tables.get(e.name)!;
    // Dependent reference: the child carries the parent's linked column.
    const dep = e.dependent_reference;
    const parent = dep && getEntity(m, dep.parent, byName);
    if (dep && parent) {
      const linked = parent.attributes.find((a) => a.name === dep.linked_column);
      if (linked && !t.columns.some((c) => c.name === dep.linked_column)) {
        t.columns.push(col(e, { ...linked, is_primary_key: false, is_label: false, description: `Parent ${parent.display_name}` }, `dependent reference → ${parent.name}`));
      }
      if (linked && primaryKey(parent)?.name === linked.name)
        foreignKeys.push({ name: fkName(`fk_${e.name}_${dep.linked_column}`), table: e.name, column: dep.linked_column, refTable: parent.name, refColumn: linked.name, kind: 'dependent' });
    }
    // Reference lookups: a real FK only when the stored value is the reference entity's key.
    for (const a of e.attributes) {
      if (a.type !== 'REFERENCE_ENTITY' || !a.reference) continue;
      const ref = getEntity(m, a.reference.entity, byName);
      if (!ref) continue;
      if (!a.is_array && primaryKey(ref)?.name === a.reference.output_attribute)
        foreignKeys.push({ name: fkName(`fk_${e.name}_${a.name}`), table: e.name, column: a.name, refTable: ref.name, refColumn: a.reference.output_attribute, kind: 'reference' });
      else notes.push(`${e.name}.${a.name} → ${ref.name}.${a.reference.output_attribute}`);
    }
  }

  for (const r of m.relationships) {
    const ends = relationshipEnds(r);
    if (!ends) {
      // N:N → junction table named after the relationship.
      const s = getEntity(m, r.source, byName);
      const tg = getEntity(m, r.target, byName);
      const spk = s && primaryKey(s);
      const tpk = tg && primaryKey(tg);
      if (!s || !tg || !spk || !tpk) continue;
      const name = uniqueName(r.name, new Set(tables.keys()));
      const jt: RelTable = { name, entity: s, relationship: r.name, description: r.description || `Links ${s.display_name} and ${tg.display_name} (${r.forward_label || r.name}).`, columns: [], pk: [], unique: [] };
      const a = addColumn(jt, keyColumnName(s, spk), spk, `${s.display_name} key`, `relationship ${r.name}`);
      const b = addColumn(jt, s === tg ? `related_${spk.name}` : keyColumnName(tg, tpk), tpk, `${tg.display_name} key`, `relationship ${r.name}`);
      for (const c of jt.columns) c.pk = c.notNull = true;
      jt.pk = [a, b];
      for (const ra of r.attributes || []) jt.columns.push(col(s, { ...ra, is_primary_key: false }, `relationship ${r.name}`));
      tables.set(name, jt);
      foreignKeys.push({ name: fkName(`fk_${name}_${a}`), table: name, column: a, refTable: s.name, refColumn: spk.name, kind: 'relationship', relationship: r.name });
      foreignKeys.push({ name: fkName(`fk_${name}_${b}`), table: name, column: b, refTable: tg.name, refColumn: tpk.name, kind: 'relationship', relationship: r.name });
      continue;
    }
    const child = tables.get(ends.child);
    const parent = getEntity(m, ends.parent, byName);
    const pk = parent && primaryKey(parent);
    if (!child || !parent || !pk) continue;
    let fk = resolveForeignKey(m, r, byName);
    if (!fk) fk = addColumn(child, ends.child === ends.parent ? `parent_${pk.name}` : keyColumnName(parent, pk), pk, `${parent.display_name} (${r.forward_label})`, `relationship ${r.name}`);
    if (r.cardinality === '1:1' && !child.pk.includes(fk)) child.unique.push(fk);
    for (const ra of r.attributes || []) addColumn(child, ra.name, ra, ra.description || `${r.forward_label} ${ra.label || ra.name}`, `relationship ${r.name}`);
    foreignKeys.push({ name: fkName(`fk_${r.name}`), table: child.name, column: fk, refTable: parent.name, refColumn: pk.name, kind: 'relationship', relationship: r.name });
  }

  return { tables: [...tables.values()], foreignKeys, notes };
}
