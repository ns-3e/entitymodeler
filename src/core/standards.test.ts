import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { STANDARD_PRESETS, applyFixes, checkStandards, createModel, fromSql, issueCounts, normalizeModel, toCase, validateModel, type DataModel } from '.';

const DDL = `
CREATE TABLE customers (cust_id BIGINT PRIMARY KEY, CustName TEXT, email TEXT, order_amt NUMERIC);
CREATE TABLE product (sku TEXT PRIMARY KEY, title TEXT);
CREATE TABLE order_status (status_cd TEXT PRIMARY KEY, status_desc TEXT);
`;
const model = (): DataModel => normalizeModel({ ...fromSql(DDL).model, standards: { logical: STANDARD_PRESETS.logical } });

describe('naming standards', () => {
  it('are off unless the model sets them', () => {
    expect(checkStandards(normalizeModel(fromSql(DDL).model))).toEqual([]);
  });

  it('flag number, case, abbreviations, keys and PII, with fixes', () => {
    const codes = checkStandards(model()).map((i) => `${i.code}:${i.target.name}.${i.target.attribute ?? ''}`);
    expect(codes).toEqual(
      expect.arrayContaining(['std.number:customers.', 'std.case:customers.CustName', 'std.abbrev:customers.order_amt', 'std.pk:product.sku', 'std.pii:customers.email', 'std.entity_desc:customers.']),
    );
    expect(checkStandards(model()).filter((i) => i.code === 'std.number' || i.code === 'std.case').every((i) => i.fix?.length)).toBe(true);
  });

  it('fix everything fixable in one pass and stay valid', () => {
    const m = model();
    let res = { applied: 0, skipped: 0 };
    const next = produce(m, (d) => void (res = applyFixes(d as DataModel, checkStandards(m), 'main')));
    expect(res.applied).toBeGreaterThan(4);
    const c = next.entities.find((e) => e.name === 'customer')!;
    expect(c.attributes.map((a) => a.name)).toEqual(['customer_id', 'customer_name', 'email', 'order_amount']);
    expect(next.entities.find((e) => e.name === 'order_status')!.attributes.map((a) => a.name)).toEqual(['status_code', 'status_description']);
    expect(next.entities.find((e) => e.name === 'product')!.attributes[0].name).toBe('product_id');
    expect(c.attributes.find((a) => a.name === 'email')!.pii).toBe(true);
    expect(issueCounts(validateModel(next)).error).toBe(0);
    // What's left needs a person (or an agent): descriptions.
    expect(checkStandards(next).filter((i) => i.fix).map((i) => i.code)).toEqual([]);
  });

  it('apply per tab kind and appear in validation', () => {
    const m = { ...createModel('x', 'X'), entities: model().entities, standards: { physical: { max_length: 5 } }, tab: { name: 'P', kind: 'physical' as const } };
    expect(validateModel(m).some((i) => i.code === 'std.length')).toBe(true);
    expect(validateModel({ ...m, tab: { name: 'L', kind: 'logical' as const } }).some((i) => i.code.startsWith('std.'))).toBe(false);
  });

  it('convert case', () => {
    expect(toCase('CustomerName', 'snake')).toBe('customer_name');
    expect(toCase('customer_name', 'camel')).toBe('customerName');
    expect(toCase('customerName', 'upper_snake')).toBe('CUSTOMER_NAME');
  });
});
