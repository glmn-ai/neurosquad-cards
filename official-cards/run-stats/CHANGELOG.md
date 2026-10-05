# Changelog — Run Stats

## 1.1.0 — 2026-10-05

- **Subagents**: "incl. N by M subagents" under Total tokens, "N by subagents"
  under Model requests, and a **Main agent vs subagents** breakdown (requests,
  input, output, cache read, cache write, total) with a share bar — open on a
  tall or expanded card, a chip on the status line otherwise. Totals keep
  including subagents. From `agents.usage` `subagents` / `mainOnly` (Card SDK
  contract 1.3, NeuroSquad 0.1.270+).
- Markdown, JSON and *Send to note* include the breakdown (JSON `subagents`
  with `count`, `mainOnly`; only when the app reports them).
- Nothing changes on older apps, for harnesses that cannot tell subagent
  requests apart, or when no subagent ran.
- Built against `@neurosquad/card-sdk` 1.3 from npm (the vendored 1.1.0
  archive is gone).

## 1.0.0 — 2026-10-04

- First release: prompts, model requests, input / output / cache tokens,
  elapsed and working time, cost; start measuring / new run, freeze at finish,
  copy as Markdown / JSON, send to a connected note. en / ru / zh.
