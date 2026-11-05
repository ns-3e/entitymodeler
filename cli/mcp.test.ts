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

  const modern = (id: number, method: string, params: object = {}) => ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } });

  it.skipIf(!existsSync(bin))('speaks the stateless 2026-07-28 protocol with no handshake', async () => {
    const res = await session([
      modern(1, 'server/discover'),
      modern(2, 'tools/list'),
      modern(3, 'tools/call', { name: 'list_models', arguments: {} }),
      modern(4, 'nope/nope'),
      { jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
    ]);
    expect(res[0].result).toMatchObject({ resultType: 'complete', capabilities: { tools: {} } });
    expect(res[0].result.supportedVersions).toContain('2026-07-28');
    expect(res[0].result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('entity-modeler');
    expect(res[1].result).toMatchObject({ resultType: 'complete', cacheScope: 'private' });
    expect(res[1].result.ttlMs).toBeGreaterThan(0);
    expect(res[2].result.resultType).toBe('complete');
    expect(res[2].result.content[0].text).toContain('demo');
    expect(res[3].error.code).toBe(-32601);
    expect(res[4].error).toMatchObject({ code: -32022, data: { requested: '1900-01-01' } });
    expect(res[5].error.code).toBe(-32602);
  });

  it.skipIf(!existsSync(bin))('negotiates a legacy version instead of echoing an unknown one', async () => {
    const init = (id: number, protocolVersion: string) => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    const res = await session([init(1, '2025-06-18'), init(2, '1900-01-01')]);
    expect(res[0].result.protocolVersion).toBe('2025-06-18');
    expect(res[1].result.protocolVersion).toBe('2025-11-25');
    expect(res[0].result.resultType).toBeUndefined();
  });

  it.skipIf(!existsSync(bin))('marks what tools do in annotations', async () => {
    const [res] = await session([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }], ['--allow-apply']);
    const by = new Map<string, any>(res.result.tools.map((t: any) => [t.name, t.annotations]));
    expect(by.get('get_model')).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(by.get('propose_changes')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(by.get('apply_changes')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(by.get('pull_schema')).toMatchObject({ openWorldHint: true });
  });

  it.skipIf(!existsSync(bin))('creates models, and refuses to overwrite one', async () => {
    const res = await session([call(1, 'create_model', { title: 'Order Management', organization: 'Acme' }), call(2, 'create_model', { title: 'Order Management' }), call(3, 'get_model', { model: 'order-management' })]);
    expect(res[0].result.content[0].text).toBe('Created model order-management.');
    expect(res[1].result.isError).toBe(true);
    expect(res[1].result.content[0].text).toContain('already exists');
    expect(res[2].result.content[0].text).toContain('Order Management');
    expect(JSON.parse(readFileSync(join(dir, 'models/order-management/model.json'), 'utf8')).organization).toBe('Acme');
  });

  it.skipIf(!existsSync(bin))('works from a folder with no models yet, and with --models-dir', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'em-mcp-empty-'));
    try {
      const run = (messages: object[], extra: string[] = []) =>
        new Promise<any[]>((ok, bad) => {
          const p = spawn(process.execPath, [bin, 'mcp', ...extra], { cwd: empty });
          let out = '';
          p.stdout.on('data', (d) => (out += d));
          p.on('error', bad);
          p.on('close', () => ok(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))));
          for (const m of messages) p.stdin.write(JSON.stringify(m) + '\n');
          p.stdin.end();
        });
      expect((await run([call(1, 'list_models', {})]))[0].result.content[0].text).toBe('No models yet.');
      await run([call(1, 'create_model', { title: 'Fresh' })]);
      expect(existsSync(join(empty, 'models/fresh/model.json'))).toBe(true);
      await run([call(1, 'create_model', { title: 'Elsewhere' })], ['--models-dir', 'other']);
      expect(existsSync(join(empty, 'other/elsewhere/model.json'))).toBe(true);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(bin))('applies directly only with --allow-apply', async () => {
    const res = await session([call(1, 'apply_changes', { model: 'demo', ops: [{ op: 'update_model', set: { version: '9.9' } }] })], ['--allow-apply']);
    expect(res[0].result.content[0].text).toMatch(/Applied 1 change/);
    expect(JSON.parse(readFileSync(join(dir, 'models/demo/model.json'), 'utf8')).version).toBe('9.9');
  });
});
