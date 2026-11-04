import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyOps, applyOpsInPlace, describeOp, diffViews, issueCounts, listTabs, normalizeModel, tabView, validateModel, type DataModel, type Op } from '.';

const demo = (): DataModel => normalizeModel(JSON.parse(readFileSync(new URL('./fixtures/supplier.model.json', import.meta.url), 'utf8')));

describe('operations', () => {
  it('adds an entity with default key and label, then attributes and a relationship', () => {
    const ops: Op[] = [
      { op: 'add_entity', entity: { name: 'contract', description: 'A supply agreement.' } },
      { op: 'add_attribute', entity: 'contract', attribute: { name: 'start_date', type: 'DATE', required: true } },
      { op: 'add_attribute', entity: 'contract', attribute: { name: 'supplier_id', type: 'STRING' }, after: 'contract_id' },
      { op: 'add_relationship', relationship: { name: 'contract_with', source: 'contract', target: 'supplier', cardinality: 'N:1', foreign_key: 'supplier_id' } },
    ];
    const r = applyOps(demo(), ops);
    expect(r.ok).toBe(true);
    const c = r.doc.entities.find((e) => e.name === 'contract')!;
    expect(c.attributes.map((a) => a.name)).toEqual(['contract_id', 'supplier_id', 'contract_name', 'start_date']);
    expect(c.attributes[0].is_primary_key).toBe(true);
    expect(c.ui).toBeUndefined();
    expect(issueCounts(validateModel(r.doc)).error).toBe(0);
  });

  it('renames cascade to references, relationships and hierarchies', () => {
    const m = demo();
    const ref = m.entities.find((e) => e.entity_type === 'reference' && m.entities.some((x) => x.attributes.some((a) => a.reference?.entity === e.name)))!;
    const r = applyOps(m, [
      { op: 'rename_entity', entity: 'supplier', to: 'vendor' },
      { op: 'rename_entity', entity: ref.name, to: `${ref.name}_list` },
    ]);
    expect(r.ok).toBe(true);
    const d = r.doc;
    expect(d.relationships.every((x) => x.source !== 'supplier' && x.target !== 'supplier')).toBe(true);
    expect(d.hierarchies.every((h) => h.root !== 'supplier')).toBe(true);
    expect(d.entities.some((e) => e.attributes.some((a) => a.reference?.entity === `${ref.name}_list`))).toBe(true);
    expect(issueCounts(validateModel(d)).error).toBe(0);
  });

  it('is all-or-nothing', () => {
    const m = demo();
    const r = applyOps(m, [
      { op: 'add_attribute', entity: 'supplier', attribute: { name: 'tier', type: 'STRING' } },
      { op: 'delete_entity', entity: 'nope' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Operation 2 \(Delete entity nope\) failed: Entity "nope" not found/);
    expect(r.doc).toBe(m);
    expect(m.entities.find((e) => e.name === 'supplier')!.attributes.some((a) => a.name === 'tier')).toBe(false);
  });

  it('rejects bad names and duplicates', () => {
    expect(applyOps(demo(), [{ op: 'add_entity', entity: { name: 'Bad Name' } }]).ok).toBe(false);
    expect(applyOps(demo(), [{ op: 'add_entity', entity: { name: 'supplier' } }]).ok).toBe(false);
    expect(applyOps(demo(), [{ op: 'rename_attribute', entity: 'supplier', attribute: 'supplier_id', to: 'name' }]).ok).toBe(false);
  });

  it('clears stale fields when an attribute changes type', () => {
    const m = demo();
    const e = m.entities.find((x) => x.attributes.some((a) => a.type === 'REFERENCE_ENTITY'))!;
    const a = e.attributes.find((x) => x.type === 'REFERENCE_ENTITY')!;
    const r = applyOps(m, [{ op: 'update_attribute', entity: e.name, attribute: a.name, set: { type: 'STRING' } }]);
    expect(r.ok && r.doc.entities.find((x) => x.name === e.name)!.attributes.find((x) => x.name === a.name)!.reference).toBeUndefined();
  });

  it('adds a derived tab and edits it by name in the same batch', () => {
    const r = applyOps(demo(), [
      { op: 'add_tab', name: 'Physical', kind: 'physical', from: 'main', dialect: 'snowflake' },
      { op: 'add_attribute', tab: 'Physical', entity: 'supplier', attribute: { name: 'created_at', type: 'TIMESTAMP' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(listTabs(r.doc).map((t) => `${t.name}:${t.kind}`)).toEqual(['Main:logical', 'Physical:physical']);
    expect(tabView(r.doc, 'physical').entities.find((e) => e.name === 'supplier')!.attributes.some((a) => a.name === 'created_at')).toBe(true);
    expect(r.doc.entities.find((e) => e.name === 'supplier')!.attributes.some((a) => a.name === 'created_at')).toBe(false);
  });

  it('works on immer drafts', () => {
    const m = demo();
    const next = produce(m, (d) => void applyOpsInPlace(d, [{ op: 'update_model', set: { title: 'Renamed' } }, { op: 'set_hidden', entities: ['supplier'], hidden: true }]));
    expect(next.title).toBe('Renamed');
    expect(next.entities.find((e) => e.name === 'supplier')!.ui?.hidden).toBe(true);
    expect(m.entities.find((e) => e.name === 'supplier')!.ui?.hidden).toBeUndefined();
  });

  it('describes ops and diffs the result', () => {
    const ops: Op[] = [{ op: 'rename_attribute', entity: 'supplier', attribute: 'supplier_id', to: 'vendor_id' }];
    expect(describeOp(ops[0])).toBe('Rename attribute supplier.supplier_id → vendor_id');
    const before = demo();
    const r = applyOps(before, ops);
    const d = diffViews(tabView(before), tabView(r.doc), 'none');
    const sup = d.entities.find((e) => e.name === 'supplier')!;
    expect(sup.attributes.map((a) => `${a.change}:${a.name}`).sort()).toEqual(['added:vendor_id', 'removed:supplier_id']);
  });
});
