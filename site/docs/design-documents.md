---
title: Diagrams and design documents
seo_title: Export ER diagrams and data dictionaries (PNG, SVG, PDF)
description: Export ER diagrams as PNG or SVG, produce a PDF data model design document, and copy data dictionary tables (entity catalog, attribute dictionary, reference data, relationships) into Google Docs, Word, Confluence or Markdown.
section: Guides
order: 7
---

EntityModel.com produces the documentation a data model usually needs: the diagram, a data dictionary, and a design document that combines them.

## Diagram images

**Export → Diagram image**:

- **PNG** at 1×, 2× or 3× (print), with an optional title block and legend, or **SVG** for lossless scaling.
- **Theme**: light, dark or the current one; **background**: white, canvas or transparent.
- The image uses the current view settings. Switch the detail level to **Keys** or **Names** for an executive-level diagram, and hide entities you don't want shown.

The selection highlight is never included in exports.

## Documentation tables

The **Tables** view shows every design-doc table for the current tab:

![The Tables view with section and entity pickers and the entity catalog](/docs/images/tables-view.webp "The Tables view: pick sections and entities on the left, then copy or download the tables.")

| Table | Contents |
| --- | --- |
| Entity catalog | One row per entity: type, purpose, keys |
| Attribute dictionary | Per entity, every attribute with its data type, flags (key, required, PII), reference, example and description |
| Reference data | Reference lists, their dependencies and where they are used |
| Reference values | The full list of values of each reference entity |
| Relationships | Typed connections between entities, with cardinality and labels |
| Hierarchies | Levels and branches |
| Source-to-target mappings | Per entity, where each attribute comes from and how |
| Business glossary | The terms the model uses, and where |

Each table has **Copy** (rich text that pastes as a real table into Google Docs, Word or Confluence), **MD** (Markdown) and **TSV** (for spreadsheets). **Copy all** copies every table, and you can download them as HTML or Markdown.

## PDF design document

**Export → PDF document** builds a complete document:

- a cover page with the model summary and linked contents;
- the diagram on a landscape page;
- one chapter per section you pick, with table headers repeated across pages.

Choose the sections, the entities to include, and Letter or A4 paper.

![The Export dialog with PDF document selected, showing contents, sections, entities and page size](/docs/images/export-pdf.webp "Export → PDF document.")

## From the command line

```bash
node bin/em.mjs docs sales --format md --stdout
node bin/em.mjs docs sales --format html --sections overview,attributes,relationships
node bin/em.mjs docs sales --format pdf --page-size a4 --diagram exports/sales-diagram.png
```

The PDF uses the newest diagram PNG in the model's `exports/` folder unless you pass `--diagram` or `--no-diagram`.

## Writing the narrative with Claude

The `entity-design-doc` skill (in the repository's `.claude/skills/`) writes the data-model section of a design document from a model: an overview, design decisions and the tables above. See [AI data modeling](/docs/ai-data-modeling/).
