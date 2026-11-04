---
title: PostgreSQL ER diagram and schema design
seo_title: PostgreSQL ER diagram tool: design and reverse-engineer
description: Design PostgreSQL databases with a free, open-source ER diagram tool. Import a pg_dump schema or a live database into an ERD, design in the browser, and generate PostgreSQL DDL and migration SQL.
section: Platforms
order: 3
---

EntityModel.com is a free, open-source ER diagram tool for PostgreSQL. Turn an existing schema into a diagram, design changes visually, and generate the PostgreSQL DDL or the migration between two versions.

## From PostgreSQL to a diagram

- **A schema dump.** Run `pg_dump --schema-only mydb > schema.sql` and drop the file on **Import SQL or DBML**. Tables, columns, keys, `UNIQUE`/`NOT NULL`, comments and foreign keys come across; lookup tables seeded with `INSERT`s become reference lists. See [SQL to ER diagram](/docs/sql-to-er-diagram/).
- **A live database.** **Import → From a database → PostgreSQL** gives you an `information_schema` query to run in `psql` or any client; paste the result. Locally, `em pull` runs it through `psql` for you:

```bash
node bin/em.mjs pull app --from postgres --url postgres://localhost/mydb --schema public
```

## From a diagram to PostgreSQL

**Export → Code → SQL DDL → PostgreSQL** writes `CREATE TABLE` statements with PostgreSQL types (`TEXT`, `INTEGER`, `BIGINT`, `NUMERIC(p,s)`, `BOOLEAN`, `DATE`, `TIMESTAMP`, arrays and `JSONB` for nested structures), primary keys, `UNIQUE` and foreign key constraints, junction tables for many-to-many relationships, `COMMENT ON TABLE`/`COLUMN` from descriptions, and optional `INSERT`s for reference data.

![The Export dialog showing PostgreSQL DDL generated from a model](/docs/images/export-sql.webp "PostgreSQL DDL with comments, ready to copy or download.")

The generated DDL is tested: the project's test suite runs it against a real PostgreSQL engine (PGlite) for the demo and every [example model](/docs/examples/).

## Migrations

Keep the current schema and the target design as two tabs, then **Compare → Migration SQL** writes the `CREATE`, `ALTER` and `DROP` statements between them, with renames as `RENAME` so data isn't dropped and re-created. From the CLI:

```bash
node bin/em.mjs migrate app current target --dialect postgres --out V42__changes.sql
```

See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/) and [Data models in Git](/docs/data-models-in-git/) for reviewing migrations in pull requests.

## Frequently asked questions

### How do I generate an ER diagram from a PostgreSQL database?

Export the schema with pg_dump --schema-only and import the .sql file into EntityModel.com, or use Import → From a database → PostgreSQL and paste the result of the generated query. Foreign keys become relationships on the diagram.

### Is there a free PostgreSQL schema design tool that runs in the browser?

Yes. EntityModel.com is free, open source and runs in the browser with no account. It generates PostgreSQL DDL and migration SQL from the diagram.
