# Contributing

This repository accepts pull requests that **add, update or remove entries in
[`verified.json`](verified.json)**, and fixes to the official cards, the
verification script and the docs.

> **The step-by-step guide to submitting a card is
> [docs/SUBMITTING.md](docs/SUBMITTING.md)** (русский:
> [docs/SUBMITTING.ru.md](docs/SUBMITTING.ru.md)): prerequisites, how to get
> the commit and tree hash, a complete example entry with every field
> explained, local checks, PR format, CI failures and how updates work.
> This page is the policy behind it.

## Submission checklist (for card authors)

- [ ] **Public repository** on github.com; the card is the repository root or
      one folder of it, with `neurosquad-card.json` at that folder's root.
- [ ] **Manifest valid:** `npx @neurosquad/card-sdk validate` passes with no
      errors on the submitted commit.
- [ ] **Pinned commit on the default branch:** the entry's `commit` is a full
      sha reachable from the default branch; the manifest `version` at that
      commit is the entry's `version`.
- [ ] **Built output committed** (`dist/` or whatever `entry` points at), and
      the **source** that produces it is in the same repository with a
      lockfile. No obfuscated code; no minified-only code without its source.
- [ ] **Minimal permissions, each justified:** every permission is used, has a
      `reason` in the manifest, and is explained in the pull request.
      Prefer `optional` permissions requested at the moment they are needed.
      `network` lists exact hosts, never more than the card talks to.
- [ ] **License:** a `LICENSE` file in the package folder and `license` in the
      manifest (an OSI-approved license is strongly preferred).
- [ ] **Screenshots:** at least one in the README (and in `screenshots`).
- [ ] **README** that says what the card does, what it sends where, and how
      to use it.
- [ ] `node scripts/verify.mjs --changed-only origin/main` passes locally.

## Permissions

Reviewers apply least privilege. Expect questions — and a longer review —
for the high-risk permissions: `agents.output`, `agents.prompt`,
`terminals.write`, `fs.read`, `fs.write`, `network.local`, and for `network`
with more than a few hosts. A good `reason` says what the card does with the
permission, not what the permission is ("Reads pull requests from the GitHub
API", not "Needs network access").

## Review policy

- Every entry is reviewed by a NeuroSquad maintainer (`glmn-ai`). CI must be
  green first; CI never replaces the review.
- The reviewer reads the source at the pinned commit (the whole card for a
  new entry, the diff since the previously verified commit for an update),
  checks that the built output matches the source, installs the card from
  that commit and tries it.
- The reviewer sets `reviewer` and `verifiedAt` before merging.
- We may decline a card without a detailed reason (for example, a near
  duplicate of an existing card). Being declined does not stop anyone from
  installing your card from its repository; it only keeps it out of the
  verified catalog.
- First response within 7 days; see
  [docs/SUBMITTING.md](docs/SUBMITTING.md#9-review) for typical timings.
- `"official": true` is reserved for cards in repositories owned by the
  `glmn-ai` organization; CI enforces it.

## Updates

Each entry pins one reviewed commit, so **a new version is a new pull
request** that changes the existing entry's `version`, `commit` and
`treeHash` (and anything else that changed, such as permissions). Keep the
same `id`. Title it `Update <id> <old> → <new>` and describe what changed,
calling out new permissions and network hosts. Until it is merged, the
catalog keeps pointing at the previous verified commit.

## Removal policy

An entry is removed (by a maintainer, or by a `Remove <id>` pull request from
its author) when:

- the author asks for it;
- the repository is deleted, made private, renamed or transferred, or the
  pinned commit is no longer reachable from its default branch (the weekly CI
  run catches these);
- the card turns out to be malicious or deceptive, or has a security problem
  that is not fixed within a reasonable time (see [SECURITY.md](SECURITY.md));
  malicious cards are removed immediately, without notice;
- it stops working with current NeuroSquad releases and is not updated within
  30 days of an issue being opened;
- the author's later versions violate this policy (the entry for the old
  reviewed version may be removed as well).

Removing an entry takes the card out of the verified catalog; it does not
uninstall it from anyone's app.

## Changes to this repository itself

- Official cards: change the card, run `npm test`, `npm run build` (commit
  `dist/`) and `npx neurosquad-card validate` in its folder, merge to `main`,
  then update its entry in a follow-up pull request.
- `scripts/verify.mjs` must keep computing the tree hash exactly like the app
  (`apps/desktop/src/main/cardSdk/install/tarball.ts` in NeuroSquad). It
  imports the hashing and path rules from `@neurosquad/card-sdk`; when the SDK
  changes them, update the dependency here in the same release.
- `verified.schema.json` is a contract with the app: add optional fields only,
  and bump `schemaVersion` for anything incompatible.

By contributing you agree that your contributions to this repository are
licensed under the [MIT License](LICENSE).
