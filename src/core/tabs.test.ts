import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  MAIN_TAB,
  addTab,
  copyEntities,
  deriveTab,
  diffCounts,
  diffTabs,
  fromSql,
  issueCounts,
  listTabs,
  logicalEntityName,
  makePrimary,
  resolveTab,
  migrationSql,
  normalizeModel,
  tabView,
  validateModel,
  validateTabs,
  withTab,
  type DataModel,
} from '.';

const PHYSICAL = `
CREATE TABLE tbl_customers (cust_id BIGINT PRIMARY KEY, cust_nm VARCHAR(200) NOT NULL, email_addr VARCHAR(200),
  created_at TIMESTAMP, updated_by VARCHAR(50), etl_batch_id BIGINT);
CREATE TABLE order_status (status_cd VARCHAR(10) PRIMARY KEY, status_desc VARCHAR(100));
CREATE TABLE orders (order_id BIGINT PRIMARY KEY, cust_id BIGINT NOT NULL REFERENCES tbl_customers (cust_id),
  status_cd VARCHAR(10) REFERENCES order_status (status_cd), order_dt DATE, total_amt DECIMAL(12,2), row_hash VARCHAR(64));
CREATE TABLE products (product_id BIGINT PRIMARY KEY, prod_nm VARCHAR(200));
CREATE TABLE customer_products (cust_id BIGINT REFERENCES tbl_customers (cust_id), product_id BIGINT REFERENCES products (product_id),
  created_at TIMESTAMP, PRIMARY KEY (cust_id, product_id));
`;

/**
 * A physical model as a plain DDL importer would produce it: a link table with two foreign keys, and the status
 * lookup as an ordinary table with a foreign key. (EntityModel.com's own SQL import already recognizes both.)
 */
const physical = (): DataModel => {
  const imported = normalizeModel(fromSql(PHYSICAL, { title: 'Shop' }).model);
  const m: DataModel = JSON.parse(JSON.stringify({ ...imported, ...deriveTab(tabView(imported), 'physical').content }));
  for (const e of m.entities) {
    delete e.derived_from;
    for (const a of e.attributes) delete a.derived_from;
  }
  m.entities.find((e) => e.name === 'order_status')!.entity_type = 'standard';
  const status = m.entities.find((e) => e.name === 'orders')!.attributes.find((a) => a.name === 'status_cd')!;
  status.type = 'STRING';
  delete status.reference;
  m.relationships.push({ name: 'orders_status', source: 'orders', target: 'order_status', cardinality: 'N:1', forward_label: 'Has Status', bidirectional: false, foreign_key: 'status_cd', attributes: [] });
  return m;
};

describe('tabs', () => {
  it('projects tabs and writes edits back to the right one', () => {
    const m = physical();
    const id = addTab(m, { name: 'Sketch', kind: 'variant' });
    expect(listTabs(m).map((t) => t.name)).toEqual(['Main', 'Sketch']);
    const next = produce(m, (d) =>
      withTab(d, id, (v) => {
        v.entities.push({ name: 'thing', display_name: 'Thing', entity_type: 'standard', color_code: '#000', attributes: [] });
        v.title = 'Renamed';
      }),
    );
    expect(tabView(next, id).entities.map((e) => e.name)).toEqual(['thing']);
    expect(next.entities.length).toBe(m.entities.length);
    expect(next.title).toBe('Renamed');
  });

  it('makes a tab primary and keeps lineage pointing at the same content', () => {
    const m = physical();
    const id = addTab(m, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(m), 'logical').content);
    const mainNames = m.entities.map((e) => e.name);
    makePrimary(m, id);
    expect(m.tab?.name).toBe('Logical');
    // The old primary gets an id from its own name, never the promoted tab's old id.
    const demoted = listTabs(m).find((t) => t.name === 'Main')!;
    expect(demoted.id).toBe('main_2');
    expect(m.tab?.derived_from).toBe('main_2');
    expect(tabView(m, 'main_2').entities.map((e) => e.name)).toEqual(mainNames);
    // No tab has the id "logical" any more, so the name finds the promoted tab.
    expect(resolveTab(m, 'logical')).toBe('main');
    expect(validateTabs(m)).toEqual([]);
  });

  it('copies entities with their relationships between tabs', () => {
    const m = physical();
    const target = tabView(m, addTab(m, { name: 'Empty', kind: 'variant' }));
    const r = copyEntities(tabView(m), ['orders', 'tbl_customers'], target, { rename: false });
    expect(r.added.sort()).toEqual(['orders', 'tbl_customers']);
    expect(target.relationships.map((x) => `${x.source}>${x.target}`)).toEqual(['orders>tbl_customers']);
    expect(target.entities.find((e) => e.name === 'orders')?.attributes.find((a) => a.name === 'status_cd')?.type).toBe('STRING');
    const again = copyEntities(tabView(m), ['orders'], tabView(m), { rename: true });
    expect(again.added).toEqual(['orders_copy']);
  });
});

describe('derive logical from physical', () => {
  const { content, report } = deriveTab(tabView(physical()), 'logical');
  const view = { ...tabView(physical()), ...content, tab: { name: 'Logical', kind: 'logical' as const } };
  const byLineage = (src: string) => content.entities.find((e) => e.derived_from === src);

  it('uses business names', () => {
    expect(logicalEntityName('tbl_customers')).toBe('customer');
    expect(logicalEntityName('dim_product_categories')).toBe('product_category');
    expect(logicalEntityName('address')).toBe('address');
    expect(byLineage('tbl_customers')?.name).toBe('customer');
    expect(byLineage('tbl_customers')?.attributes.map((a) => a.name)).toEqual(['customer_id', 'customer_name', 'email_address']);
  });

  it('drops technical and foreign-key columns, keeps lookups as reference data', () => {
    const order = byLineage('orders')!;
    expect(order.attributes.map((a) => a.name)).toEqual(['order_id', 'status_code', 'order_date', 'total_amount']);
    const status = order.attributes.find((a) => a.name === 'status_code')!;
    expect(status.type).toBe('REFERENCE_ENTITY');
    expect(byLineage('order_status')?.entity_type).toBe('reference');
    expect(report.references).toEqual(['order_status']);
  });

  it('collapses the link table into an N:N relationship', () => {
    expect(byLineage('customer_products')).toBeUndefined();
    expect(content.relationships.find((r) => r.cardinality === 'N:N')).toMatchObject({ source: 'customer', target: 'product' });
    expect(report.junctions).toEqual(['customer_products']);
  });

  it('is valid', () => {
    expect(issueCounts(validateModel(view)).error).toBe(0);
  });

  it('round-trips back to a physical model with keys and a junction table', () => {
    const phys = deriveTab(view, 'physical').content;
    const order = phys.entities.find((e) => e.name === 'order')!;
    expect(order.attributes.map((a) => a.name)).toContain('customer_id');
    expect(phys.entities.some((e) => e.attributes.filter((a) => a.is_primary_key).length === 2)).toBe(true);
    expect(issueCounts(validateModel({ ...view, ...phys })).error).toBe(0);
  });

  it('derives a conceptual view that validates without attributes', () => {
    const c = deriveTab(view, 'conceptual').content;
    expect(c.entities.every((e) => !e.attributes.length)).toBe(true);
    expect(c.entities.some((e) => e.entity_type === 'reference')).toBe(false);
    expect(issueCounts(validateModel({ ...view, ...c, tab: { name: 'C', kind: 'conceptual' } })).error).toBe(0);
  });
});

describe('diff and migration', () => {
  it('matches renamed things by lineage', () => {
    const m = physical();
    const id = addTab(m, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(m), 'logical').content);
    const d = diffTabs(m, MAIN_TAB, id);
    expect(d.matching).toBe('lineage');
    const customer = d.entities.find((e) => e.name === 'customer')!;
    expect(customer).toMatchObject({ change: 'changed', from: 'tbl_customers' });
    expect(customer.attributes.find((a) => a.name === 'customer_name')).toMatchObject({ from: 'cust_nm' });
    expect(d.entities.find((e) => e.name === 'customer_products')?.change).toBe('removed');
    expect(diffCounts(d).removed).toBeGreaterThan(0);
  });

  it('writes migration DDL with renames, adds and drops', () => {
    const m = physical();
    const v2 = produce(tabView(m), (d) => {
      d.entities = d.entities.map((e) => ({ ...e, derived_from: e.name, attributes: e.attributes.map((a) => ({ ...a, derived_from: a.name })) }));
      const p = d.entities.find((e) => e.name === 'products')!;
      p.attributes.push({ name: 'sku', label: 'SKU', type: 'STRING' });
      p.attributes = p.attributes.filter((a) => a.name !== 'prod_nm');
      d.entities.find((e) => e.name === 'orders')!.attributes.find((a) => a.name === 'order_dt')!.name = 'ordered_on';
    });
    const id = addTab(m, { name: 'v2', kind: 'physical', derived_from: MAIN_TAB }, v2);
    const sql = migrationSql(m, MAIN_TAB, id, 'postgres');
    expect(sql).toMatch(/ALTER TABLE "?products"? ADD COLUMN "?sku"? \w+;/);
    expect(sql).toMatch(/ALTER TABLE "?products"? DROP COLUMN "?prod_nm"?;/);
    expect(sql).toMatch(/ALTER TABLE "?orders"? RENAME COLUMN "?order_dt"? TO "?ordered_on"?;/);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('CREATE TABLE');
  });
});

describe('demo model', () => {
  it('derives a valid physical tab', () => {
    const demo = normalizeModel(JSON.parse(readFileSync(new URL('./fixtures/supplier.model.json', import.meta.url), 'utf8')));
    const { content } = deriveTab(tabView(demo), 'physical');
    expect(issueCounts(validateModel({ ...demo, ...content })).error).toBe(0);
  });
});

describe('tab lookup', () => {
  it('prefers an exact id over another tab’s name', () => {
    const m = physical();
    const a = addTab(m, { name: 'logical', kind: 'variant' });
    const b = addTab(m, { name: 'Logical copy', kind: 'logical' });
    expect(a).toBe('logical');
    // Give tab b a name equal to tab a's id: the id still wins.
    withTab(m, b, () => {});
    m.tabs!.find((t) => t.id === b)!.name = 'Logical';
    expect(resolveTab(m, 'logical')).toBe(a);
    expect(resolveTab(m, 'Logical copy')).toBeUndefined();
    expect(resolveTab(m, b)).toBe(b);
  });
});
