import { useEffect } from 'react';
import { create } from 'zustand';
import type { Proposal } from '../core';
import { storage } from './storage';
import type { AgentEvent } from './storage/types';
import { useStore } from './store';

/** Agent proposals waiting for review, and the in-app agent's current run (files mode only). */
interface AgentState {
  proposals: Proposal[];
  reviewing: string | null;
  panel: boolean;
  run: { runId: string | null; prompt: string; status: 'starting' | 'running' | 'done' | 'error'; events: AgentEvent[]; startedAt: string } | null;
  load(modelId: string): Promise<void>;
  review(id: string | null): void;
  togglePanel(open?: boolean): void;
  ask(prompt: string): Promise<void>;
  cancel(): Promise<void>;
  dismiss(id: string): Promise<void>;
}

export const useAgent = create<AgentState>((set, get) => ({
  proposals: [],
  reviewing: null,
  panel: false,
  run: null,
  async load(modelId) {
    const tools = storage.agentTools;
    if (!tools) return;
    try {
      set({ proposals: await tools.proposals(modelId) });
    } catch {
      /* API went away; keep what we have */
    }
  },
  review: (reviewing) => set({ reviewing }),
  togglePanel: (open) => set({ panel: open ?? !get().panel }),
  async ask(prompt) {
    const tools = storage.agentTools;
    const { modelId, model, multi, selection } = useStore.getState();
    if (!tools?.canRun || !modelId || !model) return;
    const names = multi.filter((x) => x.startsWith('entity:')).map((x) => x.slice(7));
    if (!names.length && selection.kind === 'entity') names.push(selection.name);
    set({ run: { runId: null, prompt, status: 'starting', events: [], startedAt: new Date().toISOString() } });
    try {
      const runId = await tools.run(modelId, { prompt, tab: model.tab?.name, selection: names });
      set({ run: { ...get().run!, runId, status: 'running' } });
    } catch (e: any) {
      set({ run: { ...get().run!, status: 'error', events: [{ runId: '', model: modelId, kind: 'error', text: e.message || String(e) }] } });
    }
  },
  async cancel() {
    const r = get().run;
    if (r?.runId) await storage.agentTools?.cancel(r.runId);
  },
  async dismiss(id) {
    const modelId = useStore.getState().modelId;
    if (!modelId) return;
    await storage.agentTools?.dismissProposal(modelId, id);
    set({ proposals: get().proposals.filter((p) => p.id !== id), reviewing: get().reviewing === id ? null : get().reviewing });
  },
}));

/** Keep proposals and agent progress in step with the open model. Mount once. */
export function useAgentSync() {
  const modelId = useStore((s) => s.modelId);
  useEffect(() => {
    const tools = storage.agentTools;
    if (!tools || !modelId) return;
    const { load } = useAgent.getState();
    load(modelId);
    const offP = tools.onProposals(async (id) => {
      if (id !== modelId) return;
      const before = new Set(useAgent.getState().proposals.map((p) => p.id));
      await load(modelId);
      // A proposal from a run started here opens straight into review.
      const run = useAgent.getState().run;
      const fresh = useAgent.getState().proposals.find((p) => !before.has(p.id));
      if (fresh && run && fresh.created_at >= run.startedAt) useAgent.getState().review(fresh.id);
    });
    const offA = tools.onAgent((e) => {
      const run = useAgent.getState().run;
      if (!run || e.model !== modelId || (run.runId && e.runId !== run.runId)) return;
      const status = e.kind === 'done' ? 'done' : e.kind === 'error' ? 'error' : run.status;
      useAgent.setState({ run: { ...run, runId: run.runId || e.runId, status, events: e.kind === 'start' ? run.events : [...run.events, e] } });
    });
    return () => {
      offP();
      offA();
    };
  }, [modelId]);
}
