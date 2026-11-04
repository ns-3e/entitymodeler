# EntityModel.com

An open-source, browser-based entity-relationship modeling tool (entitymodel.com). Claude edits model files; people review and adjust them in the UI. Exports are PNG/SVG diagrams, PDF design documents and design-doc tables.

## Layout

- `models/<model-id>/model.json` is **the model**, one per model. Its format is in `docs/model-format.md`.
- `models/<model-id>/inputs/` holds source material for that model (DDL, CSV headers, spreadsheets, requirements). Read these when designing.
- `models/<model-id>/exports/` holds generated diagrams and docs (git-ignored).
- `bin/em.mjs` is the CLI (zero dependencies, any Node 18+), built from `cli/em.ts` using the same core code as the UI.
- `src/core/operations.ts` is the typed edit language (agents, proposals, fixes). `cli/mcp.ts` is the MCP server; `src/server/agent.ts` runs the in-app agent; `src/server/workbench.ts` reads and writes proposals.
- `src/core/` has the model types, validation, doc tables and PDF. `tabs.ts` (projection of one tab as a single-tab model: `tabView`, `withTab`), `derive.ts` (logical ⇄ physical ⇄ conceptual) and `diff.ts` (tab compare, migration SQL). `src/ui/` is the React app. `src/server/api.ts` is the dev-server middleware for `models/`.
- The UI stores models in one of two places (`src/ui/storage/`). It uses `models/` files when the dev-server API answers (`npm run dev`), and browser IndexedDB otherwise (the hosted site at entitymodel.com, `npm run preview`). Only file mode sees your edits.
- `site/docs/**/*.md` is the public documentation at entitymodel.com/docs/ (static HTML, no JS), rendered by `src/server/docs.ts` at build time along with `sitemap.xml`, `llms.txt` and `llms-full.txt`. When a feature changes, update its page; keep claims true to the code. A `## Frequently asked questions` section with `###` questions becomes FAQPage structured data. Example pages name a model in front matter (`model: site/examples/<id>.json`); its diagram, dictionary, DDL and share link are generated (`src/server/examples.ts`, `diagram.ts`), and `examples.test.ts` checks each model validates and its DDL runs. Each page has a link-preview image in `site/og/`; after adding a page or changing a title or description, run `npm run og-images` with `npm run dev` up (needs Chrome) and commit the JPEGs.
- `_archive/` holds retired code and material (git-ignored). Do not read from it or build on it.

## Working on a model

1. Edit `models/<id>/model.json` directly. It is plain JSON; keep 2-space indentation.
2. After every edit, run `node bin/em.mjs validate <id>` and fix all errors. A warning you leave needs a reason. Warnings coded `std.*` come from the model's own naming standards (`standards`); follow them, and use `validate --fix` (or the `fix_issues` tool) for the mechanical ones.
3. Do not add `ui` positions for new entities; the UI places them. Never change existing `ui` positions unless asked. `ui.hidden` hides an entity from the diagram only; leave it alone unless asked.
4. A model can hold several diagram tabs: the top-level content is the primary tab, `tabs[]` the others (each with its own entities and relationships). Edit the tab the user means, and prefer `em derive` over hand-copying when making a logical/physical/conceptual tab from another.
5. Rename entities, attributes and relationships carefully. References are by name across the file (`reference.entity`, `output_attribute`, `dependent_reference`, relationships, hierarchies), so update every one.
6. If the UI is running (`npm run dev`, http://localhost:5180), it reloads the model live when the file changes.

## CLI

```
node bin/em.mjs list
node bin/em.mjs new <id> --title "Title" --org "Organization"
node bin/em.mjs summary <id>
node bin/em.mjs validate <id> [--all]
node bin/em.mjs fmt <id>
node bin/em.mjs docs <id> [--format md|html|pdf] [--sections a,b] [--entities x,y] [--stdout]
node bin/em.mjs export <id> --format sql|dbml|mermaid|dbt|odcs|jsonschema|avro [--dialect postgres|mysql|snowflake|databricks] [--stdout]
node bin/em.mjs import <id> <file.sql|file.dbml> [--create]       # tables from DDL/DBML into a model
                          # pdf: [--diagram F.png | --no-diagram] [--page-size letter|a4]; default diagram = newest exports/*diagram*.png
node bin/em.mjs values <id> <reference-entity> <file.csv> [--append]   # load a reference list
node bin/em.mjs values <id> <reference-entity> --export                # values as CSV
node bin/em.mjs tabs <id> [--add N --kind K | --rename T NEW | --remove T | --primary T]
node bin/em.mjs derive <id> --kind logical|physical|conceptual|variant [--from T] [--name N] [--dry-run]
node bin/em.mjs diff <id> <tabA> <tabB> [--format json]
node bin/em.mjs migrate <id> <tabA> <tabB> [--dialect D] [--out F]
node bin/em.mjs sync <id> <source> <target> [--apply [--all] | --propose]   # bring source changes into a derived tab
node bin/em.mjs mappings <id> --target T [--source S] [--auto] [--format summary|md|csv|dbt]
node bin/em.mjs review [--base REF] [--head REF] [--format md|json]   # model diff + migration SQL for PRs
node bin/em.mjs glossary [add "Term" --definition D | suggest <id> | link <id> | sync <id>]
node bin/em.mjs pull <id> --from databricks|snowflake|postgres --catalog C --schema S [--propose]
node bin/em.mjs pull <id> --csv result.csv --platform P      # catalog-query output run elsewhere
```
`--tab <name|id>` targets one diagram tab for summary/docs/export/import/values; `validate` checks all tabs.
If `bin/em.mjs` is missing, or stale after changes to `src/core` or `cli/`, run `npm run build:cli`.

## Agent tools

- Prefer the `entity-modeler` MCP tools (`.mcp.json`, served by `node bin/em.mjs mcp`) over editing JSON by hand:
  - read with `get_model`, `get_entity` and `search`
  - change with `propose_changes`, putting one request in one call
- Proposals land in `models/<id>/proposals/` and the person accepts them in the UI. Use `em apply <id> ops.json --apply` only when they asked for a direct edit.
- Operation shapes are in `src/core/operations.ts` (the `Op` union); `propose_changes` describes them too.
- Review comments: `list_comments`, then propose fixes and `reply_comment` (replies are written directly). The business glossary is shared (`models/_glossary.json`): use `search_glossary` and `propose_terms`, and don't invent definitions the inputs don't support.

- `npm run publish-snapshot` previews releasing private `main` to the public repo (github.com/ns-3e/entitymodeler) as one new commit, after a secrets scan; `-- --push [--message "…"]` publishes. The public repo never gets private history; don't push there any other way. Publish only when the person asks.
- `npm run agent-eval [-- <name>]` runs Claude headless on a brief in `evals/<name>/` with these tools and reports turns, cost, tool errors and validation. Run it after changing agent-facing tools; it costs a real run.

## Skills

- `entity-model-design`: design or extend a model from requirements or source schemas.
- `entity-model-review`: validate and critique a model before sharing it.
- `entity-design-doc`: produce data-model sections and tables for a design document.

## Code conventions

- TypeScript, React 18, React Flow 12, zustand + immer.
- Core (`src/core`) has no DOM or Node dependencies, so it runs in both the browser and the CLI.
- Node geometry in `src/ui/canvas/geometry.ts` must match the `.entity-node` CSS.
- Typecheck with `npm run typecheck`; run tests with `npm test` (vitest, `src/**/*.test.ts`). `npm run bench` times core work on 500–5,000-entity models; bulk code must stay linear (use name indexes such as `entityIndex`, and the batch `renameEntities`/`renameAttributes`, not per-item cascades).
- After UI layout or CSS changes, run `npm run ui-audit` (needs `npm run dev`): it opens every dialog, view and panel and reports overflowing elements and collapsed text boxes. Reuse a component's own class rather than a layout class from elsewhere (`.grid3` is the inspector's).
- SQL/DBML/Mermaid live in `src/core/interop/`; dbt, ODCS, JSON Schema and Avro in `interop/contracts.ts` (YAML via `src/core/yaml.ts`). Relationships carry `foreign_key` (child attribute holding the parent key) for export.
