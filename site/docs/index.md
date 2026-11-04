---
title: EntityModel.com documentation
seo_title: EntityModel.com Docs: free, open-source data modeling tool
description: How to design entity-relationship data models with EntityModel.com, the free, open-source ERD tool that runs in your browser. Covers diagrams, SQL import and export, logical and physical models, design documents, the CLI and AI agents.
section: Start here
order: 0
---

**EntityModel.com is a free, open-source (MIT) data modeling tool that runs in your web browser.** You draw entities, attributes, relationships, reference lists and hierarchies as an entity-relationship diagram (ERD), and generate the SQL, diagrams and documentation from it. You don't need an account, nothing to install, and your models stay in your browser.

[Open the app](/) · [Getting started](/docs/getting-started/) · [Source code on GitHub](https://github.com/ns-3e/entitymodeler)

![The EntityModel.com editor: model outline, ER diagram canvas and inspector](/docs/images/editor.webp "The editor: the model outline on the left, the diagram in the middle and the inspector on the right, here with the demo Customer model.")

## What you can do with it

| Task | Where to read about it |
| --- | --- |
| Draw an ER diagram with crow's foot notation | [Getting started](/docs/getting-started/) |
| Start from a complete example (e-commerce, CRM, HR, library, hospital, university) | [Example data models](/docs/examples/) |
| Turn `CREATE TABLE` scripts or DBML into a diagram | [SQL to ER diagram](/docs/sql-to-er-diagram/) |
| Reverse-engineer a Databricks, Snowflake, PostgreSQL or MySQL schema | [Import from a database](/docs/import-from-database/) |
| Model for a specific platform | [Snowflake](/docs/platforms/snowflake/), [Databricks](/docs/platforms/databricks/), [PostgreSQL](/docs/platforms/postgresql/) |
| Keep conceptual, logical and physical models side by side | [Derive, compare and migrate tabs](/docs/derive-compare-migrate/) |
| Generate SQL DDL for PostgreSQL, MySQL, Snowflake or Databricks | [Export SQL DDL](/docs/export-sql-ddl/) |
| Generate dbt `schema.yml`, ODCS data contracts, JSON Schema or Avro | [dbt and data contracts](/docs/dbt-and-data-contracts/) |
| Produce a PDF design document, PNG/SVG diagrams and data dictionary tables | [Diagrams and design documents](/docs/design-documents/) |
| Manage code lists (country, currency, status) | [Reference data](/docs/reference-data/) |
| Review model changes in pull requests | [Data models in Git](/docs/data-models-in-git/) |
| Design and change models with Claude or another AI agent | [AI data modeling](/docs/ai-data-modeling/) |

## Why EntityModel.com

- **Free and open source.** MIT license, no paid tier, no account. Run the hosted site or your own copy.
- **Private by default.** On entitymodel.com your models live in your browser's storage. Nothing is uploaded unless you export or share it, and share links keep the model in the part of the URL that browsers never send to a server.
- **Works offline.** The site caches itself on your first visit and installs as an app.
- **One model, many outputs.** The same model produces diagrams, SQL for four dialects, DBML, Mermaid, dbt tests, data contracts and a PDF design document.
- **Conceptual, logical and physical in one file.** Derive one kind of model from another, compare them, and generate migration SQL between versions.
- **Plain JSON files.** Each model is one readable JSON file you can version in Git, review in pull requests, and edit with the command-line tool or an AI agent.
- **Scales to big schemas.** Tested with models of 2,000 and 5,000 tables.

## Who it's for

Data architects and data modelers who want a lightweight alternative to desktop modeling suites; analytics and data engineers who need logical models, DDL and dbt tests from one place; software engineers documenting a database; and students learning entity-relationship modeling.

New to the topic? Start with [What is an ER diagram?](/docs/learn/what-is-an-er-diagram/) and [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/). Comparing tools? See [Free and open-source data modeling tools](/docs/learn/free-open-source-data-modeling-tools/), or EntityModel.com compared with [dbdiagram.io](/docs/compare/dbdiagram-alternative/), [erwin](/docs/compare/erwin-alternative/) and [Lucidchart](/docs/compare/lucidchart-alternative/).

## Frequently asked questions

### Is EntityModel.com free?

Yes. EntityModel.com is free to use at entitymodel.com and open source under the MIT license. There is no paid plan, no account and no usage limit.

### Do I need to install anything?

No. It runs in any modern browser. You can optionally install it as an app from the browser, or clone the repository and run it locally with Node.js 18 or later to work with model files on disk.

### Where are my models stored?

On entitymodel.com, models are stored in your browser (IndexedDB) on your device only. When you run it locally, each model is a JSON file in the `models/` folder. Export the model file to back it up or move it to another device.

### Which databases does it support?

It generates SQL DDL for PostgreSQL, MySQL/MariaDB, Snowflake and Databricks, imports SQL DDL and DBML, and can read schemas from Databricks, Snowflake, PostgreSQL and MySQL.

### Can I use it with AI assistants?

Yes. Models are plain JSON with a documented format. Locally, an MCP server and Claude Code skills let an AI agent read models and propose changes that you review and accept in the app.
