---
name: entity-design-doc
description: Produce the data-model portion of a design document from an EntityModel.com model: narrative plus tables (entity catalog, attribute dictionaries, reference data and values, relationships, hierarchies). Use for "write the data model section", "generate the design doc tables", "document the Acme model", "give me the attribute dictionary for Customer".
---

# Data model section for a design document

## Before you start: locate the workbench

This skill drives the **EntityModel.com** workbench: a folder containing `bin/em.mjs`, `models/` and `docs/model-format.md`. All paths below are relative to that folder.

- **Find it.** It is the selected or working folder, or a parent or child of it, that contains `bin/em.mjs`. If there is none, ask the user to select their EntityModel.com folder and stop.
- **Run the CLI** as `node bin/em.mjs …` from that folder. If `node` is unavailable, read `models/<id>/model.json` directly following `docs/model-format.md`.
- **The visual editor** runs at http://localhost:5180 (`npm run dev`, or the optional background service).

## Steps

1. **Generate the tables from the model.** Never hand-type them; they must match the model.
   - Markdown: `node bin/em.mjs docs <id> --stdout`.
   - Styled HTML that pastes cleanly into Word or Google Docs: `--format html`.
   - A complete PDF document: `--format pdf`.
   - Scope the output with `--sections overview,attributes,reference,refvalues,relationships,hierarchies` and `--entities a,b`. `node bin/em.mjs sections` lists the sections.
   - Files land in `models/<id>/exports/` unless you pass `--stdout`.
2. **Write the narrative around the tables**, in this order. Be decisive and specific, in a senior architect's voice, with no filler or hype.
   1. **Scope:** which business domains the model covers and why.
   2. **Entity model:** one paragraph per main entity covering what a record represents, its business key, and how it relates to the others.
   3. **Reference data:** the controlled lists, where their values come from, and their dependencies.
   4. **Relationships and hierarchies:** what they express and what they enable for consumers.
   5. **Open decisions:** from canvas notes and incomplete parts of the model.
3. **Diagram.** The PNG comes from the UI: Export → Diagram image, 2×, with title block and legend. Reference it as "Figure 1 — <model title> data model". For an executive view, suggest the "Keys" detail level.
4. **Deliver.**
   - If the user has a docs connector and asks for the content there, put it there.
   - Otherwise write a Markdown or HTML file in `models/<id>/exports/` and give the path.
   - For pasting into an existing doc, point them to the UI's **Tables** view → Copy (rich tables).
