# Shared workspaces: plan

Status: decided 2026-11-04 (see Decisions). Architecture: D1 for accounts, one Durable Object per model.

Progress: Phase 1 is live on entitymodel.com with GitHub and email sign-in. Account controls are built: download my data, delete my account (`cloud/src/index.ts`) and suspension (`cloud/scripts/suspend.mjs`). Version history is built (`VersionHistoryDialog.tsx`, `history` routes). Presence is built (`cloud/src/room.ts`, `src/ui/presence.ts`), which finishes Phase 2. Phase 4's agent access is built as a hosted MCP server with OAuth rather than API tokens (`cloud/src/mcp.ts`, `cloud/src/oauth.ts`); `em` against workspaces is not built. Next: Phase 3 (merging edits).

## Where we are

- **entitymodel.com stores models in the browser (IndexedDB) and has no server code.** The Worker only serves `dist/`. Its privacy promise is that models never leave the browser unless you export or share them (`site/docs/sharing-and-offline.md`).
- **Teams collaborate today in three ways:**
  - share links, which are compressed snapshots in the URL fragment;
  - the model file;
  - Git, with `em review` in pull requests.
  None of them gives a live, shared model.
- **Storage is behind one interface.** `ModelStorage` in `src/ui/storage/types.ts` has `list`/`get`/`put`/`create`/`onChange`. The editor already handles "changed elsewhere": `receiveExternal` reloads, or shows a banner when there are unsaved edits.
- **Saves send the whole document** (`saveNow` → `storage.put(id, text)`), debounced by 700 ms.
- **Edits are typed operations only for agents, proposals, fixes and sync** (`src/core/operations.ts`, `applyOpsInPlace`). Hand edits in the UI are immer updates to the whole document.

## Goal

A team opens the same model at a URL, sees each other's changes within about a second, and comments on it, with access limited to its members. Requirements:

- **Opt-in.** Browser-only mode stays the default and keeps its privacy promise. A model moves to a workspace only when someone chooses to.
- **No change for local runs.** File mode, the CLI and MCP work as they do now.
- **Self-hostable.** The server code ships in the open-source repo; a self-hoster deploys it with their own bindings.

## Options

### A. D1 and accounts: a document store

The Worker gains an API, and D1 holds `users`, `workspaces`, `members` and `models` (`id, workspace, text, version, updated_by, updated_at`). A new `cloud` `ModelStorage` sends `PUT` with `If-Match: version`. A stale save gets a 409, and the existing changed-elsewhere banner handles it. `onChange` polls.

- **Pros:**
  - Smallest step, and maps almost one-to-one onto `ModelStorage`.
  - Easy to query across models (lists, search, quotas).
- **Cons:**
  - Polling: others' changes arrive after seconds, not instantly.
  - Two people editing at once keep hitting conflict banners, because every save is the whole document.
  - D1 caps a row at about 2 MB. Big models (thousands of entities) need chunking or R2.
  - Moving to live editing later means a second storage migration.

### B. One Durable Object per model: live co-editing

Each workspace model is a SQLite-backed Durable Object that holds the authoritative document. Clients connect over WebSocket (hibernation, so idle connections cost nothing). The object puts saves in order and pushes each new version to everyone else. D1 still holds users, workspaces and membership.

- **Pros:**
  - Changes appear instantly.
  - One writer per model, so no write races.
  - Presence (who is here, what they have selected) comes almost free.
  - 10 GB per object.
  - Available on the Workers Free plan (SQLite backend).
- **Cons:**
  - More moving parts: a WebSocket protocol, plus the accounts system anyway.
  - Merging concurrent edits needs operations. The UI edits documents, not ops (see Phase 3).

### C. CRDT (Yjs): rejected

This would need the model held as a Y.Doc instead of immer JSON, which means rewriting the store, undo and every editor. Our edits are structured and name-referenced, and `Op` already describes them. Server-ordered ops fit better than a generic CRDT.

## Recommendation

Use **B's architecture from day one** (D1 for accounts, one Durable Object per model), and ship it in phases so the first release is about as small as A:

1. **Workspaces, with live versions and no merging yet.**
   - Sign-in, workspaces with roles (owner, editor, viewer), and a `cloud` storage adapter.
   - The Durable Object stores the document (chunked in SQLite rows) and accepts a save only when it is based on the current version. It then pushes the new version to every other client over WebSocket.
   - Clients reuse `receiveExternal`: others' edits show up within a second. If two people edit at the same moment, the second one sees the existing banner instead of losing work silently.
   - "Move to workspace" and "Download a copy" on each model.
   - Comments already live in the document, so they work here too.
2. **Presence and history.**
   - Avatars of who is viewing, and highlights on what each person has selected.
   - The Durable Object keeps the last N versions, which gives version history and restore.
   - Read-only share links scoped to a workspace.
3. **Merging by operation.**
   - The client sends `Op[]` instead of whole documents, starting with the common edits (entity and attribute fields, add, rename, delete, move), and falls back to a whole-document save for the rest.
   - The object applies ops in order with `applyOpsInPlace`. Ops refer to items by name, so edits to different entities merge without banners. An op that no longer applies is rejected, and the client reloads that part.
   - This builds on the operation language the agents already use.
4. **Agents and CLI.**
   - Workspace API tokens.
   - `em` and MCP read and propose against a workspace model, so proposals reach everyone in the UI.

Why not A first: A's polling, row limit and storage layout would all be replaced by Phase 2 or 3. B's Phase 1 costs about the same, and it doesn't need a migration later.

## What changes elsewhere

- **Privacy.**
  - Update `sharing-and-offline.md` and the privacy section: workspace models are stored on Cloudflare, and browser models still never leave the device.
  - Keep model contents out of logs and analytics.
  - Deleting a model deletes it for real: the Durable Object's storage, plus a tombstone in D1.
- **Security.**
  - Session cookies (`HttpOnly`, `SameSite=Lax`), plus Origin checks on mutating requests and on WebSocket upgrades.
  - Roles are checked in the Worker on every request; a model's Durable Object can only be reached through the Worker.
  - Rate limits and per-user storage quotas.
  - No model contents in URLs.
- **Offline.** Workspace models need a connection to save. The app should show "offline, changes not saved" instead of failing quietly. Offline editing with sync later is out of scope.
- **Tests.**
  - Run the Workers runtime in vitest (`@cloudflare/vitest-pool-workers`) for the Durable Object protocol: stale save rejected, broadcast, roles.
  - A two-browser check in the UI audit.
- **Cost.** SQLite Durable Objects and D1 both run on the Free plan at small scale. Workers Paid ($5 a month) lifts the limits when usage grows.

## Decisions (2026-11-04)

1. **Sign-in:** GitHub, Google **and** email magic links (Cloudflare Email Service). Build the OAuth pair first, then email links in the same phase. Note: Cloudflare Email Service sends to arbitrary recipients only on Workers Paid ($5/month, 3,000 emails included, then $0.35 per 1,000); on Free it reaches only verified addresses in the account. GitHub and Google sign-in are free. Email links wait for a decision on that.
2. **Launch:** open to everyone, with per-user quotas (models, storage, members per workspace) and rate limits from day one. Abuse handling (report, suspend) is part of Phase 1.
3. **Scope:** Phase 1 (live versions with the conflict banner) is enough to launch. Merging by operation follows as Phase 3.
4. **Pricing:** still open. Keep a `plan` column on workspaces so quotas can differ later without a migration.
