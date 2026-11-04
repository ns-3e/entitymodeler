---
title: Mappings, glossary and comments
seo_title: Source-to-target mappings and business glossary
description: Record source-to-target mappings and generate dbt model SQL, link entities and attributes to a shared business glossary, and review data models with comment threads in EntityModel.com.
section: Guides
order: 9
---

## Source-to-target mappings

**Mappings** (top bar) record where each attribute of the active tab gets its data from, in any other tab. It's the ETL or ELT specification for the model.

![The source-to-target mappings view with per-entity coverage and mapped attributes](/docs/images/mappings.webp "Mappings into a physical tab from its logical source, after Auto-map.")

- **Auto-map** matches attributes through derivation lineage first, then by name, so `CUST_NM` maps to `customer_name`.
- Each target attribute gets its **source columns**, a **transform** (an expression, or empty for a direct copy) and a **draft** or **approved** status. Coverage is shown per entity.
- **Renames and deletes** keep mappings in step.

Outputs:

- a CSV of every mapping;
- the generated **dbt model SQL** for each target entity;
- a "Source-to-target mappings" section in the design document.

From the CLI:

```bash
node bin/em.mjs mappings sales --target logical --source physical --auto
node bin/em.mjs mappings sales --target logical --format dbt
```

## Business glossary

The **Glossary** (top bar) is one list of business terms shared by every model: `models/_glossary.json` locally, this browser on the site. Each term has a definition, synonyms, a status, a domain and an owner.

- **Link** entities and attributes to terms from the inspector. A matching name gets a one-click suggestion, or link every match in a tab at once.
- **Models embed the terms they use**, so a model file stays self-contained when shared.
- **Docs** gain a glossary section, and blank descriptions borrow the term's definition.
- **Databricks DDL** tags columns with their business term.

```bash
node bin/em.mjs glossary add "Customer" --definition "A person or organization that buys from us."
node bin/em.mjs glossary suggest sales      # terms that match names in the model
node bin/em.mjs glossary link sales
```

## Review comments

Comment threads attach to the model, an entity, an attribute or a relationship. They have replies and can be resolved. Open comments show on entity cards and in the sidebar, and stay attached when things are renamed.

Running locally, **Ask Claude** can work through them: "Work through the open review comments" proposes fixes and replies to each thread. See [AI data modeling](/docs/ai-data-modeling/).
