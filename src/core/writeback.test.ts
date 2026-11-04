import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { addColumnTags, applyOps, catalogQuery, createModel, fromCatalogRows, planPull, tabView, writebackPlan, type CatalogSnapshot, type DataModel } from '.';

const DDL = `
CREATE TABLE customer (customer_id BIGINT PRIMARY KEY, email TEXT, status TEXT);
COMMENT ON TABLE customer IS 'People who buy.';
COMMENT ON COLUMN customer.status IS 'Lifecycle state.';
CREATE TABLE "Order Lines" (line_id INT PRIMARY KEY, note TEXT);
`;

const rows = (r: { rows: Record<string, unknown>[] }) => r.rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)])));
const snapshot = async (db: PGlite) => fromCatalogRows([rows(await db.query(catalogQuery('postgres', { schema: 'public' })))], 'postgres', { schema: 'public' });

/** Pull the schema, then document it the way a person would in the app. */
async function documented(db: PGlite): Promise<DataModel> {
  const doc = applyOps(createModel('shop', 'Shop'), planPull(createModel('shop', 'Shop'), await snapshot(db)).ops).doc;
  return applyOps(doc, [
    { op: 'update_entity', entity: 'customer', set: { description: 'People and companies that buy from us.' } },
    { op: 'update_attribute', entity: 'customer', attribute: 'email', set: { description: 'Where receipts go. Don’t share it.' } },
    { op: 'update_attribute', entity: 'customer', attribute: 'status', set: { description: '' } },
    { op: 'update_attribute', entity: 'order_lines', attribute: 'note', set: { description: 'Free text from the "notes" box.' } },
  ]).doc;
}

describe('catalog write-back', () => {
  it('writes only what differs, runs on PostgreSQL, and has nothing left to write afterwards', async () => {
    const db = new PGlite();
    await db.exec(DDL);
    const doc = await documented(db);
    const plan = writebackPlan(tabView(doc), await snapshot(db));
    // The status comment stays: a blank description in the model never clears the catalog's.
    expect(plan.map((s) => s.what).sort()).toEqual(['Order Lines.note: description', 'customer.email: description', 'customer: table description']);
    expect(plan.find((s) => s.what.startsWith('Order'))!.sql).toBe(`COMMENT ON COLUMN public."Order Lines".note IS 'Free text from the "notes" box.';`);
    for (const s of plan) await db.exec(s.sql);
    const after = await snapshot(db);
    expect(after.tables.find((t) => t.name === 'customer')).toMatchObject({ comment: 'People and companies that buy from us.' });
    expect(after.tables.find((t) => t.name === 'customer')!.columns.find((c) => c.name === 'status')!.comment).toBe('Lifecycle state.');
    expect(writebackPlan(tabView(doc), after)).toEqual([]);
    await db.close();
  });

  it('sets Databricks tags the catalog is missing, with column comments through ALTER COLUMN', () => {
    const snap: CatalogSnapshot = {
      platform: 'databricks',
      catalog: 'main',
      schema: 'sales',
      captured_at: '',
      tables: [{ schema: 'sales', name: 'customer', columns: [{ name: 'email', type: 'string', nullable: true }, { name: 'phone', type: 'string', nullable: true }], primary_key: [], foreign_keys: [] }],
    };
    addColumnTags(snap, [{ table_name: 'customer', column_name: 'phone', tag_name: 'pii', tag_value: 'true' }]);
    const m = createModel('t', 'T');
    m.entities.push({
      name: 'customer',
      display_name: 'Customer',
      entity_type: 'standard',
      color_code: '#000',
      attributes: [
        { name: 'email', label: 'Email', type: 'STRING', pii: true, description: "Customer's email" },
        { name: 'phone', label: 'Phone', type: 'STRING', pii: true },
      ],
    });
    expect(writebackPlan(m, snap).map((s) => s.sql)).toEqual([
      "ALTER TABLE main.sales.customer ALTER COLUMN email COMMENT 'Customer''s email';",
      "ALTER TABLE main.sales.customer ALTER COLUMN email SET TAGS ('pii' = 'true');",
    ]);
    expect(writebackPlan(m, snap, { tags: false })).toHaveLength(1);
  });
});
