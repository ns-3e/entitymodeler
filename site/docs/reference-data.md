---
title: Reference data
seo_title: Model reference data and code lists
description: Model reference data (code lists such as country, currency and status) as reference entities in EntityModel.com, load their values from CSV or Excel, and carry them into SQL inserts, dbt accepted_values tests and design documents.
section: Guides
order: 4
---

**Reference data** is the set of controlled code lists that other data points at: countries, currencies, order statuses, units of measure, product types. EntityModel.com treats each list as a **reference entity** that can hold its full set of values, so the list is designed, documented and exported along with the model.

## Create a reference entity

1. Add an entity and set its type to **Reference** in the inspector.
2. Give it a key attribute (such as `country_code`) and a label attribute (such as `country_name`), plus any extra columns (`iso3`, `sort_order`).
3. On another entity, add an attribute of type **Reference** and choose the list and the attribute whose value is stored, for example `customer.country_code → country.country_code`.

The diagram draws a line from the referencing attribute's row to the list. Hovering over the attribute shows the allowed values.

## Load the values

The **Values** tab of a reference entity holds its list:

- **Paste** rows from Excel, Google Sheets or a CSV file.
- **Import** a CSV file.
- **Edit** inline in the grid.

![The Values tab of the Country reference entity in the inspector](/docs/images/reference-values.webp "The Values tab of the Country reference list, with its source and four values.")

The grid checks for blank and duplicate keys. Note the source of the list (for example "ISO 3166-1") so readers know where it comes from.

From the CLI:

```bash
node bin/em.mjs values sales country countries.csv [--append]
node bin/em.mjs values sales country --export > countries.csv
```

## Dependent lists

A **dependent reference** is constrained by a parent list, as in Country → State → City. Set the parent and the linked column (usually the parent's key) on the child. Each child value then carries its parent's code, and validation checks that every parent code exists in the parent's values.

## Where the values go

| Output | What you get |
| --- | --- |
| SQL DDL | A lookup table, a foreign key to it, and optionally `INSERT` statements for every value |
| dbt `schema.yml` | An `accepted_values` test on each referencing column |
| ODCS data contract | A `validValues` quality rule on each referencing column |
| JSON Schema | An `enum` of the allowed values |
| PDF and design-doc tables | A reference data catalog and a values table per list |

## Lookup tables when importing

When you import SQL, tables seeded with `INSERT` statements, grouped as reference data, or named like `*_type`, `*_status` or `ref_*` become reference entities with their values. See [SQL to ER diagram](/docs/sql-to-er-diagram/).
