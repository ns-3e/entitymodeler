---
title: Import from a database
seo_title: Reverse-engineer a database into an ER diagram
description: Reverse-engineer a Databricks Unity Catalog, Snowflake, PostgreSQL or MySQL schema into an EntityModel.com data model without sharing credentials, and track how the schema changes over time.
section: Guides
order: 2
---

EntityModel.com can build a model from an existing database schema. In the browser it does this without ever connecting to your database: it writes a metadata query, you run it in your own SQL tool, and you paste the result back.

## In the browser

1. In a model, choose **Import → From a database**.
2. Pick the platform (**Databricks**, **Snowflake**, **PostgreSQL** or **MySQL**) and enter the catalog or database and the schema.
3. Copy the generated query. It reads only metadata from the platform's information schema: tables, columns, types, keys and comments.
4. Run it in your usual tool (a Databricks notebook or SQL editor, Snowsight, `psql`, a MySQL client) and copy the result grid.
5. Paste the result back. Tables become entities and foreign keys become relationships, with the same lookup-table and junction-table handling as [SQL import](/docs/sql-to-er-diagram/).

Because you run the query, the app never sees a host name, a password or a token.

![The Import from a database dialog with a Databricks catalog and schema and the generated metadata query](/docs/images/import-database.webp "Import → From a database for a Databricks catalog and schema: copy the query, run it in Databricks, paste the result.")

## Track schema changes

The first import of a schema becomes a **Physical** tab. Each later import of the same schema becomes a new, dated version tab derived from the previous one. Then:

- **Compare** shows tables and columns added, removed, renamed or retyped between the two versions.
- **Migration SQL** writes the `ALTER`/`CREATE`/`DROP` statements between them.

See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).

## From the command line (local)

With a local checkout, `em pull` reads the schema directly. Credentials come from your environment or the platform's own CLI profile and are never stored in the model.

```bash
# Databricks Unity Catalog, through the REST API and your Databricks CLI profile
node bin/em.mjs pull sales --from databricks --catalog main --schema sales [--profile P]

# Snowflake SQL API: SNOWFLAKE_ACCOUNT + SNOWFLAKE_TOKEN,
# or SNOWFLAKE_USER + SNOWFLAKE_PRIVATE_KEY_PATH
node bin/em.mjs pull sales --from snowflake --catalog ANALYTICS --schema SALES

# PostgreSQL, through psql
node bin/em.mjs pull sales --from postgres --url postgres://… --schema public

# A query result you ran yourself, saved as CSV
node bin/em.mjs catalog-query --platform snowflake --catalog DB --schema S   # print the query
node bin/em.mjs pull sales --csv result.csv --platform snowflake
```

Add `--propose` to turn the pull into a proposal you review in the app instead of applying it directly.

## Next steps

- Derive a **logical** model from the imported physical tab to get business names and relationships. See [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/).
- Document the schema as a PDF data dictionary. See [Diagrams and design documents](/docs/design-documents/).
- Generate dbt tests for the tables. See [dbt and data contracts](/docs/dbt-and-data-contracts/).

## Frequently asked questions

### Does EntityModel.com need my database password?

No. In the browser it gives you a metadata query to run in your own SQL tool and reads the pasted result. The command-line pull uses credentials from your environment or CLI profile and never writes them to the model.

### Can I reverse-engineer Databricks Unity Catalog tables into an ERD?

Yes. Choose Databricks in Import → From a database, run the generated information-schema query in Databricks, and paste the result; or run `em pull --from databricks` locally. Primary and foreign key constraints become keys and relationships.
