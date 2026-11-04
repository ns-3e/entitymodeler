---
title: Databricks data modeling
seo_title: Databricks data modeling: Unity Catalog ERD and DDL
description: Design Databricks and Unity Catalog data models with EntityModel.com — free and open source. Reverse-engineer Unity Catalog tables into an ER diagram and generate Delta table DDL with comments, constraints and PII tags.
section: Platforms
order: 2
---

EntityModel.com is a free, open-source data modeling tool for the Databricks lakehouse. Design logical models for your medallion layers, generate Delta `CREATE TABLE` scripts for Unity Catalog, and reverse-engineer existing catalogs and schemas into ER diagrams.

## Reverse-engineer Unity Catalog tables

In a model, choose **Import → From a database → Databricks**, enter the catalog and schema, run the generated `information_schema` query in a notebook or the SQL editor, and paste the result. Tables become entities, and declared primary and foreign key constraints become keys and relationships. The app never connects to your workspace. See [Import from a database](/docs/import-from-database/).

![The Import from a database dialog generating a Unity Catalog information_schema query](/docs/images/import-database.webp "The generated query reads only Unity Catalog metadata for main.sales.")

From a local checkout, `em pull` reads the schema through the Unity Catalog REST API, using your Databricks CLI profile:

```bash
node bin/em.mjs pull lakehouse --from databricks --catalog main --schema sales --profile DEFAULT
```

Each later pull becomes a dated version tab, so **Compare** shows schema drift between pulls.

`em profile lakehouse` then measures the pulled tables on a SQL warehouse (rows, empty values, approximate distinct counts, ranges) and flags keys that repeat, empty columns and candidate reference lists. See [Profile the data](/docs/import-from-database/#profile-the-data).

`em writeback lakehouse` writes the model's table and column descriptions back to Unity Catalog, and tags PII and glossary-linked columns (`pii`, `business_term`), setting only what the catalog doesn't already have. See [Write descriptions back](/docs/import-from-database/#write-descriptions-back-to-the-catalog).

## Generate Databricks DDL

**Export → Code → SQL DDL → Databricks** (or a physical tab targeting Databricks) writes:

- `CREATE TABLE … USING DELTA` with Databricks types: `STRING`, `INT`, `BIGINT`, `DECIMAL(p,s)`, `DOUBLE`, `BOOLEAN`, `DATE`, `TIMESTAMP`, and native `STRUCT<…>` and `ARRAY<…>` for structs and repeating groups;
- named primary key constraints and foreign keys, which Unity Catalog records as informational constraints;
- table and column `COMMENT`s from the model's descriptions, which show up in Catalog Explorer;
- `ALTER TABLE … ALTER COLUMN … SET TAGS` for columns flagged as PII (`'pii' = 'true'`) and for columns linked to a business glossary term (`'business_term' = '…'`).

![The Export dialog showing Databricks DDL with Delta tables, named constraints and comments](/docs/images/export-databricks.webp "Databricks DDL: Delta tables with named key constraints and table comments.")

```bash
node bin/em.mjs export lakehouse --format sql --dialect databricks --stdout
```

Because Databricks doesn't enforce primary and foreign keys, generate a **dbt `schema.yml`** with `not_null`, `unique`, `relationships` and `accepted_values` tests, or an **ODCS data contract**, from the same model ([dbt and data contracts](/docs/dbt-and-data-contracts/)).

## Modeling for the lakehouse

- Keep structs and arrays in the model where the data is nested; Databricks stores them natively, and the logical model stays readable.
- Use separate tabs for layers: a physical tab per source (bronze), a logical model, and a physical silver/gold tab derived from it, with lineage between them. [Source-to-target mappings](/docs/mappings-glossary-comments/) then generate the dbt SQL between layers.
- The [star schema](/docs/examples/star-schema/) and [Data Vault](/docs/examples/data-vault/) examples cover the common gold-layer and integration patterns.

## Frequently asked questions

### Can I create an ER diagram of Unity Catalog tables?

Yes. In EntityModel.com, Import → From a database → Databricks gives you an information_schema query for a catalog and schema; paste its result and the tables, keys and relationships appear as an ER diagram. Locally, em pull reads them through the Unity Catalog API.

### Does Databricks support primary and foreign keys?

Unity Catalog supports declaring primary and foreign key constraints on Delta tables. They are informational: recorded and used by tools and the optimizer, but not enforced. Use data tests or expectations to enforce them.

### How do I tag PII columns in Databricks from a data model?

Flag the attributes as PII in EntityModel.com and export Databricks DDL. The script includes ALTER TABLE … ALTER COLUMN … SET TAGS ('pii' = 'true') for each flagged column.
