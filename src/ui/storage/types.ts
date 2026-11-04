import type { DataModel, GlossaryTerm, ModelSummary, Proposal } from '../../core';

/**
 * Where models live. "files" is the dev-server API over models/<id>/model.json (local use, Claude, CLI);
 * "browser" is IndexedDB (the hosted static site).
 */
export interface ModelStorage {
  kind: 'files' | 'browser';
  /** Shown on the home page: the models folder, or "this browser". */
  location: string;
  list(): Promise<ModelSummary[]>;
  get(id: string): Promise<string>;
  put(id: string, text: string): Promise<void>;
  create(id: string, model: DataModel): Promise<void>;
  /** Browser only — file mode never deletes from disk. */
  remove?(id: string): Promise<void>;
  /** Files only: keep a copy of an export next to the model. Returns the written path. */
  saveExport?(id: string, filename: string, data: Blob | Uint8Array): Promise<string>;
  /** Called when a model changes outside this tab (file edited on disk, or another tab). Returns an unsubscribe. */
  onChange(cb: (id: string) => void): () => void;
  /** Files only: changes proposed by agents or `em apply`, waiting for review. */
  agentTools?: AgentTools;
  /** The shared business glossary: models/_glossary.json, or this browser. */
  glossary: {
    get(): Promise<GlossaryTerm[]>;
    put(terms: GlossaryTerm[]): Promise<void>;
    onChange(cb: () => void): () => void;
  };
}

export interface AgentRequest {
  prompt: string;
  tab?: string;
  selection?: string[];
}

export type AgentEvent = { runId: string; model: string } & (
  | { kind: 'start' }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'done'; text: string; cost?: number }
  | { kind: 'error'; text: string }
);

export interface AgentTools {
  proposals(id: string): Promise<Proposal[]>;
  dismissProposal(id: string, proposalId: string): Promise<void>;
  onProposals(cb: (id: string) => void): () => void;
  /** Whether the in-app agent can run (the claude CLI is installed). */
  canRun: boolean;
  run(id: string, req: AgentRequest): Promise<string>;
  cancel(runId: string): Promise<void>;
  onAgent(cb: (e: AgentEvent) => void): () => void;
}
