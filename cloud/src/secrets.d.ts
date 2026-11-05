// Secrets set with `wrangler secret put` (and .dev.vars locally). Not in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
}

// src/core/share.ts names this DOM type. The Worker's types have Blob but not it.
type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;
