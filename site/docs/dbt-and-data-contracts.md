---
title: dbt and data contracts
seo_title: Generate dbt tests and data contracts from a data model
description: Generate a dbt schema.yml with not_null, unique, relationships and accepted_values tests, an Open Data Contract Standard (ODCS v3) contract, JSON Schema 2020-12 or Avro schemas from an EntityModel.com model.
section: Guides
order: 6
---

A data model already says which columns are required, which are unique, how tables relate, and which values a code may take. EntityModel.com turns that into the files data teams use to enforce it. All of these are under **Export → Code**.

## dbt `schema.yml`

One dbt model per entity, with descriptions, data types and data tests:

| In the model | dbt test |
| --- | --- |
| Primary key | `not_null` and `unique` |
| Composite primary key | `not_null` on each column, and `dbt_utils.unique_combination_of_columns` on the model |
| Required attribute | `not_null` |
| Unique attribute | `unique` |
| Foreign key (relationship or reference) | `relationships` to the parent model |
| Reference list with values (up to 200) | `accepted_values` |
| PII flag | `meta.pii` |

Drop it into your dbt project's `models/` folder next to the SQL models and run `dbt test`. If the model has composite keys, or N:N relationships, which become junction tables with one, add [`dbt-labs/dbt_utils`](https://hub.getdbt.com/dbt-labs/dbt_utils/latest/) to `packages.yml` and run `dbt deps` first. The file's header says when it's needed.

**Source-to-target mappings** also generate the dbt model SQL itself, from each target attribute's source columns and transform. See [Mappings, glossary and comments](/docs/mappings-glossary-comments/).

## ODCS data contract

An [Open Data Contract Standard](https://bitol-io.github.io/open-data-contract-standard/) v3 contract describing the schema: objects and properties, logical and physical types, primary keys, PII classification, foreign keys, and valid values from reference lists as quality rules. Use it as the starting point of a producer–consumer agreement and add the service levels and ownership your team needs.

## JSON Schema

JSON Schema 2020-12 with one definition per table under `$defs`: required properties, types, `enum`s from reference lists and `x-references` for foreign keys. Useful for validating API payloads or JSON landing data against the model.

## Avro

Avro record schemas, one per table, with logical `date` and `timestamp` types; optional columns are nullable unions. Useful for Kafka topics and schema registries.

## From the command line

```bash
node bin/em.mjs export sales --format dbt --dialect snowflake --stdout > models/schema.yml
node bin/em.mjs export sales --format odcs
node bin/em.mjs export sales --format jsonschema
node bin/em.mjs export sales --format avro
```

Combined with [model review in pull requests](/docs/data-models-in-git/), this keeps the model, the tests and the contract in step: change the model, regenerate, and review all three together.
