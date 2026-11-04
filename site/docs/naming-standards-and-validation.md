---
title: Naming standards and validation
seo_title: Data model naming standards and validation
description: EntityModel.com validates data models as you edit and enforces your naming standards per model kind (case, singular or plural, prefixes, key suffix, abbreviations, length, descriptions, PII review), with one-click fixes.
section: Guides
order: 10
---

## Validation

The **Issues** panel validates the model as you edit: names, keys, references, structs, relationships, hierarchies, reference values and mappings. Each issue is an error or a warning, and clicking it jumps to the exact place to fix it.

Typical checks:

- every entity has a primary key and a label attribute;
- names are valid and unique;
- references point at reference entities that exist, and dependent values have a matching parent;
- relationships connect entities that exist, with a valid cardinality;
- hierarchy levels are contiguous;
- mappings don't point at attributes that no longer exist.

From the CLI, `validate` checks every tab and exits with status 2 when there are errors, so it works in CI:

```bash
node bin/em.mjs validate sales
node bin/em.mjs validate sales --all     # include info-level findings too
```

## Naming standards

In the model's inspector, set **naming standards** for each tab kind (conceptual, logical, physical). A kind with no standards isn't checked.

| Standard | Options |
| --- | --- |
| Attribute case | `snake_case`, `camelCase`, `UPPER_SNAKE` |
| Entity names | Singular or plural |
| Prefixes | For entities, and for reference entities (such as `ref_`) |
| Key suffix | Such as `_id` |
| Abbreviations | Spell them out (`cust_nm` → `customer_name`) |
| Maximum identifier length | Such as 30 or 128 characters |
| Required descriptions | For entities, for attributes |
| PII review | Every attribute's PII flag must be reviewed |

A common setup is a logical tab with `snake_case`, singular names, `_id` keys, spelled-out words and required descriptions, and a physical tab with `UPPER_SNAKE`, a length limit and a `ref_` prefix for lookups.

## Fixing findings

Standards findings appear in Issues. The mechanical ones (renames, which cascade to every reference, and PII flags) have **Fix**, **All N** and **Fix automatically** buttons. From the CLI:

![The Issues view listing naming-standard warnings, each with Fix and All buttons](/docs/images/issues.webp "Issues on a physical tab checked against upper-snake-case and ref_ prefix standards.")

```bash
node bin/em.mjs validate sales --fix --dry-run   # show the fixes
node bin/em.mjs validate sales --fix             # apply them
```
