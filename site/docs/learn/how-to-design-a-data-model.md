---
title: How to design a data model
seo_title: How to design a data model, step by step
description: A practical, step-by-step method for designing a data model, from gathering requirements and naming entities to keys, relationships, reference data, normalization, naming standards, review and generating the database.
section: Learn
order: 4
---

A good data model is understood by the business, faithful to the rules of the domain, and straightforward to implement. This is a practical method that works for an operational database, a data warehouse or a lakehouse.

## 1. Gather the inputs

Collect what already describes the domain: requirements documents, process descriptions, reports people use, existing database schemas (DDL), CSV and spreadsheet headers, API payloads, and notes from interviews with the people who do the work. Existing schemas can be imported directly to start from what's there ([SQL to ER diagram](/docs/sql-to-er-diagram/), [Import from a database](/docs/import-from-database/)).

## 2. Agree on scope with a conceptual model

List the nouns the business uses (customer, order, product, supplier, invoice) and draw the main relationships between them. Settle the vocabulary early: is a "customer" a person, an account or a company? Write a one-sentence definition for each entity. A shared [business glossary](/docs/mappings-glossary-comments/#business-glossary) keeps those definitions consistent across models.

## 3. Define entities and attributes

For each entity, list the facts the business needs, with a data type, a description and an example value. Guidelines:

- One fact per attribute: split "name" into given and family name if the business uses them separately.
- Use precise types: `DECIMAL` for money, `DATE` versus `TIMESTAMP` deliberately.
- Mark which attributes are required and which hold **personal data (PII)**.
- Group related fields (an address) or repeating ones (phone numbers) as structures rather than `phone_1`, `phone_2`, `phone_3`.

## 4. Choose keys

Give every entity a **primary key**: a stable identifier that never changes and never repeats. Surrogate keys (`customer_id`) are usually safer than natural ones (an email address can change). Record natural identifiers as unique attributes. Choose a **label** attribute too, the one people use to recognize a record (`customer_name`).

## 5. Model relationships

Connect entities and, for each relationship, decide:

- **cardinality**: one-to-one, one-to-many or many-to-many;
- **optionality**: is the link required on each side?
- **a name in both directions**, so it reads as a sentence ("Supplier *supplies* Product", "Product *is supplied by* Supplier");
- whether the relationship has **attributes of its own** (a quantity, a start date). If so, it may deserve to be an entity.

Keep many-to-many relationships as they are in the logical model; they become junction tables in the physical model.

## 6. Pull out reference data

Wherever an attribute takes values from a fixed list (country, currency, status, type, unit of measure), model the list as a **reference entity** and load its values. This documents the allowed values, prevents spelling variants, and later produces lookup tables, foreign keys and `accepted_values` tests. Model dependent lists (Country → State → City) explicitly. See [Reference data](/docs/reference-data/).

## 7. Normalize, then decide where not to

For operational systems, normalize to roughly **third normal form**: every attribute depends on the key, the whole key, and nothing but the key. That removes duplicated facts that can drift out of step. For analytics, you may deliberately denormalize into dimensional (star) schemas in the physical model; keep the logical model normalized as the source of truth.

## 8. Model hierarchies

Recursive structures (organization charts, company ownership, product categories, geographic regions) are relationships from an entity to itself or across levels. Model the levels and the rules (maximum depth, whether a child can have several parents) explicitly.

## 9. Apply naming standards

Pick conventions and apply them everywhere: singular entity names, `snake_case` attributes, `_id` for keys, spelled-out words instead of abbreviations, a maximum identifier length for the target platform. Automated checks make this cheap. See [Naming standards and validation](/docs/naming-standards-and-validation/).

## 10. Review with people who know the domain

Walk through the diagram with business users, reading relationships aloud as sentences. Check example records against the model: can every real case be represented? Use review comments to capture questions and decisions, and keep a design document as the shared record ([Diagrams and design documents](/docs/design-documents/)).

## 11. Derive the physical model and generate code

When the logical model is stable, derive a physical model for each target platform: add foreign key columns, resolve many-to-many relationships, add technical columns, map types. Then generate SQL DDL, dbt tests and data contracts from it ([Export SQL DDL](/docs/export-sql-ddl/), [dbt and data contracts](/docs/dbt-and-data-contracts/)).

## 12. Version and evolve it

Keep the model under version control and treat changes like code: compare versions, generate migration SQL, and review changes in pull requests ([Data models in Git](/docs/data-models-in-git/)).

For complete worked models, see the [example data models](/docs/examples/).

## Common mistakes

- Modeling the screens or reports instead of the business things behind them.
- Storing lists in a single text field, or numbered columns (`address_1`, `address_2`).
- Using free text where a reference list belongs.
- Natural keys that turn out not to be unique or stable.
- Undocumented entities and attributes; a model without descriptions is hard to trust.
- Skipping the logical model and designing straight in one database's dialect.

## Frequently asked questions

### What are the steps of data modeling?

Gather requirements, agree on scope with a conceptual model, define entities and attributes, choose keys, model relationships and cardinality, extract reference data, normalize, apply naming standards, review with domain experts, then derive the physical model and generate the database code.

### What makes a good data model?

It uses the business's own vocabulary, represents every real case without duplicated facts, has stable keys, documents every entity and attribute, uses reference lists for coded values, follows consistent naming, and can be implemented on the target platform without surprises.
