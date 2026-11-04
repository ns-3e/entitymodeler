---
name: entity-model-review
description: Review an EntityModel.com data model (models/<id>/model.json) for correctness and design quality before sharing it. Runs the validator, then checks modeling practice (entity types, keys, reference data use, structs, relationships, hierarchies, documentation). Use for "review the model", "is this ready to share", "check the Acme model", "what's missing".
---

# Review an entity-relationship model

## Before you start: locate the workbench

This skill drives the **EntityModel.com** workbench: a folder containing `bin/em.mjs`, `models/` and `docs/model-format.md`. All paths below are relative to that folder.

- **Find it.** It is the selected or working folder, or a parent or child of it, that contains `bin/em.mjs`. If there is none, ask the user to select their EntityModel.com folder and stop.
- **Run the CLI** as `node bin/em.mjs …` from that folder. If `node` is unavailable, read `models/<id>/model.json` directly following `docs/model-format.md`, and check the rules by hand.
- **The visual editor** runs at http://localhost:5180 (`npm run dev`, or the optional background service). It reloads live when the model file changes.

## Steps

1. Run `node bin/em.mjs validate <id> --all` (or the `validate` MCP tool) and collect the errors, warnings and notes. Every tab is checked; review the tab the person means.
2. Run `node bin/em.mjs summary <id>` and read the model file for detail.
3. Check design quality beyond the validator:
   - **Entity types.** Are the reference lists really controlled code lists? Is anything modeled as a free-text STRING that should be a REFERENCE_ENTITY (country, state, currency, status, type or category codes)?
   - **Keys.** Is each primary key a stable business key? Does every entity have a label attribute?
   - **Structure.** Are structs used only for grouped or repeating data? Are things with their own identity modeled as entities rather than structs? Are there duplicate concepts across entities?
   - **Reference data.**
     - Each `output_attribute` stores what consumers need (code or name).
     - Dependent references have the right parent and linked column.
     - Known public lists have their values filled in.
   - **Relationships and hierarchies.**
     - Cardinality direction is right (N:1 means many sources per target).
     - Labels read naturally in both directions.
     - Hierarchy branches follow the relationships the right way round.
   - **Docs readiness.** Entity and attribute descriptions are present and readable by a non-technical audience. Identifiers and coded fields have examples.
4. Report in this shape:
   - **Verdict:** ready, ready with caveats, or not ready.
   - **Must fix:** validator errors and design defects, each with `entity.attribute` and the concrete fix.
   - **Should fix**, then **Open questions**.
5. Offer to apply the fixes. With the MCP tools, put them in one `propose_changes` call so the person reviews them in the UI. Otherwise edit the file only after the user agrees. Re-validate either way.
