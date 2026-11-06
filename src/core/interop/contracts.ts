// Model → dbt schema.yml, JSON Schema, Avro and Open Data Contract Standard (ODCS v3). All follow the same
// relational plan as the SQL export (relational.ts), so keys, junction tables and foreign keys match it.
import { columnValues } from '../csv';
import { getEntity } from '../model';
import { toYaml } from '../yaml';
import type { Attribute, DataModel, Entity, ScalarType, StructField } from '../types';
import { relationalPlan, type RelTable } from './relational';
import { MADE_WITH, decimalOf, sqlColumnType, valueType, type SqlDialect } from './sqlTypes';

const tabSuffix = (m: DataModel) => (m.tab && m.tab.name !== 'Main' ? ` (${m.tab.name} tab)` : '');

/** Values a column may hold, when it references a list that has them. */
function allowedValues(m: DataModel, a: Attribute): string[] {
  if (a.type !== 'REFERENCE_ENTITY' || !a.reference) return [];
  return columnValues(getEntity(m, a.reference.entity), a.reference.output_attribute);
}

// ---------------------------------------------------------------- dbt

/** dbt `schema.yml` (version 2): models, columns, data types and generic data tests. */
export function toDbt(m: DataModel, opts: { dialect?: SqlDialect } = {}): string {
  const d = opts.dialect || (m.tab?.dialect as SqlDialect) || 'databricks';
  const plan = relationalPlan(m);
  const fksBy = new Map<string, typeof plan.foreignKeys>();
  for (const f of plan.foreignKeys) fksBy.set(`${f.table}.${f.column}`, [...(fksBy.get(`${f.table}.${f.column}`) || []), f]);
  const models = plan.tables.map((t) => {
    const single = t.pk.length === 1 ? t.pk[0] : undefined;
    return {
      name: t.name,
      description: t.description || undefined,
      config: t.pk.length > 1 ? { meta: { primary_key: t.pk } } : undefined,
      // dbt's own unique test only looks at one column. Without this, a composite key allows duplicate rows.
      data_tests: t.pk.length > 1 ? [{ 'dbt_utils.unique_combination_of_columns': { combination_of_columns: t.pk } }] : undefined,
      columns: t.columns.map((c) => {
        const tests: unknown[] = [];
        if (c.notNull) tests.push('not_null');
        if (c.name === single || t.unique.includes(c.name)) tests.push('unique');
        for (const f of fksBy.get(`${t.name}.${c.name}`) || []) tests.push({ relationships: { to: `ref('${f.refTable}')`, field: f.refColumn } });
        const values = allowedValues(m, c.attr);
        if (values.length && values.length <= 200) tests.push({ accepted_values: { values } });
        return {
          name: c.name,
          description: c.attr.description || c.origin || undefined,
          data_type: sqlColumnType(m, c.entity, c.attr, d).toLowerCase(),
          meta: c.attr.pii ? { pii: true } : undefined,
          data_tests: tests.length ? tests : undefined,
        };
      }),
    };
  });
  const needsUtils = plan.tables.some((t) => t.pk.length > 1) ? '\nComposite keys use the dbt_utils package: add dbt-labs/dbt_utils to packages.yml.' : '';
  return toYaml({ version: 2, models } as any, `${m.title}${tabSuffix(m)} — dbt models\n${MADE_WITH}${needsUtils}`);
}

// ---------------------------------------------------------------- JSON Schema

const JSON_TYPE: Record<ScalarType, object> = {
  STRING: { type: 'string' },
  BIGINT: { type: 'integer' },
  INT: { type: 'integer' },
  SMALLINT: { type: 'integer' },
  TINYINT: { type: 'integer' },
  DECIMAL: { type: 'number' },
  DOUBLE: { type: 'number' },
  FLOAT: { type: 'number' },
  BOOLEAN: { type: 'boolean' },
  DATE: { type: 'string', format: 'date' },
  TIMESTAMP: { type: 'string', format: 'date-time' },
};

function jsonField(m: DataModel, e: Entity, a: Attribute | StructField, isArray?: boolean): Record<string, unknown> {
  let s: Record<string, unknown>;
  if (a.type === 'STRUCT') {
    const st = e.struct_types?.find((x) => x.name === (a as Attribute).struct_type);
    s = { type: 'object', properties: Object.fromEntries((st?.fields || []).map((f) => [f.name, jsonField(m, e, f)])), additionalProperties: false };
  } else {
    s = { ...JSON_TYPE[valueType(m, a)] };
    const values = a.type === 'REFERENCE_ENTITY' ? allowedValues(m, a as Attribute) : [];
    if (values.length) s.enum = values;
  }
  if (a.description) s.description = a.description;
  if ((a as Attribute).example) s.examples = [(a as Attribute).example];
  if ((a as Attribute).pii) s['x-pii'] = true;
  return isArray ? { type: 'array', items: s, ...(a.description ? { description: a.description } : {}) } : s;
}

/** JSON Schema 2020-12: one definition per entity under $defs, foreign keys noted with x-references. */
export function toJsonSchema(m: DataModel): string {
  const plan = relationalPlan(m);
  const fkOf = new Map(plan.foreignKeys.map((f) => [`${f.table}.${f.column}`, f]));
  const defs: Record<string, unknown> = {};
  for (const t of plan.tables) {
    const props: Record<string, unknown> = {};
    for (const c of t.columns) {
      const p = jsonField(m, c.entity, c.attr, c.attr.is_array);
      const fk = fkOf.get(`${t.name}.${c.name}`);
      if (fk) p['x-references'] = `#/$defs/${fk.refTable}/properties/${fk.refColumn}`;
      if (c.origin && !c.attr.description) p.description = c.origin;
      props[c.name] = p;
    }
    defs[t.name] = {
      type: 'object',
      title: t.entity && !t.relationship ? t.entity.display_name : t.name,
      ...(t.description ? { description: t.description } : {}),
      properties: props,
      required: t.columns.filter((c) => c.notNull).map((c) => c.name),
      ...(t.pk.length ? { 'x-primary-key': t.pk } : {}),
      additionalProperties: false,
    };
  }
  return (
    JSON.stringify(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `${m.name}.schema.json`, title: `${m.title}${tabSuffix(m)}`, description: m.description || undefined, $comment: MADE_WITH, $defs: defs },
      null,
      2,
    ) + '\n'
  );
}

// ---------------------------------------------------------------- Avro

const AVRO_TYPE: Record<ScalarType, unknown> = {
  STRING: 'string',
  BIGINT: 'long',
  INT: 'int',
  SMALLINT: 'int',
  TINYINT: 'int',
  DECIMAL: 'double',
  DOUBLE: 'double',
  FLOAT: 'float',
  BOOLEAN: 'boolean',
  DATE: { type: 'int', logicalType: 'date' },
  TIMESTAMP: { type: 'long', logicalType: 'timestamp-millis' },
};
const avroName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1');

/** Avro: one record schema per table, as a JSON array (one file holds them all). */
export function toAvro(m: DataModel): string {
  const ns = avroName(m.name);
  const plan = relationalPlan(m);
  const typeOf = (t: RelTable, e: Entity, a: Attribute | StructField, isArray?: boolean): unknown => {
    let base: unknown;
    if (a.type === 'STRUCT') {
      const st = e.struct_types?.find((x) => x.name === (a as Attribute).struct_type);
      base = { type: 'record', name: avroName(`${t.name}_${(a as Attribute).struct_type || a.name}`), fields: (st?.fields || []).map((f) => ({ name: avroName(f.name), type: ['null', typeOf(t, e, f)], default: null })) };
    } else if (valueType(m, a) === 'DECIMAL') {
      // Avro decimal: bytes with the logical type, so precision survives (unlike double).
      const d = decimalOf(m, a as Attribute);
      base = { type: 'bytes', logicalType: 'decimal', precision: d.precision ?? 18, scale: d.scale ?? 2 };
    } else base = AVRO_TYPE[valueType(m, a)];
    return isArray ? { type: 'array', items: base } : base;
  };
  const records = plan.tables.map((t) => ({
    type: 'record',
    name: avroName(t.name),
    namespace: ns,
    ...(t.description ? { doc: t.description } : {}),
    fields: t.columns.map((c) => {
      const ty = typeOf(t, c.entity, c.attr, c.attr.is_array);
      const doc = c.attr.description || c.origin;
      return { name: avroName(c.name), ...(doc ? { doc } : {}), ...(c.notNull ? { type: ty } : { type: ['null', ty], default: null }) };
    }),
  }));
  return JSON.stringify(records, null, 2) + '\n';
}

// ---------------------------------------------------------------- ODCS

const ODCS_LOGICAL: Record<ScalarType, string> = { STRING: 'string', BIGINT: 'integer', INT: 'integer', SMALLINT: 'integer', TINYINT: 'integer', DECIMAL: 'number', DOUBLE: 'number', FLOAT: 'number', BOOLEAN: 'boolean', DATE: 'date', TIMESTAMP: 'date' };
const ODCS_STATUS: Record<string, string> = { draft: 'draft', 'in review': 'proposed', approved: 'active' };

/** Open Data Contract Standard v3 (bitol-io) YAML: the tab as a data contract with schema and properties. */
export function toOdcs(m: DataModel, opts: { dialect?: SqlDialect } = {}): string {
  const d = opts.dialect || (m.tab?.dialect as SqlDialect) || 'databricks';
  const plan = relationalPlan(m);
  const fkOf = new Map(plan.foreignKeys.map((f) => [`${f.table}.${f.column}`, f]));
  const contract = {
    apiVersion: 'v3.0.2',
    kind: 'DataContract',
    id: `${m.name}${m.tab && m.tab.name !== 'Main' ? `-${m.tab.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`,
    name: `${m.title}${tabSuffix(m)}`,
    version: m.version || '0.1.0',
    status: ODCS_STATUS[m.status || 'draft'] || 'draft',
    domain: m.organization || undefined,
    description: m.description ? { purpose: m.description } : undefined,
    schema: plan.tables.map((t) => ({
      name: t.name,
      physicalName: t.name,
      logicalType: 'object',
      physicalType: 'table',
      description: t.description || undefined,
      properties: t.columns.map((c) => {
        const pkPos = t.pk.indexOf(c.name);
        const fk = fkOf.get(`${t.name}.${c.name}`);
        const values = allowedValues(m, c.attr);
        return {
          name: c.name,
          logicalType: c.attr.is_array ? 'array' : c.attr.type === 'STRUCT' ? 'object' : ODCS_LOGICAL[valueType(m, c.attr)],
          physicalType: sqlColumnType(m, c.entity, c.attr, d),
          description: c.attr.description || c.origin || undefined,
          required: c.notNull || undefined,
          primaryKey: pkPos >= 0 || undefined,
          primaryKeyPosition: pkPos >= 0 ? pkPos + 1 : undefined,
          unique: t.unique.includes(c.name) || undefined,
          classification: c.attr.pii ? 'restricted' : undefined,
          examples: c.attr.example ? [c.attr.example] : undefined,
          quality: values.length && values.length <= 200 ? [{ type: 'library', rule: 'validValues', validValues: values }] : undefined,
          relationships: fk ? [{ type: 'foreignKey', to: `${fk.refTable}.${fk.refColumn}` }] : undefined,
        };
      }),
    })),
  };
  return toYaml(contract as any, `${m.title}${tabSuffix(m)} — data contract (ODCS v3)\n${MADE_WITH}`);
}
