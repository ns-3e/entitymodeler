---
title: Example data models
seo_title: Data model examples: ER diagrams, schemas and SQL
description: Free example data models with ER diagrams, data dictionaries and SQL DDL — e-commerce, CRM, HR, library, hospital, university, SaaS billing, star schema and Data Vault. Open any of them in EntityModel.com and adapt it.
section: Examples
order: 0
---

Each example is a complete, validated data model you can read here or open in EntityModel.com and change. Every page has the ER diagram, the entity and attribute dictionary, the relationships, reference data with values, PostgreSQL DDL and a Mermaid diagram.

| Example | What it covers |
| --- | --- |
| [E-commerce store](/docs/examples/ecommerce/) | Customers, addresses, a category tree, products, carts, orders, payments and shipments |
| [CRM](/docs/examples/crm/) | Accounts with parent companies, contacts, leads, an opportunity pipeline, quoted products and activities |
| [Human resources](/docs/examples/human-resources/) | Employees and their reporting line, departments, jobs and positions, salary history, leave and reviews |
| [Library management](/docs/examples/library-management/) | Books and authors (many-to-many), copies at branches, members, loans, holds and fines |
| [Hospital management](/docs/examples/hospital-management/) | Patients, doctors, appointments, admissions to wards and beds, diagnoses, prescriptions and invoices |
| [Student enrollment](/docs/examples/student-enrollment/) | Students, programs, courses with prerequisites, sections in terms, instructors and graded enrollments |
| [SaaS subscription billing](/docs/examples/saas-subscription/) | Organizations, plans and prices, subscriptions with seat and metered items, usage, invoices and payments |
| [Star schema (retail sales)](/docs/examples/star-schema/) | A sales fact at order-line grain with date, product, store, customer (SCD type 2) and promotion dimensions |
| [Data Vault 2.0](/docs/examples/data-vault/) | Hubs, links and satellites for customers, products and orders, with hash keys and load metadata |

## How to use an example

1. Open the example's page and click **Open this model in EntityModel.com**. The whole model is in the link, so nothing is uploaded; the app offers to open a copy in your browser.
2. Rename, add and remove entities to fit your domain. Validation keeps keys, references and relationships consistent as you go.
3. Derive a physical model for your database, then export SQL DDL, dbt tests or a PDF design document. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/) and [Export SQL DDL](/docs/export-sql-ddl/).

You can also download each example's `model.json` and open it with **Open model file**, or use it with the [command-line tool](/docs/cli/).

## How the examples are modeled

The examples follow the practices in [How to design a data model](/docs/learn/how-to-design-a-data-model/):

- singular `snake_case` names, surrogate primary keys ending in `_id`, and natural identifiers (email, SKU, ISBN) marked unique;
- every coded value (status, type, country) as a **reference list** with its values, so it becomes a lookup table, a foreign key and a dbt `accepted_values` test;
- relationships named in both directions, with the foreign key column recorded;
- personal data flagged as PII;
- money as `DECIMAL`, and history kept where it matters (prices on order lines, salary effective dates).
