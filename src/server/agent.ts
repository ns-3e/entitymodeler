// In-app agent (local mode): runs Claude Code headless with only the EntityModel.com MCP tools, so a request
// typed in the UI comes back as a proposal to review. Progress streams to the UI over the Vite websocket.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';

export interface AgentRequest {
  prompt: string;
  tab?: string;
  /** Entity names selected on the canvas. */
  selection?: string[];
}

type AgentEventBody =
  | { kind: 'start' }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; summary: string }
  | { kind: 'done'; text: string; cost?: number }
  | { kind: 'error'; text: string };
export type AgentEvent = AgentEventBody & { runId: string; model: string };

let available: boolean | null = null;
/** Whether the `claude` CLI is installed (checked once). */
export function agentAvailable(): boolean {
  if (available === null) {
    try {
      available = spawnSync('claude', ['--version'], { timeout: 5000 }).status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

const runs = new Map<string, ChildProcess>();

export function cancelAgent(runId: string): boolean {
  const p = runs.get(runId);
  if (!p) return false;
  p.kill('SIGTERM');
  return true;
}

export function startAgent(server: ViteDevServer, root: string, model: string, req: AgentRequest): string {
  const runId = Math.random().toString(36).slice(2, 10);
  const emit = (e: AgentEventBody) => server.ws.send({ type: 'custom', event: 'em:agent', data: { ...e, runId, model } });
  // Propose-only MCP server: the agent cannot write model files, and has no shell or file-edit tools.
  const mcp = JSON.stringify({ mcpServers: { 'entity-modeler': { command: process.execPath, args: [join(root, 'bin/em.mjs'), 'mcp', '--author', 'Claude (Ask panel)'] } } });
  const context = [
    `You are working in the EntityModel.com app for the person at the keyboard. Model id: "${model}".`,
    req.tab ? `They are looking at tab "${req.tab}"; use it unless they say otherwise.` : '',
    req.selection?.length ? `Selected on the canvas: ${req.selection.join(', ')}. "These", "this" and "the selection" mean these entities.` : '',
    'Use the entity-modeler tools: read with get_model / get_entity / search, check with validate.',
    'Make every change through ONE propose_changes call (or derive_tab / import_ddl), never by editing files. The person reviews the proposal in the app.',
    'Do not invent columns or values the request does not imply; say what you left as open questions.',
    'Finish with two or three plain sentences: what you proposed and anything left open.',
  ]
    .filter(Boolean)
    .join('\n');
  const args = [
    '-p',
    req.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    mcp,
    '--strict-mcp-config',
    '--allowedTools',
    'mcp__entity-modeler',
    '--permission-mode',
    'dontAsk',
    '--restricted',
    '--append-system-prompt',
    context,
  ];
  const p = spawn('claude', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  runs.set(runId, p);
  emit({ kind: 'start' });
  let buf = '';
  let err = '';
  let finished = false;
  p.stdout.on('data', (d) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'assistant')
        for (const c of ev.message?.content || []) {
          if (c.type === 'text' && c.text.trim()) emit({ kind: 'text', text: c.text });
          if (c.type === 'tool_use') emit({ kind: 'tool', name: String(c.name).replace(/^mcp__entity-modeler__/, ''), summary: toolSummary(c.input) });
        }
      if (ev.type === 'result') {
        finished = true;
        if (ev.is_error || ev.subtype !== 'success') emit({ kind: 'error', text: ev.result || ev.subtype || 'The agent stopped with an error.' });
        else emit({ kind: 'done', text: ev.result || '', cost: ev.total_cost_usd });
      }
    }
  });
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code, signal) => {
    runs.delete(runId);
    if (finished) return;
    emit({ kind: 'error', text: signal ? 'Cancelled.' : err.trim().split('\n').slice(-3).join(' ') || `claude exited with code ${code}.` });
  });
  p.on('error', (e) => emit({ kind: 'error', text: e.message }));
  return runId;
}

function toolSummary(input: any): string {
  if (!input || typeof input !== 'object') return '';
  if (Array.isArray(input.ops)) return `${input.title ? `${input.title}: ` : ''}${input.ops.length} change(s)`;
  return ['entity', 'query', 'tab', 'kind', 'name'].map((k) => input[k]).filter(Boolean).join(' · ');
}
