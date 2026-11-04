---
title: Sharing, storage and offline use
seo_title: Share data models privately and work offline
description: How EntityModel.com stores models in your browser, shares them with links that never touch a server, works offline, installs as an app, and moves models between devices with the model file.
section: Guides
order: 8
---

## Where your models are stored

On [entitymodel.com](/), models are stored in your browser's IndexedDB, on this device and in this browser profile only. They are never uploaded unless you add one to a [shared workspace](/docs/shared-workspaces/). When you [run it locally](/docs/getting-started/#run-it-locally), each model is a JSON file in `models/<id>/model.json` instead.

Clearing site data deletes browser storage, so keep a copy of anything important: **Export → Model file** downloads `<name>.json`.

## Share links

**Share** in the top bar copies a link like `https://entitymodel.com/#/share/v1.…` that contains the whole model, compressed. The demo model fits in about 3 KB.

- **Nothing is uploaded.** The model lives in the part of the link after `#`, which browsers never send to a server.
- **Opening a link offers "Open a copy".** The recipient gets their own copy to view and edit; your model is not affected.
- **A link is a snapshot.** Later edits aren't included, so share again to send a newer version.
- **Very large models make long links**, which some chat apps cut off. Send the model file instead.

## The model file

The model file is a single readable JSON document ([format](/docs/model-format/)). Use it to:

- back up a model or move it to another browser or computer;
- send it to someone who opens it with **Open model file** (or by dropping it on the home page);
- keep it in Git and [review changes in pull requests](/docs/data-models-in-git/);
- give it to an AI assistant to change ([AI data modeling](/docs/ai-data-modeling/)).

## Offline and install

The site caches itself on your first visit, so it keeps working without a connection, and your models are already in the browser.

- **Install as an app:** in Chrome or Edge, use the install button in the address bar. On iPhone or iPad, use **Share → Add to Home Screen**.
- **Updates:** when a new version is released, the next visit picks it up and the app tells you.

On phones, the side panels become drawers over the diagram; tap an entity to see its details.

## Privacy

Your models never leave your browser unless you export them, share a link, or add them to a [shared workspace](/docs/shared-workspaces/), whose models are stored on the server for the workspace's members. Signing in, which only workspaces need, stores your email address. entitymodel.com counts visits with Cloudflare Web Analytics, which uses no cookies and no personal data. Self-hosted copies and local runs send nothing.

## Frequently asked questions

### Can I use EntityModel.com without an internet connection?

Yes. After the first visit the site is cached by your browser and works offline. You can also install it as an app.

### How do I move a model to another computer?

Export → Model file downloads a .json file. Open it on the other computer with Open model file on the home page. A share link also works for small and medium models.
