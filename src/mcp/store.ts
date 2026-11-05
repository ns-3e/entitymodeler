// Where the MCP tools find models. The stdio server keeps them in models/ (cli/mcp.ts); the hosted server in shared
// workspaces (cloud/src/mcp.ts). No Node or DOM here: this code also runs in a Cloudflare Worker.
import type { GlossaryTerm } from '../core/types';
import type { Proposal } from '../core/operations';

export interface ModelListing {
  id: string;
  title: string;
  /** Hosted: the workspace it belongs to. */
  workspace?: string;
  /** Tab summaries, when the store can afford to open every model to get them. */
  tabs?: string;
}

export interface ModelStore {
  /** Says how to refer to a model, in tool schemas. */
  modelIdHelp: string;
  /** The hosted server creates models in a workspace, so create_model needs one. */
  createNeedsWorkspace?: boolean;
  list(): Promise<ModelListing[]>;
  /** Throws an Error the agent can act on when the model doesn't exist. `rev` is passed back to write. */
  read(id: string): Promise<{ text: string; rev: string | number }>;
  /** Saves only if the model is still at `rev`, so an agent can't overwrite a change it hasn't seen. */
  write(id: string, rev: string | number, text: string): Promise<{ ok: true } | { ok: false; reason: 'conflict' }>;
  /** Returns the id the model got. Throws if one already exists there. */
  create(id: string, text: string, opts: { workspace?: string }): Promise<string>;
  /** The hash ProposalDialog compares, to warn that the model changed after a proposal was made. */
  hash(text: string): string | Promise<string>;
  /** Tells the agent where the person reviews a proposal. */
  reviewHint(model: string, proposal: string): string;
  proposals: {
    list(model: string): Promise<Proposal[]>;
    add(model: string, p: Omit<Proposal, 'id' | 'created_at'>): Promise<Proposal>;
    remove(model: string, id: string): Promise<boolean>;
  };
  /** The shared glossary, where the store has one. Without it the glossary tools aren't offered. */
  glossary?(): Promise<GlossaryTerm[]>;
  /** Keep a generated file next to the model. Without it `export` only returns text. Returns where it went. */
  saveExport?(model: string, file: string, text: string): Promise<string>;
}
