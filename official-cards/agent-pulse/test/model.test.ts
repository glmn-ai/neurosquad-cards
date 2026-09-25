import type { AgentInfo } from '@neurosquad/card-sdk'
import { describe, expect, it } from 'vitest'
import {
  applyStatus,
  applyTurn,
  emptyHistory,
  formatDuration,
  laneBlocks,
  median,
  restoreHistory,
  summarize,
  syncAgents,
  toolReport,
  trimHistory,
  HISTORY_KEEP_MS
} from '../src/model'

const MIN = 60_000
const T0 = 1_750_000_000_000

const agent = (over: Partial<AgentInfo> & { id: string }): AgentInfo => ({
  name: over.id,
  harness: 'claude-code',
  kind: 'ai',
  status: 'idle',
  connected: false,
  ...over
})

describe('model', () => {
  it('records status segments and ignores repeats', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a' })], T0)
    expect(applyStatus(h, 'a', 'working', T0 + MIN)).toBe(true)
    expect(applyStatus(h, 'a', 'working', T0 + 2 * MIN)).toBe(false)
    expect(applyStatus(h, 'a', 'finished', T0 + 5 * MIN)).toBe(true)
    expect(h.segments.a.map((s) => [s.status, s.from, s.to])).toEqual([
      ['idle', T0, T0 + MIN],
      ['working', T0 + MIN, T0 + 5 * MIN],
      ['finished', T0 + 5 * MIN, null]
    ])
  })

  it('starts a working agent at its turnStartedAt', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a', status: 'working', turnStartedAt: T0 - 3 * MIN })], T0)
    expect(h.segments.a[0]).toEqual({ status: 'working', from: T0 - 3 * MIN, to: null })
    expect(h.openTurns.a).toBe(T0 - 3 * MIN)
  })

  it('turns pair start and end; an end without a start is dropped', () => {
    const h = emptyHistory(T0)
    expect(applyTurn(h, 'a', 'end', T0)).toBeNull()
    applyTurn(h, 'a', 'start', T0)
    expect(applyTurn(h, 'a', 'end', T0 + 4 * MIN, 'needs-input')).toEqual({
      agentId: 'a',
      start: T0,
      end: T0 + 4 * MIN,
      endedAs: 'needs-input'
    })
  })

  it('summarizes counts, turns, busy share and waiting time in the window', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a', name: 'Lead' }), agent({ id: 'b', name: 'Back', harness: 'codex-cli' })], T0)
    // a: works 10 min, waits 5 min, works 5 more and is still working at T0+30
    applyStatus(h, 'a', 'working', T0 + 10 * MIN)
    applyTurn(h, 'a', 'start', T0 + 10 * MIN)
    applyStatus(h, 'a', 'needs-input', T0 + 20 * MIN)
    applyTurn(h, 'a', 'end', T0 + 20 * MIN, 'needs-input')
    applyStatus(h, 'a', 'working', T0 + 25 * MIN)
    // b: one 2-minute turn
    applyStatus(h, 'b', 'working', T0 + 1 * MIN)
    applyTurn(h, 'b', 'start', T0 + 1 * MIN)
    applyStatus(h, 'b', 'finished', T0 + 3 * MIN)
    applyTurn(h, 'b', 'end', T0 + 3 * MIN)

    const s = summarize(h, T0 + 30 * MIN, 60 * MIN)
    expect(s.counts).toMatchObject({ working: 1, finished: 1 })
    expect(s.turns).toBe(2)
    expect(s.medianTurnMs).toBe(6 * MIN)
    expect(s.longestTurn).toEqual({ ms: 10 * MIN, agent: 'Lead' })
    expect(s.waitingMs).toBe(5 * MIN)
    const lead = s.agents.find((a) => a.meta.id === 'a')!
    expect(lead.busyMs).toBe(15 * MIN)
    expect(lead.busyShare).toBeCloseTo(0.25)
    // Sorted: waiting first, then working, then finished.
    expect(s.agents.map((a) => a.meta.id)).toEqual(['a', 'b'])
  })

  it('hides shells unless asked', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a' }), agent({ id: 'sh', kind: 'shell', harness: 'shell-bash' })], T0)
    expect(summarize(h, T0, MIN).agents).toHaveLength(1)
    expect(summarize(h, T0, MIN, { includeShells: true }).agents).toHaveLength(2)
  })

  it('marks removed agents gone and closes their segment', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a', status: 'working' })], T0)
    syncAgents(h, [], T0 + MIN)
    expect(h.agents.a.present).toBe(false)
    expect(h.segments.a[0].to).toBe(T0 + MIN)
    expect(summarize(h, T0 + MIN, MIN).agents).toHaveLength(0)
  })

  it('restores a saved history with a gap, and continues a status seen again soon', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a', status: 'needs-input' }), agent({ id: 'b', status: 'idle' })], T0)
    h.savedAt = T0 + MIN
    const raw = JSON.parse(JSON.stringify(h))

    const soon = restoreHistory(raw, T0 + 90_000)
    expect(soon.segments.a[0].to).toBe(T0 + MIN)
    syncAgents(soon, [agent({ id: 'a', status: 'needs-input' }), agent({ id: 'b', status: 'working' })], T0 + 90_000)
    expect(soon.segments.a).toEqual([{ status: 'needs-input', from: T0, to: null }]) // continued
    expect(soon.segments.b.at(-1)).toEqual({ status: 'working', from: T0 + 90_000, to: null })

    const late = restoreHistory(raw, T0 + 30 * MIN)
    syncAgents(late, [agent({ id: 'a', status: 'needs-input' })], T0 + 30 * MIN)
    expect(late.segments.a).toHaveLength(2) // the gap stays a gap
  })

  it('rejects garbage from storage', () => {
    expect(restoreHistory({ version: 99 }, T0).agents).toEqual({})
    expect(restoreHistory(null, T0).turns).toEqual([])
  })

  it('trims history older than a day', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a' })], T0)
    applyStatus(h, 'a', 'working', T0 + MIN)
    applyTurn(h, 'a', 'start', T0 + MIN)
    applyTurn(h, 'a', 'end', T0 + 2 * MIN)
    applyStatus(h, 'a', 'idle', T0 + 2 * MIN)
    trimHistory(h, T0 + HISTORY_KEEP_MS + 3 * MIN)
    expect(h.segments.a).toHaveLength(1) // the open idle segment
    expect(h.turns).toHaveLength(0)
  })

  it('lays blocks out as fractions of the window', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a' })], T0)
    applyStatus(h, 'a', 'working', T0 + 30 * MIN)
    const blocks = laneBlocks(h, 'a', T0 + 60 * MIN, 60 * MIN)
    expect(blocks.map((b) => [b.status, b.left, b.width])).toEqual([
      ['idle', 0, 0.5],
      ['working', 0.5, 0.5]
    ])
  })

  it('writes a plain-English tool report', () => {
    const h = emptyHistory(T0)
    syncAgents(h, [agent({ id: 'a', name: 'Lead', status: 'needs-input' })], T0)
    const text = toolReport(summarize(h, T0 + 2 * MIN, 60 * MIN))
    expect(text).toContain('1 agents: 0 working, 1 waiting for the user')
    expect(text).toContain('- Lead [claude-code, id a]: waiting for the user for 2m 00s')
    expect(toolReport(summarize(emptyHistory(T0), T0, MIN))).toBe(
      'There are no agents in this workspace.'
    )
  })

  it('formats durations and medians', () => {
    expect(formatDuration(12_400)).toBe('12s')
    expect(formatDuration(4 * MIN + 5000)).toBe('4m 05s')
    expect(formatDuration(72 * MIN)).toBe('1h 12m')
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(3)
  })
})
