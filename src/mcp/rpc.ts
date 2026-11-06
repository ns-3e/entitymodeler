// MCP over JSON-RPC, independent of the transport. Hand-written instead of the SDK, so bin/em.mjs stays dependency-free
// and the Worker stays small. Two protocol eras are served side by side:
//   modern (2026-07-28): stateless; every request carries its version and capabilities in _meta; server/discover.
//   legacy (2024-11-05 to 2025-11-25): an initialize handshake. Many clients still speak this.
// A request's era comes from its own _meta, so nothing is remembered between requests.
import type { Need, Tool } from './tools';

/** What both servers report as their version: the npm package's. */
export { version as SERVER_VERSION } from '../../package.json';

export const MODERN_VERSION = '2026-07-28';
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_VERSION = -32022;

/** How long a client may cache the tool list. */
const TOOLS_TTL_MS = 3_600_000;

export interface RpcServer {
  name: string;
  version: string;
  instructions: string;
  tools: Tool[];
  /** May this server's tools write directly? Without it `apply: true` is ignored. */
  allowApply: boolean;
  /** Throw to refuse a call: the message goes to the agent as the tool's error. */
  authorize?(tool: Tool, need: Need, args: Record<string, unknown>): void | Promise<void>;
  /** What the agent sees for a failure. Default: the error's message. */
  describeError?(e: unknown): string;
}

export interface RpcOutcome {
  /** Null for a notification, which gets no reply. */
  body: object | null;
  /** The HTTP status this outcome maps to. The stdio transport ignores it. */
  status: number;
}

const annotations = (t: Tool) => ({
  readOnlyHint: t.needs === 'read' && !t.writes,
  destructiveHint: t.needs === 'apply',
  idempotentHint: t.needs === 'read',
  openWorldHint: !!t.external,
});

export async function handleRpc(server: RpcServer, msg: any): Promise<RpcOutcome> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // A reply to something we sent, which this server never does, is not an error worth answering.
    if (msg && typeof msg === 'object' && !Array.isArray(msg) && msg.method === undefined && msg.id !== undefined && ('result' in msg || 'error' in msg)) return { body: null, status: 202 };
    return { body: { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: INVALID_REQUEST, message: 'Invalid request' } }, status: 400 };
  }
  // Notifications (initialized, cancelled) need no reply.
  if (msg.id === undefined) return { body: null, status: 202 };

  const meta = msg.params?._meta;
  const requested = meta?.[META_VERSION];
  const error = (code: number, message: string, status: number, data?: object): RpcOutcome => ({ body: { jsonrpc: '2.0', id: msg.id, error: { code, message, ...(data ? { data } : {}) } }, status });

  if (requested !== undefined && !SUPPORTED_VERSIONS.includes(requested)) return error(UNSUPPORTED_VERSION, 'Unsupported protocol version', 400, { supported: SUPPORTED_VERSIONS, requested });
  const modern = requested === MODERN_VERSION;
  if (modern && msg.method !== 'server/discover' && (typeof meta[META_CAPABILITIES] !== 'object' || meta[META_CAPABILITIES] === null)) return error(INVALID_PARAMS, `Missing ${META_CAPABILITIES} in _meta`, 400);

  const serverInfo = { name: server.name, version: server.version };
  const reply = (result: object): RpcOutcome => ({
    body: { jsonrpc: '2.0', id: msg.id, result: modern || msg.method === 'server/discover' ? { resultType: 'complete', ...result, _meta: { [META_SERVER]: serverInfo } } : result },
    status: 200,
  });

  switch (msg.method) {
    case 'server/discover':
      return reply({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} }, instructions: server.instructions, ttlMs: TOOLS_TTL_MS, cacheScope: 'public' });
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({ protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0], capabilities: { tools: {} }, serverInfo, instructions: server.instructions });
    }
    case 'ping':
      return reply({});
    case 'tools/list': {
      const tools = server.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: annotations(t) }));
      return reply(modern ? { tools, ttlMs: TOOLS_TTL_MS, cacheScope: 'private' } : { tools });
    }
    case 'tools/call': {
      const tool = server.tools.find((t) => t.name === msg.params?.name);
      if (!tool) return error(INVALID_PARAMS, `Unknown tool ${msg.params?.name}`, modern ? 400 : 200);
      const args = msg.params?.arguments || {};
      const apply = server.allowApply && args.apply === true;
      try {
        await server.authorize?.(tool, apply ? 'apply' : tool.needs, args);
        return reply({ content: [{ type: 'text', text: await tool.run(args, { apply }) }] });
      } catch (e: any) {
        return reply({ content: [{ type: 'text', text: server.describeError ? server.describeError(e) : e?.message || String(e) }], isError: true });
      }
    }
    default:
      return error(METHOD_NOT_FOUND, `Method not found: ${msg.method}`, modern ? 404 : 200);
  }
}

/** The value of an Mcp-Name header, decoding the spec's Base64 form. Null if it can't be decoded. */
function headerValue(raw: string): string | null {
  if (!raw.startsWith('=?base64?') || !raw.endsWith('?=')) return raw;
  try {
    const bytes = Uint8Array.from(atob(raw.slice(9, -2)), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** A modern request's headers must repeat what its body says, so proxies that route on them can't be misled. */
export function headerProblem(headers: Headers, msg: any): string | null {
  const version = headers.get('MCP-Protocol-Version');
  const bodyVersion = msg?.params?._meta?.[META_VERSION];
  // Only a modern request has to match. Older clients send either the header alone or neither.
  if (bodyVersion === undefined && version !== MODERN_VERSION) return null;
  if (version !== bodyVersion) return `MCP-Protocol-Version header value '${version}' does not match body value '${bodyVersion}'`;
  if (bodyVersion !== MODERN_VERSION) return null;
  const method = headers.get('Mcp-Method');
  if (method !== msg.method) return `Mcp-Method header value '${method}' does not match body value '${msg.method}'`;
  if (msg.method === 'tools/call') {
    const raw = headers.get('Mcp-Name');
    const name = raw === null ? null : headerValue(raw);
    if (name !== msg.params?.name) return `Mcp-Name header value '${raw}' does not match body value '${msg.params?.name}'`;
  }
  return null;
}

/** One POST to a Streamable HTTP endpoint: a JSON reply, never a stream, because no tool sends progress. */
export async function handleHttp(server: RpcServer, req: Request, maxBytes = Infinity): Promise<Response> {
  const respond = (body: object | null, status: number) => (body ? new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : new Response(null, { status }));
  let msg: any;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return respond({ jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Request too large.' } }, 413);
    msg = JSON.parse(text);
  } catch {
    return respond({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Parse error' } }, 400);
  }
  const problem = headerProblem(req.headers, msg);
  if (problem) return respond({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: HEADER_MISMATCH, message: `Header mismatch: ${problem}` } }, 400);
  const { body, status } = await handleRpc(server, msg);
  return respond(body, status);
}
