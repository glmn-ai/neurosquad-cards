# NeuroSquad cards

The catalog of **verified community cards** for [NeuroSquad](https://neurosquad.ai),
and the home of NeuroSquad's own **official cards**.

A NeuroSquad card is a small web app that runs in a sandboxed frame on the
canvas, next to your agents (see the
[`@neurosquad/card-sdk`](https://www.npmjs.com/package/@neurosquad/card-sdk)
package). Anyone can publish a card in their own GitHub repository and anyone
can install it by pasting its source into the app. This repository adds a
reviewed list on top of that: [`verified.json`](verified.json), which the app
shows as its verified catalog.

> **Submitting a card?** Read **[docs/SUBMITTING.md](docs/SUBMITTING.md)**
> (step by step, with a complete example entry) — по-русски:
> **[docs/SUBMITTING.ru.md](docs/SUBMITTING.ru.md)**.

## What is in here

```
verified.json            the catalog: one entry per reviewed card, pinned to a commit
verified.schema.json     JSON Schema (draft 2020-12) of verified.json
scripts/verify.mjs       the checks CI runs on every change; run them locally too
official-cards/          NeuroSquad's own cards (source + committed dist/)
  agent-pulse/           live status timelines of every agent on the canvas
  decision-log/          ADR-style decisions agents record over MCP
  launch-control/        a Go/No-Go release board with a countdown
  repo-radar/            GitHub pull requests and CI on the canvas
  signal-router/         routes messages between cards by rules, with an inspector
docs/SUBMITTING.md       how to add or update a card (English)
docs/SUBMITTING.ru.md    то же по-русски
CONTRIBUTING.md          submission checklist, review, update and removal policy
SECURITY.md              reporting a malicious or vulnerable card
```

## What "verified" means

An entry in `verified.json` means that a NeuroSquad reviewer:

- read the card's source **at one exact commit** (`commit`) and found nothing
  malicious, deceptive or obfuscated in it;
- checked that it asks only for the permissions it needs, and that each one
  is explained to the user;
- confirmed the commit is on the repository's default branch, and recorded the
  **tree hash** of the package folder at that commit (`treeHash`) — the same
  hash the app computes when it installs the card, so a verified install is
  byte-for-byte the code that was reviewed;
- saw that the card works as described.

CI re-checks every entry mechanically (see [below](#how-entries-are-checked)).

## What "verified" does NOT mean

- **Not a security guarantee.** A review lowers the risk; it cannot prove the
  absence of bugs. The app's sandbox and permission prompts are the real
  protection, and they apply to verified cards exactly as to any other.
- **Not an endorsement of other versions.** Only the pinned `commit` was
  reviewed. When the author pushes new code, the app offers the update like
  any other; the verified badge applies to the reviewed version only, until a
  new entry is merged here.
- **Not a statement about the author,** their other repositories, or any
  network service a card talks to (`networkHosts`). What a remote service does
  with data you send it is between you and that service.
- **Not "made by NeuroSquad".** Only entries with `"official": true` (cards in
  repositories owned by the `glmn-ai` organization) are NeuroSquad's own.
  Everything else is community code, shown as such in the app.

## Installing a card

In NeuroSquad: **Settings → Custom cards**. Pick a card from the verified
catalog, or paste a source such as
`glmn-ai/neurosquad-cards/official-cards/agent-pulse`
(`owner/repo[/folder][@ref]`). Review the permissions in the install dialog,
then add the card from the canvas: **+ → Custom card…**.

> While this repository is private, installing the official cards from it
> needs a GitHub token saved in **Settings → Custom cards** (a fine-grained
> token with read access to this repository).

## How entries are checked

[`scripts/verify.mjs`](scripts/verify.mjs) runs in CI
([`.github/workflows/verify.yml`](.github/workflows/verify.yml)) on every pull
request (new and changed entries), on every push to `main` (all entries) and
weekly (all entries). For each entry it:

1. validates `verified.json` against [`verified.schema.json`](verified.schema.json):
   unique ids, cards sorted by id, canonical formatting;
2. checks the repository exists under that exact name, is public, and — for
   `"official": true` — belongs to `glmn-ai`;
3. checks `commit` exists and is reachable from the repository's default branch
   (GitHub's compare API says `identical` or `behind`), which rules out
   commits that only exist in a fork;
4. downloads the repository archive at `commit` exactly as the app does
   (`GET /repos/{owner}/{repo}/tarball/{commit}`), applies the app's archive
   rules to `path`, and recomputes the **tree hash**;
5. parses the manifest with the app's own validator and compares its `name`
   (`packageId`), `version` and declared permissions and hosts with the entry;
6. runs `neurosquad-card validate` on the package, and `neurosquad-card pack
   --dry-run`, which must print the same tree hash.

Run it yourself:

```sh
npm ci
node scripts/verify.mjs                          # every entry
node scripts/verify.mjs --changed-only origin/main
node scripts/verify.mjs --id agent-pulse
node scripts/verify.mjs entry owner/repo/path --commit <sha>   # draft an entry
```

It uses `GITHUB_TOKEN`, `GH_TOKEN` or a signed-in `gh` CLI for the GitHub API.

### The tree hash

For every regular file of the package folder at the pinned commit (as it comes
out of GitHub's archive; symlinks are not installed and not hashed), take the
sha256 of its bytes and write one line `<sha256 hex>  <path>\n`, paths relative
to the package folder, sorted by path. The tree hash is the sha256 (hex) of
that text. The app computes it in `extractTarball` from
`treeHashInput()`; `scripts/verify.mjs` imports the same `treeHashInput()` and
`archiveEntryToPackagePath()` from `@neurosquad/card-sdk`.

## Official cards

`official-cards/*` are complete, self-contained card projects:

```sh
cd official-cards/agent-pulse
npm ci
npm test
npm run build      # dist/ is committed: the app installs the repository as is
npx neurosquad-card validate
```

Each depends on `@neurosquad/card-sdk` from npm. After changing one, rebuild
and commit `dist/`, merge to `main`, then update its entry (`commit`,
`treeHash`, `version`) in a follow-up pull request — the same flow as any
community card.

## License

The repository's own code, docs and the official cards are [MIT](LICENSE).
Community cards listed in `verified.json` live in their authors' repositories
under their own licenses.
