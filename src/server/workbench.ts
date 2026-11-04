// Node-side access to the models/ folder, shared by the CLI, the MCP server and the dev-server API.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Proposal } from '../core/operations';
import type { GlossaryTerm } from '../core/types';

export const MODEL_FILE = 'model.json';
const PROPOSAL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex');

/** The workbench root: the nearest folder (from `start` up) that has models/ and package.json. */
export function findRoot(start = process.cwd()): string {
  let d = start;
  for (;;) {
    if (existsSync(join(d, 'models')) && existsSync(join(d, 'package.json'))) return d;
    const up = dirname(d);
    if (up === d) return start;
    d = up;
  }
}

const proposalsDir = (modelDir: string) => join(modelDir, 'proposals');

/** Proposals for the model in `modelDir`, newest first. Unreadable files are skipped. */
export function listProposals(modelDir: string): Proposal[] {
  const dir = proposalsDir(modelDir);
  if (!existsSync(dir)) return [];
  const out: Proposal[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch {
      /* half-written or hand-broken file */
    }
  }
  return out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export function writeProposal(modelDir: string, p: Omit<Proposal, 'id' | 'created_at'> & Partial<Pick<Proposal, 'id' | 'created_at'>>): Proposal {
  const created_at = p.created_at || new Date().toISOString();
  const id = p.id || `${created_at.slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
  const full: Proposal = { ...p, id, created_at };
  mkdirSync(proposalsDir(modelDir), { recursive: true });
  writeFileSync(join(proposalsDir(modelDir), `${id}.json`), JSON.stringify(full, null, 2) + '\n');
  return full;
}

export function deleteProposal(modelDir: string, id: string): boolean {
  if (!PROPOSAL_ID_RE.test(id)) return false;
  const f = join(proposalsDir(modelDir), `${id}.json`);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

/** The shared business glossary, one file for every model in the workbench. */
export const GLOSSARY_FILE = '_glossary.json';

export function readGlossary(modelsDir: string): GlossaryTerm[] {
  const f = join(modelsDir, GLOSSARY_FILE);
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, 'utf8')).terms || [];
  } catch {
    return [];
  }
}

export function glossaryText(terms: GlossaryTerm[]): string {
  return JSON.stringify({ format: 'entitymodeler-glossary', terms: [...terms].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + '\n';
}

export function writeGlossary(modelsDir: string, terms: GlossaryTerm[]) {
  mkdirSync(modelsDir, { recursive: true });
  writeFileSync(join(modelsDir, GLOSSARY_FILE), glossaryText(terms));
}
