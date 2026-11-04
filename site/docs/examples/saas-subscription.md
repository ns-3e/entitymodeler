---
title: SaaS subscription billing data model
seo_title: SaaS subscription billing data model and ER diagram
description: An example SaaS subscription billing data model with ER diagram — organizations and users, plans and prices, subscriptions and items, metered usage, invoices, invoice lines and payments — with SQL DDL you can adapt.
section: Examples
order: 7
model: site/examples/saas-subscription.json
---

This example models how a SaaS company bills its customers: organizations and their users, a catalog of plans with prices per currency and interval, subscriptions made of items (seats, flat fees or metered usage), the usage reported against them, and the invoices and payments each billing period produces.

## Design notes

- **Plans and prices are separate.** A plan is what you sell (Team, Business); a price is how much, in which currency, how often and on which model (flat, per seat, metered, tiered). Prices are never edited, only replaced, so old invoices stay explainable.
- **A subscription has items.** Each item is one price with a quantity: 25 seats of Team monthly, plus a metered add-on. Upgrades change items rather than the subscription itself.
- **Usage is recorded, not summed in place.** `usage_record` keeps every report with an idempotency key; invoicing sums it for the period.
- **Invoices copy amounts.** Invoice lines store quantity, unit amount and amount as billed, and flag prorations from mid-period changes.
- **Payments are attempts.** Failed attempts are kept with their reason, which drives dunning and the `PAST_DUE` status.
- **Status, interval and pricing model are reference lists** with their values.

To extend it: add `coupon` and `discount`, `credit_note`, `tax_rate`, `payment_method` (stored as a provider token), or `entitlement` for feature flags per plan.

<!-- example -->

## Frequently asked questions

### How do you model subscriptions in a database?

Separate the catalog (plan, price) from what a customer holds (subscription and subscription items with quantities). Generate an invoice per billing period from the items, with invoice lines that copy the amounts charged, and record payments against invoices.

### How should SaaS pricing changes be stored?

Never update a price in place. Add a new price row and point new or migrated subscription items at it, keeping the old one for history. Invoices store the amounts they charged, so past bills never change.
