# Submitting a card to the verified catalog

This guide walks you from "my card works" to a merged pull request that adds
it — or a new version of it — to [`verified.json`](../verified.json).
Русская версия: [SUBMITTING.ru.md](SUBMITTING.ru.md).

The short version:

1. Publish the card in a **public** GitHub repository, with `dist/` committed.
2. Make sure `npx @neurosquad/card-sdk validate` passes and pick the exact
   commit on your default branch you want reviewed.
3. Generate the entry: `node scripts/verify.mjs entry <owner>/<repo>[/<folder>] --commit <sha>`.
4. Fill in the fields the script cannot know, insert the entry in id order,
   run `npm run format` and `node scripts/verify.mjs --id <your id>`.
5. Open a pull request titled `Add <id> <version>` using the template.

The rest of this page explains each step.

---

## 1. Before you start: prerequisites

Your card must meet all of these. CI checks the ones marked (CI); a reviewer
checks the rest.

| Requirement | Why |
| --- | --- |
| The repository is **public** on github.com (CI) | Users and reviewers must be able to read the exact code they install. |
| The card is at the repository root or in one folder of it, with `neurosquad-card.json` at that folder's root (CI) | That folder is the package. Its path is the entry's `path`. |
| `dist/` (or whatever `entry` points at) is **committed** (CI) | The app never builds cards; it installs the files at the commit. |
| `npx @neurosquad/card-sdk validate` passes with no errors (CI) | The same validators the app runs at install. |
| The commit you submit is **on the default branch** (CI) | Commits that exist only in a fork or on a side branch are refused by the app too. |
| No credential-looking files in the package (`.env`, keys) (CI) | `neurosquad-card pack` refuses them; so does review. |
| No `node_modules/` committed inside the package folder (CI) | The app would install it, but the SDK's pack skips it, so the hashes disagree. |
| The source that produced `dist/` is in the same repository and builds reproducibly with the committed lockfile | Reviewers read the source, not minified bundles. Minified-only or obfuscated code is rejected. |
| Every permission is needed, and has a `reason` in the manifest | Least privilege. See [CONTRIBUTING.md](../CONTRIBUTING.md#permissions). |
| A license (a `LICENSE` file and `license` in the manifest) | So people know what they may do with it. |
| A README with at least one screenshot | So users (and reviewers) know what it looks like and does. |
| `displayName` and `author.name` do not say NeuroSquad, official or verified | Only `glmn-ai`'s own cards may; the app refuses others. |
| The whole repository archive is under **50 MB** | The app downloads the whole repository tarball at the commit and refuses larger ones. Keep videos and big assets out of the card's repository. |

Tip: keep text files with LF line endings (add `* text=auto eol=lf` to
`.gitattributes`). The tree hash is computed from the bytes GitHub serves; a
CRLF checkout on Windows makes the hash `pack` prints locally differ from the
real one (the `entry` command below always uses GitHub's bytes).

## 2. Pick the commit

Push your final version to the default branch, then take the commit sha:

```sh
git checkout main && git pull
git log -1 --format=%H            # e.g. 3f9c2e7d0b1a4c5d6e7f8091a2b3c4d5e6f70812
```

That exact commit is what gets reviewed and what users install as the verified
version. Tagging a release for it is nice, but the entry pins the sha, not the tag.

Check the package once more at that commit:

```sh
npx @neurosquad/card-sdk validate          # in the card folder
npx @neurosquad/card-sdk pack --dry-run    # prints the file list and a tree hash
```

## 3. Generate the entry

Fork this repository, clone your fork, then:

```sh
npm ci
node scripts/verify.mjs entry <owner>/<repo>[/<folder>] --commit <sha>
```

It downloads your repository at that commit exactly like the app, validates
the manifest and prints a draft entry with everything it can compute:
`packageId`, `name`, `description`, `version`, `commit`, `treeHash`,
`permissions`, `optionalPermissions`, `networkHosts`, `license`, `icon`. The
tree hash it prints is the authoritative one (the app computes the same from
GitHub's archive).

It needs GitHub API access: set `GITHUB_TOKEN` (any token, no scopes needed
for public repositories) or sign in with `gh auth login`; without a token the
limit is 60 requests an hour.

## 4. Complete the entry

A complete example — every field, including the optional ones:

```json
{
  "id": "test-radar",
  "packageId": "test-radar",
  "name": { "en": "Test Radar", "ru": "Радар тестов" },
  "description": {
    "en": "Runs the test suite in a connected terminal and shows what broke.",
    "ru": "Запускает тесты в подключённом терминале и показывает, что сломалось."
  },
  "author": { "name": "Acme", "github": "acme" },
  "repo": "acme/neurosquad-test-radar",
  "path": "card",
  "version": "1.2.0",
  "commit": "3f9c2e7d0b1a4c5d6e7f8091a2b3c4d5e6f70812",
  "treeHash": "9b1f0c3e5d7a2b4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d",
  "permissions": ["agents.read", "terminals.write"],
  "optionalPermissions": ["clipboard.write"],
  "networkHosts": ["api.example.com"],
  "tags": ["testing", "ci"],
  "category": "dev-tools",
  "license": "MIT",
  "homepage": "https://github.com/acme/neurosquad-test-radar",
  "icon": "icon.png",
  "screenshots": ["docs/screenshot.png"],
  "minAppVersion": "0.1.123",
  "official": false,
  "verifiedAt": "2026-10-01",
  "reviewer": "glmn-ai",
  "notes": "Runs only the command set in its settings; no network besides api.example.com."
}
```

(This example declares `network` for `api.example.com` in its manifest, which
is why `networkHosts` is present.)

| Field | Required | What to put there |
| --- | --- | --- |
| `id` | yes | Catalog slug, `[a-z0-9-]{2,64}`, unique in the file. Usually the same as `packageId`; if that is taken, prefix it (`acme-test-radar`). Never changes between versions. |
| `packageId` | yes | The `name` field of your `neurosquad-card.json`. CI compares them. |
| `name` | yes | Display name, `en` required, `ru`/`zh` optional, ≤ 80 characters. Normally the manifest's `displayName`. |
| `description` | yes | One or two sentences, `en` required, ≤ 300 characters. |
| `author.name` | yes | How you want to be credited. Not "NeuroSquad", "official" or "verified". |
| `author.github` | yes | Your GitHub login (or your organization). It should own `repo`. |
| `repo` | yes | `owner/repo` on github.com, exactly as GitHub spells it (a renamed repository fails). |
| `path` | no | The card's folder inside the repository, no leading or trailing slash. Omit when the card is at the root. |
| `version` | yes | The manifest `version` at `commit`. CI compares them. |
| `commit` | yes | The full 40-character sha from step 2. |
| `treeHash` | yes | From the `entry` command (or `pack --dry-run` on an LF checkout). CI recomputes it. |
| `permissions` | yes | The manifest's required permission ids, sorted. `[]` if none. CI compares. |
| `optionalPermissions` | when the manifest has any | Permissions with `"optional": true`, sorted. CI compares. |
| `networkHosts` | when the manifest declares `network` | Every host of the `network` permission, sorted. CI compares. |
| `tags` | no | Up to 10 lowercase words (`[a-z0-9-]`) for search. |
| `category` | yes | One of `agents`, `productivity`, `dev-tools`, `data`, `integrations`, `fun`, `other`. |
| `license` | yes | SPDX identifier; must equal the manifest's `license` when it has one. |
| `homepage` | no | An `https://` page for the card — usually the repository or the folder. |
| `icon` | no | Path inside the package folder to a square PNG/WebP (usually the manifest's `icon`). |
| `screenshots` | no | Up to 8 paths inside the package folder (png, webp, jpg, gif). |
| `minAppVersion` | when the manifest has it | The lowest NeuroSquad version the card works with; at least the manifest's `minAppVersion`. |
| `official` | yes | `false` for community cards. Only `glmn-ai`'s repositories may say `true`. |
| `verifiedAt` | yes | Put today's date (`YYYY-MM-DD`); the reviewer updates it on merge. |
| `reviewer` | yes | Put `glmn-ai`; the reviewer replaces it with their login. |
| `notes` | no | Anything a reviewer should know (why a permission is needed, what a network host is). Shown to reviewers, may be shown to users. |

## 5. Insert it in the right place

- `cards` is sorted by `id` (plain string order). Put your entry where it
  belongs alphabetically, not at the end.
- Set the top-level `updatedAt` to now in UTC, e.g. `2026-10-01T12:00:00Z`
  (it must not be earlier than any `verifiedAt`).
- Let the script do the formatting (2-space JSON, canonical key order,
  sorted cards, final newline):

```sh
npm run format
```

## 6. Run the checks locally

```sh
node scripts/verify.mjs --id test-radar            # your entry, fully
node scripts/verify.mjs --changed-only origin/main # what CI will run on your PR
node scripts/verify.mjs --offline                  # file checks only, no network
```

A passing run ends with `✔ verified.json is valid`. Warnings (`▲`) do not
fail CI but reviewers will ask about them.

## 7. Open the pull request

- **One card per pull request.** Change nothing else in the file.
- **Title:** `Add <id> <version>` for a new card, `Update <id> <old> → <new>`
  for a new version, `Remove <id>` for a removal.
- **Body:** the template fills in automatically — link the repository and the
  commit, say what the card does, justify every permission and network host,
  add a screenshot, and tick the checklist.
- Allow edits from maintainers, so a reviewer can fix `reviewer` and
  `verifiedAt` without a round trip.

## 8. What CI checks, and how to read failures

The `verify` workflow runs `node scripts/verify.mjs --changed-only <base>` on
your pull request. Each failure is one line starting with `✖` (and an
annotation on the PR):

| Message | Meaning and fix |
| --- | --- |
| `must match pattern …`, `must have required property …` | The entry breaks [the schema](../verified.schema.json). Check the field table above. |
| `must be sorted by id` / `not in canonical form` | Run `npm run format` and commit. |
| `duplicate id` / `the same package as …` | That id or that repository folder is already listed. Update the existing entry instead. |
| `repository … not found` | Wrong `owner/repo`, or the repository is private. |
| `… now answers as … (renamed or transferred)` | Use the current `owner/repo`. |
| `… is private` | Make the repository public. |
| `commit … does not exist` | Typo in the sha, or the commit was not pushed. |
| `commit … is not reachable from main` | The commit is on another branch or only in a fork. Merge it to the default branch. |
| `treeHash is X at this commit, the entry says Y` | The hash was computed from a different commit or from a CRLF checkout. Use the `entry` command and copy its `treeHash`. |
| `packageId …` / `version …` / `permissions: the manifest requires …` | The entry does not describe the manifest at that commit. Copy the values from the `entry` command. |
| `no files under "…"` / `neurosquad-card.json is missing` | Wrong `path`. |
| `validate …: …` | The card fails the SDK's validator — the app would refuse it too. Fix the card, push, pick the new commit. |
| `neurosquad-card pack refused the package: … credentials` | Remove `.env`/key files from the package folder. |
| `pack computes … for the same files` | `node_modules/` or `.git` inside the package folder. Remove them from git. |
| `only official cards may call themselves NeuroSquad …` | Rename `displayName` / `author.name`. |
| `the repository archive is … bytes` | The whole repository at that commit is over 50 MB. Move large files out. |
| `GitHub rate limit reached` | Locally: set `GITHUB_TOKEN`. In CI: re-run the job later. |

## 9. Review

After CI is green, a NeuroSquad reviewer:

- reads the source at the pinned commit (all of it for a new card, the diff
  since the last verified commit for an update) and checks `dist/` matches it
  (they may rebuild it);
- checks each permission and network host is needed and explained, and that
  secrets and user data go nowhere they should not;
- installs it from the pinned commit and tries it;
- then sets `reviewer` and `verifiedAt` and merges.

Expect a first response within **7 days**; a typical new card takes one to two
weeks, a small update a few days. Big cards, broad permissions (`agents.prompt`,
`terminals.write`, `fs.write`, `network.local`) and many network hosts take
longer.

## 10. Updating your card to a new version

The app pins the reviewed commit; a new version needs a new review:

1. Push the new version to your default branch (bump the manifest `version`).
2. `node scripts/verify.mjs entry <owner>/<repo>[/<folder>] --commit <new sha>`.
3. In your existing entry change `version`, `commit`, `treeHash`, and —
   if they changed — `permissions`, `optionalPermissions`, `networkHosts`,
   `minAppVersion`, `name`, `description`, `screenshots`. Keep the same `id`.
4. Update `updatedAt`, `npm run format`, run the checks, and open
   `Update <id> <old> → <new>`. Say what changed, and call out any new
   permission or host — that is what reviewers look at first.

## 11. Common reasons for rejection

- The source for `dist/` is missing, or `dist/` does not match it; minified or
  obfuscated code with no readable source.
- Permissions the card does not use, or "just in case" (`network` to broad
  hosts, `fs.write`, `agents.prompt` for a card that only displays things).
- Sending workspace content, agent output or settings to a server without
  saying so clearly in the README and the permission `reason`.
- Loading remote code at runtime (scripts, iframes, `eval` of fetched text) —
  the reviewed code must be the code that runs.
- Impersonating NeuroSquad, another card or another author.
- A card that does not work, is a placeholder, or duplicates an existing card
  without a clear difference.
- No license, or a license that forbids users from running it.
- Tracking or analytics without an opt-in.
