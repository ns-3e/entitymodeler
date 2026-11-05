// Our hand-written protocol code against the official SDK, as a real client would use it: over stdio with the bundled
// CLI, and over Streamable HTTP with the same dispatcher the hosted server uses.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleHttp, type RpcServer } from '../src/mcp/rpc';

const repo = new URL('..', import.meta.url).pathname;
const bin = join(repo, 'bin/em.mjs');
const text = (r: any) => r.content[0].text as string;

describe('official MCP SDK client', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'em-conformance-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'models/demo'), { recursive: true });
    cpSync(join(repo, 'src/core/fixtures/supplier.model.json'), join(dir, 'models/demo/model.json'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!existsSync(bin))('connects over stdio, lists tools with valid schemas, calls them', async () => {
    const client = new Client({ name: 'conformance', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'mcp'], cwd: dir }));
    try {
      expect(client.getServerVersion()?.name).toBe('entity-modeler');
      expect(client.getInstructions()).toContain('propose_changes');
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(25);
      for (const t of tools) expect(t.inputSchema.type).toBe('object');
      expect(text(await client.callTool({ name: 'list_models', arguments: {} }))).toContain('demo');
      const bad = await client.callTool({ name: 'get_model', arguments: { model: 'nope' } });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  describe('over Streamable HTTP', () => {
    let http: Server;
    let url: URL;
    const stub: RpcServer = { name: 'stub', version: '1', instructions: 'x', allowApply: false, tools: [{ name: 'echo', needs: 'read', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, run: (a) => String(a.text) }] };
    beforeAll(async () => {
      http = createServer(async (req, res) => {
        // What the hosted handler does for anything but POST.
        if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const out = await handleHttp(stub, new Request('http://x/mcp', { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(await out.text());
      });
      await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
      url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
    });
    afterAll(() => new Promise((ok) => http.close(ok)));

    it('connects, lists and calls, with no session', async () => {
      const client = new Client({ name: 'conformance', version: '1' });
      const transport = new StreamableHTTPClientTransport(url);
      await client.connect(transport);
      expect(transport.sessionId).toBeUndefined();
      expect((await client.listTools()).tools[0].name).toBe('echo');
      expect(text(await client.callTool({ name: 'echo', arguments: { text: 'hi' } }))).toBe('hi');
      await client.close();
    });
  });
});
