// A mandatory link survives logical/physical round trips: a logical tab has no foreign-key column to hold NOT NULL,
// so the relationship carries it.
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyOps, createModel, deriveTab, diffViews, fromSql, relationalPlan, toSql, validateModel, type DataModel } from './index';

const DDL = `
CREATE TABLE customer (customer_id BIGINT PRIMARY KEY, name VARCHAR(50) NOT NULL);
CREATE TABLE warehouse (warehouse_id BIGINT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE sales_order (
  order_id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customer (customer_id),
  warehouse_id BIGINT REFERENCES warehouse (warehouse_id),
  notes VARCHAR(200)
);`;

const physical = (): DataModel => fromSql(DDL).model;
const logical = (m: DataModel): DataModel => ({ ...m, ...deriveTab(m, 'logical').content });
const toPhysical = (m: DataModel): DataModel => ({ ...m, ...deriveTab(m, 'physical', { physical: { dialect: 'postgres' } }).content });
const column = (m: DataModel, entity: string, name: string) => m.entities.find((e) => e.name === entity)!.attributes.find((a) => a.name === name);
const rel = (m: DataModel, target: string) => m.relationships.find((r) => r.target === target)!;

describe('required relationships', () => {
  it('deriving a logical tab moves NOT NULL from the dropped column to the relationship', () => {
    const l = logical(physical());
    expect(column(l, 'sales_order', 'customer_id')).toBeUndefined();
    expect(rel(l, 'customer').required).toBe(true);
    expect(rel(l, 'warehouse').required).toBeUndefined();
  });

  it('a round trip to physical restores NOT NULL, and only where it was', () => {
    const p = toPhysical(logical(physical()));
    expect(column(p, 'sales_order', 'customer_id')?.required).toBe(true);
    expect(column(p, 'sales_order', 'warehouse_id')?.required).toBeFalsy();
    // The column holds it again, so there is one place to change it.
    expect(rel(p, 'customer').required).toBeUndefined();
  });

  it('survives any number of round trips', () => {
    const twice = toPhysical(logical(toPhysical(logical(physical()))));
    expect(column(twice, 'sales_order', 'customer_id')?.required).toBe(true);
    expect(column(twice, 'sales_order', 'warehouse_id')?.required).toBeFalsy();
  });

  it('marks an existing foreign-key column when deriving physical', () => {
    const m = physical();
    rel(m, 'warehouse').required = true;
    expect(column(toPhysical(m), 'sales_order', 'warehouse_id')?.required).toBe(true);
  });

  it('SQL from a logical tab enforces it, in a real database', async () => {
    const sql = toSql(logical(physical()), { dialect: 'postgres' });
    const table = /CREATE TABLE sales_order \(([\s\S]*?)\n\);/.exec(sql)![1];
    expect(table).toMatch(/customer_id\s+BIGINT\s+NOT NULL/);
    expect(table).toMatch(/warehouse_id\s+BIGINT/);
    expect(table).not.toMatch(/warehouse_id\s+BIGINT\s+NOT NULL/);
    const db = new PGlite();
    await db.exec(sql);
    await db.exec(`INSERT INTO customer (customer_id, name) VALUES (1, 'a')`);
    await db.exec('INSERT INTO sales_order (order_id, customer_id) VALUES (1, 1)');
    await expect(db.exec('INSERT INTO sales_order (order_id) VALUES (2)')).rejects.toThrow(/null/i);
  });

  it('holds on a column an export generates', () => {
    const m = createModel('m', 'M');
    const key = (name: string) => ({ name, label: name, type: 'BIGINT' as const, is_primary_key: true, required: true });
    m.entities.push({ name: 'a', display_name: 'A', entity_type: 'standard', color_code: '#888888', attributes: [key('a_id')] }, { name: 'b', display_name: 'B', entity_type: 'standard', color_code: '#888888', attributes: [key('b_id')] });
    m.relationships.push({ name: 'a_b', source: 'b', target: 'a', cardinality: 'N:1', forward_label: 'Has', bidirectional: false, required: true, attributes: [] });
    const c = relationalPlan(m).tables.find((t) => t.name === 'b')!.columns.find((x) => x.name === 'a_id')!;
    expect(c.notNull).toBe(true);
  });

  it('is kept through an edit and shows in a diff', () => {
    const before = logical(physical());
    const r = applyOps(before, [{ op: 'update_relationship', relationship: rel(before, 'warehouse').name, set: { required: true } }]);
    expect(r.ok).toBe(true);
    const diff = diffViews(before, r.doc, 'none');
    expect(diff.relationships.flatMap((x) => x.details)).toContain('optional → required');
  });

  it('warns that it means nothing on N:N', () => {
    const m = createModel('m', 'M');
    const key = (name: string) => ({ name, label: name, type: 'BIGINT' as const, is_primary_key: true, required: true });
    m.entities.push({ name: 'a', display_name: 'A', entity_type: 'standard', color_code: '#888888', attributes: [key('a_id')] }, { name: 'b', display_name: 'B', entity_type: 'standard', color_code: '#888888', attributes: [key('b_id')] });
    m.relationships.push({ name: 'a_b', source: 'a', target: 'b', cardinality: 'N:N', forward_label: 'Has', bidirectional: false, required: true, attributes: [] });
    expect(validateModel(m).map((i) => i.code)).toContain('rel.reqnn');
  });
});
