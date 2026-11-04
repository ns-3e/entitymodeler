import { useEffect } from 'react';
import { create } from 'zustand';
import { mergeTerms, refreshSnapshot, type GlossaryTerm } from '../core';
import { storage } from './storage';
import { useStore } from './store';

/** The shared business glossary (every model links into it). */
interface GlossaryState {
  terms: GlossaryTerm[];
  loaded: boolean;
  load(): Promise<void>;
  save(terms: GlossaryTerm[]): Promise<void>;
  upsert(term: GlossaryTerm): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useGlossary = create<GlossaryState>((set, get) => ({
  terms: [],
  loaded: false,
  async load() {
    try {
      set({ terms: await storage.glossary.get(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(terms) {
    const sorted = [...terms].sort((a, b) => a.name.localeCompare(b.name));
    set({ terms: sorted });
    try {
      await storage.glossary.put(sorted);
    } catch (e: any) {
      useStore.getState().toast(`Could not save the glossary: ${e.message}`, 'error');
    }
  },
  async upsert(term) {
    const t = { ...term, updated_at: new Date().toISOString() };
    await get().save([...get().terms.filter((x) => x.id !== t.id), t]);
    // Models carry the terms they use; keep the open one current.
    useStore.getState().amend((d) => void refreshSnapshot(d, get().terms));
  },
  async remove(id) {
    await get().save(get().terms.filter((x) => x.id !== id));
  },
}));

/**
 * Mount once. Loads the shared glossary, follows changes to it, and when a model opens: adds the terms it
 * carries that the glossary lacks (it may come from someone else) and refreshes its snapshot.
 */
export function useGlossarySync() {
  const modelId = useStore((s) => s.modelId);
  const loaded = useGlossary((s) => s.loaded);
  useEffect(() => {
    useGlossary.getState().load();
    return storage.glossary.onChange(() => useGlossary.getState().load());
  }, []);
  // Terms that arrive inside the model (an accepted proposal, a teammate's edit) join the shared glossary.
  const snapshot = useStore((s) => s.doc?.glossary_snapshot);
  useEffect(() => {
    if (!loaded || !snapshot?.length) return;
    const { terms, save } = useGlossary.getState();
    const missing = snapshot.filter((t) => !terms.some((x) => x.id === t.id));
    if (missing.length) save([...terms, ...missing]);
  }, [snapshot, loaded]);
  useEffect(() => {
    if (!loaded || !modelId) return;
    const doc = useStore.getState().doc;
    if (!doc) return;
    const { terms, save } = useGlossary.getState();
    const merged = mergeTerms(terms, doc.glossary_snapshot || []);
    if (JSON.stringify(merged) !== JSON.stringify(terms)) save(merged);
    useStore.getState().amend((d) => void refreshSnapshot(d, merged));
  }, [modelId, loaded]);
}
