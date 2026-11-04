---
title: Command-line tool (em)
seo_title: em CLI reference: validate, export, diff and migrate models
description: Reference for bin/em.mjs, EntityModel.com's zero-dependency command-line tool. Validate models, export SQL, dbt and docs, import DDL, load reference values, derive tabs, diff, migrate, review and pull live schemas.
section: Reference
order: 1
---

`bin/em.mjs` is a single-file, zero-dependency bundle of the same core code the app uses. It runs on any Node.js 18 or later, works on the `models/<id>/model.json` files of a [local checkout](/docs/getting-started/#run-it-locally), and is safe to copy into other repositories (for CI, for example).

Run `node bin/em.mjs` with no arguments to see every option.

## Models

```bash
node bin/em.mjs list                                       # models in models/
node bin/em.mjs new <id> --title "Title" --org "Organization"
node bin/em.mjs summary <id>                                # compact text view
node bin/em.mjs validate <id> [--all]                       # exit 2 on errors; --all adds info findings
node bin/em.mjs validate <id> --fix [--dry-run]             # apply mechanical fixes
node bin/em.mjs fmt <id>                                    # normalize and re-save
```

## Import and reference values

```bash
node bin/em.mjs import <id> <file.sql|file.dbml> [--create] [--title T]
node bin/em.mjs values <id> <reference-entity> <file.csv> [--append]
node bin/em.mjs values <id> <reference-entity> --export [--out F]
```

## Export and docs

```bash
node bin/em.mjs export <id> --format sql|dbml|mermaid|dbt|odcs|jsonschema|avro \
  [--dialect postgres|mysql|snowflake|databricks] [--no-values] [--out F | --stdout]
node bin/em.mjs docs <id> [--format md|html|pdf] [--sections a,b] [--entities x,y] [--out F] [--stdout]
     # PDF only: [--diagram F.png | --no-diagram] [--page-size letter|a4]
node bin/em.mjs sections                                    # list the doc sections
```

## Tabs, derive, diff and migrate

```bash
node bin/em.mjs tabs <id>                                   # list tabs
node bin/em.mjs tabs <id> --add NAME [--kind K]             # conceptual|logical|physical|variant
node bin/em.mjs tabs <id> --rename TAB NEW | --remove TAB | --primary TAB
node bin/em.mjs derive <id> --kind logical|physical|conceptual|variant [--from TAB] [--name N] [--dry-run]
     # logical:  [--no-business-names] [--no-drop-technical] [--no-drop-fks] [--no-collapse-junctions]
     #           [--no-detect-references] [--no-infer-relationships]
     # physical: [--dialect D] [--no-add-fks] [--no-junctions] [--flatten-structs] [--audit-columns]
node bin/em.mjs diff <id> <tabA> <tabB> [--format json]
node bin/em.mjs migrate <id> <tabA> <tabB> [--dialect D] [--out F]
node bin/em.mjs sync <id> <source> <target> [--apply [--all] | --propose]
```

`--tab <name|id>` picks the tab for `summary`, `docs`, `export`, `import` and `values` (default: the primary tab). `validate` checks every tab unless you pass `--tab`.

## Mappings and glossary

```bash
node bin/em.mjs mappings <id> --target T [--source S] [--auto] [--format summary|md|csv|dbt] [--out F]
node bin/em.mjs glossary [add "Term" --definition D [--synonyms a,b] | suggest <id> | link <id> | sync <id>]
```

## Review in pull requests

```bash
node bin/em.mjs review [--base REF] [--head REF] [--models a,b] [--format md|json] \
  [--dialect D] [--fail-on-errors] [--out F]
```

See [Data models in Git](/docs/data-models-in-git/).

## Live schemas

Credentials come from your environment or the platform's CLI profile and are never stored.

```bash
node bin/em.mjs pull <id> --from databricks --catalog C --schema S [--profile P]
node bin/em.mjs pull <id> --from snowflake --catalog DB --schema S
node bin/em.mjs pull <id> --from postgres [--url postgres://…] [--schema public]
node bin/em.mjs pull <id> --csv result.csv --platform P [--catalog C] [--schema S]
node bin/em.mjs catalog-query --platform P [--catalog C] [--schema S]
     # common: [--name TAB] [--propose]
node bin/em.mjs profile <id> [--tab T] [--sample N] [--entities a,b] [--warehouse ID] [--propose]
node bin/em.mjs profile <id> --query | --csv results.csv      # run the queries yourself
node bin/em.mjs writeback <id> [--tab T] [--out F] [--no-tags] [--apply]   # descriptions and tags into the catalog
```

See [Import from a database](/docs/import-from-database/).

## Agents and proposals

```bash
node bin/em.mjs mcp [--allow-apply]                         # MCP server over stdio
node bin/em.mjs proposals <id> [--accept|--reject|--show <pid>]
node bin/em.mjs apply <id> ops.json [--apply]
```

See [AI data modeling](/docs/ai-data-modeling/).
