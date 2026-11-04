---
title: Getting started
seo_title: Getting started: make your first ER diagram online
description: Create your first entity-relationship model in EntityModel.com in a few minutes. Open the site, add entities and relationships, then export a diagram or SQL. Also covers running it locally.
section: Start here
order: 1
---

EntityModel.com runs at [entitymodel.com](/) with nothing to install. This page walks through a first model, then explains how to run it on your own machine.

## Make your first model

1. **Open [entitymodel.com](/).** The home page lists your models. On a first visit it is empty.
2. **Look at the demo (optional).** Click **Open the demo** to copy a customer model for an outdoor retailer (accounts, contacts and orders, with reference lists and a hierarchy) into your browser. It's a quick way to see every feature.
3. **Click New model.** Give it a title and, optionally, an organization. The diagram canvas opens.
4. **Add entities.** Press `E` or use the toolbar to add an entity, such as `customer`. In the inspector on the right, add attributes with their data types, and mark one as the primary key.
5. **Paste attributes in bulk.** Paste a `CREATE TABLE` statement, `name TYPE` lines or spreadsheet columns into the attributes list to add many at once.
6. **Draw relationships.** Press `R` for the relationship tool and drag from one entity to another. Set the cardinality (1:1, 1:N, N:1 or N:N) and the forward and reverse labels, such as "Customer *places* Order".
7. **Check the Issues panel.** Validation runs as you edit. Click an issue to jump to it.
8. **Export.** Click **Export** for a PNG or SVG diagram, a PDF design document, SQL DDL or the model file itself.

Your work saves automatically in the browser. Press `⌘S` (or `Ctrl+S`) at any time to save immediately.

> Browser storage is private to one browser profile, and clearing site data deletes it. Export the model file (**Export → Model file**) for anything you want to keep.

## Start from something you already have

- **SQL or DBML.** Click **Import SQL or DBML** on the home page and paste or drop `CREATE TABLE` scripts or a dbdiagram.io file. See [SQL to ER diagram](/docs/sql-to-er-diagram/).
- **A live database.** Use **Import → From a database** to build a metadata query for Databricks, Snowflake, PostgreSQL or MySQL, run it in your own SQL tool, and paste the result. See [Import from a database](/docs/import-from-database/).
- **An example.** Open one of the [example data models](/docs/examples/) (e-commerce, CRM, HR and more) and adapt it.
- **A model file.** Click **Open model file**, or drop a `.json` model anywhere on the home page.
- **A description.** **Design with Claude** copies a ready-made prompt you can paste into Claude, then paste the model it writes back in. See [AI data modeling](/docs/ai-data-modeling/).

## Find your way around

![The editor with the sidebar, diagram canvas, toolbar, inspector and tab bar](/docs/images/editor.webp "The sidebar lists entities, reference lists and relationships; the canvas toolbar sits above the diagram; the inspector edits the selection; tabs run along the bottom.")

- **Canvas.** Drag empty space to box-select; Space+drag, middle-drag or a two-finger scroll pans. Right-click a selection for Hide, Show only these, Arrange, Color, Copy to tab and more.
- **Detail level.** The toolbar toggle switches entity cards between All attributes, Keys only and Names only.
- **Inspector.** Select anything to edit it: entities, attributes, relationships, hierarchies, subject areas, notes and the model itself.
- **Command palette.** Press `⌘K` to jump to any entity, attribute (`order.status`), relationship or tab, or to run any action.
- **Tabs.** One model can hold several diagrams, such as a conceptual, a logical and a physical view. See [Derive, compare and migrate tabs](/docs/derive-compare-migrate/).

All shortcuts are listed in [Keyboard shortcuts](/docs/keyboard-shortcuts/).

## Run it locally

Running locally keeps each model as a JSON file on disk, which lets you version models in Git and use the [CLI](/docs/cli/) and [AI agents](/docs/ai-data-modeling/). You need Node.js 18 or later.

```bash
git clone https://github.com/ns-3e/entitymodeler.git
cd entitymodeler
npm install
npm run dev          # opens http://localhost:5180
```

The app chooses where to store models by itself:

| | In the browser (entitymodel.com) | Locally (`npm run dev`) |
| --- | --- | --- |
| Where models live | IndexedDB in your browser, this device only | `models/<id>/model.json` files |
| Getting started | Open the site | Clone, `npm install`, `npm run dev` |
| Sharing and backup | Share link, or Export → Model file | The files themselves (Git, a shared drive) |
| Offline | After the first visit; installable | Always |
| CLI and AI agents | Not available | Edit the same files; the UI reloads live |

Add `?storage=browser` to the URL to force browser storage when running locally.

## Next steps

- [Core concepts](/docs/concepts/): entities, reference entities, structs, relationships and hierarchies.
- [Export SQL DDL](/docs/export-sql-ddl/) for your database.
- [What is an ER diagram?](/docs/learn/what-is-an-er-diagram/) if you're new to data modeling.
