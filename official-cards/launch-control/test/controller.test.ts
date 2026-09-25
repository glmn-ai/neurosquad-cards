import type { CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../neurosquad-card.json'
import { COMPACT_SIZE, FULL_SIZE, LaunchController, STORAGE_KEY } from '../src/controller'
import type { Board } from '../src/model'

const RELAY: MockPeer = {
  cardId: 'relay',
  kind: 'custom',
  name: 'Signal router',
  type: 'signal-router',
  direction: 'downstream',
  inputs: [{ id: 'in', label: 'In', type: 'ns:any', mode: 'stream', retain: false, default: true }],
  outputs: []
}

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

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

const AGENT = { agent: { id: 'back', name: 'Backend' } }
const text = (r: { content: { type: string; text?: string }[] }): string => r.content[0].text ?? ''

let live: LaunchController[] = []
async function setup(options: MockHostOptions & { board?: Board } = {}) {
  const host = createMockHost({ manifest: manifest as unknown as CardManifest, ...options })
  if (options.board) host.storage.instance.set(STORAGE_KEY, options.board as unknown as JsonValue)
  const card = await host.connect()
  const lc = new LaunchController(card)
  live.push(lc)
  await lc.start()
  await settle()
  return { host, card, lc }
}

function board(statuses: ('go' | 'nogo' | 'pending')[], target: number | null = null): Board {
  return {
    version: 1,
    checks: statuses.map((status, i) => ({ id: `c${i + 1}`, name: `Check ${i + 1}`, status })),
    target,
    goAt: null
  }
}

afterEach(() => {
  for (const lc of live) lc.dispose()
  live = []
  vi.useRealTimers()
})

describe('LaunchController', () => {
  it('starts empty, needs no permissions and fills the tile', async () => {
    const { host, lc } = await setup()
    expect(lc.getSnapshot().phase).toBe('ready')
    expect(host.chrome.overview).toMatchObject({ primary: 'No checks yet', secondary: 'Release', icon: 'rocket-launch' })
    expect(host.chrome.status).toMatchObject({ text: null })
    expect(host.chrome.menu.map((m) => m.id)).toEqual(['report', 'size', 'reset'])
    expect(manifest.permissions.every((p) => (p as { optional?: boolean }).optional)).toBe(true)
  })

  it('lets agents add checks and set them, with a flash and a banner', async () => {
    const { host, lc } = await setup()
    const added = await host.callTool('add_check', { name: 'Tests green' }, AGENT)
    expect(text(added)).toBe('Added c1 "Tests green" (pending). 0/1 GO, 0 NO-GO, 1 pending.')
    const dup = await host.callTool('add_check', { name: 'tests green' }, AGENT)
    expect(text(dup)).toContain('already exists: c1')

    const set = await host.callTool('set_check', { check: 'Tests green', status: 'go', note: '412 passed' }, AGENT)
    expect(text(set)).toBe('c1 "Tests green" is now GO. 1/1 GO, 0 NO-GO, 0 pending.')
    const snap = lc.getSnapshot()
    expect(snap.board.checks[0]).toMatchObject({ status: 'go', note: '412 passed', by: 'Backend', byAgent: true })
    expect(snap.flash.c1).toMatchObject({ by: 'Backend', agent: true })
    expect(snap.lastAgent?.text).toBe('Backend set “Tests green” to GO')
    expect(host.chrome.overview).toMatchObject({ primary: '1/1 GO', tone: 'success', progress: 1 })
  })

  it('returns a useful error for an unknown check', async () => {
    const { host } = await setup({ board: board(['pending']) })
    await expect(host.callTool('set_check', { check: 'nope', status: 'go' }, AGENT)).rejects.toThrow(
      /No check "nope". Checks: c1 "Check 1"/
    )
  })

  it('lists the checks with the mission from settings', async () => {
    const { host } = await setup({ board: board(['go', 'pending']) })
    host.setSettings({ title: 'v2.4', brief: 'Payments v2' })
    await settle()
    const listing = text(await host.callTool('list_checks', {}, AGENT))
    expect(listing).toContain('Mission: v2.4 — Payments v2')
    expect(listing).toContain('- c2 "Check 2": pending')
  })

  it('asks for the user when an agent calls NO-GO, and stands down when it clears', async () => {
    const { host } = await setup({ board: board(['go', 'pending']) })
    await host.callTool('set_check', { check: 'c2', status: 'nogo', note: 'migration drops a column' }, AGENT)
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'needs-input', message: 'Backend: NO-GO on “Check 2”' })
    expect(host.chrome.badge).toMatchObject({ count: 1, tone: 'danger' })
    expect(host.chrome.status).toMatchObject({ text: 'HOLD', tone: 'danger' })
    await host.callTool('set_check', { check: 'c2', status: 'go' }, AGENT)
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'none' })
  })

  it('retries attention once the host throttle allows it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { host } = await setup({ board: board(['pending', 'pending']), enforceRateLimits: true })
    await host.callTool('set_check', { check: 'c1', status: 'nogo' }, AGENT)
    await settle()
    await host.callTool('set_check', { check: 'c2', status: 'nogo' }, { agent: { id: 'f', name: 'Frontend' } })
    await settle()
    expect(host.chrome.attention?.message).toBe('Backend: NO-GO on “Check 1”')
    vi.advanceTimersByTime(10_500)
    await settle()
    expect(host.chrome.attention?.message).toBe('Frontend: NO-GO on “Check 2”')
  })

  it('sends the GO signal once when everything turns GO', async () => {
    const { host, lc } = await setup({ board: board(['go', 'pending']), peers: [RELAY] })
    lc.userSet('c2', 'go')
    await settle()
    const go = host.deliveries.filter((d) => d.output === 'go')
    expect(go).toHaveLength(1)
    expect(go[0]).toMatchObject({
      to: 'relay',
      data: { type: 'go', data: { title: 'Release', checks: [{ id: 'c1', name: 'Check 1' }, { id: 'c2', name: 'Check 2' }] } }
    })
    expect(host.retained.get('go')).toBeTruthy()
    lc.userRename('c1', 'Check one') // still all GO → no second signal
    await settle()
    expect(host.deliveries.filter((d) => d.output === 'go')).toHaveLength(1)
    lc.userSet('c1', 'nogo')
    lc.userSet('c1', 'go')
    await settle()
    expect(host.deliveries.filter((d) => d.output === 'go')).toHaveLength(2)
  })

  it('turns a connected checklist into checks', async () => {
    const { host, lc } = await setup({
      peers: [{ cardId: 'todo-1', kind: 'todo', name: 'Release checklist', direction: 'upstream', inputs: [], outputs: [] }]
    })
    host.sendPortMessage('checks', [
      { text: 'Tests green', status: 'done' },
      { text: 'Docs', status: 'error' }
    ], { cardId: 'todo-1', kind: 'todo', output: 'items' })
    await settle()
    expect(lc.getSnapshot().board.checks.map((c) => [c.name, c.status, c.by])).toEqual([
      ['Tests green', 'go', 'Release checklist'],
      ['Docs', 'nogo', 'Release checklist']
    ])
  })

  it('persists the board and restores it', async () => {
    const { host, lc } = await setup()
    lc.userAdd('Rollback plan')
    lc.setTarget(Date.now() + 3_600_000)
    await lc.flush()
    const saved = host.storage.instance.get(STORAGE_KEY) as unknown as Board
    expect(saved.checks[0].name).toBe('Rollback plan')
    const again = new LaunchController(await host.connect())
    live.push(again)
    await again.start()
    expect(again.getSnapshot().board.target).toBe(saved.target)
  })

  it('shows an error when storage fails, and recovers', async () => {
    let fail = true
    const host = createMockHost({ manifest: manifest as unknown as CardManifest })
    host.handle('storage.get', () => {
      if (fail) throw new Error('disk full')
      return { exists: false, value: null }
    })
    const lc = new LaunchController(await host.connect())
    live.push(lc)
    await lc.start()
    await settle()
    expect(lc.getSnapshot()).toMatchObject({ phase: 'error' })
    expect(host.chrome.overview?.tone).toBe('danger')
    fail = false
    await lc.load()
    expect(lc.getSnapshot().phase).toBe('ready')
  })

  it('sends a Markdown report, asking for cards.connected for a note', async () => {
    const asked: string[][] = []
    const { host, lc } = await setup({
      board: board(['go', 'nogo', 'pending']),
      peers: [NOTE],
      requestPermissions: (ids) => (asked.push(ids), ids)
    })
    expect(await lc.sendReport()).toBe(1)
    expect(asked).toEqual([['cards.connected']])
    const md = host.deliveries[0].data as string
    expect(md).toContain('### Release — T−−:−−')
    expect(md).toContain('**HOLD** · 1/3 GO · 1 NO-GO · 1 standby')
    expect(md).toContain('- [x] **GO** Check 1')
    expect(md).toContain('- [ ] **NO-GO** Check 2')
  })

  it('resets after confirming, and not without', async () => {
    let answer = false
    const { lc } = await setup({ board: board(['go', 'nogo']), confirm: () => answer })
    expect(await lc.resetAllChecks()).toBe(false)
    answer = true
    expect(await lc.resetAllChecks()).toBe(true)
    expect(lc.getSnapshot().board.checks.every((c) => c.status === 'pending')).toBe(true)
  })

  it('toggles between compact and full size', async () => {
    const { host, lc, card } = await setup()
    await lc.toggleSize()
    await settle()
    expect(card.size).toEqual(COMPACT_SIZE)
    expect(host.chrome.menu.find((m) => m.id === 'size')?.label).toBe('Full size')
    await lc.toggleSize()
    await settle()
    expect(card.size).toEqual(FULL_SIZE)
    expect(host.chrome.menu.find((m) => m.id === 'size')?.label).toBe('Compact size')
  })

  it('refreshes the tile when the card leaves the screen, and at T−0 with a single timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const now = Date.now()
    const { host } = await setup({ board: board(['go', 'go'], now + 90_000) })
    expect(host.chrome.overview?.primary).toBe('T−00:01 · 2/2 GO')
    vi.advanceTimersByTime(40_000)
    host.setVisibility('overview')
    await settle()
    expect(host.chrome.overview?.primary).toBe('T−00:00 · 2/2 GO')
    vi.advanceTimersByTime(60_000)
    await settle()
    expect(host.chrome.status).toMatchObject({ text: 'LAUNCH', tone: 'success' })
    expect(host.chrome.overview?.primary).toBe('T+00:00 · 2/2 GO')
  })

  it('follows the app language', async () => {
    const { host } = await setup({ board: board(['nogo']) })
    host.setLanguage('ru')
    await settle()
    expect(host.chrome.status?.text).toBe('СТОП')
    expect(host.chrome.menu.map((m) => m.label)).toContain('Отправить отчёт')
    host.setLanguage('zh')
    await settle()
    expect(host.chrome.status?.text).toBe('暂停')
  })
})
