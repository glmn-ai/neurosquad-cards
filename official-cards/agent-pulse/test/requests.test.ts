import type { AgentInfo, AgentTimeline, CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '../neurosquad-card.json'
import {
  barHeight,
  dataExtent,
  laneStats,
  relLabel,
  shortDuration,
  ticks,
  zoomView
} from '../src/requestModel'
import { RequestsController } from '../src/requests'

const span = (startedAt: number | null, endedAt: number, output = 10) => ({
  startedAt,
  endedAt,
  inputTokens: 100,
  outputTokens: output,
  cacheReadTokens: null,
  cacheWriteTokens: null
})

const timeline = (over: Partial<AgentTimeline> = {}): AgentTimeline => ({
  agentId: 'a',
  harness: 'claude-code',
  since: 0,
  until: 100_000,
  usageReadable: true,
  requestTimes: 'start-end',
  requests: [],
  truncated: false,
  statuses: [],
  turns: [],
  scannedAt: 0,
  ...over
})

describe('request model', () => {
  it('lane statistics over the timed requests', () => {
    const s = laneStats(
      timeline({
        requests: [span(1000, 3000), span(4000, 10_000), span(null, 12_000), span(13_000, 14_000)],
        turns: [
          { start: 900, end: 15_000, endedAs: 'finished', counted: true },
          { start: 20_000, end: 20_500, endedAs: 'finished', counted: false }
        ]
      })
    )
    expect(s).toMatchObject({
      requests: 4,
      timed: 3,
      modelMs: 2000 + 6000 + 1000,
      avgMs: 3000,
      medianMs: 2000,
      longest: { ms: 6000, at: 10_000 },
      inputTokens: 400,
      outputTokens: 40,
      prompts: 1
    })
  })

  it('extent, ticks, labels, zoom, bar height, durations', () => {
    const extent = dataExtent([timeline({ requests: [span(10_000, 70_000)] })], 0)!
    expect(extent.origin).toBe(10_000)
    expect(extent.from).toBeLessThan(10_000)
    expect(ticks(0, 60_000)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000])
    expect(relLabel(65_000)).toBe('1:05')
    expect(relLabel(3_725_000)).toBe('1:02:05')
    expect(zoomView({ from: 0, to: 100 }, 50, 0.5, 10)).toEqual({ from: 25, to: 75 })
    expect(barHeight(0, 100)).toBeCloseTo(0.28)
    expect(barHeight(100, 100)).toBe(1)
    expect(barHeight(null, 100)).toBe(0.5)
    expect(shortDuration(850)).toBe('850 ms')
    expect(shortDuration(4200, 'ru')).toBe('4,2 с')
    expect(shortDuration(185_000, 'zh')).toBe('3分 05秒')
    expect(dataExtent([timeline()], 0)).toBeNull()
  })
})

const BENCH: AgentInfo[] = [
  {
    id: 'cc',
    name: 'Claude Code',
    harness: 'claude-code',
    kind: 'ai',
    status: 'finished',
    connected: true
  },
  { id: 'cx', name: 'Codex', harness: 'codex-cli', kind: 'ai', status: 'working', connected: true },
  { id: 'far', name: 'Far', harness: 'opencode', kind: 'ai', status: 'idle', connected: false }
]

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

const live: RequestsController[] = []
afterEach(() => {
  for (const one of live.splice(0)) one.dispose()
})

async function setup(options: MockHostOptions = {}) {
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    agents: structuredClone(BENCH),
    grant: 'all',
    ...options
  })
  const card = await host.connect()
  const requests = new RequestsController(card, { now: () => 5_000_000 })
  live.push(requests)
  await requests.start()
  await settle()
  return { host, requests }
}

describe('Requests controller', () => {
  it('one lane per arrow-connected AI agent, fetched from agents.timeline', async () => {
    const { host, requests } = await setup({
      agentTimeline: { cc: { requests: [span(1000, 2000)] }, cx: { requests: [span(3000, 9000)] } }
    })
    const snap = requests.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.lanes.map((lane) => lane.agent.id)).toEqual(['cc', 'cx'])
    expect(snap.lanes[1].timeline?.requests[0].endedAt).toBe(9000)
    const calls = host.calls
      .filter((call) => call.method === 'agents.timeline')
      .map((call) => call.params)
    expect(calls).toContainEqual({ agentId: 'cc', since: 0, until: 5_000_000 })
    await requests.setWindow('15m')
    expect(
      host.calls.filter((call) => call.method === 'agents.timeline').at(-1)?.params
    ).toMatchObject({
      since: 5_000_000 - 15 * 60_000
    })
  })

  it('asks for the optional permission; empty without arrows; old app', async () => {
    const without = await setup({ grant: ['agents.read'] })
    expect(without.requests.getSnapshot().phase).toBe('permission')
    expect(await without.requests.allow()).toBe(true)
    expect(without.requests.getSnapshot().phase).toBe('ready')
    const empty = await setup({ agents: [structuredClone(BENCH[2])] })
    expect(empty.requests.getSnapshot().phase).toBe('empty')
    const host = createMockHost({
      manifest: manifest as unknown as CardManifest,
      agents: structuredClone(BENCH),
      grant: 'all'
    })
    host.handle('host.capabilities', () => ({ protocol: 1, methods: [], events: [] }))
    const old = new RequestsController(await host.connect())
    live.push(old)
    await old.start()
    expect(old.getSnapshot().phase).toBe('unsupported')
  })
})
