import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyOps, catalogQuery, createModel, fromCatalogRows, fromProfileRows, planProfile, planPull, profileIssues, profileQuery, profileTargets, tabView, validateModel, type DataModel } from '.';

// 300 customers with a repeating "primary key" on a legacy table, a status with 3 values, an empty column and
// a nullable column that is always set.
const DDL = `
CREATE TABLE customer (customer_id BIGINT PRIMARY KEY, email TEXT NOT NULL, status TEXT, fax TEXT, signup_date DATE, score NUMERIC(5,2), prefs JSONB);
INSERT INTO customer SELECT g, 'user' || g || '@example.com', (ARRAY['active','paused','closed'])[1 + g % 3], NULL, DATE '2024-01-01' + g, g / 10.0, '{}'::jsonb FROM generate_series(1, 300) g;
CREATE TABLE "Legacy Orders" (order_ref INT PRIMARY KEY, customer_id BIGINT);
INSERT INTO "Legacy Orders" SELECT g, CASE WHEN g % 4 = 0 THEN NULL ELSE g % 50 END FROM generate_series(1, 120) g;
`;

const rows = (r: { rows: Record<string, unknown>[] }) => r.rows.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)])));

async function profiled(sample?: number): Promise<{ view: DataModel; findings: ReturnType<typeof profileIssues> }> {
  const db = new PGlite();
  await db.exec(DDL);
  const snap = fromCatalogRows([rows(await db.query(catalogQuery('postgres', { schema: 'public' })))], 'postgres', { schema: 'public' });
  const pulled = applyOps(createModel('shop', 'Shop'), planPull(createModel('shop', 'Shop'), snap).ops).doc;
  const view = tabView(pulled);
  const targets = profileTargets(view, snap);
  const result: Record<string, string>[] = [];
  for (const t of targets) result.push(...rows(await db.query(profileQuery('postgres', t.table, { sample }))));
  await db.close();
  const ops = planProfile(view, targets, fromProfileRows(result, { sample }), '2026-11-03T00:00:00Z');
  const doc = applyOps(pulled, ops).doc;
  return { view: tabView(doc), findings: profileIssues(tabView(doc)) };
}

describe('data profiling', () => {
  it('measures rows, nulls, distinct values, ranges and lengths on a live PostgreSQL table', async () => {
    const { view } = await profiled();
    const customer = view.entities.find((e) => e.name === 'customer')!;
    expect(customer.profile).toEqual({ rows: 300, profiled_at: '2026-11-03T00:00:00Z' });
    const col = (n: string) => customer.attributes.find((a) => a.name === n)!.profile;
    expect(col('customer_id')).toMatchObject({ non_null: 300, distinct: 300, min: '1', max: '300' });
    expect(col('status')).toMatchObject({ non_null: 300, distinct: 3, max_length: 6 });
    // Strings get a length, never a value.
    expect(col('email')!.min).toBeUndefined();
    expect(col('fax')).toMatchObject({ non_null: 0 });
    expect(col('signup_date')).toMatchObject({ min: '2024-01-02', max: '2024-10-27' });
    // JSON can't be compared: only nulls are counted.
    expect(col('prefs')).toEqual({ non_null: 300 });
  });

  it('matches tables whose names the import changed', async () => {
    const { view } = await profiled();
    const legacy = view.entities.find((e) => e.profile && e.name !== 'customer')!;
    expect(legacy.name).toBe('legacy_orders');
    expect(legacy.profile?.rows).toBe(120);
  });

  it('turns the numbers into findings', async () => {
    const { findings } = await profiled();
    const codes = (attr: string) => findings.filter((f) => f.target.attribute === attr).map((f) => f.code);
    expect(codes('fax')).toEqual(['profile.empty']);
    expect(codes('status')).toEqual(['profile.reference_candidate']);
    // One note per table for the columns that are always set, as a suggestion, so bulk fixes leave it alone.
    const always = findings.filter((f) => f.code === 'profile.always_set' && f.target.name === 'customer');
    expect(always).toHaveLength(1);
    expect(always[0]).toMatchObject({ suggested: true, message: expect.stringContaining('4 columns of customer') });
    expect(always[0].fix!.map((o) => (o as { attribute: string }).attribute)).toEqual(['status', 'signup_date', 'score', 'prefs']);
    expect(codes('customer_id')).toEqual([]);
  });

  it('flags a primary key that is empty or repeats', () => {
    const m = createModel('t', 'T');
    m.entities.push({
      name: 'orders',
      display_name: 'Orders',
      entity_type: 'standard',
      color_code: '#000',
      profile: { rows: 1000, profiled_at: '' },
      attributes: [
        { name: 'order_id', label: 'Order Id', type: 'BIGINT', is_primary_key: true, profile: { non_null: 990, distinct: 400 } },
        { name: 'sku', label: 'SKU', type: 'STRING', unique: true, required: true, profile: { non_null: 1000, distinct: 1000 } },
      ],
    });
    expect(validateModel(m).filter((i) => i.code.startsWith('profile.')).map((i) => i.code)).toEqual(['profile.pk_null', 'profile.pk_dupes']);
  });

  it('marks a profile as sampled when it stops at the row limit', async () => {
    const { view } = await profiled(100);
    expect(view.entities.find((e) => e.name === 'customer')!.profile).toMatchObject({ rows: 100, sampled: true });
  });

  it('writes valid SQL shapes for the warehouses', () => {
    const t = { schema: 'sales', name: 'orders', columns: [{ name: 'id', type: 'bigint', nullable: false }, { name: 'tags', type: 'array<string>', nullable: true }] };
    const dbx = profileQuery('databricks', t, { catalog: 'main', sample: 10 });
    expect(dbx).toContain('FROM (SELECT * FROM `main`.`sales`.`orders` LIMIT 10) s');
    // A sample is counted exactly; only full scans estimate (approx_count_distinct is ~5% off).
    expect(dbx).toContain('COUNT(DISTINCT s.`id`)');
    expect(profileQuery('databricks', t, { catalog: 'main' })).toContain('approx_count_distinct(s.`id`)');
    expect(dbx).toMatch(/'tags' AS column_name.*CAST\(NULL AS BIGINT\) AS distinct_count/);
    expect(profileQuery('snowflake', t, { catalog: 'analytics' })).toContain('FROM "ANALYTICS"."sales"."orders" s');
  });

  it('suggests a key for a table without one, and allows for estimated counts', () => {
    const table = (approx: boolean, distinct: number): DataModel => {
      const m = createModel('t', 'T');
      m.entities.push({
        name: 'customer',
        display_name: 'Customer',
        entity_type: 'standard',
        color_code: '#000',
        profile: { rows: 100000, profiled_at: '', ...(approx ? { approx_distinct: true } : {}) },
        attributes: [
          { name: 'c_name', label: 'Name', type: 'STRING', profile: { non_null: 100000, distinct: 100000 } },
          { name: 'c_custkey', label: 'Custkey', type: 'BIGINT', profile: { non_null: 100000, distinct } },
        ],
      });
      return m;
    };
    const key = (m: DataModel) => profileIssues(m).find((i) => i.code === 'profile.key_candidate');
    expect(key(table(false, 100000))).toMatchObject({ target: { attribute: 'c_custkey' }, suggested: true, fix: [{ set: { is_primary_key: true, required: true } }] });
    // A unique name column isn't offered as a key.
    expect(key(table(false, 99999))).toBeUndefined();
    // Databricks' estimate said 94,522 for 100,000 unique keys: still a candidate, and a declared key isn't flagged.
    expect(key(table(true, 94522))?.target.attribute).toBe('c_custkey');
    const declared = table(true, 94522);
    declared.entities[0].attributes[1].is_primary_key = true;
    expect(profileIssues(declared).map((i) => i.code)).not.toContain('profile.pk_dupes');
  });

  it('keeps no range for personal columns, and notes empty tables', () => {
    const m = createModel('t', 'T');
    m.entities.push({
      name: 'person',
      display_name: 'Person',
      entity_type: 'standard',
      color_code: '#000',
      attributes: [
        { name: 'soc_sec_id', label: 'SSN', type: 'DOUBLE' },
        { name: 'dateOfBirth', label: 'Born', type: 'DATE' },
        { name: 'score', label: 'Score', type: 'INT', pii: true },
        { name: 'visits', label: 'Visits', type: 'INT' },
      ],
    });
    const table = { name: 'person', columns: [], primary_key: [], foreign_keys: [] };
    const cols = new Map(['soc_sec_id', 'dateOfBirth', 'score', 'visits'].map((c) => [c, { non_null: 5, distinct: 5, min: '1', max: '9' }]));
    const ops = planProfile(m, [{ entity: 'person', table }], [{ table: 'person', rows: 5, sampled: false, columns: cols }]);
    const prof = (a: string) => (ops.find((o) => o.op === 'update_attribute' && o.attribute === a) as { set: { profile: object } }).set.profile;
    expect(prof('soc_sec_id')).toEqual({ non_null: 5, distinct: 5 });
    expect(prof('dateOfBirth')).toEqual({ non_null: 5, distinct: 5 });
    expect(prof('score')).toEqual({ non_null: 5, distinct: 5 });
    expect(prof('visits')).toEqual({ non_null: 5, distinct: 5, min: '1', max: '9' });

    const empty = applyOps(m, [{ op: 'update_entity', entity: 'person', set: { profile: { rows: 0, profiled_at: '' } } }]).doc;
    expect(profileIssues(empty).map((i) => i.code)).toEqual(['profile.empty_table']);
  });
});
