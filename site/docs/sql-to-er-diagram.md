---
title: SQL to ER diagram
seo_title: Convert SQL to an ER diagram online (free)
description: Turn CREATE TABLE scripts from PostgreSQL, MySQL, Snowflake or Databricks, or a dbdiagram.io DBML file, into an editable entity-relationship diagram in your browser. Free, no upload, no account.
section: Guides
order: 1
---

You can paste SQL DDL or DBML into EntityModel.com and get an editable ER diagram, with tables as entities and foreign keys as relationships. Parsing happens in your browser; the script is never uploaded.

## Import a script

1. Open [entitymodel.com](/) and click **Import SQL or DBML** on the home page. (Inside a model, use the import button in the top bar to add tables to it.)
2. Paste the script, or drop a `.sql` or `.dbml` file.
3. Import. Entities are laid out automatically, and anything that couldn't be read (such as a composite foreign key) is listed as a warning.

It reads `CREATE TABLE` statements in the PostgreSQL, MySQL/MariaDB, Snowflake and Databricks styles, and DBML files from [dbdiagram.io](https://dbdiagram.io).

![The Import tables dialog with two CREATE TABLE statements pasted in](/docs/images/import-sql.webp "Two pasted tables, detected as SQL DDL: the summary shows what will be added and how the model validates afterwards.")

## What the importer recognizes

| In the script | In the model |
| --- | --- |
| `CREATE TABLE` | An entity, with each column as a typed attribute |
| `PRIMARY KEY` | The entity's primary key |
| `FOREIGN KEY … REFERENCES`, inline `REFERENCES`, DBML `Ref` | A relationship with the right cardinality and its foreign key column |
| `UNIQUE`, `NOT NULL` | The attribute's unique and required flags |
| Column and table comments | Descriptions |
| Lookup tables | Reference entities, with their values when the script seeds them |
| Junction (link) tables | Many-to-many relationships |

A table counts as a **lookup table** when it is seeded with `INSERT` statements, sits in a "Reference data" group, or is named like `*_type`, `*_status` or `ref_*`. Its `INSERT` rows become the reference list's values. See [Reference data](/docs/reference-data/).

A table counts as a **junction table** when its primary key is exactly two foreign keys and it has at most two other columns. It becomes an N:N relationship instead of an entity, which is how a logical model shows it.

## After importing

- Switch the toolbar's detail level to **Keys** to see the structure without every column.
- Use **Auto-layout**, or drag entities and group them into subject areas.
- Imported tables mirror the database. Use **New tab → Derive** to turn them into a clean **logical** model with business names, relationships instead of key columns, and audit columns dropped. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).
- Export the diagram as PNG or SVG, or generate a PDF data dictionary. See [Diagrams and design documents](/docs/design-documents/).

## From the command line

With a local checkout, `em import` does the same:

```bash
node bin/em.mjs import sales schema.sql --create     # create a model from a script
node bin/em.mjs import sales more-tables.dbml        # add tables to an existing model
```

## Importing straight from a database

To reverse-engineer a live schema rather than a script, see [Import from a database](/docs/import-from-database/). The app generates a metadata query you run yourself, so it never needs your credentials.

## Frequently asked questions

### Can I convert a PostgreSQL schema dump into an ER diagram?

Yes. Run `pg_dump --schema-only` and paste the CREATE TABLE statements, or drop the .sql file on the import dialog. Tables become entities and foreign keys become relationships drawn in crow's foot notation.

### Is my SQL uploaded anywhere?

No. On entitymodel.com the script is parsed in your browser and the model is stored in your browser's local storage.

### Can I go back from the diagram to SQL?

Yes. Export → Code generates SQL DDL for PostgreSQL, MySQL, Snowflake or Databricks from the model, including any changes you made to the diagram.
