---
name: entity-model-design
description: Design or extend an EntityModel.com data model (models/<id>/model.json) from requirements, source DDL, CSV headers, spreadsheets or interview notes. Use for "design a Customer/Order/Product model", "add a reference list for country", "add these tables as entities", "model the relationships", "model the hierarchy", or any change to entities, attributes, reference lists, relationships or hierarchies in models/.
---

# Design an entity-relationship model

## Before you start: locate the workbench

This skill drives the **EntityModel.com** workbench: a folder containing `bin/em.mjs`, `models/` and `docs/model-format.md`. All paths below are relative to that folder.

- **Find it.** It is the selected or working folder, or a parent or child of it, that contains `bin/em.mjs`. If there is none, ask the user to select their EntityModel.com folder and stop.
- **Run the CLI** as `node bin/em.mjs …` from that folder. If `node` is unavailable, edit `models/<id>/model.json` directly following `docs/model-format.md`, and check the rules by hand.
- **The visual editor** runs at http://localhost:5180 (`npm run dev`, or the optional background service). It reloads live when the model file changes, so you never need to start it from here.

The model file is `models/<id>/model.json`. Its format is in `docs/model-format.md`; read that first if you have not this session. People edit the same file in the UI, so keep it tidy and valid.

## Steps

When the `entity-modeler` MCP tools are available, use them for every step below:
- read with `get_model`, `get_entity` and `search`
- check with `validate`
- change through one `propose_changes` call per request, or `derive_tab` / `import_ddl`

The person reviews the proposal in the UI. Edit `model.json` by hand only when the tools are unavailable.

1. **Find or create the model.**
   - Run `node bin/em.mjs list`.
   - For a new model, run `node bin/em.mjs new <id> --title "…" --org "…"`.
   - Read everything in `models/<id>/inputs/`.
   - If the inputs include SQL DDL or DBML, start with `node bin/em.mjs import <id> <file> [--create]`. It creates entities, keys, relationships and reference lists from the schema. Then refine the result: labels, descriptions, reference entities and examples.
2. **Get the current state.** Run `node bin/em.mjs summary <id>` before editing an existing model, and `node bin/em.mjs tabs <id>` to see its diagram tabs.
   - A model can hold several tabs (conceptual, logical, physical, variants). The top-level content is the primary tab; the others are in `tabs[]`. Work in the tab the user means, and pass `--tab <name>` to `summary`, `import` and `values`.
   - For "a logical model of these tables", "a physical model for Snowflake" or "a conceptual overview", run `node bin/em.mjs derive <id> --kind logical|physical|conceptual --from <tab> [--dialect snowflake] --dry-run`, check the report, then run it without `--dry-run` and refine the new tab. Derivation keeps lineage, so `node bin/em.mjs diff <id> <a> <b>` and `migrate` work afterwards.
3. **Decide entity types.**
   - **standard**: the business things the model is about (Customer, Order, Product, Location, Contact). Prefer one entity per real-world concept. A thing with its own identity and lifecycle (sites, stores, accounts) is its own entity with a relationship, not a struct.
   - **reference**: controlled code lists that other entities point at (country, state, currency, status, type/category codes, units of measure, payment terms).
   - For chains like Country → State → City, add `dependent_reference`. Create the parent first and set `linked_column` to the parent's primary key. The linked column must NOT also be an attribute on the child.
4. **Attributes.**
   - Names are snake_case and `label` is Title Case. Each entity has one `is_primary_key` (its business key) and one `is_label` (its display name).
   - Use `REFERENCE_ENTITY` for any coded value backed by a list. `output_attribute` is the value stored on the referencing record: usually the name, or the code when downstream systems need codes.
   - Use `STRUCT` (with `is_array` if it repeats) only for genuinely grouped or repeating data, such as addresses and phones. Struct fields can themselves be REFERENCE_ENTITY.
   - Add a `description` for anything non-obvious, and mark `pii` where relevant.
   - Add an `example` value to identifiers, codes and formatted fields (tax ids, phone numbers, dates, amounts) so readers see what goes where. Use realistic but fake values; never copy real personal data from the inputs.
5. **Reference values.**
   - When the inputs contain the list (a workbook tab, code table or extract), or it is a public standard (ISO country/currency codes, US states, time zones), fill `reference_values` and `reference_values_source`.
   - For a CSV/TSV with attribute-name headers, use `node bin/em.mjs values <id> <entity> <file>`.
   - Dependent children carry the parent's linked-column value in each row, and it must match the parent's value exactly (case-sensitive).
   - If the list is unknown, leave it empty and add it to the open questions.
6. **Relationships.**
   - Give them verb-like names (`placed_by`, `subsidiary_of`) in the form `^[a-z][a-z0-9_]*$`.
   - Read cardinality from the *source* side: N:1 means many sources per target.
   - Use a forward label, plus a reverse label when the relationship is bidirectional (the two must differ).
   - Use relationship `attributes` for facts that belong to the link itself.
   - Set `foreign_key` to the child attribute that holds the parent's key (the source for N:1, the target for 1:N) whenever the name isn't simply the parent's PK name. SQL and DBML export use it.
7. **Hierarchies** are built from relationships. Levels run contiguously from 2, and `forward` means the relationship's source is the child.
8. **Validate.** Run `node bin/em.mjs validate <id>` and fix every error. Address or justify every warning.
9. **Report back briefly:**
   - what you added or changed
   - open questions, also put in a canvas `notes` entry
   - that the diagram is in the UI at http://localhost:5180 (run `npm run dev` if it isn't running)

## Rules of thumb

- Don't invent columns or values. If something is unknown, leave it out and list it as an open question.
- Don't set `ui` positions for new entities, and keep existing ones (including `ui.hidden`).
- When renaming, update every reference (see CLAUDE.md). When removing an entity, also remove its relationships, hierarchy branches and reference links.
- Write `description`s that are ready for the docs: one or two plain sentences on business meaning, not implementation.
