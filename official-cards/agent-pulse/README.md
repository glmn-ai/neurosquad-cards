# Agent Pulse

A live pulse of every agent on your [NeuroSquad](https://neurosquad.ai) canvas:
a status timeline per agent, turn counts and durations, and — the number people
remember — **how long agents have been waiting for you**.

## Requests (new in 1.1)

![Three CLIs, one model, one prompt each — every model request as a bar](docs/requests.png)

Draw arrows between the card and the agents you want to compare (say Claude
Code, OpenCode and Codex running the same prompt on the same model): each gets
a **swimlane on a shared time axis**, and **every model request is a bar** from
the moment it was sent to the moment its response completed.

- Bar length = how long the request took; bar height = its output tokens.
  Hover or focus a bar: duration, model, input / output / cache tokens and the
  tool calls the model asked for.
- Faint band = the agent was working (amber: waiting for you); ▼ = a prompt;
  green line = finished.
- Per lane: requests, total model time, median and longest request. KPIs over
  all lanes; the overview tile shows requests · median request.
- **Run** fits the whole run (sequential or simultaneous agents — lanes simply
  sit where their requests are in time); 15m / 1h / 4h follow the clock.
  Expanded: scroll to zoom, drag to pan, **Fit** to reset.
- Requests come from each harness's own log through NeuroSquad's
  `agents.timeline` (Card SDK 1.2, NeuroSquad 0.1.257+). Harnesses whose log
  records only when a response completed (Hermes, Droid, Goose, aider, Auggie)
  show ticks instead of bars; Amp and Cursor keep no usage log. Needs the
  optional `usage.read` permission — the card asks the first time.

## Status (1.0)

![Agent Pulse on a busy afternoon](docs/screenshot.png)

- **Timeline lanes** for the last 15 minutes, hour or 4 hours: working (blue),
  waiting for you (amber stripes), finished, idle, stopped.
- **KPIs**: agents working now, agents waiting on you, turns finished, median
  turn length; footer with the total time agents waited on you and the longest
  turn.
- **Nudges**: when an agent waits longer than you set (default 5 min), the card
  pulses softly and shows up in the Inbox. No sounds, no OS notifications.
- **A tool for agents**: a connected lead agent can call
  `agent_pulse_report` to see who is idle (delegate to them) and who is blocked
  on you. The card shows "Read by …" when that happens.
- **Ports**: `report` (Markdown table, from the card menu → *Send report*) and
  `turns` (one `ns:event` per finished turn — pipe it into another card).
- Header chip, badge (agents waiting on you) and the zoomed-out overview tile
  are filled in, so you can read the pulse from across the canvas.
- English, Russian and Chinese, following the app's language live.

![States: small, Chinese, just read by an agent, empty, loading, error](docs/states.png)

## Permissions

| Permission | Required | Why |
| --- | --- | --- |
| `agents.read` | yes | Agent names, harness and status (working / waiting / finished). That is all the timeline needs. The card **never** reads what agents print, and it cannot prompt them. |
| `usage.read` | optional | Only for the Requests view: the model requests (times, tokens, tool names) of agents connected to the card by an arrow. Asked when you open the view. |
| `cards.connected` | optional | Asked only when you send a report into a connected built-in note, checklist or sticky. Sending to another custom card needs nothing. |

No network, no files, no clipboard. History (at most a day) is kept in the
card's own storage.

## Performance

The lanes re-render once a second **only while the card is on screen**; zoomed
out, off-screen or in a hidden workspace the card only records status events
(a few per minute) and the host shows the overview tile. History is saved at
most every 3 s, when hidden and on suspend.

## Develop

```sh
npm install
npm run dev        # the card on the SDK's mock host with a simulated team
npm test           # model + controller tests against createMockHost()
npm run build      # → dist/ (commit it: the app installs the repository as is)
npm run validate   # the app's own checks + the install dialog preview
npm run pack       # what would be installed, and the tree hash
```

Preview states: `?state=filled|empty|loading|error|updated|requests|requests-live&lang=en|ru|zh&live=0`.
In the app: **Settings → Custom cards → Developer mode**, then
`npx neurosquad-card dev`.

### The SDK dependency

The card is built against [`@neurosquad/card-sdk`](https://www.npmjs.com/package/@neurosquad/card-sdk)
1.2.0, vendored as `vendor/neurosquad-card-sdk-1.2.0.tgz` until that version is on
npm (it is `npm pack` of `packages/card-sdk` at the NeuroSquad commit that added
`agents.timeline`). On an older app the Requests view says so; Status works. `dist/` is committed on purpose: NeuroSquad installs the
repository as it is and never runs a build, so rebuild and commit `dist/`
together with every source change.

## Install

This is an official NeuroSquad card from
[`glmn-ai/neurosquad-cards`](https://github.com/glmn-ai/neurosquad-cards), listed in its
[verified catalog](../../verified.json). Install it from the verified catalog in
**Settings → Custom cards**, or paste the source
`glmn-ai/neurosquad-cards/official-cards/agent-pulse` into **Settings → Custom cards →
Install**. Check the permissions, then add the card from the canvas: **+ → Custom card… → Agent Pulse**.

## License

MIT
