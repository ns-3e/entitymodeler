---
title: MCP server for data modeling
seo_title: Data modeling MCP server for Claude and other AI agents
description: Connect Claude, Cursor or any MCP client to EntityModel.com. Use the hosted server for shared workspace models or run the local one over your model files. Agents read, validate and propose changes you review.
section: Guides
order: 14
---

EntityModel.com is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI agent can read your data models, check them, generate code from them and suggest changes. There are two servers with the same core tools. Which one you use depends on where your models are.

| Your models are | Use | Address |
| --- | --- | --- |
| In a [shared workspace](/docs/shared-workspaces/) on entitymodel.com | The hosted server | `https://entitymodel.com/mcp` |
| In a `models/` folder on your computer | The local server | `npx entitymodeler mcp` |
| Only in your browser on entitymodel.com | Neither | Add the model to a workspace first |

Agents can't reach models that are only in your browser, because those never leave it. To work on one, [add a copy to a workspace](/docs/shared-workspaces/#create-a-workspace-and-add-models), or export the model file into a `models/` folder.

## Connect to the hosted server

The hosted server needs no install. It uses the account you already have, through OAuth.

**Claude Code:**

```bash
claude mcp add --transport http entitymodel https://entitymodel.com/mcp
```

Then run `/mcp` in Claude Code and choose **Authenticate**.

**Claude on the web and on desktop:** add a custom connector in your connector settings, with the address `https://entitymodel.com/mcp`.

**Other clients** that support remote servers usually take a configuration like this:

```json
{
  "mcpServers": {
    "entitymodel": { "url": "https://entitymodel.com/mcp" }
  }
}
```

Your browser opens so you can sign in and choose what the app can do. The server speaks Streamable HTTP, and registers clients automatically. It doesn't accept calls from web pages on other sites.

### What you allow

| Permission | Lets the app | Default |
| --- | --- | --- |
| **Read models** | See your workspaces' models, comments and proposals; validate; generate code and docs | Always on |
| **Suggest changes** | Create models, reply to comments, and propose edits for review | On |
| **Change models directly** | Edit shared models and accept proposals, with no review | Off |

These limit what the app can do, and your role in each workspace limits it further. A viewer's app can only read, whatever was allowed here. If you're removed from a workspace, or your role changes, that applies from the app's next call.

To change what an app can do, disconnect it and connect again.

### Disconnect an app

Choose **Account** under **Shared workspaces** on the home page. **Connected agents** lists each app, and **Disconnect** ends its access at once. Deleting your account disconnects them all.

### Review what agents propose

An agent's proposal appears as a banner on the model for everyone who has it open. Anyone with the editor role can review it: see each change, untick the ones you don't want, compare the diff and the validation result, then accept. Viewers can look at a proposal but not accept it. See [AI data modeling](/docs/ai-data-modeling/) for the review.

Accepting a proposal saves the model under your name. Anything an agent saves directly appears in [version history](/docs/shared-workspaces/#version-history) with the app's name, such as "Ada via Claude", and you can restore an earlier save.

### Limits

- Each person can make 120 requests a minute.
- A model can have 50 proposals waiting for review, and receive 30 a minute.
- Direct saves count toward the model's limit on saves per minute.

An app's direct save or comment reply is a new version of the model, like a save by another person. If you have unsaved edits at that moment, you'll see the "changed elsewhere" banner and choose what to keep.

## Run the local server

The local server works on model files in a `models/` folder, with no account, and nothing leaves your computer except what your agent sends to its own provider.

**Claude Code:**

```bash
claude mcp add entity-modeler -- npx -y entitymodeler mcp
```

**Other clients:**

```json
{
  "mcpServers": {
    "entity-modeler": { "command": "npx", "args": ["-y", "entitymodeler", "mcp"] }
  }
}
```

It uses `models/` in the nearest project folder, or in the current one, and creates it when the first model is made. To use another folder, pass `--models-dir DIR` or set `EM_MODELS_DIR`.

If you work in a clone of the repository, its `.mcp.json` already registers the server for Claude Code.

| Option | What it does |
| --- | --- |
| `--models-dir DIR` | Where the models are |
| `--author NAME` | The name on proposals and comment replies |
| `--allow-apply` | Adds `apply_changes` and `accept_proposal`, and lets tools that propose take `apply: true`. Only for automation you trust |

Proposals land in `models/<id>/proposals/`. [Run the app](/docs/getting-started/#run-it-locally) to review them, or use `em proposals`.

## Tools

| Purpose | Tools | Where |
| --- | --- | --- |
| Find and read | `list_models`, `get_model`, `get_entity`, `search`, `list_tabs`, `get_mappings` | Both |
| Check | `validate` | Both |
| Generate | `export`, `docs`, `diff_tabs`, `migration_sql` | Both |
| Start a model | `create_model` | Both |
| Propose changes | `propose_changes`, `fix_issues`, `import_ddl`, `derive_tab`, `sync_tabs`, `auto_map` | Both |
| Review | `list_comments`, `reply_comment`, `list_proposals`, `withdraw_proposal` | Both |
| Change directly | `apply_changes`, `accept_proposal` | Hosted with permission; local with `--allow-apply` |
| Workspaces | `list_workspaces` | Hosted |
| Live databases | `pull_schema`, `profile_data`, `plan_writeback` | Local |
| Glossary | `search_glossary`, `propose_terms` | Local |

The live database tools are local because they use the database credentials on your computer. The hosted server never connects to your databases.

## Safety

Models hold text that other people wrote: descriptions, comments and proposals. An agent reads that text, and a model could contain instructions meant to mislead it. This is why **Change models directly** is off by default. With proposals, a person sees every change before it happens. Allow direct changes only if you trust the app and the people you share workspaces with.

## Frequently asked questions

### Is there an MCP server for data modeling?

Yes. EntityModel.com has a hosted MCP server at `https://entitymodel.com/mcp` for shared workspace models, and a local one, `npx entitymodeler mcp`, for model files on your computer. Both let an agent read and validate models, generate SQL, dbt and other code, and propose changes you review.

### Can an AI agent change my model without asking?

Not by default. Agents propose changes, and a person accepts them. Direct changes need you to allow them when you connect the app, or to start the local server with `--allow-apply`.

### Which MCP clients work?

Any client that supports Streamable HTTP and OAuth can use the hosted server, and any client that can start a local command can use the local one. Both servers support the current protocol, 2026-07-28, and earlier versions back to 2024-11-05 on the local server and 2025-03-26 on the hosted one.

### Can the hosted server read the models in my browser?

No. It only reaches workspace models you can already open. Models that are only in your browser stay there.

### Does it cost anything?

No. Both servers are free to use. You pay your AI provider for the agent, as usual.
