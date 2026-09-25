import { describe, expect, it } from 'vitest'
import {
  adrFiles,
  adrId,
  compactLine,
  createDecision,
  DecisionError,
  editDecision,
  normalizeInput,
  parseId,
  search,
  slugify,
  tagCounts,
  toMarkdown,
  withStatus,
  type Author
} from '../src/model'

const T0 = Date.UTC(2026, 8, 25, 10)
const LEAD: Author = { name: 'Lead', kind: 'agent' }

const make = (n: number, title: string, tags: string[] = [], status: 'proposed' | 'accepted' = 'accepted') =>
  createDecision(n, { title, decision: `${title} because reasons`, tags }, LEAD, T0 + n, status)

describe('ids', () => {
  it('formats and parses ADR ids', () => {
    expect(adrId(7)).toBe('ADR-0007')
    expect(adrId(12345)).toBe('ADR-12345')
    for (const v of ['ADR-0007', 'adr-7', 'adr7', '7', '#7', ' 007 ', 7]) expect(parseId(v)).toBe(7)
    for (const v of ['', 'ADR-', 'seven', '0', -1, 1.5, null, '7a']) expect(parseId(v)).toBeNull()
  })
})

describe('input', () => {
  it('trims, bounds, lowercases and dedupes', () => {
    const out = normalizeInput({
      title: '  Use   SQLite\n',
      decision: ' yes ',
      tags: ['Storage', '#storage', ' Local Cache ', '', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
      alternatives: [' LevelDB ', '', 'x'.repeat(400)]
    })
    expect(out.title).toBe('Use SQLite')
    expect(out.tags).toEqual(['storage', 'local-cache', 'a', 'b', 'c', 'd', 'e', 'f'])
    expect(out.alternatives).toHaveLength(2)
    expect(out.alternatives[1]).toHaveLength(300)
  })

  it('refuses an entry without title or decision', () => {
    expect(() => normalizeInput({ title: ' ', decision: 'x' })).toThrow(DecisionError)
    expect(() => normalizeInput({ title: 'x', decision: '' })).toThrow(/decision text/)
  })

  it('leaves empty optional fields out', () => {
    const entry = createDecision(1, { title: 'A', decision: 'B', context: '  ', alternatives: [] }, LEAD, T0, 'proposed')
    expect('context' in entry).toBe(false)
    expect('alternatives' in entry).toBe(false)
    expect(entry.history).toEqual([{ at: T0, status: 'proposed', by: 'Lead' }])
  })
})

describe('status and edits', () => {
  it('appends history on status change and edit', () => {
    const a = make(1, 'A', [], 'proposed')
    const b = withStatus(a, 'accepted', 'You', T0 + 10, '  looks right ')
    expect(b.history.at(-1)).toEqual({ at: T0 + 10, status: 'accepted', by: 'You', note: 'looks right' })
    const c = editDecision(b, { title: 'A2', decision: 'D', context: 'ctx' }, 'You', T0 + 20)
    expect(c.title).toBe('A2')
    expect(c.context).toBe('ctx')
    expect(c.status).toBe('accepted')
    expect(c.history.at(-1)?.note).toBe('edited')
    const d = editDecision(c, { title: 'A2', decision: 'D' }, 'You', T0 + 30)
    expect('context' in d).toBe(false)
  })
})

describe('search', () => {
  const entries = [
    make(1, 'Monorepo with npm workspaces', ['repo']),
    make(2, 'Use SQLite for the local cache', ['storage', 'performance'], 'proposed'),
    make(3, 'Signed cookies for sessions', ['security', 'storage'])
  ]

  it('matches every word anywhere, newest first', () => {
    expect(search(entries).map((e) => e.n)).toEqual([3, 2, 1])
    expect(search(entries, { query: 'sqlite cache' }).map((e) => e.n)).toEqual([2])
    expect(search(entries, { query: 'adr-0003' }).map((e) => e.n)).toEqual([3])
    expect(search(entries, { query: 'lead' })).toHaveLength(3) // author
    expect(search(entries, { query: 'sqlite redis' })).toHaveLength(0)
  })

  it('filters by tag, status and limit', () => {
    expect(search(entries, { tag: '#Storage' }).map((e) => e.n)).toEqual([3, 2])
    expect(search(entries, { status: 'proposed' }).map((e) => e.n)).toEqual([2])
    expect(search(entries, { status: 'all', limit: 1 }).map((e) => e.n)).toEqual([3])
  })

  it('counts tags by use', () => {
    expect(tagCounts(entries)[0]).toEqual({ tag: 'storage', count: 2 })
  })
})

describe('text', () => {
  it('writes compact lines and Markdown', () => {
    const entry = {
      ...createDecision(
        4,
        {
          title: 'Signed cookies',
          decision: 'Keep sessions in a signed cookie.',
          context: 'Redis is our only extra service.',
          alternatives: ['Keep Redis'],
          consequences: 'Global logout needs a token version.',
          tags: ['security']
        },
        LEAD,
        T0,
        'accepted'
      ),
      supersedes: 2
    }
    expect(compactLine(entry)).toBe('ADR-0004 [accepted] Signed cookies — tags: security (by Lead, 2026-09-25)')
    const md = toMarkdown(entry)
    expect(md).toContain('# ADR-0004: Signed cookies')
    expect(md).toContain('- Status: **accepted**')
    expect(md).toContain('- Author: Lead (agent)')
    expect(md).toContain('- Supersedes: ADR-0002')
    expect(md).toContain('## Alternatives considered\n\n- Keep Redis')
    const old = { ...make(2, 'Redis sessions'), status: 'superseded' as const, supersededBy: 4 }
    expect(compactLine(old)).toContain('[superseded → ADR-0004]')
  })

  it('slugifies titles, including non-Latin ones', () => {
    expect(slugify('Use SQLite for the local cache!')).toBe('use-sqlite-for-the-local-cache')
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu')
    expect(slugify('Использовать SQLite')).toBe('sqlite')
    expect(slugify('使用缓存')).toBe('decision')
  })

  it('builds ADR files and an index, oldest first', () => {
    const files = adrFiles([make(2, 'Second'), make(1, 'First | one')])
    expect(files.map((f) => f.path)).toEqual([
      'docs/adr/0001-first-one.md',
      'docs/adr/0002-second.md',
      'docs/adr/README.md'
    ])
    expect(files[2].text).toContain('| [ADR-0001](0001-first-one.md) | First \\| one | accepted |')
  })
})
