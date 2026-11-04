---
title: Data Vault 2.0 example
seo_title: Data Vault 2.0 example: hubs, links and satellites
description: A worked Data Vault 2.0 example — hubs for customer, product and order business keys, links for their relationships, and satellites for descriptive history — with ER diagram, hash keys and SQL DDL.
section: Examples
order: 9
model: site/examples/data-vault.json
---

**Data Vault** is a modeling method for the integration layer of a data warehouse. It separates *business keys* (hubs), *relationships* (links) and *descriptive attributes over time* (satellites), so new sources and changes are added without reworking what's there. This example is a small raw vault for customers, products and orders.

## Design notes

- **Hubs hold business keys only.** `hub_customer` has one row per customer ID ever seen, with its hash key, first load time and source. Hubs are insert-only.
- **Links hold relationships.** `link_order_customer` and `link_order_product` connect hubs through their hash keys. Every relationship is a link, even one-to-many ones, so cardinality changes in the source don't change the model.
- **Satellites hold history.** Each satellite is keyed by its parent's hash key plus `load_dts`, and gets a new row only when `hash_diff` (a hash of its descriptive columns) changes.
- **Satellites can hang off links.** `sat_order_product` holds the quantity and price of each order line.
- **Every row records where and when it came from** (`record_source`, `load_dts`), which makes the vault auditable.
- **Hash keys** (`*_hk`) are computed from the business keys, so loads can run in parallel without lookups.

Business-facing star schemas or views are built on top of the vault; see the [star schema example](/docs/examples/star-schema/).

<!-- example -->

## Frequently asked questions

### What are hubs, links and satellites in Data Vault?

Hubs store unique business keys, links store relationships between hubs, and satellites store descriptive attributes and their history for a hub or a link. Together they separate identity, relationships and context.

### When should you use Data Vault instead of a star schema?

Data Vault suits the integration layer when you combine many changing sources and need full history and auditability. Star schemas suit the presentation layer that analysts query. Many warehouses use both: a vault for integration, stars built on top for reporting.
