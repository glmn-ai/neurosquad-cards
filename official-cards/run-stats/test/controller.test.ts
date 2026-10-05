import type { AgentInfo, AgentUsage, CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '../neurosquad-card.json'
import { RunController, STORAGE_KEY } from '../src/controller'
import { FREEZE_GRACE_MS } from '../src/model'

const BENCH: AgentInfo = {
  id: 'bench',
  name: 'Bench',
  harness: 'claude-code',
  kind: 'ai',
  status: 'idle',
  connected: true
}
const OTHER: AgentInfo = { ...BENCH, id: 'other', name: 'Other', harness: 'codex-cli' }
const FAR: AgentInfo = { ...BENCH, id: 'far', name: 'Far', connected: false }
const SHELL: AgentInfo = {
  id: 'sh',
  name: 'bash',
  harness: 'shell-bash',
  kind: 'shell',
  status: 'idle',
  connected: true
}

const NOTE: MockPeer = {
  cardId: 'note-1',
  kind: 'note',
  name: 'Notes',
  direction: 'downstream',
  inputs: [
    {
      id: 'append',
      label: 'Append',
      type: 'ns:markdown',
      mode: 'stream',
      retain: false,
      default: true,
      permission: 'cards.connected'
    }
  ],
  outputs: []
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

const live: RunController[] = []
afterEach(() => {
  for (const run of live.splice(0)) run.dispose()
})

async function setup(options: MockHostOptions = {}, clock = { now: 1_000_000 }) {
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    agents: [structuredClone(BENCH), structuredClone(FAR), structuredClone(SHELL)],
    ...options
  })
  const card = await host.connect()
  const run = new RunController(card, { now: () => clock.now })
  live.push(run)
  await run.start()
  await settle()
  return { host, card, run, clock }
}

const usageCalls = (host: { calls: { method: string; params: unknown }[] }) =>
  host.calls.filter((call) => call.method === 'agents.usage').map((call) => call.params)

describe('binding', () => {
  it('binds the only connected AI agent: its whole history, armed at that moment', async () => {
    const { host, run } = await setup()
    const snap = run.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.agent?.id).toBe('bench')
    const state = { agentId: 'bench', since: 0, armedAt: 1_000_000 }
    expect(snap.state).toEqual(state)
    expect(host.storage.instance.get(STORAGE_KEY)).toEqual(state)
    expect(usageCalls(host)).toEqual([{ agentId: 'bench', since: 0 }])
  })

  it('a finish from before the card was attached does not freeze it', async () => {
    const { run } = await setup({
      agentUsage: { bench: { status: 'finished', prompts: 3, lastFinishedAt: 900_000 } }
    })
    await run.refresh()
    await settle()
    expect(run.getSnapshot().state.frozenUntil).toBeUndefined()
  })

  it('empty without an arrow; asks to choose with several', async () => {
    const empty = await setup({ agents: [structuredClone(FAR)] })
    expect(empty.run.getSnapshot().phase).toBe('empty')
    const two = await setup({ agents: [structuredClone(BENCH), structuredClone(OTHER)] })
    expect(two.run.getSnapshot().phase).toBe('choose')
    await two.run.choose('other')
    await settle()
    expect(two.run.getSnapshot()).toMatchObject({ phase: 'ready', agent: { id: 'other' } })
  })

  it('an app without agents.usage shows the update state', async () => {
    const host = createMockHost({
      manifest: manifest as unknown as CardManifest,
      agents: [structuredClone(BENCH)]
    })
    host.handle('host.capabilities', () => ({ protocol: 1, methods: [], events: [] }))
    const run = new RunController(await host.connect())
    live.push(run)
    await run.start()
    expect(run.getSnapshot().phase).toBe('unsupported')
  })

  it('keeps a stored window across a reload', async () => {
    const host = createMockHost({
      manifest: manifest as unknown as CardManifest,
      agents: [structuredClone(BENCH)]
    })
    host.storage.instance.set(STORAGE_KEY, { agentId: 'bench', since: 500, frozenUntil: 900, frozenBy: 'user' })
    const run = new RunController(await host.connect(), { now: () => 2000 })
    live.push(run)
    await run.start()
    await settle()
    expect(usageCalls(host).at(-1)).toEqual({ agentId: 'bench', since: 500, until: 900 })
  })
})

describe('the numbers', () => {
  const finished = (over: Partial<AgentUsage> = {}): Partial<AgentUsage> => ({
    status: 'finished',
    prompts: 1,
    requests: 9,
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: 1540,
    firstPromptAt: 1_000_500,
    lastFinishedAt: 1_060_500,
    elapsedMs: 60_000,
    workingMs: 58_000,
    ...over
  })

  it('freezes at the finish with a grace for late log lines, and exports exactly', async () => {
    const { host, run } = await setup({ agentUsage: { bench: finished() } })
    await run.refresh()
    await settle()
    const snap = run.getSnapshot()
    expect(snap.state).toMatchObject({ frozenUntil: 1_060_500 + FREEZE_GRACE_MS, frozenBy: 'finish' })
    expect(usageCalls(host).at(-1)).toEqual({
      agentId: 'bench',
      since: 0,
      until: 1_060_500 + FREEZE_GRACE_MS
    })
    const md = run.markdown()!
    expect(md).toContain('| Model requests | 9 |')
    expect(md).toContain('| Input | 1,200 |')
    expect(md).toContain('| Cache read | not reported |')
    expect(md).toContain('| Total tokens | 1,540 |')
    expect(md).toContain('| Elapsed | 1:00 |')
    expect(md).toContain('| Cost | no price |')
    const json = JSON.parse(run.json()!)
    expect(json).toMatchObject({
      prompts: 1,
      modelRequests: 9,
      frozen: true,
      tokens: { input: 1200, output: 340, cacheRead: null, cacheWrite: null, total: 1540 },
      elapsedMs: 60_000,
      workingMs: 58_000,
      costMicroUsd: null
    })
    const overview = host.chrome.overview
    expect(overview).toMatchObject({ primary: '1.5K tokens · 1:00', secondary: '9 requests · Claude Code' })
  })

  it('without subagent fields (an app before contract 1.3) the exports are exactly as before', async () => {
    const { run } = await setup({ agentUsage: { bench: finished() } })
    await run.refresh()
    await settle()
    expect(run.markdown()).not.toContain('subagent')
    const json = JSON.parse(run.json()!)
    expect('subagents' in json).toBe(false)
    expect('mainOnly' in json).toBe(false)
  })

  it('no extra section when the app can tell subagents apart but none ran', async () => {
    const zero = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      totalTokens: 0,
      costMicroUsd: null
    }
    const { run } = await setup({
      agentUsage: {
        bench: finished({
          subagents: { ...zero, count: 0 },
          mainOnly: { ...zero, requests: 9, inputTokens: 1200, outputTokens: 340, totalTokens: 1540 }
        })
      }
    })
    await run.refresh()
    await settle()
    expect(run.markdown()).not.toContain('Main agent vs subagents')
    expect(JSON.parse(run.json()!).subagents).toMatchObject({ count: 0, modelRequests: 0 })
  })

  it('exports the main agent vs subagents breakdown (contract 1.3)', async () => {
    const { run } = await setup({
      agentUsage: {
        bench: finished({
          subagents: {
            count: 2,
            requests: 3,
            inputTokens: 500,
            outputTokens: 40,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            reasoningTokens: null,
            totalTokens: 540,
            costMicroUsd: null
          },
          mainOnly: {
            requests: 6,
            inputTokens: 700,
            outputTokens: 300,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            reasoningTokens: null,
            totalTokens: 1000,
            costMicroUsd: null
          }
        })
      }
    })
    await run.refresh()
    await settle()
    const md = run.markdown()!
    // The totals keep including subagents.
    expect(md).toContain('| Model requests | 9 |')
    expect(md).toContain('#### Main agent vs subagents')
    expect(md).toContain(
      '| Part | Model requests | Input | Output | Cache read | Cache write | Total tokens | Cost |'
    )
    expect(md).toContain('| Main agent | 6 | 700 | 300 | not reported | not reported | 1,000 | no price |')
    expect(md).toContain('| 2 subagents | 3 | 500 | 40 | not reported | not reported | 540 | no price |')
    const json = JSON.parse(run.json()!)
    expect(json.modelRequests).toBe(9)
    expect(json.subagents).toEqual({
      count: 2,
      modelRequests: 3,
      tokens: { input: 500, output: 40, reasoning: null, cacheRead: null, cacheWrite: null, total: 540 },
      costMicroUsd: null
    })
    expect(json.mainOnly).toMatchObject({ modelRequests: 6, tokens: { input: 700, total: 1000 } })
  })

  it('does not freeze with the setting off; freeze / unfreeze / new run by hand', async () => {
    const { host, run, clock } = await setup({
      agentUsage: { bench: finished() },
      settings: { freezeOnFinish: false }
    })
    await run.refresh()
    expect(run.getSnapshot().state.frozenUntil).toBeUndefined()
    clock.now = 1_100_000
    await run.freeze()
    expect(run.getSnapshot().state).toMatchObject({ frozenUntil: 1_100_000, frozenBy: 'user' })
    await run.unfreeze()
    expect(run.getSnapshot().state).toEqual({ agentId: 'bench', since: 0, armedAt: 1_100_000 })
    clock.now = 1_200_000
    await run.reset()
    expect(run.getSnapshot().state).toEqual({ agentId: 'bench', since: 1_200_000, armedAt: 1_200_000 })
    expect(usageCalls(host).at(-1)).toEqual({ agentId: 'bench', since: 1_200_000 })
  })

  it('flashes changed numbers; live elapsed ticks only during a turn', async () => {
    const { host, run, clock } = await setup({
      agentUsage: { bench: finished({ status: 'working', lastFinishedAt: null, elapsedMs: 10_000 }) }
    })
    await run.refresh()
    clock.now += 3000
    expect(run.liveElapsed()).toBe(13_000)
    host.setAgentUsage('bench', finished({ status: 'working', requests: 10, lastFinishedAt: null }))
    await run.refresh()
    expect(run.getSnapshot().changedAt.requests).toBe(clock.now)
    expect(run.getSnapshot().changedAt.input).toBeUndefined()
  })

  it('copies with the optional clipboard permission and sends to a connected note', async () => {
    const { host, run } = await setup({
      agentUsage: { bench: finished() },
      peers: [NOTE],
      grant: ['agents.read', 'usage.read']
    })
    await run.refresh()
    expect(await run.copy('json')).toBe(true)
    expect(host.clipboard.at(-1)).toContain('"modelRequests": 9')
    expect(await run.send()).toBe(1)
    expect(host.deliveries.at(-1)).toMatchObject({ to: 'note-1', output: 'results' })
  })
})
