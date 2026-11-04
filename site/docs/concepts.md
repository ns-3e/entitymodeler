---
title: Core concepts
seo_title: Data model concepts: entities, relationships, reference data
description: The building blocks of an EntityModel.com data model: entities, attributes, keys, reference entities, dependent references, structs, relationships, hierarchies, subject areas and diagram tabs.
section: Start here
order: 2
---

An EntityModel.com model describes the things a business cares about and how they relate. Everything below lives in one JSON file; its exact format is in [Model file format](/docs/model-format/).

## Entities and attributes

An **entity** is a business thing the model describes, such as Customer, Order or Product. It has:

- **Attributes**, each with a data type (`STRING`, `BIGINT`, `INT`, `DECIMAL`, `DOUBLE`, `BOOLEAN`, `DATE`, `TIMESTAMP` and others), a description, an example value, and flags for required, unique and PII. An attribute can also be an array, a struct or a reference to a code list.
- **A primary key**: the attribute that identifies a record.
- **One label attribute**: the human-readable name of a record, such as `customer_name`.
- A **display name**, a description, a color and an optional subject area.

Internal names use lowercase `snake_case` (`order_line`); display names are free text (`Order Line`).

## Reference entities

A **reference entity** is a controlled list of codes that other entities point at: country, currency, order status, unit of measure. An attribute that *references* one, such as `order.status_code → order_status`, draws a line from the attribute row to the list on the diagram.

A reference entity can hold its full list of **values**, which flow into SQL `INSERT` statements, dbt `accepted_values` tests and the design document. See [Reference data](/docs/reference-data/).

## Dependent references

A **dependent reference** is a list constrained by a parent list: the valid states depend on the country, the valid cities on the state. The diagram shows these as "depends on" links, and the values grid checks each value's parent code.

## Structs

A **struct** is a grouped or repeating set of fields on an entity, such as a postal address or a list of phone numbers. Structs keep a logical model readable. When you derive a physical model, you can flatten them into columns.

## Relationships

A **relationship** is a named link between two entities with:

- a **cardinality**: one-to-one (1:1), one-to-many (1:N), many-to-one (N:1) or many-to-many (N:N);
- **forward and reverse labels**, so it reads as a sentence: "Customer *places* Order", "Order *is placed by* Customer";
- optionally, a **foreign key**: the child attribute that holds the parent's key, used for SQL export;
- optionally, **attributes of its own**: facts about the link rather than either entity, such as a student's grade in a course or the date an advisor took a student on.

Relationships use crow's foot notation on the diagram. Many-to-many relationships become junction tables when exported to SQL or derived into a physical model.

### Relationship attributes

Select a relationship and use **Relationship attributes → Attribute** in the inspector. Each one has a name, a type, a description and a **Required** flag. They show under the relationship's label on the diagram.

Where they end up:

- **Many-to-many:** columns of the junction table, next to the two keys. Required ones are `NOT NULL`.
- **One-to-many, many-to-one, one-to-one:** columns of the child entity, the one that holds the foreign key. They are never `NOT NULL` there, because a child without the link has no value for them.

Deriving a physical tab moves them onto those tables. Deriving a logical tab turns a link table keyed by its two foreign keys, with up to two other columns, back into a many-to-many relationship that carries those columns as attributes. SQL import does the same. Design documents list them in a **Relationship attributes** table, and compare reports when they're added, removed or changed.

## Hierarchies

A **hierarchy** organizes entities or records into levels and branches built from relationships: company ownership, a product taxonomy, a sales territory tree. Selecting a hierarchy highlights its path on the diagram.

## Subject areas and notes

**Areas** are labeled rectangles that group related entities on the canvas (Sales, Inventory, Finance). **Notes** are sticky notes for open questions and decisions.

## Diagram tabs

One model can hold several **tabs**, each a complete diagram with its own entities, relationships and layout, and a **kind**: conceptual, logical, physical or variant. A physical tab also has a target **dialect** (PostgreSQL, MySQL, Snowflake or Databricks). Tabs derived from another tab remember where they came from, which powers compare, sync and migration SQL. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).

## Business glossary and comments

A **glossary** of business terms is shared by every model; link entities and attributes to terms so definitions stay consistent. **Review comments** attach to the model, an entity, an attribute or a relationship. See [Mappings, glossary and comments](/docs/mappings-glossary-comments/).

## Next

- [Data modeling glossary](/docs/learn/data-modeling-glossary/) for the general terms.
- [How to design a data model](/docs/learn/how-to-design-a-data-model/) for a step-by-step method.
