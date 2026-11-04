import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MAIN_TAB, addTab, applyOps, autoMap, buildDocTables, deleteTab, deriveTab, fromSql, mappingCoverage, mappingSql, mappingsCsv, normalizeModel, renameAttribute, tabView, validateTabs, withTab, type DataModel } from '.';

const DDL = `
CREATE TABLE tbl_customers (cust_id BIGINT PRIMARY KEY, cust_nm TEXT NOT NULL, created_at TIMESTAMP);
CREATE TABLE orders (order_id BIGINT PRIMARY KEY, cust_id BIGINT NOT NULL REFERENCES tbl_customers (cust_id), order_dt DATE);
`;

function setup(): { doc: DataModel; logical: string } {
  const doc = normalizeModel(fromSql(DDL, { title: 'Shop' }).model);
  const logical = addTab(doc, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(doc), 'logical').content);
  return { doc, logical };
}

describe('mappings', () => {
  it('auto-map through lineage, then report coverage', () => {
    const { doc, logical } = setup();
    const maps = autoMap(doc, MAIN_TAB, logical);
    const pairs = maps.map((x) => `${x.target.entity}.${x.target.attribute}<-${x.sources[0].entity}.${x.sources[0].attribute}`);
    expect(pairs).toEqual(expect.arrayContaining(['customer.customer_id<-tbl_customers.cust_id', 'customer.customer_name<-tbl_customers.cust_nm', 'order.order_date<-orders.order_dt']));
    doc.mappings = maps;
    expect(mappingCoverage(doc, logical).pct).toBe(100);
    expect(autoMap(doc, MAIN_TAB, logical)).toEqual([]);
  });

  it('auto-map by name between unrelated tabs', () => {
    const { doc } = setup();
    const other = addTab(doc, { name: 'Staging', kind: 'physical' }, { entities: [{ name: 'customers', display_name: 'Customers', entity_type: 'standard', color_code: '#000', attributes: [{ name: 'CUST_ID', label: 'Id', type: 'BIGINT' }, { name: 'CustNm', label: 'Name', type: 'STRING' }] }], relationships: [], hierarchies: [], areas: [], notes: [] });
    const maps = autoMap(doc, other, MAIN_TAB);
    expect(maps.map((x) => `${x.target.attribute}<-${x.sources[0].attribute}`)).toEqual(expect.arrayContaining(['cust_id<-CUST_ID', 'cust_nm<-CustNm']));
  });

  it('follow renames and deletes in either tab, and tab deletion', () => {
    const { doc, logical } = setup();
    doc.mappings = autoMap(doc, MAIN_TAB, logical);
    // A rename through the UI path (withTab + the cascade functions) and one through ops.
    const next = produce(doc, (d) => withTab(d as DataModel, MAIN_TAB, (v) => renameAttribute(v, 'tbl_customers', 'cust_nm', 'customer_nm')));
    expect(next.mappings!.some((x) => x.sources[0].attribute === 'customer_nm')).toBe(true);
    const r = applyOps(next, [{ op: 'rename_entity', tab: 'Logical', entity: 'customer', to: 'client' }, { op: 'delete_attribute', tab: 'Logical', entity: 'order', attribute: 'order_date' }]);
    expect(r.ok).toBe(true);
    const d = (r as { doc: DataModel }).doc;
    expect(d.mappings!.filter((x) => x.target.entity === 'client')).toHaveLength(2);
    expect(d.mappings!.some((x) => x.target.attribute === 'order_date')).toBe(false);
    expect(validateTabs(d)).toEqual([]);
    deleteTab(d, logical);
    expect(d.mappings).toEqual([]);
  });

  it('set and delete mappings with ops, and flag dangling ends', () => {
    const { doc, logical } = setup();
    const r = applyOps(doc, [{ op: 'set_mapping', target: { tab: 'Logical', entity: 'customer', attribute: 'customer_name' }, sources: [{ tab: 'main', entity: 'tbl_customers', attribute: 'cust_nm' }], transform: 'initcap(src.cust_nm)' }]);
    expect(r.ok).toBe(true);
    const d = (r as { doc: DataModel }).doc;
    expect(d.mappings).toHaveLength(1);
    expect(applyOps(d, [{ op: 'set_mapping', target: { tab: 'Logical', entity: 'nope', attribute: 'x' }, sources: [] }]).ok).toBe(false);
    d.mappings![0].sources[0].attribute = 'gone';
    expect(validateTabs(d).map((i) => i.code)).toEqual(['map.dangling']);
    const r2 = applyOps(d, [{ op: 'delete_mapping', target: { tab: logical, entity: 'customer', attribute: 'customer_name' } }]);
    expect((r2 as { doc: DataModel }).doc.mappings).toBeUndefined();
  });

  it('write a doc table, CSV and dbt SQL', () => {
    const { doc, logical } = setup();
    doc.mappings = autoMap(doc, MAIN_TAB, logical);
    doc.mappings.find((x) => x.target.attribute === 'customer_name')!.transform = 'initcap(src.cust_nm)';
    const tables = buildDocTables(tabView(doc, logical), { sections: ['mappings'] });
    expect(tables.map((t) => t.id)).toEqual(['mappings-customer', 'mappings-order']);
    expect(tables[0].rows.find((r) => r[0] === 'customer_name')).toEqual(['customer_name', 'tbl_customers.cust_nm', 'initcap(src.cust_nm)', 'draft', '']);
    expect(buildDocTables(tabView(doc), { sections: ['mappings'] })).toEqual([]);
    expect(mappingsCsv(doc, logical).split('\n')[0]).toBe('target_entity,target_attribute,sources,transform,status,notes');
    const sql = mappingSql(doc, logical, 'customer');
    expect(sql).toContain('initcap(src.cust_nm) as customer_name');
    expect(sql).toContain("from {{ ref('tbl_customers') }} as src");
    // An unmapped column keeps its comma outside the TODO comment.
    doc.mappings = doc.mappings.filter((x) => x.target.attribute !== 'customer_id');
    expect(mappingSql(doc, logical, 'customer')).toContain('null as customer_id,  -- TODO: not mapped yet');
  });
});
