# Changelog — Agent Pulse

## 1.2.0 — 2026-10-05

- **Subagent requests** in the Requests view: drawn as pink bars on a thin
  sub-lane under the agent's own, the tooltip names the subagent ("Subagent:
  Explore"), the lane line says "incl. N by subagents", a legend entry appears
  when there are any. Totals keep including them. From `agents.timeline`
  `requests[].subagent` (Card SDK contract 1.3, NeuroSquad 0.1.270+); lanes
  without marked requests are drawn exactly as before.
- Built against `@neurosquad/card-sdk` 1.3 from npm (the vendored 1.2.0
  archive is gone).

## 1.1.0 — 2026-10-04

- The Requests view: every model request of the arrow-connected agents as a
  bar on a shared timeline (`agents.timeline`, optional `usage.read`).

## 1.0.0

- Status timelines, turns, waiting-on-you KPIs and nudges, the
  `agent_pulse_report` tool, `report` / `turns` ports.
