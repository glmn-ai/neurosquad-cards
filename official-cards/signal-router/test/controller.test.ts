import type { CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it } from 'vitest'
import manifest from '../neurosquad-card.json'
import { CONFIG_KEY, RouterController, STATE_KEY } from '../src/controller'
import { newRule, type RouterConfig } from '../src/model'

const stream = { mode: 'stream' as const, retain: false, default: false }
const PULSE: MockPeer = {
  cardId: 'pulse',
  kind: 'custom',
  name: 'Agent Pulse',
  direction: 'upstream',
  inputs: [],
  outputs: [{ id: 'turns', label: 'Turns', type: 'ns:event', ...stream }]
}
const SOMEWHERE: MockPeer = {
  cardId: 'somewhere',
  kind: 'custom',
  name: 'Somewhere',
  direction: 'upstream',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'ns:text', ...stream }]
}
const NOTE: MockPeer = {
  cardId: 'notes',
  kind: 'note',
  name: 'Notes',
  direction: 'downstream',
  inputs: [{ id: 'append', label: 'Append', type: 'ns:markdown', ...stream, default: true, permission: 'cards.connected' }],
  outputs: []
}
const LEAD: MockPeer = {
  cardId: 'lead',
  kind: 'agent',
  name: 'Lead',
  direction: 'downstream',
  inputs: [{ id: 'prompt', label: 'Prompt', type: 'ns:text', ...stream, default: true, permission: 'agents.prompt' }],
  outputs: []
}
const OPS: MockPeer = {
  cardId: 'ops',
  kind: 'custom',
  name: 'Ops',
  direction: 'both',
  inputs: [{ id: 'events', label: 'Events', type: 'ns:event', ...stream, default: true }],
  outputs: [{ id: 'out', label: 'Out', type: 'ns:event', ...stream }]
}
const TURN = { type: 'turn', data: { agent: 'Backend', endedAs: 'needs-input' }, at: 1 }

async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

let live: RouterController[] = []
async function setup(config: Partial<RouterConfig> | null, options: MockHostOptions = {}) {
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    peers: [PULSE, NOTE, LEAD, OPS],
    ...options
  })
  if (config) host.storage.instance.set(CONFIG_KEY, { version: 1, mode: 'first', rules: [], ...config } as unknown as JsonValue)
  const card = await host.connect()
  const router = new RouterController(card)
  live.push(router)
  await router.start()
  await settle()
  return { host, card, router }
}

afterEach(() => {
  for (const router of live) router.dispose()
  live = []
})

describe('RouterController', () => {
  it('needs no permissions to install', () => {
    const required = (manifest.permissions as { optional?: boolean }[]).filter((p) => !p.optional)
    expect(required).toEqual([])
  })

  it('routes a message to a custom card with no permission at all', async () => {
    const { host, router } = await setup({
      rules: [newRule('ops', { id: 'r1', format: 'event', eventType: 'agent-turn' })]
    })
    host.sendPortMessage('in', TURN, { cardId: 'pulse', output: 'turns' })
    await settle()
    expect(host.deliveries).toEqual([
      { to: 'ops', output: 'event', input: 'events', data: { type: 'agent-turn', data: TURN, at: expect.any(Number) } }
    ])
    const [msg] = router.getSnapshot().messages
    expect(msg.type).toBe('ns:event') // the sender's declared type, not ns:any
    expect(msg.routes[0]).toMatchObject({ ok: true, input: 'events', toName: 'Ops' })
    expect(router.getSnapshot().counters).toMatchObject({ routed: 1, dropped: 0, hits: { r1: 1 } })
    expect(host.chrome.overview).toMatchObject({ primary: '1 routed · 1 rules', tone: 'accent', icon: 'link' })
  })

  it('templates text into a note once cards.connected is granted', async () => {
    const { host, router } = await setup(
      { rules: [newRule('notes', { id: 'r1', template: '- {{data.agent}}: {{data.endedAs}}' })] },
      { grant: 'all' }
    )
    host.sendPortMessage('in', TURN, { cardId: 'pulse', output: 'turns' })
    await settle()
    expect(host.deliveries[0]).toMatchObject({ to: 'notes', input: 'append', data: '- Backend: needs-input' })
    expect(router.getSnapshot().counters.routed).toBe(1)
  })

  it('drops (and counts) what a rule cannot deliver without the permission; the badge shows it', async () => {
    const { host, router } = await setup({ rules: [newRule('notes', { id: 'r1' })] })
    host.sendPortMessage('in', 'hello')
    await settle()
    expect(host.deliveries).toHaveLength(0)
    expect(router.getSnapshot().messages[0].routes[0]).toMatchObject({ ok: false, reason: 'permission' })
    expect(router.getSnapshot().counters.dropped).toBe(1)
    expect(host.chrome.badge).toMatchObject({ count: 1, tone: 'warning' })
    router.markSeen()
    await settle()
    expect(host.chrome.badge).toMatchObject({ count: null })
  })

  it('asks for the optional permission when a rule targeting a built-in card is saved', async () => {
    const asked: string[][] = []
    const { router, card } = await setup(null, {
      requestPermissions: (ids) => {
        asked.push(ids)
        return ids
      }
    })
    await router.saveRule(newRule('lead', { id: 'r1' }))
    expect(asked).toEqual([['agents.prompt']])
    expect(card.permissions.has('agents.prompt')).toBe(true)
    await router.saveRule(newRule('ops', { id: 'r2', format: 'event' }))
    expect(asked).toHaveLength(1) // a custom card needs nothing
  })

  it('never exceeds the host prompt rate for agents, whatever the rule says', async () => {
    const { host, router } = await setup(
      { rules: [newRule('lead', { id: 'r1', perMinute: 100 })] },
      { grant: 'all' }
    )
    for (let i = 0; i < 9; i++) host.sendPortMessage('in', `msg ${i}`)
    await settle(30)
    expect(host.deliveries).toHaveLength(6)
    const reasons = router.getSnapshot().messages.flatMap((m) => m.routes.map((r) => r.reason ?? 'ok'))
    expect(reasons.filter((r) => r === 'rate-limited')).toHaveLength(3)
  })

  it('does not echo a message back to the card it came from', async () => {
    const { host, router } = await setup({ rules: [newRule('ops', { id: 'r1', format: 'event' })] })
    host.sendPortMessage('in', TURN, { cardId: 'ops', output: 'out' })
    await settle()
    expect(host.deliveries).toHaveLength(0)
    expect(router.getSnapshot().messages[0].routes[0].reason).toBe('loop')
  })

  it('first match wins, or all matches fire', async () => {
    const rules = [
      newRule('ops', { id: 'a', format: 'event' }),
      newRule('ops', { id: 'b', format: 'json', match: { kind: 'contains', text: 'backend' } })
    ]
    const first = await setup({ rules, mode: 'first' })
    first.host.sendPortMessage('in', TURN)
    await settle()
    expect(first.host.deliveries.map((d) => d.output)).toEqual(['event'])

    const all = await setup({ rules, mode: 'all' })
    all.host.sendPortMessage('in', TURN)
    await settle()
    // ops has only an ns:event input: the JSON rule finds nothing compatible.
    expect(all.router.getSnapshot().messages[0].routes.map((r) => r.reason ?? 'ok')).toEqual(['ok', 'incompatible'])
  })

  it('drops messages no rule matches', async () => {
    const { host, router } = await setup({
      rules: [newRule('ops', { id: 'a', match: { kind: 'type', type: 'ns:event' }, format: 'event' })]
    }, {
      // The sender must be an upstream peer (the mock checks it, like the app).
      peers: [PULSE, NOTE, LEAD, OPS, SOMEWHERE]
    })
    host.sendPortMessage('in', 'plain text', { cardId: 'somewhere' })
    await settle()
    expect(router.getSnapshot().messages[0].dropped).toBe('no-rule')
    expect(host.chrome.overview?.secondary).toBe('1 dropped')
  })

  it('answers the request-mode input with the last message and counters', async () => {
    const { host } = await setup({ rules: [newRule('ops', { id: 'a', format: 'event' })] })
    host.sendPortMessage('in', TURN, { cardId: 'pulse', output: 'turns' })
    await settle()
    const reply = await host.requestPort('last', {})
    expect(reply).toMatchObject({ last: { from: 'Agent Pulse', type: 'ns:event', data: TURN }, routed: 1, dropped: 0, rules: 1 })
  })

  it('marks a rule disconnected when its target’s arrow goes away', async () => {
    const { host, router } = await setup({ rules: [newRule('ops', { id: 'a', format: 'event' })] })
    host.setPeers([PULSE])
    await settle()
    expect(router.getSnapshot().peers.map((p) => p.cardId)).toEqual(['pulse'])
    host.sendPortMessage('in', TURN)
    await settle()
    expect(router.getSnapshot().messages[0].routes[0].reason).toBe('disconnected')
  })

  it('pausing drops everything, and the menu offers Resume', async () => {
    const { host, router } = await setup({ rules: [newRule('ops', { id: 'a', format: 'event' })] })
    router.setPaused(true)
    await settle()
    expect(host.chrome.menu.map((i) => i.id)).toEqual(['resume', 'clear'])
    expect(host.chrome.status).toMatchObject({ text: 'paused' })
    host.sendPortMessage('in', TURN)
    await settle()
    expect(router.getSnapshot().messages[0].dropped).toBe('disabled')
    expect(host.deliveries).toHaveLength(0)
  })

  it('persists rules, counters and the last 10 messages', async () => {
    const { host, router } = await setup({
      rules: [newRule('ops', { id: 'a', format: 'event', perMinute: 100 })]
    })
    for (let i = 0; i < 14; i++) host.sendPortMessage('in', { i })
    await settle(40)
    await router.flush()
    const saved = host.storage.instance.get(STATE_KEY) as { messages: unknown[]; counters: { routed: number } }
    expect(saved.messages).toHaveLength(10)
    expect(saved.counters.routed).toBe(14)

    const again = new RouterController(await host.connect())
    live.push(again)
    await again.start()
    expect(again.getSnapshot().messages).toHaveLength(10)
    expect(again.getSnapshot().config.rules).toHaveLength(1)
    host.sendPortMessage('in', { i: 99 })
    await settle()
    expect(again.getSnapshot().messages[0].seq).toBe(15) // numbering continues
  })

  it('speaks the app language', async () => {
    const { host } = await setup({ rules: [newRule('ops', { id: 'a', format: 'event' })] })
    host.sendPortMessage('in', TURN)
    await settle()
    host.setLanguage('ru')
    await settle()
    expect(host.chrome.overview?.primary).toBe('отправлено 1 · правил 1')
    expect(host.chrome.menu.map((i) => i.label)).toEqual(['Приостановить', 'Очистить инспектор'])
  })

  it('shows an error when storage fails, and recovers', async () => {
    let fail = true
    const host = createMockHost({ manifest: manifest as unknown as CardManifest })
    const original = { value: null as JsonValue }
    host.handle('storage.get', () => {
      if (fail) throw new Error('locked')
      return { exists: false, value: original.value }
    })
    const router = new RouterController(await host.connect())
    live.push(router)
    await router.start()
    await settle()
    expect(router.getSnapshot().phase).toBe('error')
    expect(host.chrome.overview?.tone).toBe('danger')
    fail = false
    await router.load()
    expect(router.getSnapshot().phase).toBe('ready')
  })
})
