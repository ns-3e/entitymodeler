import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromSql, normalizeModel, toAvro, toDbt, toJsonSchema, toOdcs, toSql, toYaml, type DataModel } from '..';

const demo = (): DataModel => {
  const m = normalizeModel(JSON.parse(readFileSync(new URL('../fixtures/supplier.model.json', import.meta.url), 'utf8')));
  m.entities[0].attributes[1].pii = true;
  return m;
};

describe('YAML writer', () => {
  it('round-trips awkward scalars through a real parser', () => {
    const v = { a: 'yes', b: '007', c: 'x: y', d: '', e: 'line\nbreak', f: [1, 'no', { g: null, h: [] }], 'odd key': true, i: "ref('customer')" };
    expect(parse(toYaml(v as any))).toEqual(v);
  });
});

describe('contract exports', () => {
  const m = demo();
  it('dbt schema.yml has models, types and tests', () => {
    const y = parse(toDbt(m));
    expect(y.version).toBe(2);
    const sup = y.models.find((x: any) => x.name === 'supplier');
    const pk = sup.columns.find((c: any) => c.name === 'supplier_id');
    expect(pk.data_tests).toEqual(expect.arrayContaining(['not_null', 'unique']));
    expect(y.models.some((x: any) => x.columns.some((c: any) => c.data_tests?.some((t: any) => t.relationships)))).toBe(true);
    expect(y.models.some((x: any) => x.columns.some((c: any) => c.data_tests?.some((t: any) => t.accepted_values?.values.length)))).toBe(true);
    expect(sup.columns[1].meta).toEqual({ pii: true });
  });

  it('dbt tests that a composite key is unique, and says what that needs', () => {
    const composite = fromSql('CREATE TABLE a (a_id BIGINT PRIMARY KEY, x TEXT); CREATE TABLE line (a_id BIGINT NOT NULL, line_no INT NOT NULL, qty INT, PRIMARY KEY (a_id, line_no));').model;
    const text = toDbt(composite);
    const y = parse(text);
    const line = y.models.find((x: any) => x.name === 'line');
    expect(line.data_tests).toEqual([{ 'dbt_utils.unique_combination_of_columns': { combination_of_columns: ['a_id', 'line_no'] } }]);
    expect(line.columns.find((c: any) => c.name === 'a_id').data_tests).not.toContain('unique');
    expect(y.models.find((x: any) => x.name === 'a').data_tests).toBeUndefined();
    expect(text).toContain('dbt_utils');
    // A model with only single-column keys doesn't ask for the package.
    expect(toDbt(fromSql('CREATE TABLE a (a_id BIGINT PRIMARY KEY, x TEXT);').model)).not.toContain('dbt_utils');
  });

  it('JSON Schema has a definition per table, required keys and enums', () => {
    const s = JSON.parse(toJsonSchema(m));
    expect(s.$schema).toMatch(/2020-12/);
    expect(Object.keys(s.$defs)).toEqual(expect.arrayContaining(['supplier', 'country']));
    expect(s.$defs.supplier.required).toContain('supplier_id');
    expect(JSON.stringify(s)).toContain('"enum"');
    expect(JSON.stringify(s)).toContain('x-references');
  });

  it('Avro records use logical types and nullable unions', () => {
    const recs = JSON.parse(toAvro(m));
    const sup = recs.find((r: any) => r.name === 'supplier');
    expect(sup.type).toBe('record');
    expect(sup.fields.find((f: any) => f.name === 'supplier_id').type).not.toEqual(expect.arrayContaining(['null']));
    expect(sup.fields.some((f: any) => Array.isArray(f.type) && f.type[0] === 'null' && f.default === null)).toBe(true);
  });

  it('ODCS contract parses with schema and properties', () => {
    const c = parse(toOdcs(m));
    expect(c).toMatchObject({ apiVersion: 'v3.0.2', kind: 'DataContract', status: 'draft' });
    const sup = c.schema.find((s: any) => s.name === 'supplier');
    expect(sup.properties.find((p: any) => p.name === 'supplier_id')).toMatchObject({ primaryKey: true, primaryKeyPosition: 1, required: true });
    expect(sup.properties[1].classification).toBe('restricted');
  });

  it('Databricks SQL tags PII columns', () => {
    expect(toSql(m, { dialect: 'databricks' })).toMatch(/ALTER TABLE supplier ALTER COLUMN \w+ SET TAGS \('pii' = 'true'\);/);
    expect(toSql(m, { dialect: 'postgres' })).not.toContain('SET TAGS');
  });
});
