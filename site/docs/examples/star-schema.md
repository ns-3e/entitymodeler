---
title: Star schema example (retail sales)
seo_title: Star schema example: retail sales fact and dimensions
description: A worked star schema example for retail sales analytics — a sales fact table at order-line grain with date, product, store, customer (SCD type 2) and promotion dimensions — with ER diagram and SQL DDL.
section: Examples
order: 8
model: site/examples/star-schema.json
---

A **star schema** is the classic design for analytics: one **fact table** of measurements in the middle, surrounded by **dimension tables** that describe them. This example is a retail sales star in the Kimball style, the kind of model that sits in a Snowflake, Databricks or BigQuery warehouse behind BI dashboards.

## Design notes

- **Declare the grain first.** `fact_sales` has one row per order line. Every measure (quantity, sales, cost, margin) is true at that grain and adds up across any dimension.
- **Surrogate keys everywhere.** Dimensions have integer `*_key` columns independent of source system IDs, which keep their natural keys (`sku`, `customer_id`) as ordinary attributes.
- **The date dimension is a table, not a function.** `dim_date` has a row per day with calendar and fiscal attributes, keyed `YYYYMMDD`.
- **Customer history is kept (SCD type 2).** When a customer's segment or city changes, a new row with new `valid_from`/`valid_to` dates is added; facts point at the version current at the time of sale.
- **No empty foreign keys.** Sales without a promotion point at a "No promotion" row (key 0), so joins never drop rows.
- **The order number is a degenerate dimension**: kept on the fact for drill-through, with no table of its own.
- **Dimensions are denormalized**: the product carries its category and subcategory directly, so reports need one join per dimension.

To extend it: add `fact_inventory_snapshot` (a periodic snapshot fact), `fact_returns`, or a `dim_employee` for the cashier. Model the normalized source system first; see [Conceptual, logical and physical data models](/docs/learn/conceptual-logical-physical-data-models/).

<!-- example -->

## Frequently asked questions

### What is a star schema?

A star schema is a dimensional data model with a central fact table holding numeric measurements at a declared grain, joined by foreign keys to denormalized dimension tables (date, product, customer, store) that describe the context. Drawn as a diagram, the dimensions surround the fact like the points of a star.

### What is the difference between a star schema and a snowflake schema?

In a star schema each dimension is a single denormalized table. In a snowflake schema dimensions are normalized into several tables (product, then subcategory, then category). Stars are simpler and faster to query; snowflakes save some storage and enforce hierarchies.

### What is a slowly changing dimension (SCD) type 2?

A way to keep history in a dimension: instead of overwriting a changed attribute, add a new row with its own surrogate key and validity dates, and mark it current. Facts keep pointing at the version that was true when they happened.
