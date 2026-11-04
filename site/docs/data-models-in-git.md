---
title: Data models in Git
seo_title: Review data model changes in Git pull requests
description: Keep EntityModel.com model files in Git and review data model changes in pull requests, with a model diff, validation before and after, and migration SQL posted by a GitHub Action.
section: Guides
order: 12
---

Each EntityModel.com model is one JSON file, `models/<id>/model.json`, with stable formatting. That makes it a good fit for Git: diffs are readable, branches work, and changes can be reviewed like code.

## Review a change with `em review`

`em review` compares each changed model with a base ref, tab by tab, and reports:

- entities, attributes and relationships added, removed, renamed or changed;
- the validation result before and after;
- migration SQL for physical tabs, with renames written as `RENAME`.

```bash
node bin/em.mjs review                       # working tree vs. where this branch left origin/main
node bin/em.mjs review --base main --head my-branch --format md
node bin/em.mjs review --format json --fail-on-errors
```

## Pull request comments with GitHub Actions

The repository's `.github/workflows/model-review.yml` runs `em review` on every pull request that touches `models/**/model.json` and posts the result as one comment, updated on every push. To use it in your own repository:

1. Copy `.github/workflows/model-review.yml` and `bin/em.mjs` (a single file with no dependencies) into the repository.
2. Keep models at `models/<id>/model.json`.
3. Open a pull request that changes a model.

Reviewers then see the model change in business terms ("added attribute `customer.loyalty_tier`", "renamed `cust_nm` → `customer_name`") and the exact SQL it implies, next to the code change.

## Validate in CI

`node bin/em.mjs validate <id>` exits with status 2 when the model has errors, and `em review --fail-on-errors` fails when a changed model does. Add either to an existing CI job to stop invalid models from being merged:

```bash
for m in models/*/model.json; do node bin/em.mjs validate "$(basename "$(dirname "$m")")" || exit 1; done
```

## Formatting

`node bin/em.mjs fmt <id>` normalizes and re-saves a model, so diffs stay minimal when files are edited by hand or by other tools.

## Sharing models in a repository

The app's local mode reads models from `models/`. Collaborators clone the repository, run `npm run dev`, and edit the same files; the UI reloads live when the file changes on disk (after a `git pull`, for example).
