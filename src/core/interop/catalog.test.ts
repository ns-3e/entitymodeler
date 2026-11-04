import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyOps, catalogQuery, createModel, diffTabs, fromCatalog, fromCatalogRows, fromUnityCatalog, issueCounts, listTabs, planPull, tabView, validateModel, type DataModel } from '..';

const DDL = `
CREATE TABLE country (country_code CHAR(2) PRIMARY KEY, country_name TEXT NOT NULL);
CREATE TABLE customer (customer_id BIGINT PRIMARY KEY, name TEXT NOT NULL, country_code CHAR(2) REFERENCES country (country_code), created_at TIMESTAMPTZ);
COMMENT ON TABLE customer IS 'People and companies that buy from us.';
COMMENT ON COLUMN customer.name IS 'Legal name.';
CREATE TABLE orders (order_id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES customer (customer_id), total NUMERIC(12,2));
CREATE TABLE product (product_id INT PRIMARY KEY, title TEXT);
CREATE TABLE order_product (order_id BIGINT REFERENCES orders (order_id), product_id INT REFERENCES product (product_id), PRIMARY KEY (order_id, product_id));
CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
`;

async function pgRows(ddl: string): Promise<Record<string, string>[]> {
  const db = new PGlite();
  await db.exec(ddl);
  const res = await db.query<Record<string, unknown>>(catalogQuery('postgres', { schema: 'public' }));
  await db.close();
  return res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)])));
}

describe('catalog import', () => {
  it('reads a live PostgreSQL schema through the catalog query', async () => {
    const snap = fromCatalogRows([await pgRows(DDL)], 'postgres', { schema: 'public' });
    expect(snap.tables.map((t) => t.name).sort()).toEqual(['country', 'customer', 'order_product', 'orders', 'product']);
    const customer = snap.tables.find((t) => t.name === 'customer')!;
    expect(customer.comment).toBe('People and companies that buy from us.');
    expect(customer.primary_key).toEqual(['customer_id']);
    expect(customer.columns.find((c) => c.name === 'name')).toMatchObject({ comment: 'Legal name.', nullable: false });
    expect(customer.foreign_keys).toEqual([expect.objectContaining({ columns: ['country_code'], ref_table: 'country', ref_columns: ['country_code'] })]);
    expect(snap.tables.find((t) => t.name === 'order_product')!.primary_key).toEqual(['order_id', 'product_id']);

    const { model } = fromCatalog(snap);
    // Same recognition as DDL import: the lookup is reference data, the link table an N:N relationship.
    expect(model.entities.find((e) => e.name === 'country')?.entity_type).toBe('standard');
    expect(model.relationships.find((r) => r.cardinality === 'N:N')).toMatchObject({ source: 'orders', target: 'product' });
    expect(model.relationships.find((r) => r.source === 'orders' && r.target === 'customer')?.foreign_key).toBe('customer_id');
    expect(issueCounts(validateModel(model)).error).toBe(0);
  });

  it('reads Snowflake columns plus SHOW PRIMARY/IMPORTED KEYS results', () => {
    const cols = [
      { TABLE_SCHEMA: 'SALES', TABLE_NAME: 'CUSTOMER', TABLE_COMMENT: '', COLUMN_NAME: 'ID', ORDINAL_POSITION: '1', DATA_TYPE: 'NUMBER', IS_NULLABLE: 'NO', COLUMN_COMMENT: '' },
      { TABLE_SCHEMA: 'SALES', TABLE_NAME: 'CUSTOMER', TABLE_COMMENT: '', COLUMN_NAME: 'NAME', ORDINAL_POSITION: '2', DATA_TYPE: 'TEXT', IS_NULLABLE: 'YES', COLUMN_COMMENT: 'Display name' },
      { TABLE_SCHEMA: 'SALES', TABLE_NAME: 'ORDERS', TABLE_COMMENT: 'Orders', COLUMN_NAME: 'ID', ORDINAL_POSITION: '1', DATA_TYPE: 'NUMBER', IS_NULLABLE: 'NO', COLUMN_COMMENT: '' },
      { TABLE_SCHEMA: 'SALES', TABLE_NAME: 'ORDERS', TABLE_COMMENT: 'Orders', COLUMN_NAME: 'CUSTOMER_ID', ORDINAL_POSITION: '2', DATA_TYPE: 'NUMBER', IS_NULLABLE: 'NO', COLUMN_COMMENT: '' },
    ];
    const pks = [
      { created_on: '', database_name: 'DB', schema_name: 'SALES', table_name: 'CUSTOMER', column_name: 'ID', key_sequence: '1', constraint_name: 'PK1', rely: 'false', comment: '' },
      { created_on: '', database_name: 'DB', schema_name: 'SALES', table_name: 'ORDERS', column_name: 'ID', key_sequence: '1', constraint_name: 'PK2', rely: 'false', comment: '' },
    ];
    const fks = [{ pk_schema_name: 'SALES', pk_table_name: 'CUSTOMER', pk_column_name: 'ID', fk_schema_name: 'SALES', fk_table_name: 'ORDERS', fk_column_name: 'CUSTOMER_ID', key_sequence: '1', fk_name: 'FK_ORDER_CUSTOMER' }];
    const snap = fromCatalogRows([cols, pks, fks], 'snowflake', { catalog: 'DB', schema: 'SALES' });
    expect(snap.tables.find((t) => t.name === 'ORDERS')).toMatchObject({ primary_key: ['ID'], foreign_keys: [{ columns: ['CUSTOMER_ID'], ref_table: 'CUSTOMER', ref_columns: ['ID'] }] });
    const { model } = fromCatalog(snap);
    expect(model.relationships).toHaveLength(1);
    expect(model.entities.find((e) => e.name === 'customer')?.attributes.find((a) => a.name === 'NAME')?.description).toBe('Display name');
  });

  it('reads Unity Catalog REST table info, skipping views', () => {
    const snap = fromUnityCatalog(
      [
        { name: 'customer', schema_name: 'sales', table_type: 'MANAGED', comment: 'Customers', columns: [{ name: 'id', type_text: 'bigint', position: 0, nullable: false }, { name: 'name', type_text: 'string', position: 1 }], table_constraints: [{ primary_key_constraint: { name: 'pk', child_columns: ['id'] } }] },
        { name: 'orders', schema_name: 'sales', table_type: 'MANAGED', columns: [{ name: 'id', type_text: 'bigint', position: 0, nullable: false }, { name: 'customer_id', type_text: 'bigint', position: 1 }], table_constraints: [{ primary_key_constraint: { child_columns: ['id'] } }, { foreign_key_constraint: { name: 'fk_orders_customer', child_columns: ['customer_id'], parent_table: 'main.sales.customer', parent_columns: ['id'] } }] },
        { name: 'v', schema_name: 'sales', table_type: 'VIEW', columns: [] },
      ],
      { catalog: 'main', schema: 'sales' },
    );
    expect(snap.tables.map((t) => t.name)).toEqual(['customer', 'orders']);
    const { model } = fromCatalog(snap);
    expect(model.relationships[0]).toMatchObject({ source: 'orders', target: 'customer', foreign_key: 'customer_id' });
  });
});

describe('pull plan', () => {
  it('fills an empty model, then adds a dated version tab that diffs against it', async () => {
    const first = fromCatalogRows([await pgRows(DDL)], 'postgres', { schema: 'public' });
    const plan1 = planPull(createModel('shop', 'Shop'), first);
    const r1 = applyOps(createModel('shop', 'Shop'), plan1.ops);
    expect(r1.ok).toBe(true);
    const doc1 = (r1 as { doc: DataModel }).doc;
    expect(listTabs(doc1)).toHaveLength(1);
    expect(doc1.tab).toMatchObject({ kind: 'physical', dialect: 'postgres', source: { platform: 'postgres', schema: 'public' } });
    doc1.entities.find((e) => e.name === 'customer')!.ui = { x: 100, y: 200 };

    // The database changed: a new column, a dropped table.
    const second = fromCatalogRows([await pgRows(DDL.replace('created_at TIMESTAMPTZ', 'created_at TIMESTAMPTZ, segment TEXT').replace(/CREATE VIEW[^;]+;/, ''))], 'postgres', { schema: 'public' });
    second.tables = second.tables.filter((t) => t.name !== 'product' && t.name !== 'order_product');
    second.captured_at = '2026-12-01T00:00:00.000Z';
    const plan2 = planPull(doc1, second);
    expect(plan2.previous).toBe('main');
    const r2 = applyOps(doc1, plan2.ops);
    expect(r2.ok).toBe(true);
    const doc2 = (r2 as { doc: DataModel }).doc;
    const tab = listTabs(doc2)[1];
    expect(tab).toMatchObject({ name: 'public (PostgreSQL) @ 2026-12-01', derived_from: 'main' });
    expect(tabView(doc2, tab.id).entities.find((e) => e.name === 'customer')!.ui).toEqual({ x: 100, y: 200 });
    const d = diffTabs(doc2, 'main', tab.id);
    expect(d.matching).toBe('lineage');
    expect(d.entities.find((e) => e.name === 'customer')!.attributes).toEqual([expect.objectContaining({ change: 'added', name: 'segment' })]);
    expect(d.entities.find((e) => e.name === 'product')?.change).toBe('removed');
  });
});
