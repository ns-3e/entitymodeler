// Shareable links: the whole model, deflated and base64url-encoded into the URL fragment (#…).
// Browsers never send the fragment to a server, so sharing uploads nothing.
import { normalizeModel } from './model';
import type { DataModel } from './types';

export const SHARE_PREFIX = '#/share/';
const VERSION = 'v1';

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** "#/share/v1.<data>" for a model. Append it to the site URL to get a link. */
export async function encodeShareFragment(m: DataModel): Promise<string> {
  const deflated = await transform(new TextEncoder().encode(JSON.stringify(m)), new CompressionStream('deflate-raw'));
  return `${SHARE_PREFIX}${VERSION}.${toBase64Url(deflated)}`;
}

export function isShareFragment(hash: string): boolean {
  return hash.startsWith(SHARE_PREFIX);
}

/** The model inside a share fragment (normalized), or an error message saying why it can't be read. */
export async function decodeShareFragment(hash: string): Promise<DataModel> {
  const body = hash.slice(SHARE_PREFIX.length);
  const dot = body.indexOf('.');
  if (!isShareFragment(hash) || dot === -1) throw new Error('This is not an EntityModel.com share link.');
  if (body.slice(0, dot) !== VERSION) throw new Error('This share link was made by a newer version of EntityModel.com.');
  let json: string;
  try {
    json = new TextDecoder().decode(await transform(fromBase64Url(body.slice(dot + 1)), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('This share link is incomplete or damaged — it may have been cut off when it was copied.');
  }
  const raw = JSON.parse(json);
  if (!raw || !Array.isArray(raw.entities)) throw new Error('This share link does not contain a model.');
  return normalizeModel(raw);
}
