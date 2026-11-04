import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAIN_TAB, addTab, applyOps, deriveTab, normalizeModel, reviewModels, reviewToMarkdown, tabView, type DataModel } from '.';

const demo = (): DataModel => normalizeModel(JSON.parse(readFileSync(new URL('./fixtures/supplier.model.json', import.meta.url), 'utf8')));

describe('model review', () => {
  it('reports per-tab changes, validation and migration SQL for physical tabs', () => {
    const before = demo();
    addTab(before, { name: 'Physical', kind: 'physical', dialect: 'postgres', derived_from: MAIN_TAB }, deriveTab(tabView(before), 'physical').content);
    const r = applyOps(before, [
      { op: 'add_attribute', entity: 'supplier', attribute: { name: 'website', type: 'STRING' } },
      { op: 'add_attribute', tab: 'Physical', entity: 'supplier', attribute: { name: 'credit_limit', type: 'DECIMAL', precision: 12, scale: 2 } },
      { op: 'update_model', set: { version: '0.4' } },
      { op: 'add_comment', target: { kind: 'entity', name: 'supplier' }, text: 'Is website required?', author: 'Ana' },
    ]);
    const after = (r as { doc: DataModel }).doc;
    const rev = reviewModels('models/supplier-demo/model.json', before, after);
    expect(rev.change).toBe('changed');
    expect(rev.header).toEqual(['version: 0.3 → 0.4']);
    const main = rev.tabs.find((t) => t.id === MAIN_TAB)!;
    expect(main.change).toBe('changed');
    expect(main.sql).toBeUndefined();
    const phys = rev.tabs.find((t) => t.name === 'Physical')!;
    expect(phys.sql).toMatch(/ALTER TABLE supplier ADD COLUMN credit_limit NUMERIC\(12,2\);/);
    expect(rev.comments).toEqual({ opened: 1, resolved: 0, open: 1 });
    const md = reviewToMarkdown([rev]);
    expect(md).toContain('| Main (logical) | 1 changed |');
    expect(md).toContain('+ `website`');
    expect(md).toContain('```sql');
    expect(md).toContain('Review comments: 1 new');
  });

  it('pairs a same-type, same-position remove + add as a rename', () => {
    const before = demo();
    const r = applyOps(before, [
      { op: 'rename_attribute', entity: 'supplier', attribute: 'duns', to: 'duns_number' },
      { op: 'rename_entity', entity: 'country', to: 'nation' },
    ]);
    const rev = reviewModels('x', before, (r as { doc: DataModel }).doc);
    const d = rev.tabs[0].diff!;
    expect(d.entities.find((e) => e.name === 'supplier')!.attributes).toEqual([expect.objectContaining({ change: 'changed', name: 'duns_number', from: 'duns' })]);
    expect(d.entities.find((e) => e.name === 'nation')).toMatchObject({ change: 'changed', from: 'country' });
    expect(d.entities.some((e) => e.change === 'removed')).toBe(false);
  });

  it('writes RENAME, not DROP + ADD, for renames in physical tabs', () => {
    const before = demo();
    before.tab = { name: 'Physical', kind: 'physical', dialect: 'postgres' };
    const r = applyOps(before, [{ op: 'rename_attribute', entity: 'supplier', attribute: 'duns', to: 'duns_number' }]);
    const sql = reviewModels('x', before, (r as { doc: DataModel }).doc).tabs[0].sql!;
    expect(sql).toContain('ALTER TABLE supplier RENAME COLUMN duns TO duns_number;');
    expect(sql).not.toMatch(/DROP COLUMN duns\b/);
  });

  it('handles new and removed models, and no changes', () => {
    const m = demo();
    expect(reviewModels('a', null, m).change).toBe('added');
    expect(reviewModels('a', m, null).change).toBe('removed');
    const same = reviewModels('a', m, demo());
    expect(same.change).toBe('unchanged');
    expect(reviewToMarkdown([same])).toContain('No model changes.');
  });
});
