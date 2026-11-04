import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deleteAttribute, normalizeModel, renameAttribute, type DataModel } from '../../core';
import { estimateNodeHeight, isFolded, nodeRows, rowCenterY } from './geometry';

const demo = (): DataModel => normalizeModel(JSON.parse(readFileSync(new URL('../../../models/customer-demo/model.json', import.meta.url), 'utf8')));
const customer = (m: DataModel) => m.entities.find((e) => e.name === 'customer')!;

describe('folded struct fields', () => {
  it('drops the fields of a folded struct from the node, keeping the struct row', () => {
    const m = demo();
    const c = customer(m);
    const open = nodeRows(c, 'full');
    expect(open.filter((r) => r.kind === 'field' && r.attr === 'billing_address')).toHaveLength(6);
    c.ui = { ...c.ui!, folded: ['billing_address'] };
    expect(isFolded(c, 'billing_address')).toBe(true);
    const folded = nodeRows(c, 'full');
    expect(folded.some((r) => r.kind === 'field')).toBe(false);
    expect(folded.some((r) => r.key === 'attr:billing_address')).toBe(true);
    expect(folded).toHaveLength(open.length - 6);
    expect(estimateNodeHeight(c, 'full')).toBeLessThan((open.length + 2) * 24 + 58);
  });

  it('hides folded reference fields in keys view too', () => {
    const c = customer(demo());
    expect(nodeRows(c, 'keys').some((r) => r.kind === 'field')).toBe(true);
    c.ui = { ...c.ui!, folded: ['billing_address'] };
    expect(nodeRows(c, 'keys').some((r) => r.kind === 'field')).toBe(false);
    // A line from a folded field lands on the struct's own row.
    const structRow = rowCenterY(c, 'keys', (r) => r.kind === 'attr' && r.attr === 'billing_address');
    expect(structRow).toBeGreaterThan(58);
  });

  it('follows attribute renames and deletes', () => {
    const m = demo();
    customer(m).ui = { ...customer(m).ui!, folded: ['billing_address'] };
    renameAttribute(m, 'customer', 'billing_address', 'bill_to');
    expect(customer(m).ui?.folded).toEqual(['bill_to']);
    deleteAttribute(m, 'customer', 'bill_to');
    expect(customer(m).ui?.folded).toBeUndefined();
  });
});
