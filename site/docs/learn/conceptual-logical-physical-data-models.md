---
title: Conceptual, logical and physical data models
seo_title: Conceptual vs logical vs physical data models
description: The three levels of data modeling explained. What conceptual, logical and physical data models contain, who they are for, how they differ, and how to move from one to the next.
section: Learn
order: 2
---

Data models are usually built at three levels of detail. Each answers a different question for a different audience, and each is derived from the one before.

| | Conceptual | Logical | Physical |
| --- | --- | --- | --- |
| Question | What does the business deal with? | What data do we need, exactly? | How is it stored in this database? |
| Audience | Business stakeholders, sponsors | Data architects, analysts, engineers | Database and data engineers |
| Contains | Main entities and relationships | All entities, attributes, keys, relationships, reference data | Tables, columns, data types, foreign key columns, junction tables, indexes, audit columns |
| Names | Business terms (Customer) | Business terms, standardized (`customer_name`) | Platform conventions (`CUSTOMER_NM`, `dim_customer`) |
| Many-to-many | Shown as-is | Shown as-is | Resolved into junction tables |
| Platform-specific | No | No | Yes: one per database (PostgreSQL, Snowflake, Databricks…) |

## Conceptual data model

A conceptual model names the core things the business deals with and how they relate: Customer *places* Order, Order *contains* Product, Supplier *supplies* Product. It usually has no attributes or only a few, and fits on one page. Its job is to agree on scope and vocabulary with the people who own the business process.

## Logical data model

A logical model adds full detail while staying independent of any database product:

- every attribute, with a business data type and a description;
- primary keys and the label that identifies each record to people;
- relationships with cardinality and optionality, including many-to-many;
- reference data (code lists such as country or order status) and their values;
- structures such as an address or a list of phone numbers;
- hierarchies, such as company ownership or a product taxonomy.

The logical model is where most design decisions are made, and it's the best source for a data dictionary and design document.

## Physical data model

A physical model is the logical model implemented for one platform:

- foreign key columns added for each relationship;
- many-to-many relationships resolved into junction tables;
- names converted to the platform's conventions and length limits;
- data types mapped to the platform's types (`DECIMAL(18,2)`, `TIMESTAMP_NTZ`, `STRING`);
- technical columns for loading and auditing (`created_at`, `load_id`, slowly-changing-dimension dates);
- indexes, partitioning and clustering where the platform uses them.

There can be several physical models for one logical model, for example an operational PostgreSQL database and a Snowflake or Databricks analytics copy.

## Moving between levels

- **Forward engineering** goes down: conceptual → logical → physical → SQL DDL.
- **Reverse engineering** goes up: an existing database → physical model → a cleaned-up logical model with business names and relationships.

Keeping the levels linked (knowing which physical column came from which logical attribute) lets you compare them, keep them in sync, and generate migration scripts when the design changes.

## Doing this in EntityModel.com

EntityModel.com keeps all three levels as **tabs** of one model. **New tab → Derive** creates one from another, with a preview: physical → logical (business names, audit columns dropped, link tables as N:N, lookups as reference data), logical → physical (foreign keys, junction tables, a target platform), or anything → conceptual. Tabs remember their lineage, so **Compare**, **Sync** and **Migration SQL** work across them. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).

## Frequently asked questions

### What is the difference between a logical and a physical data model?

A logical data model describes the data (entities, attributes, keys and relationships) independent of any database. A physical data model implements it for a specific database, with tables, columns, platform data types, foreign key columns, junction tables for many-to-many relationships, and technical columns.

### Do I need all three data models?

Not always. Small projects often go straight to a logical model and generate the physical one from it. The conceptual model helps most when many business stakeholders need to agree on scope, and separate physical models help when one design is deployed to several platforms.

### Which comes first, the logical or the physical model?

For a new system, the conceptual and logical models come first and the physical model is derived from them. For an existing database, you often start from the physical model (reverse engineering) and derive a logical model from it.
