---
title: AI data modeling with Claude and MCP
seo_title: AI data modeling with Claude and MCP
description: Use AI to design and change data models in EntityModel.com. Copy a prompt into Claude, use Ask Claude in the app, or connect any MCP agent. The agent proposes typed changes that you review and accept.
section: Guides
order: 13
---

EntityModel.com is built so an AI assistant can work on a model safely. Models are plain JSON with a [documented format](/docs/model-format/), and agents change them through **proposals**: lists of typed changes you review, edit and accept in the app, as one undoable step.

There are three ways in, depending on how you run it.

## Copy and paste with claude.ai (any mode)

**Design with Claude** on the home page works on entitymodel.com with no setup. The app sends nothing anywhere; you copy and paste.

1. Optionally describe the model or the change ("a subscription billing model with plans, invoices and payments"), then click **Copy prompt**. The prompt holds the instructions, the model file format and your current model.
2. Paste it into [Claude](https://claude.ai). **Open Claude** opens it for you.
3. Paste Claude's reply back, or open the `.json` file it made. The dialog finds the JSON and lists what will change: entities and attributes added, removed or changed, relationships, and the validation result.
4. Click **Apply changes**. Your layout is kept, new entities are placed automatically, and `⌘Z` undoes the whole change.

To change an existing model, export it (**Export → Model file**), attach it in Claude, and open the result with **Open model file**.

If you do this often, download the **EntityModel.com skill** (`entity-modeler-skill.zip`) from the same dialog and upload it once under **Customize → Skills** in Claude. After that, attach your model file and ask for changes.

## Ask Claude in the app (local mode)

When you [run EntityModel.com locally](/docs/getting-started/#run-it-locally) and the [Claude Code](https://claude.com/claude-code) CLI is installed, the top bar shows **Ask Claude** (`⌘J`).

![The Ask Claude panel open beside the diagram, with suggested requests](/docs/images/ask-claude.webp "The Ask Claude panel with suggested requests for the current tab.")

- Describe a change: "add a Contract entity linked to Supplier", "derive a physical model for Databricks", "work through the open review comments".
- The run streams into the panel and uses your current tab and canvas selection as context.
- Claude answers with a **proposal**. In the review you see each change, can untick the ones you don't want, compare the before/after diff and the validation result, then **Accept**.
- Claude runs headless with only the EntityModel.com tools (no shell, no file editing), under your own Claude Code login.

## MCP server for any agent

`node bin/em.mjs mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server. The repository's `.mcp.json` registers it for Claude Code; any MCP client can use it.

| Purpose | Tools |
| --- | --- |
| Read and check | `get_model`, `get_entity`, `search`, `validate`, `list_tabs` |
| Transform and generate | `diff_tabs`, `migration_sql`, `export`, `docs`, `derive_tab`, `import_ddl`, `pull_schema`, `profile_data`, `plan_writeback`, `sync_tabs`, `auto_map` |
| Change | `propose_changes`, `fix_issues`, `propose_terms` |
| Review | `list_comments`, `reply_comment`, `list_proposals`, `withdraw_proposal` |
| Glossary | `search_glossary` |

Changes become proposals in `models/<id>/proposals/`. A banner in the app offers them for review, or handle them from the terminal:

```bash
node bin/em.mjs proposals sales                    # list pending proposals
node bin/em.mjs proposals sales --accept <pid>     # or --reject, --show
node bin/em.mjs apply sales ops.json [--apply]     # the same typed operations without MCP
```

Start the server with `--allow-apply` to add `apply_changes`, which edits directly without review, for automation you trust.

## Claude Code skills

The repository ships three [Claude Code](https://claude.com/claude-code) skills in `.claude/skills/`:

| Skill | What it does |
| --- | --- |
| `entity-model-design` | Design or extend a model from requirements, DDL, CSV headers or spreadsheets |
| `entity-model-review` | Validate and critique a model before sharing it |
| `entity-design-doc` | Write the data-model section and tables of a design document |

Put source material in `models/<id>/inputs/` and ask, for example: "Design a Customer and Order model from the DDL in models/acme/inputs." To use the skills in the Claude desktop app, run `npm run skills:package` and upload the zips from `cowork-skills/`.

## Tips for good results

- Give the agent your **source material**: DDL, CSV headers, a requirements document, interview notes.
- Ask for one coherent change at a time ("model the billing subject area") rather than the whole enterprise at once.
- Set [naming standards](/docs/naming-standards-and-validation/) first; agents follow them, and validation catches what they miss.
- Review the proposal's **validation result** before accepting.

## Frequently asked questions

### Can AI design a database schema for me?

Yes. Describe the domain in Design with Claude or Ask Claude, and Claude writes an EntityModel.com model with entities, typed attributes, keys, reference lists and relationships. You review it on the diagram and export SQL DDL for your database.

### Does the AI change my model without asking?

No. Claude's changes arrive as a proposal that lists each change with a diff and the validation result. Nothing is applied until you accept it, and accepting is one undoable step.

### Does EntityModel.com send my model to an AI service?

Not by itself. On entitymodel.com you copy and paste the prompt into Claude yourself. Ask Claude in local mode runs the Claude Code CLI on your machine under your own login.
