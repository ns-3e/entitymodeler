---
title: Snowflake data modeling
seo_title: Snowflake data modeling tool: ERD and DDL (free)
description: Design Snowflake data models in your browser with EntityModel.com — free and open source. Reverse-engineer a Snowflake schema into an ER diagram, design logical and physical models, and generate Snowflake DDL, dbt tests and data contracts.
section: Platforms
order: 1
---

EntityModel.com is a free, open-source data modeling tool that works well with Snowflake. You can draw the model, generate Snowflake `CREATE TABLE` scripts, reverse-engineer an existing database into an ER diagram, and keep the model, the DDL and the dbt tests in step.

## Reverse-engineer a Snowflake schema

In a model, choose **Import → From a database → Snowflake**, enter the database and schema, run the generated metadata query in Snowsight or SnowSQL, and paste the result. Tables become entities, and primary and foreign key constraints become keys and relationships. The app never connects to Snowflake, so it never needs credentials. See [Import from a database](/docs/import-from-database/).

From a local checkout, `em pull` reads the schema through the Snowflake SQL API instead:

```bash
export SNOWFLAKE_ACCOUNT=myorg-myaccount SNOWFLAKE_TOKEN=…   # or SNOWFLAKE_USER + SNOWFLAKE_PRIVATE_KEY_PATH
node bin/em.mjs pull analytics --from snowflake --catalog ANALYTICS --schema SALES
```

Pull again later and you get a dated version tab; **Compare** and **Migration SQL** show what changed in the warehouse.

## Generate Snowflake DDL

**Export → Code → SQL DDL → Snowflake** (or set a physical tab's platform to Snowflake) writes:

- `CREATE TABLE` statements with Snowflake types: `VARCHAR`, `NUMBER(p,s)`, `FLOAT`, `BOOLEAN`, `DATE`, `TIMESTAMP_NTZ`, and `ARRAY` for repeating groups;
- `NOT NULL`, primary keys, `UNIQUE` constraints and foreign keys;
- table and column comments (`COMMENT = '…'`) from the model's descriptions;
- optionally, `INSERT` statements for reference lists.

![The Export dialog showing Snowflake DDL with VARCHAR types, primary keys and comments](/docs/images/export-snowflake.webp "Snowflake DDL with Snowflake types, keys and table comments.")

Snowflake records primary, unique and foreign key constraints but doesn't enforce them (except `NOT NULL`). They still document the model, and BI tools and query planners use them. Enforce them with tests instead: export a **dbt `schema.yml`** with `not_null`, `unique`, `relationships` and `accepted_values` tests ([dbt and data contracts](/docs/dbt-and-data-contracts/)).

```bash
node bin/em.mjs export analytics --format sql --dialect snowflake --stdout
node bin/em.mjs export analytics --format dbt --dialect snowflake > models/schema.yml
```

## Logical to physical for Snowflake

Keep a business-friendly **logical** model and derive a **physical** Snowflake tab from it with **New tab → Derive**: foreign key columns are added, many-to-many relationships become junction tables, and you can flatten structs and add audit columns. Naming standards (for example `UPPER_SNAKE` with a length limit) keep physical names consistent. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).

## Warehouse patterns

The [star schema](/docs/examples/star-schema/) and [Data Vault 2.0](/docs/examples/data-vault/) examples are common Snowflake designs; open either one and export it as Snowflake DDL.

## Frequently asked questions

### Is there a free data modeling tool for Snowflake?

Yes. EntityModel.com is free and open source (MIT). It imports Snowflake schemas, draws ER diagrams, and generates Snowflake DDL, dbt tests and data contracts, in the browser with no account.

### Does Snowflake enforce foreign keys?

No. Snowflake stores primary, unique and foreign key constraints as metadata but only enforces NOT NULL. Check keys and relationships with data tests, such as the dbt tests EntityModel.com generates from the model.

### How do I create an ER diagram from an existing Snowflake database?

Use Import → From a database → Snowflake in EntityModel.com: run the generated information-schema query in Snowsight and paste the result. Declared primary and foreign keys become relationships on the diagram.
