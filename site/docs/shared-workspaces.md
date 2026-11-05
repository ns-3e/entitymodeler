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

## See who else is here

While a workspace model is open, the top bar shows a square for each other member who has it open. Hover over one to see their name and which tab they're on. When someone selects entities on the tab you're looking at, those entities get a colored outline and a tag with their name.

Others see your selection too, but only while you have the model open. It isn't saved with the model. Presence isn't shown on phones, where the top bar has no room for it, but the outlines on the canvas still are.

## Version history

Choose the **Version history** button in the top bar of a workspace model, or find it in the command palette (⌘K), which is where it is on a phone. The list shows each saved version, who saved it and when. Select one to see how the model has changed since then.

**Restore this version** saves that version as the newest one, for everyone. It doesn't remove anything, so the version you restored over stays in the list, and you can undo a restore the same way. Viewers can look through history but can't restore.

The server keeps the latest 20 saves of each model, plus the last save of each hour for the 30 most recent hours with saves. Models over about 1 MB keep 5 of those hourly saves.

## Limits

Each account can create 3 workspaces. Each workspace holds up to 50 models and 10 members, and a model can be up to 5 MB, which is several thousand entities.

## Privacy

Workspace models are stored on Cloudflare's network, on servers run for entitymodel.com, and only workspace members can open them, along with any [AI agent](/docs/mcp-server/) a member connects to their own account. Your account holds your email address and, if you sign in with GitHub or Google, your name, and other members of a workspace can see these. Models you don't add to a workspace never leave your browser. See [Sharing, storage and offline use](/docs/sharing-and-offline/).

## Download your data or delete your account

Choose **Account** next to your email address under **Shared workspaces**.

**Download my data** gives you one JSON file with your account details, your sign-in methods, your [connected agents](/docs/mcp-server/#disconnect-an-app), your workspaces, and the current version of every model in them, with its pending proposals.

**Delete my account** asks you to type your email address, then removes your account, sign-in methods, sessions and memberships straight away. This can't be undone.

- Any workspace you alone own is deleted with its models, for everyone in it. The dialog lists these first. To keep one, make another member its owner before you delete your account.
- Workspaces with another owner carry on, with their models. Anything you wrote in those models stays, and saved versions keep an internal ID that no longer links to you.
- Models in your browser aren't affected.

## Frequently asked questions

### Can two people edit the same data model at the same time?

Yes. In a shared workspace, each person's saves reach the others within about a second. If two people save at once, the second sees a banner and chooses which version to keep, so neither change is silently lost.

### Do I need an account to use EntityModel.com?

No. The modeler works without an account, and models stay in your browser. You only sign in to use shared workspaces.

### Can I see who else is working on a shared model?

Yes. The top bar shows who else has the model open, and entities they've selected on your tab are outlined with their name.

### Can I get back an earlier version of a shared model?

Yes. Open **Version history** on the model, select a version to see what changed since, and choose **Restore this version**. Restoring adds a new version, so nothing is lost.

### How do I delete my account?

Choose **Account** under **Shared workspaces**, type your email address and choose **Delete my account**. Workspaces you alone own are deleted too, and the dialog lists them first. You can download your data from the same dialog.

### Does adding a model to a workspace move it?

No. **Add a model…** copies it. Your browser copy stays as it was, and changes to one don't affect the other.
