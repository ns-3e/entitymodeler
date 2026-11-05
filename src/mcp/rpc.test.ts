// The Streamable HTTP rules in one place, with a stub tool: the hosted server's auth is tested in cloud/test.
import { describe, expect, it } from 'vitest';
import { handleHttp, type RpcServer } from './rpc';

const server: RpcServer = {
  name: 'test',
  version: '1',
  instructions: 'x',
  allowApply: false,
  tools: [{ name: 'echo', needs: 'read', description: 'Echo', inputSchema: { type: 'object' }, run: (a) => String(a.text) }],
};

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const post = (body: unknown, headers: Record<string, string> = {}) => handleHttp(server, new Request('https://x/mcp', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const call = (name = 'echo') => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { text: 'hi' }, _meta: META } });
const good = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'echo' };

describe('handleHttp', () => {
  it('serves a modern call whose headers repeat its body', async () => {
    const res = await post(call(), good);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).result.content[0].text).toBe('hi');
  });

  it('decodes a Base64 Mcp-Name', async () => {
    expect((await post(call(), { ...good, 'Mcp-Name': `=?base64?${btoa('echo')}?=` })).status).toBe(200);
    const bad = await post(call(), { ...good, 'Mcp-Name': '=?base64?!!!?=' });
    expect(bad.status).toBe(400);
  });

  it.each([
    ['a missing version header', { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'echo' }],
    ['a different version', { ...good, 'MCP-Protocol-Version': '2025-06-18' }],
    ['a missing method', { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Name': 'echo' }],
    ['a different method', { ...good, 'Mcp-Method': 'tools/list' }],
    ['a missing name', { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' }],
    ['a different name', { ...good, 'Mcp-Name': 'other' }],
  ])('refuses %s with HeaderMismatch', async (_, headers) => {
    const res = await post(call(), headers as Record<string, string>);
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32020);
  });

  it('refuses a modern version header on a body that does not claim it', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
    expect(((await res.json()) as any).error.code).toBe(-32020);
  });

  it('answers 404 with a JSON-RPC error for an unknown method', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'nope', params: { _meta: META } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'nope' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe(-32601);
  });

  it('serves older clients, with or without the version header', async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    expect(((await init.json()) as any).result.protocolVersion).toBe('2025-03-26');
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' });
    expect(((await list.json()) as any).result.tools[0].name).toBe('echo');
  });

  it('accepts a notification with 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers bad input without throwing', async () => {
    expect(((await (await post('not json')).json()) as any).error.code).toBe(-32700);
    expect(((await (await post([1, 2])).json()) as any).error.code).toBe(-32600);
    expect(((await (await post('null')).json()) as any).error.code).toBe(-32600);
  });
});
