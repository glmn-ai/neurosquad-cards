<!--
Title: "Add <id> <version>" · "Update <id> <old> → <new>" · "Remove <id>"
Step-by-step guide: docs/SUBMITTING.md (English) · docs/SUBMITTING.ru.md (русский)
One card per pull request. For changes to the repository itself, delete the card sections.
-->

## Card

- **id:** 
- **Repository and folder:** https://github.com/<owner>/<repo>/tree/<commit>/<path>
- **Commit:** <!-- full 40-character sha on the default branch -->
- **Version:** 
- **Previous verified commit (updates only):** <!-- and a compare link: https://github.com/<owner>/<repo>/compare/<old>...<new> -->

## What it does

<!-- Two or three sentences. What a user sees, what agents can do with it. -->

## Permissions and network hosts

<!-- One line per permission and per host: what the card does with it and why it cannot do without.
     For updates: list what is NEW or CHANGED first. -->

| Permission / host | Required or optional | Why |
| --- | --- | --- |
|  |  |  |

## Screenshot

<!-- Drag an image here (or link the one in your README). -->

## Checklist

See [docs/SUBMITTING.md](https://github.com/glmn-ai/neurosquad-cards/blob/main/docs/SUBMITTING.md) ([русский](https://github.com/glmn-ai/neurosquad-cards/blob/main/docs/SUBMITTING.ru.md)) for each item.

- [ ] The repository is **public**, and the card is at its root or in the `path` folder with `neurosquad-card.json` at that folder's root.
- [ ] `npx @neurosquad/card-sdk validate` passes with no errors at this commit.
- [ ] The commit is on the **default branch**, and `version` equals the manifest `version` at that commit.
- [ ] `dist/` (the manifest's `entry`) is committed, and the **source** that builds it is in the repository with a lockfile. No obfuscated or minified-only code.
- [ ] No `.env`, keys or `node_modules/` inside the package folder.
- [ ] Every permission is needed, has a `reason` in the manifest, and is explained above; `network` lists only the hosts the card talks to.
- [ ] The package has a `LICENSE` file and the manifest a `license`, equal to the entry's `license`.
- [ ] The README describes the card, what it sends where, and has at least one screenshot.
- [ ] `displayName` / `author.name` do not say NeuroSquad, official or verified (unless this is a `glmn-ai` card).
- [ ] `treeHash` (and the other computed fields) come from `node scripts/verify.mjs entry <owner>/<repo>[/<path>] --commit <sha>`.
- [ ] The entry is in `id` order, `updatedAt` is updated, and `npm run format` leaves the file unchanged.
- [ ] `node scripts/verify.mjs --changed-only origin/main` passes locally.
- [ ] This pull request changes only this one card's entry.
- [ ] "Allow edits from maintainers" is on.
