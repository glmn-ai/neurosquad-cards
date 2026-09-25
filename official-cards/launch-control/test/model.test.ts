import { describe, expect, it } from 'vitest'
import {
  addCheck,
  BoardError,
  countdown,
  counts,
  emptyBoard,
  findCheck,
  formatT,
  isWarning,
  mergeTasks,
  MAX_CHECKS,
  phaseOf,
  resetAll,
  restoreBoard,
  setCheck,
  toolListing
} from '../src/model'

const T0 = 1_750_000_000_000
const MIN = 60_000

function board3() {
  const b = emptyBoard()
  addCheck(b, 'Tests green')
  addCheck(b, 'Changelog')
  addCheck(b, 'Migrations reviewed')
  return b
}

describe('model', () => {
  it('adds checks with short ids and refuses duplicates by name', () => {
    const b = board3()
    expect(b.checks.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    const again = addCheck(b, '  tests   GREEN ')
    expect(again).toMatchObject({ created: false, check: { id: 'c1' } })
    expect(() => addCheck(b, '   ')).toThrow(BoardError)
  })

  it('caps the board', () => {
    const b = emptyBoard()
    for (let i = 0; i < MAX_CHECKS; i++) addCheck(b, `check ${i}`)
    expect(() => addCheck(b, 'one more')).toThrow(/at most/)
  })

  it('finds checks by id or by name, ignoring case and spaces', () => {
    const b = board3()
    expect(findCheck(b, 'c2')?.name).toBe('Changelog')
    expect(findCheck(b, 'migrations  REVIEWED')?.id).toBe('c3')
    expect(findCheck(b, 'nope')).toBeUndefined()
  })

  it('sets a status with a note and who set it; unknown refs list the checks', () => {
    const b = board3()
    const check = setCheck(b, 'c1', 'go', { note: ' 412 passed ', by: 'Backend', byAgent: true, at: T0 })
    expect(check).toMatchObject({ status: 'go', note: '412 passed', by: 'Backend', byAgent: true, at: T0 })
    setCheck(b, 'c1', 'pending', { note: '', by: 'you', at: T0 + 1 })
    expect(b.checks[0].note).toBeUndefined()
    expect(b.checks[0].byAgent).toBeUndefined()
    expect(() => setCheck(b, 'x', 'go', { at: T0 })).toThrow('No check "x". Checks: c1 "Tests green", c2 "Changelog", c3 "Migrations reviewed".')
  })

  it('walks through the phases', () => {
    const b = emptyBoard()
    expect(phaseOf(b, T0)).toBe('empty')
    addCheck(b, 'a')
    addCheck(b, 'b')
    expect(phaseOf(b, T0)).toBe('pending')
    setCheck(b, 'a', 'nogo', { at: T0 })
    expect(phaseOf(b, T0)).toBe('hold')
    setCheck(b, 'a', 'go', { at: T0 })
    setCheck(b, 'b', 'go', { at: T0 })
    expect(phaseOf(b, T0)).toBe('go')
    b.target = T0 + MIN
    expect(phaseOf(b, T0)).toBe('go')
    expect(phaseOf(b, T0 + MIN)).toBe('launched')
    setCheck(b, 'b', 'pending', { at: T0 })
    expect(phaseOf(b, T0 + MIN)).toBe('scrubbed')
    expect(counts(b)).toEqual({ go: 1, nogo: 0, pending: 1, total: 2 })
  })

  it('counts down with T− and up with T+', () => {
    expect(formatT(countdown(T0 + 72 * MIN + 5_500, T0))).toBe('T−01:12:06')
    expect(formatT(countdown(T0 + 999, T0))).toBe('T−00:00:01')
    expect(formatT(countdown(T0 - 61_000, T0))).toBe('T+00:01:01')
    expect(formatT(countdown(T0 + 30 * MIN, T0), false)).toBe('T−00:30')
    expect(formatT(null)).toBe('T−−:−−')
  })

  it('warns only inside the window and only with checks not GO', () => {
    const b = board3()
    b.target = T0 + 5 * MIN
    expect(isWarning(b, T0, 10)).toBe(true)
    expect(isWarning(b, T0, 3)).toBe(false)
    expect(isWarning(b, T0, 0)).toBe(false)
    for (const c of b.checks) c.status = 'go'
    expect(isWarning(b, T0, 10)).toBe(false)
  })

  it('merges tasks from a connected checklist and follows it', () => {
    const b = emptyBoard()
    addCheck(b, 'Hand-made')
    const touched = mergeTasks(
      b,
      [
        { text: 'Tests green', status: 'done' },
        { text: 'Docs', status: 'error' },
        { text: 'Rollback plan', status: 'active' }
      ],
      'Release checklist',
      T0
    )
    expect(b.checks.map((c) => [c.name, c.status, c.source ?? null])).toEqual([
      ['Hand-made', 'pending', null],
      ['Tests green', 'go', 'port'],
      ['Docs', 'nogo', 'port'],
      ['Rollback plan', 'pending', 'port']
    ])
    expect(touched).toContain('c2')
    // The list changes: one item gone, one fixed. The hand-made check stays.
    mergeTasks(b, [{ text: 'Tests green', status: 'done' }, { text: 'Docs', status: 'done' }], 'Release checklist', T0 + 1)
    expect(b.checks.map((c) => [c.name, c.status])).toEqual([
      ['Hand-made', 'pending'],
      ['Tests green', 'go'],
      ['Docs', 'go']
    ])
    expect(b.checks[2].by).toBe('Release checklist')
  })

  it('restores only valid boards', () => {
    const b = board3()
    b.target = T0
    const back = restoreBoard(JSON.parse(JSON.stringify(b)))
    expect(back.checks).toHaveLength(3)
    expect(back.target).toBe(T0)
    expect(restoreBoard({ version: 2 }).checks).toEqual([])
    expect(restoreBoard({ version: 1, checks: [{ id: 'c1', name: 'x', status: 'weird' }] }).checks).toEqual([])
  })

  it('resets every check to pending', () => {
    const b = board3()
    setCheck(b, 'c1', 'go', { note: 'n', by: 'x', byAgent: true, at: T0 })
    resetAll(b)
    expect(b.checks.every((c) => c.status === 'pending' && !c.note && !c.by)).toBe(true)
  })

  it('lists the board for agents', () => {
    const b = board3()
    b.target = T0 + 10 * MIN
    setCheck(b, 'c1', 'go', { note: 'all green', by: 'Backend', byAgent: true, at: T0 })
    const text = toolListing(b, T0, { title: 'v2.4', brief: 'Ship it' })
    expect(text).toContain('Mission: v2.4 — Ship it')
    expect(text).toContain('Countdown: T−00:10:00')
    expect(text).toContain('Phase: pending. 1/3 GO, 0 NO-GO, 2 pending.')
    expect(text).toContain('- c1 "Tests green": GO (set by Backend) — all green')
    expect(toolListing(emptyBoard(), T0, { title: 'x', brief: '' })).toContain('No countdown is set.')
  })
})
