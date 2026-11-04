// Regressions from the end-to-end agent trial (a legacy ERP → logical → Databricks run through MCP).
import { describe, expect, it } from 'vitest';
import { MAIN_TAB, addTab, applyOps, autoMap, deriveTab, fromSql, listTabs, normalizeModel, tabView, withTab, renameEntity, renameAttribute, type DataModel } from '.';

const ERP = `
CREATE TABLE tbl_ord_hdr (ord_id BIGINT PRIMARY KEY, cust_nm VARCHAR(100), crt_dt TIMESTAMP, row_hash CHAR(64));
CREATE TABLE tbl_prod (prod_id INT PRIMARY KEY, prod_nm VARCHAR(200), sku VARCHAR(40) UNIQUE);
CREATE TABLE tbl_ord_line (ord_id BIGINT REFERENCES tbl_ord_hdr (ord_id), line_nbr INT, prod_id INT REFERENCES tbl_prod (prod_id), qty INT, PRIMARY KEY (ord_id, line_nbr));
CREATE TABLE tbl_supp (supp_id INT PRIMARY KEY, supp_nm VARCHAR(200));
CREATE TABLE prod_supplier_xref (prod_id INT REFERENCES tbl_prod (prod_id), supp_id INT REFERENCES tbl_supp (supp_id), PRIMARY KEY (prod_id, supp_id));
`;

describe('agent trial fixes', () => {
  it('imports a faithful physical copy: link tables stay tables, display names avoid keys and ETL columns', () => {
    const m = fromSql(ERP, { keepJunctions: true }).model;
    expect(m.entities.map((e) => e.name)).toContain('prod_supplier_xref');
    const hdr = m.entities.find((e) => e.name === 'tbl_ord_hdr')!;
    expect(hdr.attributes.find((a) => a.is_label)!.name).toBe('cust_nm');
    const line = m.entities.find((e) => e.name === 'tbl_ord_line')!;
    expect(line.attributes.find((a) => a.is_label)!.name).not.toMatch(/^(ord_id|prod_id)$/);
    expect(m.entities.find((e) => e.name === 'tbl_prod')!.attributes.find((a) => a.name === 'sku')!.unique).toBe(true);
  });

  it('derives physical from logical without duplicating an identifying foreign key, and names junctions by what they link', () => {
    const legacy = normalizeModel(fromSql(ERP, { keepJunctions: true }).model);
    const logical = { ...legacy, ...deriveTab(tabView(legacy), 'logical').content };
    // A person renames the N:N to a verb, as the agent did.
    const nn = logical.relationships.find((r) => r.cardinality === 'N:N')!;
    nn.name = 'supplied_by';
    const phys = deriveTab(logical, 'physical').content;
    const line = phys.entities.find((e) => e.derived_from === 'order_line')!;
    expect(line.attributes.filter((a) => /order_id/.test(a.name)).map((a) => a.name)).toEqual(['order_id']);
    expect(phys.entities.some((e) => e.name === 'product_supplier')).toBe(true);
  });

  it('auto-maps through intermediate tabs, after renames', () => {
    const doc = normalizeModel(fromSql(ERP, { keepJunctions: true }).model);
    const logical = addTab(doc, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(doc), 'logical').content);
    withTab(doc, logical, (v) => {
      renameEntity(v, 'order_hdr', 'sales_order');
      renameAttribute(v, 'sales_order', 'customer_name', 'buyer_name');
    });
    const db = addTab(doc, { name: 'Databricks', kind: 'physical', derived_from: logical }, deriveTab(tabView(doc, logical), 'physical').content);
    const pairs = autoMap(doc, MAIN_TAB, db).map((x) => `${x.target.entity}.${x.target.attribute}<-${x.sources[0].entity}.${x.sources[0].attribute}`);
    expect(pairs).toEqual(expect.arrayContaining(['sales_order.buyer_name<-tbl_ord_hdr.cust_nm', 'sales_order.order_id<-tbl_ord_hdr.ord_id']));
  });

  it('manages tabs with ops: make primary, delete the old empty one', () => {
    const doc: DataModel = normalizeModel({ format: 'entitymodeler', format_version: 1, name: 'x', title: 'X', entities: [], relationships: [], hierarchies: [], areas: [], notes: [] });
    const r = applyOps(doc, [
      { op: 'add_tab', name: 'Logical', kind: 'logical', content: deriveTab(tabView(normalizeModel(fromSql(ERP).model)), 'logical').content },
      { op: 'make_primary', tab: 'Logical' },
      { op: 'delete_tab', tab: 'Main' },
    ]);
    expect(r.ok).toBe(true);
    expect(listTabs((r as { doc: DataModel }).doc).map((t) => t.name)).toEqual(['Logical']);
    expect(applyOps((r as { doc: DataModel }).doc, [{ op: 'delete_tab', tab: 'Logical' }]).ok).toBe(false);
  });
});
