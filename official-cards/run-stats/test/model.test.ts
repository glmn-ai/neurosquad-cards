import type { AgentInfo, AgentUsage } from '@neurosquad/card-sdk'
import { describe, expect, it } from 'vitest'
import {
  changedMetrics,
  formatInt,
  formatUsd,
  pickAgent,
  restoreState,
  stopwatch
} from '../src/model'

const agent = (id: string, over: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: id,
  harness: 'claude-code',
  kind: 'ai',
  status: 'idle',
  connected: true,
  ...over
})

describe('model', () => {
  it('formats exact integers per language and times as a stopwatch', () => {
    expect(formatInt(1234567, 'en')).toBe('1,234,567')
    expect(formatInt(1234567, 'ru').replace(/\s/g, ' ')).toBe('1 234 567')
    expect(stopwatch(0)).toBe('0:00')
    expect(stopwatch(65_999)).toBe('1:05')
    expect(stopwatch(3_725_000)).toBe('1:02:05')
    expect(formatUsd(593_418)).toBe('$0.59')
    expect(formatUsd(123)).toBe('$0.0001')
  })

  it('restores only valid state', () => {
    expect(restoreState(null)).toEqual({ since: null })
    expect(restoreState({ since: 5, agentId: 'a', frozenUntil: 9, frozenBy: 'finish' })).toEqual({
      since: 5,
      agentId: 'a',
      frozenUntil: 9,
      frozenBy: 'finish'
    })
    expect(restoreState({ since: 'x', frozenBy: 'finish' })).toEqual({ since: null })
  })

  it('picks the stored agent, else the only one', () => {
    expect(pickAgent({ since: 1, agentId: 'b' }, [agent('a'), agent('b')])?.id).toBe('b')
    expect(pickAgent({ since: 1 }, [agent('a')])?.id).toBe('a')
    expect(pickAgent({ since: 1 }, [agent('a'), agent('b')])).toBeNull()
  })

  it('reports which numbers changed (not the clocks)', () => {
    const base = { prompts: 1, requests: 2, inputTokens: 3, elapsedMs: 4 } as AgentUsage
    expect(changedMetrics(null, base)).toEqual([])
    expect(changedMetrics(base, { ...base, requests: 3, elapsedMs: 9 })).toEqual(['requests'])
  })
})
