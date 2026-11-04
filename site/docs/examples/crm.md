---
title: CRM data model
seo_title: CRM data model: ER diagram and database schema
description: An example CRM (customer relationship management) data model with ER diagram — accounts and parent companies, contacts, leads, opportunities and pipeline stages, quoted products, activities and sales users — with SQL DDL.
section: Examples
order: 2
model: site/examples/crm.json
---

This example models a sales CRM: the companies you sell to (accounts), the people there (contacts), prospects not yet qualified (leads), deals moving through a pipeline (opportunities) with the products quoted on them, and the calls, emails, meetings and tasks logged against them.

## Design notes

- **Accounts form corporate families.** `parent_account_id` links a subsidiary to its parent, and the **Corporate Family** hierarchy makes the levels explicit for roll-up reporting.
- **Leads are separate from contacts.** A lead is an unqualified prospect. When it's converted, `converted_opportunity_id` records the opportunity it became.
- **Pipeline stages are a reference list with a default probability**, so forecast reports can weight each opportunity by stage.
- **Opportunity lines are a separate entity** between opportunity and product, holding the quantity and the discounted price.
- **Activities link to an account and, optionally, a contact and an opportunity**, so the timeline can be shown at each level.
- **Every record has an owner** (`owner_user_id`), which drives territories and permissions.

To extend it: add `campaign` and `campaign_member` for marketing attribution, `quote` for formal quotes, `case` for support tickets, or `territory` for sales coverage.

<!-- example -->

## Frequently asked questions

### What is the difference between a lead and a contact in a CRM?

A lead is an unqualified prospect, often a name and a company from a form or an event. A contact is a person at an account you already work with. When a lead is qualified, it is converted into an account, a contact and usually an opportunity.

### How do you model parent and child companies in a CRM?

Give the account table a parent_account_id that points at another account. That self-relationship forms a hierarchy you can roll revenue and opportunities up through.
