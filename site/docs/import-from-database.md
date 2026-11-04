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

A Databricks tab remembers the CLI profile name it was pulled with (never the token), so profiling and write-back reach the same workspace without `--profile`.

## Profile the data

A schema says what a table may hold; profiling shows what it does hold. `em profile` runs one query per table where the tab was pulled from and stores, for each column, how many rows have a value, how many distinct values there are, the range of numbers and dates, and the longest string. It never stores sample values, so a profiled model is still safe to commit.

```bash
node bin/em.mjs profile sales                    # first 100,000 rows per table
node bin/em.mjs profile sales --sample 0         # every row
node bin/em.mjs profile sales --entities orders,customer --propose

# Without a connection: print the queries, run them yourself, save the results as CSV
node bin/em.mjs profile sales --query > profile.sql
node bin/em.mjs profile sales --csv results.csv
```

In the app, running locally (`npm run dev`), a tab pulled from a database has a **Profile data** button in Issues and in the command palette (⌘K). It runs the same queries on this machine and applies the results as one undo step.

On Databricks the queries run on a SQL warehouse: `--warehouse <id>` or `DATABRICKS_WAREHOUSE_ID`, else the first running warehouse (a stopped one is started). Distinct values are counted exactly in the sample; with `--sample 0`, Databricks and Snowflake estimate them (within a few percent), and the checks allow for that. The numbers then show under each attribute in the inspector, and validation reports where the data disagrees with the design:

- a primary key that is empty or repeats, or a unique column that repeats
- a required column with empty rows
- a table without a primary key that has a column with a value in every row and no repeats: a candidate key
- a column that is always empty, or columns that are always set (they could be required: one note per table, with a one-click fix in Issues)
- a text column with only a handful of distinct values, a candidate reference list

## Write descriptions back to the catalog

Once tables and columns are described in the model, `em writeback` puts those descriptions into the catalog the tab was pulled from, so people browsing the catalog see them too. On Databricks it also tags personal-data columns (`pii`) and columns linked to a glossary term (`business_term`).

```bash
node bin/em.mjs writeback sales                 # print the statements, run nothing
node bin/em.mjs writeback sales --out docs.sql  # save them to review or run elsewhere
node bin/em.mjs writeback sales --apply         # run them
```

It reads the catalog first and lists only what differs. It never removes anything: a description left blank in the model keeps the catalog's comment. Agents get the same plan from the `plan_writeback` tool, which only returns the SQL; a person runs it.

In the app, running locally, **Write back** in Issues (or ⌘K) shows the same statements for the active tab, ready to copy or download as a `.sql` file. The app never runs them; run them in your SQL editor or with `--apply`.

## Next steps

- Derive a **logical** model from the imported physical tab to get business names and relationships. See [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/).
- Document the schema as a PDF data dictionary. See [Diagrams and design documents](/docs/design-documents/).
- Generate dbt tests for the tables. See [dbt and data contracts](/docs/dbt-and-data-contracts/).

## Frequently asked questions

### Does EntityModel.com need my database password?

No. In the browser it gives you a metadata query to run in your own SQL tool and reads the pasted result. The command-line pull uses credentials from your environment or CLI profile and never writes them to the model.

### Does profiling copy my data into the model?

No. `em profile` stores counts (rows, non-empty rows, distinct values), the longest string, and the smallest and largest value of numbers and dates. Text values, such as names or emails, are never stored. Columns flagged as PII, or named like personal data (birth date, social security number, phone…), keep counts only, without their smallest and largest values.

### Can I reverse-engineer Databricks Unity Catalog tables into an ERD?

Yes. Choose Databricks in Import → From a database, run the generated information-schema query in Databricks, and paste the result; or run `em pull --from databricks` locally. Primary and foreign key constraints become keys and relationships.
