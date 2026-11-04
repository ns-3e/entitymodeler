// Secrets set with `wrangler secret put` (and .dev.vars locally). Not in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_SECRET: string;
}
