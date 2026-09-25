# Security

## Reporting a malicious or vulnerable card

If a card listed in [`verified.json`](verified.json) — or one of the official
cards in `official-cards/` — steals data, does something its description and
permissions do not say, loads code from the internet, or has a vulnerability
another card, a web page or an agent could exploit:

1. **Report it privately** through GitHub: this repository's **Security** tab →
   **Report a vulnerability**. Include the card's `id`, the `commit`, what it
   does, and how to see it (file and line, or steps).
2. If private reporting is not available to you, open an issue titled
   `Security: <card id>` that says only that you have a report and how to
   reach you — no details — and a maintainer will contact you.

A card that is **actively malicious** (its code is public anyway) can be
reported in a normal issue with full details; speed matters more than
discretion there.

## What happens next

- We acknowledge reports within 3 days.
- A malicious card is removed from `verified.json` immediately. Removal
  takes it out of the verified catalog; people who already installed it are
  told through the app's own channels where possible.
- For a vulnerability in a community card, we contact the author and give
  them a reasonable time to fix it (normally up to 30 days, shorter if it is
  being exploited); if it is not fixed, the entry is removed.
- For a vulnerability in an official card, we fix it and update its entry.

## Vulnerabilities in NeuroSquad itself

A flaw in the app — the card sandbox, the permission system, the installer
(for example a way for a card to escape its frame, or to install code that
differs from the pinned tree hash) — is also welcome here through **Report a
vulnerability**; it will be routed to the app team.

## Scope

In scope: cards in the verified catalog, the official cards, and
`scripts/verify.mjs` (for example a way to get an entry past CI with a tree
hash that differs from what the app installs).

Out of scope: cards that are not in the catalog (report them to their
authors), and third-party services a card connects to.
