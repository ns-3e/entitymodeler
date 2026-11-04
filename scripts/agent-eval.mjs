// Agent eval: run Claude Code headless on a realistic brief with the EntityModel.com MCP tools, then report how
// it went (turns, cost, tool errors, final validation). `npm run agent-eval [-- <eval-name>]`. Uses your
// Claude Code login and costs a real run (~$1). Evals live in evals/<name>/ (inputs + prompt.txt).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const name = process.argv[2] || 'retail-erp';
const model = `zz-eval-${name}-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
const em = (...a) => spawnSync(process.execPath, [join(root, 'bin/em.mjs'), ...a], { cwd: root, encoding: 'utf8' });
em('new', model, '--title', name);
mkdirSync(join(root, 'models', model, 'inputs'), { recursive: true });
for (const f of readdirSync(join(root, 'evals', name))) if (f !== 'prompt.txt') cpSync(join(root, 'evals', name, f), join(root, 'models', model, 'inputs', f));
const prompt = readFileSync(join(root, 'evals', name, 'prompt.txt'), 'utf8').replaceAll('{model}', model);
const mcp = JSON.stringify({ mcpServers: { 'entity-modeler': { command: process.execPath, args: [join(root, 'bin/em.mjs'), 'mcp', '--allow-apply', '--author', 'Claude (eval)'] } } });
console.log(`Running ${name} on models/${model} …`);
const r = spawnSync('claude', ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--mcp-config', mcp, '--strict-mcp-config', '--allowedTools', 'mcp__entity-modeler', 'Read', '--permission-mode', 'dontAsk', '--max-turns', '40'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.error) throw r.error;
writeFileSync(join(root, 'models', model, 'eval.jsonl'), r.stdout);

const calls = {};
const errors = [];
let result;
for (const line of r.stdout.split('\n').filter(Boolean)) {
  const ev = JSON.parse(line);
  if (ev.type === 'assistant') for (const c of ev.message.content) if (c.type === 'tool_use') calls[c.name.replace('mcp__entity-modeler__', '')] = (calls[c.name.replace('mcp__entity-modeler__', '')] || 0) + 1;
  if (ev.type === 'user')
    for (const c of ev.message.content)
      if (c.type === 'tool_result' && c.is_error) errors.push((typeof c.content === 'string' ? c.content : c.content.map((x) => x.text).join(' ')).slice(0, 160));
  if (ev.type === 'result') result = ev;
}
const v = em('validate', model);
console.log(`\n${result?.subtype} · ${result?.num_turns} turns · $${(result?.total_cost_usd || 0).toFixed(2)} · ${Math.round((result?.duration_ms || 0) / 1000)} s`);
console.log(`Tool calls: ${Object.entries(calls).map(([k, n]) => `${k}×${n}`).join(', ')}`);
console.log(`Tool errors (${errors.length}):${errors.map((e) => `\n  - ${e}`).join('')}`);
console.log(`Validation: ${v.stdout.trim().split('\n').pop()}`);
console.log(`\n${result?.result || ''}`);
console.log(`\nTranscript: models/${model}/eval.jsonl (models/ is git-ignored)`);
