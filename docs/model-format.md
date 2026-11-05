# EntityModel.com model format (`model.json`)

There is one JSON file per model, at `models/<model-id>/model.json`. The UI, the CLI and Claude all edit this file, and the UI reloads live when it changes on disk. The types are defined in `src/core/types.ts`, which is the source of truth for this document.

**Identity is by name, never by numeric id.** Entities, relationships and hierarchies are referenced by their `name`.

## Top level

```jsonc
{
  "format": "entitymodeler",
  "format_version": 1,
  "source": "https://entitymodel.com",  // where the file was made; written automatically
  "name": "acme_orders",              // internal slug
  "title": "Acme Orders",
  "organization": "Acme Corp",
  "description": "Scope and purpose…",
  "version": "0.1",
  "author": "",
  "status": "draft",                  // draft | in review | approved
  "created_at": "ISO-8601", "updated_at": "ISO-8601",
  "entities": [ /* Entity */ ],
  "relationships": [ /* Relationship */ ],
  "hierarchies": [ /* Hierarchy */ ],
  "areas": [ /* subject-area rectangles on the canvas */ ],
  "notes": [ /* sticky notes on the canvas */ ],
  "tab": { "name": "Physical", "kind": "physical", "dialect": "postgres" },  // optional: the primary tab's name and kind
  "tabs": [ /* further diagram tabs, see Tabs below */ ]
}
```

## Entity

```jsonc
{
  "name": "customer",                 // ^[a-z][a-z0-9_]*$ — internal name
  "display_name": "Customer",
  "entity_type": "standard",          // standard | reference
  "description": "…",
  "color_code": "#2563EB",
  "area": "Sales",                    // optional subject-area name
  "attributes": [ /* Attribute */ ],
  "struct_types": [ /* StructType */ ],
  "dependent_reference": null,        // reference only: { "parent": "country", "linked_column": "country_code" }
  "reference_values": [               // reference only: the list's values, keyed by attribute name
    { "country_code": "US", "country_name": "United States", "iso3": "USA" }
  ],                                  // dependent children also carry the linked column, e.g. { "country_code": "US", "state_code": "CA", ... }
  "reference_values_source": "ISO 3166-1",
  "notes": "design notes, not shown in the docs",
  "derived_from": "tbl_customers",    // set by tab derivation: the entity's name in the source tab
  "ui": { "x": 120, "y": 80 }         // canvas position; omit it and the UI lays the entity out.
                                      // "hidden": true keeps it in the model but off the diagram
                                      // "folded": ["billing_address"] collapses those STRUCT attributes' fields
                                      // into a single row on the diagram (docs and exports still list them)
}
```

- **standard** entities are the business things the model is about: Customer, Order, Product, Location.
- **reference** entities are controlled code lists that other entities point at: country, currency, status, type codes.

### Attribute

```jsonc
{ "name": "customer_id", "label": "Customer ID", "type": "STRING",
  "is_primary_key": true, "is_label": false, "is_array": false,
  "description": "",
  // REFERENCE_ENTITY only:
  "reference": { "entity": "country", "output_attribute": "country_name" },
  // STRUCT only:
  "struct_type": "address",
  // documentation metadata:
  "required": true, "pii": false, "example": "CUS-0001", "notes": "" }
```

- Types: `STRING BIGINT INT SMALLINT TINYINT DECIMAL DOUBLE FLOAT BOOLEAN DATE TIMESTAMP STRUCT REFERENCE_ENTITY`.
- `DECIMAL` takes `precision` and `scale` (default 18, 2). Use it for money and other exact numbers.
- `unique: true` marks values unique across rows. It becomes a UNIQUE constraint in SQL and a `unique` test in dbt.
- `profile` (on attributes and entities) is written by `em profile`, not by hand: `{ "non_null": 480, "distinct": 3, "min": "1", "max": "300", "max_length": 6 }` on an attribute, `{ "rows": 500, "sampled": true, "profiled_at": "…" }` on its entity. It holds counts and ranges only (min/max for numbers and dates), never sample values. Validation compares it with the design (`profile.*` issues), and derived tabs don't copy it.
- `is_label` marks the primary display attribute. Each entity has one.
- STRUCT and array attributes cannot be primary keys.
- `output_attribute` on a reference is the attribute of the reference entity whose value is stored on the referencing record.
- `example` appears in the UI, on hover, and in the Example column of the attribute dictionary. A reference attribute with no example shows the first values of its reference list instead.

### Reference values

A reference entity can carry its full list in `reference_values`: one object per value, keyed by attribute name, with every value a string.

The values are used for:
- hover hints on the attributes that reference the list
- the Reference values doc tables
- CSV download, with attribute names as the headers

Validation checks for blank or duplicate keys. It also checks that every dependent child's linked-column value exists in the parent's values; that match is exact and case-sensitive.

Load values from a file with `node bin/em.mjs values <id> <entity> <file.csv>`.

### Dependent reference

`dependent_reference` constrains a reference list to a parent list, as in Country → State → City.

- `parent` is the parent reference entity.
- `linked_column` is the parent attribute that each child value carries, usually the parent's primary key.
- The linked column is added to the child automatically, so it must not also be declared as an attribute on the child.

### StructType

```jsonc
{ "name": "address", "description": "",
  "fields": [ { "name": "line1", "type": "STRING" },
              { "name": "country_code", "type": "REFERENCE_ENTITY", "reference": { "entity": "country", "output_attribute": "country_code" } } ] }
```

Fields are scalars or REFERENCE_ENTITY only; structs cannot nest. For repeating groups, set `is_array: true` on the STRUCT attribute.

## Relationship

```jsonc
{ "name": "placed_by",                // ^[a-z][a-z0-9_]*$
  "source": "order", "target": "customer",
  "cardinality": "N:1",               // 1:1 | 1:N | N:1 | N:N   (1:N = each source has many targets)
  "forward_label": "Placed By", "reverse_label": "Placed", "bidirectional": true,
  "description": "",
  "foreign_key": "customer_id",       // optional: child attribute holding the parent's key (see below)
  "required": true,                   // optional: the child can't exist without the parent (see below)
  "attributes": [ { "name": "channel", "label": "Channel", "type": "STRING" } ] }
```

`foreign_key` names the attribute on the **child** side that holds the parent's primary key. SQL and DBML export use it.
- **N:1 and 1:1:** the child is the source.
- **1:N:** the child is the target.
- **N:N:** there is no foreign key; export writes a junction table named after the relationship.

`required` means every child row must have a parent, so the foreign key is `NOT NULL` in exports. It's how a logical tab, which has no foreign-key column, keeps that rule. Deriving a logical tab moves `NOT NULL` from a dropped column to its relationship, and deriving a physical tab moves it back to the column. N:N relationships ignore it.

`attributes` describe the relationship itself (an enrollment's `grade`), with the same shape as entity attributes but simple types only (no `STRUCT` or `REFERENCE_ENTITY`). Exports make them columns of the junction table for N:N (`required` → NOT NULL) and of the child table otherwise (always nullable there). Deriving a physical tab moves them onto those tables. Validation flags duplicate or invalid names (`rel.attr_duplicate`, `rel.attr_name`), complex types (`rel.attr_type`) and a name already used by a column of the child entity (`rel.attr_clash`).

When `foreign_key` is unset, it is inferred from the names: the parent's PK name, then `<parent>_<pk>`, then `<parent>_id`, and for self-relationships `parent_<pk>`. If nothing matches, the export adds a key column. Set it explicitly when the column name is unusual, e.g. `parent_supplier_id`.

## Hierarchy

```jsonc
{ "name": "customer_ownership", "display_name": "Customer Ownership", "root": "customer",
  "status": "draft", "max_depth": 6, "allow_multi_parent": false,
  "levels": [
    { "level": 2, "branches": [ { "name": "Subsidiaries", "entity": "customer", "relationship": "subsidiary_of", "direction": "forward", "parent_branch": "Root" } ] } ] }
```

- Level 1 is the root, and its branch name is `Root`.
- Levels run contiguously from 2.
- `forward` means the relationship's source is the child.

## Canvas extras

```jsonc
"areas": [ { "id": "area_x1", "name": "Sales", "color": "#3B82F6", "x": 0, "y": 0, "w": 900, "h": 600, "description": "" } ],
"notes": [ { "id": "note_x1", "text": "Open question: …", "x": 0, "y": 700, "w": 220, "color": "#FEF3C7" } ]
```

## Tabs

A model can hold several diagrams, shown as tabs: a conceptual view, a logical model, one physical model per platform, versions and what-if variants. The top-level `entities`, `relationships`, `hierarchies`, `areas` and `notes` are the **primary tab**; `tab` names it (default `{ "name": "Main", "kind": "logical" }`). Every other tab is an entry in `tabs` with the same five arrays plus its own metadata:

```jsonc
"tabs": [
  { "id": "logical",                 // stable id; [a-z0-9_]
    "name": "Logical",               // unique across tabs (case-insensitive)
    "kind": "logical",               // conceptual | logical | physical | variant
    "description": "",
    "dialect": "snowflake",          // physical tabs: target platform (default SQL dialect)
    "derived_from": "main",          // id of the tab this one was derived or copied from
    "derived_at": "ISO-8601",
    "source": { "platform": "databricks", "catalog": "main", "schema": "sales", "profile": "dev", "pulled_at": "ISO-8601" },  // tabs from `em pull`; profile = Databricks CLI profile name, never a secret
    "entities": [], "relationships": [], "hierarchies": [], "areas": [], "notes": [] }
]
```

- Tabs are independent: the same entity name can exist in several tabs with different attributes and positions. References and relationships only point within their own tab.
- Each tab is validated on its own. **Conceptual** tabs may have entities without attributes.
- `derived_from` on a tab, and on its entities and attributes, is lineage: `em diff` and `em migrate` (and Compare in the UI) use it to match renamed things, e.g. `tbl_cust.cust_nm` ↔ `customer.customer_name`.
- Make derived tabs with `node bin/em.mjs derive <id> --kind logical|physical|conceptual --from <tab>` rather than by hand.
- Single-tab tools (docs, export, values, import) act on the primary tab unless given `--tab`.

## Mappings

`mappings` records where each target attribute's data comes from, across tabs (an ETL spec):

```jsonc
"mappings": [
  { "id": "map_x1", "target": { "tab": "logical", "entity": "customer", "attribute": "customer_name" },
    "sources": [ { "tab": "main", "entity": "tbl_customers", "attribute": "cust_nm" } ],
    "transform": "initcap(src.cust_nm)", "status": "draft", "notes": "" } ]
```

- `tab` is a tab id (`main` for the primary tab).
- `sources` can be empty (a constant) or list several columns. An empty `transform` means a direct copy.
- Entity and attribute renames update mappings automatically; deleting a target removes its mapping.
- Validation warns about ends that no longer exist (`map.dangling`) and attributes mapped twice.

## Glossary terms and comments

```jsonc
"glossary_snapshot": [ { "id": "term_x1", "name": "Customer", "definition": "…", "synonyms": ["Client"], "status": "approved", "updated_at": "ISO-8601" } ],
"comments": [ { "id": "c_x1", "author": "Ana", "text": "Is this the legal name?", "created_at": "ISO-8601", "resolved": false,
               "target": { "tab": "main", "kind": "entity", "name": "customer", "attribute": "customer_name" },
               "replies": [ { "id": "r_x1", "author": "Claude", "text": "Yes; renamed.", "created_at": "ISO-8601" } ] } ]
```

- `term` on an entity or attribute holds a term id.
- The shared glossary lives in `models/_glossary.json` (`em glossary`). `glossary_snapshot` carries the terms the model uses, so the file stands alone.
- Comment `target.kind` is `model`, `entity` or `relationship`. Renames keep comments attached.

## Naming standards

`standards` holds optional rules per tab kind. Validation checks them, and Issues offers fixes for the mechanical ones.

```jsonc
"standards": {
  "logical": { "attribute_case": "snake", "entity_number": "singular", "abbreviations": "expand", "pk_suffix": "_id",
               "require_entity_description": true, "require_attribute_description": true, "require_pii_review": true },
  "physical": { "attribute_case": "upper_snake", "max_length": 255, "reference_prefix": "ref_" }
}
```

- Fields: `attribute_case` (`snake`, `camel`, `upper_snake`), `entity_number` (`singular`, `plural`), `entity_prefix`, `reference_prefix`, `pk_suffix`, `abbreviations` (`expand`), `max_length`, `require_entity_description`, `require_attribute_description`, `require_pii_review`.
- A kind with no entry is not checked.

## Older files

`normalizeModel` (in `src/core/model.ts`) migrates files from earlier versions of the format when they load:
- `client` becomes `organization`
- any non-reference `entity_type` becomes `standard`
- fields the model no longer carries are dropped

The cleaned file is written back on the next save, or immediately with `node bin/em.mjs fmt <id>`.
