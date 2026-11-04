// End-to-end: the bundled CLI's MCP server over stdio, against a throwaway workbench folder.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = new URL('..', import.meta.url).pathname;
const bin = join(repo, 'bin/em.mjs');
let dir: string;

function session(messages: object[], extra: string[] = []): Promise<any[]> {
  return new Promise((ok, bad) => {
    const p = spawn(process.execPath, [bin, 'mcp', ...extra], { cwd: dir });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', bad);
    p.on('close', () => ok(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const m of messages) p.stdin.write(JSON.stringify(m) + '\n');
    p.stdin.end();
  });
}
const call = (id: number, name: string, args: object) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'em-mcp-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  mkdirSync(join(dir, 'models/demo'), { recursive: true });
  cpSync(join(repo, 'src/core/fixtures/supplier.model.json'), join(dir, 'models/demo/model.json'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('em mcp', () => {
  it.skipIf(!existsSync(bin))('initializes, lists tools, reads and proposes', async () => {
    const before = readFileSync(join(dir, 'models/demo/model.json'), 'utf8');
    const res = await session([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'get_model', { model: 'demo' }),
      call(4, 'propose_changes', { model: 'demo', title: 'Add tier', ops: [{ op: 'add_attribute', entity: 'supplier', attribute: { name: 'tier', type: 'STRING' } }] }),
      call(5, 'propose_changes', { model: 'demo', title: 'Bad', ops: [{ op: 'delete_entity', entity: 'nope' }] }),
      call(6, 'apply_changes', { model: 'demo', ops: [] }),
    ]);
    const byId = new Map(res.map((r) => [r.id, r]));
    expect(byId.get(1).result.serverInfo.name).toBe('entity-modeler');
    const names = byId.get(2).result.tools.map((t: any) => t.name);
    expect(names).toContain('propose_changes');
    expect(names).not.toContain('apply_changes');
    expect(byId.get(3).result.content[0].text).toContain('supplier');
    expect(byId.get(4).result.content[0].text).toMatch(/Proposal .* saved/);
    expect(byId.get(5).result.isError).toBe(true);
    expect(byId.get(6).error.code).toBe(-32602);
    // The model itself is untouched; the proposal waits in proposals/.
    expect(readFileSync(join(dir, 'models/demo/model.json'), 'utf8')).toBe(before);
    expect(readdirSync(join(dir, 'models/demo/proposals'))).toHaveLength(1);
  });

  it.skipIf(!existsSync(bin))('lists and replies to review comments, and searches the glossary', async () => {
    const file = join(dir, 'models/demo/model.json');
    const m = JSON.parse(readFileSync(file, 'utf8'));
    m.comments = [{ id: 'c1', author: 'Ana', text: 'Is name the legal name?', created_at: '2026-01-01T00:00:00Z', target: { tab: 'main', kind: 'entity', name: 'supplier', attribute: 'name' } }];
    writeFileSync(file, JSON.stringify(m));
    writeFileSync(join(dir, 'models/_glossary.json'), JSON.stringify({ terms: [{ id: 't1', name: 'Supplier', definition: 'A company we buy from.' }] }));
    const res = await session([call(1, 'list_comments', { model: 'demo' }), call(2, 'reply_comment', { model: 'demo', id: 'c1', text: 'Yes.' }), call(3, 'search_glossary', { model: 'demo' })]);
    expect(res[0].result.content[0].text).toContain('[c1] main:entity supplier.name — Ana: Is name the legal name?');
    expect(res[1].result.content[0].text).toBe('Replied to c1.');
    expect(JSON.parse(readFileSync(file, 'utf8')).comments[0].replies[0]).toMatchObject({ author: 'Claude', text: 'Yes.' });
    expect(res[2].result.content[0].text).toContain('supplier → Supplier');
  });

  it.skipIf(!existsSync(bin))('applies directly only with --allow-apply', async () => {
    const res = await session([call(1, 'apply_changes', { model: 'demo', ops: [{ op: 'update_model', set: { version: '9.9' } }] })], ['--allow-apply']);
    expect(res[0].result.content[0].text).toMatch(/Applied 1 change/);
    expect(JSON.parse(readFileSync(join(dir, 'models/demo/model.json'), 'utf8')).version).toBe('9.9');
  });
});
