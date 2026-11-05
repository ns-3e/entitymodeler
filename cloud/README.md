# EntityModel.com cloud (shared workspaces)

The backend for shared workspaces: a Cloudflare Worker with a D1 database (accounts, workspaces, members) and one Durable Object per model. The plan and its decisions are in [`docs/plans/shared-workspaces.md`](../docs/plans/shared-workspaces.md). It runs on `entitymodel.com/api/cloud/*`, and serves the hosted MCP server at `entitymodel.com/mcp` with its OAuth discovery documents at `/.well-known/oauth-*` (Worker routes, which take precedence over the site's custom domain for those paths). This folder has its own `wrangler.jsonc`, separate from the site's: merging to `main` deploys only the static site, and this Worker is deployed with `npx wrangler deploy` from `cloud/`.

```bash
cd cloud
npm install
npm run types   # generates src/worker-configuration.d.ts from wrangler.jsonc
npm test        # runs the Worker, D1 and Durable Objects locally
npm run dev     # wrangler dev on http://localhost:8787 (apply migrations first, below)
```

## Running it locally

```bash
npx wrangler d1 migrations apply entitymodel-cloud --local
npx wrangler dev --var DEV_LOGIN:1 --var ALLOWED_ORIGINS:http://localhost:8787
```

`DEV_LOGIN=1` turns on `POST /api/cloud/dev/login {"email": "…"}`, which signs in without a password. It is for local use only and is off in `wrangler.jsonc`.

## With the app

Run the Worker and the app side by side. The app's dev server sends `/api/cloud` to the Worker, so both share one origin, the way they will on entitymodel.com:

```bash
cd cloud && npx wrangler dev --var DEV_LOGIN:1 --var ALLOWED_ORIGINS:http://localhost:5180   # http://localhost:8787
EM_CLOUD=http://localhost:8787 npm run dev               # in the repo root: http://localhost:5180
```

The home page then shows **Shared workspaces**: sign in, create a workspace, copy models into it with **Add a model…**, and manage members. Workspace models open in the normal editor. Others' saves arrive within a second. A save that collides with someone else's shows the "Someone else saved this model" banner, with **Load their version** and **Keep mine**. Without `EM_CLOUD`, and on the live site until the Worker is deployed, the section doesn't appear.

## Suspending an account

```bash
npm run suspend -- someone@example.com          # signs them out and stops them signing in
npm run suspend -- someone@example.com --lift   # lets them back in
```

Add `--local` to try it on the local database. A suspended account's workspaces stay available to their other members. A model it already has open keeps receiving updates until that page closes.

## Setting up GitHub and Google sign-in

Each provider needs an OAuth app. Its **client ID** goes in `wrangler.jsonc` (it's public). Its **client secret** goes in Cloudflare's secret store, never in a file in this repo. Make one app for production and, for local testing, a second one whose callback points at localhost.

The callback URL is always `<PUBLIC_URL>/api/cloud/auth/<provider>/callback`:

| | Production | Local (`wrangler dev`) |
|---|---|---|
| GitHub | `https://entitymodel.com/api/cloud/auth/github/callback` | `http://localhost:8787/api/cloud/auth/github/callback` |
| Google | `https://entitymodel.com/api/cloud/auth/google/callback` | `http://localhost:8787/api/cloud/auth/google/callback` |

### GitHub

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in the fields:
   - **Application name:** EntityModel.com
   - **Homepage URL:** `https://entitymodel.com`
   - **Authorization callback URL:** the production callback from the table above.
3. Click **Register application**, then **Generate a new client secret**.
4. Copy the **Client ID** into `GITHUB_CLIENT_ID` in `wrangler.jsonc`.
5. Store the secret by running `npx wrangler secret put GITHUB_CLIENT_SECRET` and pasting it when asked.

The app asks for `read:user` and `user:email` only: the profile and the verified email address.

### Google

1. Go to **console.cloud.google.com** and create a project, for example "EntityModel".
2. Open **Google Auth Platform → Branding** and fill in:
   - the app name;
   - a support email;
   - the authorized domain `entitymodel.com`.
3. Under **Audience**, choose **External**.
4. Under **Data access**, add the scopes `openid`, `email` and `profile`. These are non-sensitive scopes, so Google doesn't need to review the app.
5. Go to **Clients → Create client → Web application**.
6. Under **Authorized redirect URIs**, add both callbacks from the table. Google allows several on one client.
7. Copy the **Client ID** into `GOOGLE_CLIENT_ID` in `wrangler.jsonc`.
8. Store the secret by running `npx wrangler secret put GOOGLE_CLIENT_SECRET`.

### Local secrets

For `wrangler dev`, put the local apps' values in `cloud/.dev.vars`. That file is git-ignored; don't commit it.

```
PUBLIC_URL=http://localhost:8787
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
```

A provider is offered (`GET /api/cloud/auth/providers`) only when both its ID and secret are set.

## Email sign-in links

`entitymodel.com` is set up in Cloudflare Email Service (done 2026-11-04):

- **Sending:** SPF, DKIM (`cf-bounce` selector, return path `cf-bounce.entitymodel.com`) and DMARC (`p=reject`) are in place. The Worker's `send_email` binding may only send from `signin@entitymodel.com`.
- **Receiving:** Email Routing forwards `support@`, `hello@`, `postmaster@` and `abuse@entitymodel.com` to the owner. Everything else is dropped. Replies to sign-in emails go to `support@`.

The flow:

1. `POST /api/cloud/auth/email/start {email, return}` emails a one-time link. It's valid for 15 minutes, and each address can request 5 per hour.
2. The link opens a confirmation page with a **Sign in** button. Mail scanners that open links don't use it up.
3. The button posts to `/api/cloud/auth/email/verify`, which signs in. A link works once.

Sending to any address needs Workers Paid (3,000 emails a month included). New accounts start with a daily quota (200 a day at setup), which Cloudflare raises as the sending reputation builds.

## The MCP server

`src/mcp.ts` serves the shared tool catalog (`src/mcp/` in the repo root) over HTTP. `@cloudflare/workers-oauth-provider` wraps the whole Worker: it handles tokens, client registration and discovery, and checks the token on `/mcp`. `src/oauth.ts` is the sign-in and consent page. Tokens and grants live in the `OAUTH_KV` namespace. Each call re-reads the person's role and suspension from D1, so those take effect at once.

To try it locally, have the discovery documents name your local address:

```bash
# --local-upstream: otherwise wrangler rewrites requests to the route's host, and the OAuth addresses stop matching.
npx wrangler dev --local-upstream localhost:8787 --var DEV_LOGIN:1 --var PUBLIC_URL:http://localhost:8787 --var ALLOWED_ORIGINS:http://localhost:8787
npx @modelcontextprotocol/inspector   # connect it to http://localhost:8787/mcp
```

Self-hosters change the `routes` and `PUBLIC_URL`, and the server advertises its own address.

## Deploying

The D1 database `entitymodel-cloud` exists (its id is in `wrangler.jsonc`). From `cloud/`, after `npx wrangler login`:

```bash
npx wrangler kv namespace create entitymodel-oauth           # once; put its id in wrangler.jsonc (OAUTH_KV)
npx wrangler d1 migrations apply entitymodel-cloud --remote   # new migrations only
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_SECRET                  # once; Google's when its app exists
```

Deploy the Worker before merging a change to `main` that the app depends on: the site deploys on merge, the Worker doesn't.
