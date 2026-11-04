---
title: Shared workspaces
seo_title: Collaborative data modeling in shared workspaces
description: Work on EntityModel.com data models together. Sign in, create a workspace, invite your team, and see each other's changes within a second. Saves never silently overwrite each other.
section: Guides
order: 9
---

A shared workspace holds data models that a team edits together. Members see each other's changes within about a second, and a save never silently overwrites someone else's.

Workspaces are optional. Models you don't add to a workspace stay where they always were: in your browser on entitymodel.com, or in `models/` when you [run it locally](/docs/getting-started/#run-it-locally).

## Sign in

On the home page, under **Shared workspaces**, sign in with an email link: enter your address and choose **Email me a link**. The link works once, for 15 minutes. It opens a page with a **Sign in** button, so a mail scanner that opens the link can't use it up. GitHub and Google sign-in are offered where they're configured.

The same verified email address is the same account, however you sign in.

## Create a workspace and add models

1. Choose **New workspace** and give it a name.
2. Choose **Add a model…** and pick one of your models. A copy goes into the workspace, and your own copy is unchanged.
3. Open the workspace model from its card. It opens in the same editor, with undo, export and every other feature.

## Invite your team

Open **Members** on the workspace. Owners add people by email and choose a role:

| Role | Can |
|---|---|
| Viewer | Open models and export them |
| Editor | Also change models and add models |
| Owner | Also manage members and delete models |

The person needs to have signed in once before they can be added. Anyone can leave a workspace, but each workspace keeps at least one owner.

## Working at the same time

Every save names the version it was made on.

- When someone else saves, your open copy reloads with their change within about a second.
- When their save arrives while you have unsaved edits, the editor shows **Someone else saved this model**. Choose **Load their version**, or **Keep mine** to save yours on top. Nothing is saved until you choose.

The server keeps the last 20 versions of each model.

## Limits

Each account can create 3 workspaces. Each workspace holds up to 50 models and 10 members, and a model can be up to 5 MB, which is several thousand entities.

## Privacy

Workspace models are stored on Cloudflare's network, on servers run for entitymodel.com, and only workspace members can open them. Your account holds your email address and, if you sign in with GitHub or Google, your name. Models you don't add to a workspace never leave your browser. See [Sharing, storage and offline use](/docs/sharing-and-offline/).

## Frequently asked questions

### Can two people edit the same data model at the same time?

Yes. In a shared workspace, each person's saves reach the others within about a second. If two people save at once, the second sees a banner and chooses which version to keep, so neither change is silently lost.

### Do I need an account to use EntityModel.com?

No. The modeler works without an account, and models stay in your browser. You only sign in to use shared workspaces.

### Does adding a model to a workspace move it?

No. **Add a model…** copies it. Your browser copy stays as it was, and changes to one don't affect the other.
