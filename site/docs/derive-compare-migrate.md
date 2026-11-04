---
title: Derive, compare and migrate tabs
seo_title: Derive logical and physical models, generate migration SQL
description: Keep conceptual, logical and physical data models as tabs of one EntityModel.com model. Derive one from another, compare any two, sync changes and generate ALTER/CREATE/DROP migration SQL.
section: Guides
order: 3
---

A model can hold several diagram **tabs**: a conceptual view, a logical model, a physical model per platform, dated versions and what-if variants. Tabs derived from one another remember their lineage, so EntityModel.com can compare them, carry changes across, and write the SQL that moves a database from one to the other.

If you're unsure what the three levels are, read [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/) first.

## Tabs

The tabs sit under the top bar. Each has its own entities, relationships, hierarchies, layout and a **kind**:

| Kind | Holds |
| --- | --- |
| Conceptual | Entities and relationships only; attributes optional |
| Logical | Business names, typed attributes, keys, reference lists, structs, N:N relationships |
| Physical | Tables and columns for one platform (its **dialect**): foreign key columns, junction tables, audit columns |
| Variant | A copy for a version or a what-if design |

**Copy** a tab to start a version or a variant. Right-click a selection for **Copy to tab** or **New tab from selection** to split out a subject area.

## Derive one tab from another

**New tab → Derive** builds a new tab from an existing one and shows a preview of every change before you accept it.

**Physical → logical** (reverse-engineering):
- business names: `tbl_cust_mstr` → `customer`, `cust_nm` → `customer_name`;
- audit, ETL and slowly-changing-dimension columns dropped;
- relationships instead of foreign key columns, and link tables as N:N relationships;
- lookup tables as reference data;
- relationships missing from the database inferred from key names.

**Logical → physical** (forward-engineering):
- foreign key columns added;
- N:N relationships resolved into junction tables;
- optional struct flattening and audit columns;
- a target platform (PostgreSQL, MySQL, Snowflake or Databricks).

**Anything → conceptual**: entities and relationships only, for executive and stakeholder diagrams.

From the CLI:

```bash
node bin/em.mjs derive sales --kind logical --from physical --dry-run
node bin/em.mjs derive sales --kind physical --from logical --name "Snowflake"
```

## Compare two tabs

**Compare** lists what was added, removed, renamed or changed between any two tabs. Lineage tracks renames, so `tbl_cust.cust_nm` and `customer.customer_name` are matched as the same thing rather than a delete and an add. Copy the diff as Markdown for a change log or a ticket.

![The Compare tabs dialog showing differences between a logical and a physical tab](/docs/images/compare-tabs.webp "Comparing a logical tab with the physical tab derived from it. Migration SQL is one click away.")

```bash
node bin/em.mjs diff sales v2026_10 v2026_11 [--format json]
```

## Generate migration SQL

From Compare, **Migration SQL** writes the DDL that turns the first tab's schema into the second's: `CREATE TABLE`, `ALTER TABLE … ADD/DROP/ALTER COLUMN`, `DROP TABLE`, with renames written as `RENAME` rather than drop-and-add.

```bash
node bin/em.mjs migrate sales v2026_10 v2026_11 --dialect postgres --out migrate.sql
```

## Sync a derived tab

After the source tab changes, **Sync from source** re-derives just the changes made since the tab was derived. It lists new entities, new attributes, type changes and new relationships to apply. Things the source dropped are listed but not selected, so nothing you added to the target by hand is lost.

```bash
node bin/em.mjs sync sales logical physical            # list the changes
node bin/em.mjs sync sales logical physical --apply    # or --propose for review in the app
```

## Source-to-target mappings

Derived tabs also feed **Mappings**: which source columns, with which transform, fill each target attribute. See [Mappings, glossary and comments](/docs/mappings-glossary-comments/).
