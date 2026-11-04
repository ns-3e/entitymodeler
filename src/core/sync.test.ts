import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { MAIN_TAB, addTab, applyOps, applySync, deriveTab, fromSql, issueCounts, normalizeModel, syncPlan, tabView, validateModel, withTab, type DataModel } from '.';

const DDL = `
CREATE TABLE tbl_customers (cust_id BIGINT PRIMARY KEY, cust_nm TEXT NOT NULL, credit_lmt INT);
CREATE TABLE orders (order_id BIGINT PRIMARY KEY, cust_id BIGINT NOT NULL REFERENCES tbl_customers (cust_id), order_dt DATE);
CREATE TABLE legacy_notes (note_id BIGINT PRIMARY KEY, body TEXT);
`;

/** Physical source on the primary tab, a logical tab derived from it, and a person's edit on that tab. */
function setup(): { doc: DataModel; logical: string } {
  const doc = normalizeModel(fromSql(DDL, { title: 'Shop' }).model);
  const logical = addTab(doc, { name: 'Logical', kind: 'logical', derived_from: MAIN_TAB }, deriveTab(tabView(doc), 'logical').content);
  withTab(doc, logical, (v) => {
    const c = v.entities.find((e) => e.name === 'customer')!;
    c.description = 'Someone who buys from us.';
    c.attributes.find((a) => a.name === 'customer_name')!.name = 'full_name'; // renamed by hand
  });
  return { doc, logical };
}

describe('sync from source', () => {
  it('is empty right after deriving', () => {
    const { doc, logical } = setup();
    expect(syncPlan(doc, MAIN_TAB, logical)).toEqual([]);
  });

  it('finds what changed in the source and brings it over the way the tab was made', () => {
    const { doc, logical } = setup();
    const r = applyOps(doc, [
      { op: 'add_attribute', entity: 'tbl_customers', attribute: { name: 'email_addr', type: 'STRING' } },
      { op: 'update_attribute', entity: 'tbl_customers', attribute: 'credit_lmt', set: { type: 'DOUBLE' } },
      { op: 'add_entity', entity: { name: 'invoices', attributes: [{ name: 'inv_id', label: 'Invoice ID', type: 'BIGINT', is_primary_key: true }, { name: 'order_id', label: 'Order', type: 'BIGINT' }] } },
      { op: 'add_relationship', relationship: { name: 'invoice_for', source: 'invoices', target: 'orders', cardinality: 'N:1', foreign_key: 'order_id' } },
      { op: 'delete_entity', entity: 'legacy_notes' },
    ]);
    expect(r.ok).toBe(true);
    const src = (r as { doc: DataModel }).doc;
    const plan = syncPlan(src, MAIN_TAB, logical);
    const labels = plan.map((c) => `${c.kind}:${c.label}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        'attribute_added:customer: new attribute email_address (STRING)',
        'attribute_changed:customer.credit_lmt: INT → DOUBLE',
        expect.stringMatching(/^entity_added:New entity invoice /),
        'relationship_added:New relationship invoice → order (N:1)',
        'entity_removed:legacy_note: gone from the source',
      ]),
    );
    // The hand rename is respected: no "new customer_name".
    expect(labels.some((l) => l.includes('customer_name'))).toBe(false);
    expect(plan.find((c) => c.kind === 'entity_removed')!.suggested).toBe(false);

    const next = produce(src, (d) => void applySync(d as DataModel, plan.filter((c) => c.suggested), logical));
    const v = tabView(next, logical);
    expect(v.entities.find((e) => e.name === 'invoice')).toBeDefined();
    expect(v.entities.find((e) => e.name === 'legacy_note')).toBeDefined(); // flagged, not removed
    expect(v.entities.find((e) => e.name === 'customer')!.description).toBe('Someone who buys from us.');
    expect(v.relationships.some((x) => x.source === 'invoice' && x.target === 'order')).toBe(true);
    expect(issueCounts(validateModel(v)).error).toBe(0);
    expect(syncPlan(next, MAIN_TAB, logical).filter((c) => c.suggested)).toEqual([]);
  });
});
