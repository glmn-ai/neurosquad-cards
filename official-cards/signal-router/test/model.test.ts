import type { PeerInfo } from '@neurosquad/card-sdk'
import { describe, expect, it } from 'vitest'
import {
  checkTarget,
  compatibleFormats,
  inferShape,
  jsonSize,
  newRule,
  RateLimiter,
  renderTemplate,
  restoreConfig,
  ruleMatches,
  shape,
  valueAtPath
} from '../src/model'

const stream = { mode: 'stream' as const, retain: false, default: false }
const NOTE: PeerInfo = {
  cardId: 'note',
  kind: 'note',
  name: 'Notes',
  direction: 'downstream',
  inputs: [{ id: 'append', label: 'Append', type: 'ns:markdown', ...stream, default: true, permission: 'cards.connected' }],
  outputs: []
}
const TODO: PeerInfo = {
  cardId: 'todo',
  kind: 'todo',
  name: 'Todo',
  direction: 'both',
  inputs: [
    { id: 'add', label: 'Add', type: 'ns:tasks', ...stream, default: true, permission: 'cards.connected' },
    { id: 'update', label: 'Update', type: 'ns:task-patch', ...stream, permission: 'cards.connected' }
  ],
  outputs: []
}
const SOURCE: PeerInfo = { ...NOTE, cardId: 'src', direction: 'upstream' }
const EVENT = { type: 'turn', data: { agent: 'Backend', durationMs: 1200, endedAs: 'needs-input', tags: ['a', 'b'] } }

describe('matching', () => {
  const msg = { from: 'pulse', type: 'ns:event', data: EVENT }
  it('any / contains / field / source / type', () => {
    expect(ruleMatches(newRule('x'), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'contains', text: 'BACKEND' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'contains', text: 'frontend' } }), msg)).toBe(false)
    expect(ruleMatches(newRule('x', { match: { kind: 'field', path: 'data.endedAs', text: 'needs-input' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'field', path: 'data.durationMs' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'field', path: 'data.missing' } }), msg)).toBe(false)
    expect(ruleMatches(newRule('x', { match: { kind: 'field', path: 'data.tags.1', text: 'b' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'source', source: 'pulse' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'source', source: 'other' } }), msg)).toBe(false)
    expect(ruleMatches(newRule('x', { match: { kind: 'type', type: 'ns:event' } }), msg)).toBe(true)
    expect(ruleMatches(newRule('x', { match: { kind: 'contains' } }), msg)).toBe(false) // empty never matches
  })

  it('reads dot paths', () => {
    expect(valueAtPath(EVENT, 'data.agent')).toBe('Backend')
    expect(valueAtPath(EVENT, '.')).toBe(EVENT)
    expect(valueAtPath('text', 'a.b')).toBeUndefined()
  })
})

describe('shaping', () => {
  it('fills templates', () => {
    expect(renderTemplate('{{data.agent}} took {{data.durationMs}} ms', EVENT)).toBe('Backend took 1200 ms')
    expect(renderTemplate('> {{.}}', 'hello')).toBe('> hello')
    expect(renderTemplate('{{ nope }}!', EVENT)).toBe('!')
    expect(renderTemplate('{{data.tags}}', EVENT)).toBe('["a","b"]')
  })

  it('shapes for each output', () => {
    const at = 1000
    expect(shape(newRule('x', { format: 'text', template: '{{type}}' }), { data: EVENT, at })).toEqual({
      output: 'text',
      type: 'ns:markdown',
      data: 'turn'
    })
    expect(shape(newRule('x', { format: 'json' }), { data: 5, at })).toEqual({
      output: 'json',
      type: 'ns:json',
      data: { value: 5 }
    })
    expect(shape(newRule('x', { format: 'event', eventType: 'ping' }), { data: 'x', at })).toEqual({
      output: 'event',
      type: 'ns:event',
      data: { type: 'ping', data: 'x', at }
    })
  })
})

describe('targets', () => {
  it('picks the input like the host does and reports its permission', () => {
    const check = checkTarget(newRule('note', { format: 'text' }), [NOTE])
    expect(check).toMatchObject({ connected: true, compatible: true, permission: 'cards.connected' })
    expect(check.input?.id).toBe('append')
  })

  it('knows text reaches a checklist (lines → tasks), JSON and events do not', () => {
    expect(compatibleFormats(TODO)).toEqual(['text'])
    expect(checkTarget(newRule('todo', { format: 'json' }), [TODO]).compatible).toBe(false)
  })

  it('an upstream-only peer or a missing one is not a target', () => {
    expect(checkTarget(newRule('src'), [SOURCE]).connected).toBe(false)
    expect(checkTarget(newRule('gone'), [NOTE]).connected).toBe(false)
  })

  it('an explicit input must exist and fit', () => {
    expect(checkTarget(newRule('todo', { input: 'update', format: 'text' }), [TODO]).compatible).toBe(false)
  })
})

describe('misc', () => {
  it('rate-limits per key over a sliding minute', () => {
    const limiter = new RateLimiter()
    expect([1, 2, 3].map((i) => limiter.allow('r', 2, i))).toEqual([true, true, false])
    expect(limiter.allow('r', 2, 60_002)).toBe(true)
    expect(limiter.allow('other', 2, 3)).toBe(true)
  })

  it('infers a structural shape', () => {
    expect(inferShape(EVENT)).toBe(
      '{\n  type: string\n  data: {\n    agent: string\n    durationMs: number\n    endedAs: string\n    tags: string[]\n  }\n}'
    )
    expect(inferShape([1, 'a', 2])).toBe('(number | string)[]')
    expect(inferShape([])).toBe('unknown[]')
    expect(inferShape({ 'a-b': null })).toBe('{\n  "a-b": null\n}')
  })

  it('measures UTF-8 size', () => {
    expect(jsonSize('é')).toBe(4)
  })

  it('restores only valid configs', () => {
    expect(restoreConfig(null).rules).toEqual([])
    expect(restoreConfig({ version: 1, mode: 'all', rules: [newRule('x'), null] }).rules).toHaveLength(1)
  })
})
