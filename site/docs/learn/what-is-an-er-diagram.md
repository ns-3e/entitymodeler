---
title: What is an ER diagram?
seo_title: What is an ER diagram? Crow's foot notation explained
description: An entity-relationship (ER) diagram shows the things a system stores data about, their attributes, and how they relate. Learn the parts of an ERD, cardinality, crow's foot notation and how to read one, with examples.
section: Learn
order: 1
---

An **entity-relationship diagram (ERD)** is a picture of the data a system holds: the *things* it stores information about (entities), the *facts* it records about each (attributes), and how the things are *connected* (relationships). ER diagrams are the standard way to design a database, document an existing one, and agree with business people on what the data means.

## The parts of an ER diagram

### Entities

An **entity** is a kind of thing the business needs to keep data about: Customer, Order, Product, Invoice. On a diagram it's a box with the entity's name at the top. Each row of the real data, such as one particular customer, is an *instance* of the entity.

### Attributes

**Attributes** are the facts recorded about each instance: a customer's name, email and sign-up date. They're listed inside the entity's box, usually with a data type.

### Keys

- A **primary key** uniquely identifies each instance, such as `customer_id`.
- A **foreign key** is an attribute that holds another entity's primary key, such as `order.customer_id`. It's how a relationship is stored in a relational database.

### Relationships

A **relationship** is a meaningful connection between two entities, drawn as a line: a Customer *places* an Order; an Order *contains* Order Lines. Good diagrams label relationships so they read as sentences in both directions.

## Cardinality

**Cardinality** says how many instances on one side can relate to how many on the other:

| Cardinality | Meaning | Example |
| --- | --- | --- |
| One-to-one (1:1) | Each A has at most one B, and each B one A | Employee — Security badge |
| One-to-many (1:N) | Each A can have many Bs; each B belongs to one A | Customer — Order |
| Many-to-many (N:N) | Each A can have many Bs and each B many As | Student — Course |

A many-to-many relationship can't be stored directly in relational tables. In the physical design it becomes a **junction table** (such as Enrollment, between Student and Course) holding both keys.

**Optionality** (or *modality*) adds whether the relationship is required: must every order have a customer (yes), must every customer have an order (no)?

## Crow's foot notation

The most common way to draw cardinality is **crow's foot notation**, using symbols at each end of the line:

| Symbol at the line's end | Meaning |
| --- | --- |
| A single bar `|` | One |
| A crow's foot (three prongs) | Many |
| A circle `O` | Zero (optional) |
| Bar and bar `||` | Exactly one |
| Circle and crow's foot | Zero or more |
| Bar and crow's foot | One or more |

So a line from Customer to Order with `||` at the Customer end and a circle and crow's foot at the Order end reads: "each order belongs to exactly one customer; each customer places zero or more orders." Other notations exist (Chen notation uses diamonds for relationships, and UML class diagrams use numbers like `1..*`), but crow's foot is the usual one in database design. EntityModel.com draws relationships in crow's foot notation.

## Levels of ER diagram

The same domain can be drawn at three levels of detail:

- **Conceptual**: the main entities and how they relate, for business stakeholders.
- **Logical**: every attribute, key and relationship, independent of any database product.
- **Physical**: tables, columns, data types, indexes and foreign keys for one database.

See [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/).

## How to make one

1. List the things the business talks about; these become entities.
2. Write down what you need to know about each; these become attributes. Pick a primary key.
3. Connect the entities, naming each relationship and deciding its cardinality.
4. Review it with the people who know the domain, and refine.

[How to design a data model](/docs/learn/how-to-design-a-data-model/) goes through this step by step. To draw one now, open [EntityModel.com](/), a free ER diagram tool that runs in your browser, or turn existing SQL into a diagram with [SQL to ER diagram](/docs/sql-to-er-diagram/).

## Frequently asked questions

### What is the difference between an ER diagram and a database schema?

An ER diagram is a model of the data: entities, attributes and relationships, often drawn before any database exists. A database schema is the implemented structure in a specific database: tables, columns, types and constraints. A physical ER diagram corresponds closely to a schema.

### What are the three main components of an ER diagram?

Entities (the things data is kept about), attributes (the facts recorded about each entity) and relationships (how entities are connected, with their cardinality).

### What does the crow's foot symbol mean?

The three-pronged crow's foot at the end of a relationship line means "many". Combined with a circle it means zero or more; combined with a bar it means one or more.
