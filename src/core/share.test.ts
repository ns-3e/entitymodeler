import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAIN_TAB, SHARE_PREFIX, addTab, decodeShareFragment, deriveTab, encodeShareFragment, isShareFragment, listTabs, normalizeModel, serializeModel, tabView } from '.';

const demo = () => normalizeModel(JSON.parse(readFileSync(new URL('./fixtures/supplier.model.json', import.meta.url), 'utf8')));

describe('share links', () => {
  it('round-trips a model exactly, compactly and URL-safely', async () => {
    const hash = await encodeShareFragment(demo());
    expect(hash.startsWith(SHARE_PREFIX)).toBe(true);
    expect(isShareFragment(hash)).toBe(true);
    expect(hash).toMatch(/^#\/share\/v1\.[A-Za-z0-9_-]+$/);
    // The demo is ~14 KB of JSON; the link should be a fraction of that.
    expect(hash.length).toBeLessThan(serializeModel(demo()).length / 2);
    expect(serializeModel(await decodeShareFragment(hash))).toBe(serializeModel(demo()));
  });

  it('keeps every tab, mapping and comment', async () => {
    const m = demo();
    const id = addTab(m, { name: 'Physical', kind: 'physical', derived_from: MAIN_TAB }, deriveTab(tabView(m), 'physical').content);
    m.comments = [{ id: 'c1', author: 'A', text: 'Check keys', created_at: '2026-01-01T00:00:00Z', target: { tab: id, kind: 'model' } }];
    const back = await decodeShareFragment(await encodeShareFragment(m));
    expect(listTabs(back).map((t) => t.name)).toEqual(['Main', 'Physical']);
    expect(tabView(back, id).entities.length).toBe(tabView(m, id).entities.length);
    expect(back.comments).toEqual(m.comments);
  });

  it('explains damaged, truncated and foreign links', async () => {
    const hash = await encodeShareFragment(demo());
    await expect(decodeShareFragment(hash.slice(0, hash.length - 40))).rejects.toThrow(/incomplete or damaged/);
    await expect(decodeShareFragment('#/share/v9.abc')).rejects.toThrow(/newer version/);
    await expect(decodeShareFragment('#/model/x')).rejects.toThrow(/not an EntityModel.com share link/);
  });
});
