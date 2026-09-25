import type { CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../neurosquad-card.json'
import { INDEX_KEY, LogController } from '../src/controller'
import { entryKey, type Decision } from '../src/model'

const LEAD = { agent: { id: 'lead', name: 'Lead' } }
const BACK = { agent: { id: 'back', name: 'Backend' } }

const NOTE: MockPeer = {
  cardId: 'note-1',
  kind: 'note',
  name: 'Notes',
  direction: 'downstream',
  inputs: [
    { id: 'append', label: 'Append', type: 'ns:markdown', mode: 'stream', retain: false, default: true, permission: 'cards.connected' }
  ],
  outputs: []
}
const WIKI: MockPeer = {
  cardId: 'wiki',
  kind: 'custom',
  name: 'Wiki',
  type: 'wiki',
  direction: 'downstream',
  inputs: [{ id: 'page', label: 'Page', type: 'ns:markdown', mode: 'stream', retain: false, default: true }],
  outputs: []
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

const text = (result: { content: { type: string; text?: string }[] }): string =>
  result.content.map((c) => c.text ?? '').join('')

let live: LogController[] = []
async function setup(options: MockHostOptions = {}) {
  const host = createMockHost({ manifest: manifest as unknown as CardManifest, ...options })
  const card = await host.connect()
  const log = new LogController(card)
  live.push(log)
  await log.start()
  await settle()
  return { host, card, log }
}

const RECORD = {
  title: 'Use SQLite for the local cache',
  decision: 'Cache product data in SQLite.',
  alternatives: ['LevelDB'],
  tags: ['Storage']
}

afterEach(() => {
  for (const log of live) log.dispose()
  live = []
  vi.useRealTimers()
})

describe('LogController', () => {
  it('asks for no permissions at install', () => {
    const required = (manifest.permissions as { id: string; optional?: boolean }[]).filter((p) => !p.optional)
    expect(required).toEqual([])
  })

  it('starts empty with a calm overview', async () => {
    const { host, log } = await setup()
    expect(log.getSnapshot().phase).toBe('ready')
    expect(host.chrome.overview).toMatchObject({ primary: 'No decisions yet', icon: 'book-open' })
    expect(host.chrome.menu.map((m) => m.id)).toEqual(['export'])
  })

  it('records a proposal from an agent: storage, badge, attention, pill, flash', async () => {
    const { host, log } = await setup()
    const result = await host.callTool('record', RECORD, LEAD)
    expect(text(result)).toBe('Recorded ADR-0001 "Use SQLite for the local cache" as proposed — the user reviews it.')
    await settle()
    const stored = host.storage.instance.get(entryKey(1)) as unknown as Decision
    expect(stored).toMatchObject({ n: 1, status: 'proposed', author: { name: 'Lead', kind: 'agent' }, tags: ['storage'] })
    expect(host.storage.instance.get(INDEX_KEY)).toEqual({ version: 1, nextN: 2, ids: [1] })
    expect(host.chrome.badge).toMatchObject({ count: 1, tone: 'warning' })
    expect(host.chrome.attention).toMatchObject({ level: 'info', message: 'Lead proposed: Use SQLite for the local cache' })
    expect(host.chrome.overview).toMatchObject({
      primary: '1 decision · 1 to review',
      secondary: 'ADR-0001 · Use SQLite for the local cache',
      tone: 'warning'
    })
    const snap = log.getSnapshot()
    expect(snap.lastAgent).toMatchObject({ agent: 'Lead', n: 1, kind: 'recorded' })
    expect(snap.flash[1]).toBeTypeOf('number')
    expect(snap.focus?.n).toBe(1)
  })

  it('keeps agents from accepting unless the user allows it', async () => {
    const { host } = await setup()
    const r1 = await host.callTool('record', { ...RECORD, status: 'accepted' }, LEAD)
    expect(text(r1)).toContain('as proposed')
    expect(text(r1)).toContain('agents may not accept')
    await expect(host.callTool('set_status', { id: 'ADR-0001', status: 'accepted' }, LEAD)).rejects.toThrow(
      /Only the user can accept/
    )
    host.setSettings({ agentsMayAccept: true })
    await settle()
    expect(text(await host.callTool('set_status', { id: '1', status: 'accepted' }, LEAD))).toBe('ADR-0001 is now accepted.')
    const r2 = await host.callTool('record', { ...RECORD, title: 'Second', status: 'accepted' }, LEAD)
    expect(text(r2)).toBe('Recorded ADR-0002 "Second" as accepted.')
  })

  it('folds a burst of proposals into one attention call (host throttle)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { host } = await setup()
    await host.callTool('record', RECORD, LEAD)
    await host.callTool('record', { ...RECORD, title: 'Two' }, BACK)
    await host.callTool('record', { ...RECORD, title: 'Three' }, BACK)
    await settle()
    expect(host.calls.filter((c) => c.method === 'card.attention')).toHaveLength(1)
    vi.advanceTimersByTime(11_000)
    await settle()
    const calls = host.calls.filter((c) => c.method === 'card.attention')
    expect(calls).toHaveLength(2)
    expect(host.chrome.attention?.message).toBe('3 decisions wait for your review')
  })

  it('searches and reads entries for agents', async () => {
    const { host, log } = await setup()
    expect(text(await host.callTool('search', {}, LEAD))).toBe('The decision log is empty.')
    await host.callTool('record', RECORD, LEAD)
    await host.callTool('record', { title: 'REST not GraphQL', decision: 'REST.', tags: ['api'] }, BACK)
    const all = text(await host.callTool('search', { limit: 5 }, LEAD))
    expect(all.split('\n')).toHaveLength(2)
    expect(all.split('\n')[0]).toMatch(/^ADR-0002 \[proposed\] REST not GraphQL — tags: api \(by Backend, /)
    expect(text(await host.callTool('search', { tag: 'storage' }, LEAD))).toMatch(/^ADR-0001/)
    expect(text(await host.callTool('search', { query: 'kafka' }, LEAD))).toBe('No decisions match.')
    const md = text(await host.callTool('get', { id: 'adr-1' }, BACK))
    expect(md).toContain('# ADR-0001: Use SQLite for the local cache')
    expect(log.getSnapshot().lastAgent).toMatchObject({ agent: 'Backend', kind: 'read' })
    await expect(host.callTool('get', { id: 'ADR-0099' }, LEAD)).rejects.toThrow(/no decision "ADR-0099"/)
  })

  it('supersedes with links in both directions', async () => {
    const { host, log } = await setup()
    await host.callTool('record', RECORD, LEAD)
    await host.callTool('record', { title: 'Use DuckDB', decision: 'Analytics too.' }, LEAD)
    const r = await host.callTool('set_status', { id: '1', status: 'superseded', supersededBy: 'ADR-0002', note: 'needs analytics' }, LEAD)
    expect(text(r)).toBe('ADR-0001 is now superseded (superseded by ADR-0002).')
    expect(log.get(1)).toMatchObject({ status: 'superseded', supersededBy: 2 })
    expect(log.get(2)?.supersedes).toBe(1)
    expect(log.get(1)?.history.at(-1)).toMatchObject({ by: 'Lead', note: 'needs analytics' })
    await expect(host.callTool('set_status', { id: '2', status: 'superseded', supersededBy: '2' }, LEAD)).rejects.toThrow(/itself/)
  })

  it('lets the user accept and clears the badge and attention', async () => {
    const { host, log } = await setup({ peers: [WIKI] })
    await host.callTool('record', RECORD, LEAD)
    await settle()
    await log.changeStatus(1, 'accepted', 'You')
    await settle()
    expect(host.chrome.badge).toMatchObject({ count: null })
    expect(host.chrome.attention).toMatchObject({ level: 'none' })
    // An accepted decision goes out on the port to connected cards.
    expect(host.deliveries).toHaveLength(1)
    expect(host.deliveries[0]).toMatchObject({ to: 'wiki', output: 'decisions', input: 'page' })
    expect(host.deliveries[0].data).toContain('- Status: **accepted**')
  })

  it('writes, edits and deletes by hand', async () => {
    const { host, log } = await setup({ confirm: () => true })
    const n = await log.createByUser({ title: 'Monorepo', decision: 'One repo.', tags: ['repo'] })
    expect(log.get(n)).toMatchObject({ status: 'accepted', author: { name: 'You', kind: 'human' } })
    await log.editByUser(n, { title: 'Monorepo with workspaces', decision: 'One repo.', status: 'rejected' })
    expect(log.get(n)).toMatchObject({ title: 'Monorepo with workspaces', status: 'rejected' })
    expect(await log.remove(n)).toBe(true)
    expect(log.get(n)).toBeUndefined()
    expect(host.storage.instance.has(entryKey(n))).toBe(false)
    expect(host.storage.instance.get(INDEX_KEY)).toEqual({ version: 1, nextN: 2, ids: [] })
    // Numbers are never reused.
    expect(await log.createByUser({ title: 'Next', decision: 'x' })).toBe(2)
  })

  it('reloads the log from storage in a new frame', async () => {
    const { host } = await setup()
    await host.callTool('record', RECORD, LEAD)
    await host.callTool('record', { title: 'Bee', decision: 'b' }, LEAD)
    await settle()
    const again = new LogController(await host.connect())
    live.push(again)
    await again.start()
    expect(again.getSnapshot().entries.map((e) => e.n)).toEqual([2, 1])
    expect(await again.createByUser({ title: 'C', decision: 'c' })).toBe(3)
  })

  it('asks for fs.write before exporting ADR files', async () => {
    const asked: string[][] = []
    const { host, log } = await setup({
      requestPermissions: (ids) => {
        asked.push(ids)
        return ids
      }
    })
    expect(await log.exportAdr()).toBe(0) // empty
    await host.callTool('record', RECORD, LEAD)
    expect(await log.exportAdr()).toBe(2)
    expect(asked).toEqual([['fs.write']])
    expect(host.readFile('docs/adr/0001-use-sqlite-for-the-local-cache.md')).toContain('# ADR-0001')
    expect(host.readFile('docs/adr/README.md')).toContain('[ADR-0001](0001-use-sqlite-for-the-local-cache.md)')
    expect(host.toasts.at(-1)?.message).toBe('Wrote 2 files to docs/adr')
  })

  it('does not export when fs.write is refused', async () => {
    const { host, log } = await setup({ requestPermissions: () => [] })
    await host.callTool('record', RECORD, LEAD)
    expect(await log.exportAdr()).toBe(0)
    expect(host.files.size).toBe(0)
    expect(host.toasts.at(-1)?.message).toBe('Export needs permission to write files')
  })

  it('asks for cards.connected when sending into a note', async () => {
    const asked: string[][] = []
    const { host, log } = await setup({
      peers: [NOTE],
      requestPermissions: (ids) => {
        asked.push(ids)
        return ids
      }
    })
    await log.createByUser({ title: 'A', decision: 'a', status: 'proposed' })
    expect(await log.send(1)).toBe(1)
    expect(asked).toEqual([['cards.connected']])
    expect(host.deliveries[0]).toMatchObject({ to: 'note-1', input: 'append' })
  })

  it('shows an error when storage fails, and recovers on retry', async () => {
    let fail = true
    const host = createMockHost({ manifest: manifest as unknown as CardManifest })
    host.handle('storage.get', () => {
      if (fail) throw new Error('disk busy')
      return { exists: false, value: null }
    })
    const log = new LogController(await host.connect())
    live.push(log)
    await log.start()
    await settle()
    expect(log.getSnapshot()).toMatchObject({ phase: 'error' })
    expect(log.getSnapshot().error).toContain('disk busy')
    expect(host.chrome.overview?.tone).toBe('danger')
    fail = false
    await log.load()
    expect(log.getSnapshot().phase).toBe('ready')
  })

  it('speaks the app language live', async () => {
    const { host } = await setup()
    await host.callTool('record', RECORD, LEAD)
    await host.callTool('record', { ...RECORD, title: 'Bee' }, LEAD)
    host.setLanguage('ru')
    await settle()
    expect(host.chrome.overview?.primary).toBe('2 решения · на проверку 2')
    expect(host.chrome.menu[0].label).toBe('Выгрузить как файлы ADR')
    host.setLanguage('zh')
    await settle()
    expect(host.chrome.overview?.primary).toBe('2 条决策 · 2 条待审阅')
  })
})
