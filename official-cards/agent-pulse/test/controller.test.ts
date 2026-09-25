import type { AgentInfo, CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../neurosquad-card.json'
import { PulseController, STORAGE_KEY } from '../src/controller'

const TEAM: AgentInfo[] = [
  { id: 'lead', name: 'Lead', harness: 'claude-code', kind: 'ai', status: 'working', connected: true, turnStartedAt: Date.now() - 60_000 },
  { id: 'back', name: 'Backend', harness: 'codex-cli', kind: 'ai', status: 'idle', connected: false },
  { id: 'sh', name: 'bash', harness: 'shell-bash', kind: 'shell', status: 'idle', connected: false }
]

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

const LOGGER: MockPeer = {
  cardId: 'logger',
  kind: 'custom',
  name: 'Signal router',
  type: 'signal-router',
  direction: 'downstream',
  inputs: [{ id: 'in', label: 'In', type: 'ns:any', mode: 'stream', retain: false, default: true }],
  outputs: []
}

/** Lets MessagePort traffic between the card and the mock host settle. */
async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

let live: PulseController[] = []
async function setup(options: MockHostOptions = {}) {
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    agents: structuredClone(TEAM),
    ...options
  })
  const card = await host.connect()
  const pulse = new PulseController(card)
  live.push(pulse)
  await pulse.start()
  await settle()
  return { host, card, pulse }
}

afterEach(() => {
  for (const pulse of live) pulse.dispose()
  live = []
  vi.useRealTimers()
})

describe('PulseController', () => {
  it('loads the agents and fills the header and the overview tile', async () => {
    const { host, pulse } = await setup()
    expect(pulse.getSnapshot().phase).toBe('ready')
    expect(Object.keys(pulse.history.agents).sort()).toEqual(['back', 'lead', 'sh'])
    expect(host.chrome.overview).toMatchObject({
      primary: '1 working · 0 waiting',
      tone: 'accent',
      icon: 'signal'
    })
    expect(host.chrome.status).toMatchObject({ text: '1 working', busy: true })
    expect(host.chrome.badge).toMatchObject({ count: null })
    expect(host.subscriptions.has('agents.status')).toBe(true)
    expect(host.subscriptions.has('agents.turn')).toBe(true)
  })

  it('follows status changes: badge, status chip and a flash for the row', async () => {
    const { host, pulse } = await setup()
    host.setAgentStatus('back', 'needs-input')
    await settle()
    expect(pulse.history.segments.back.at(-1)?.status).toBe('needs-input')
    expect(pulse.getSnapshot().changedAt.back).toBeTypeOf('number')
    expect(host.chrome.badge).toMatchObject({ count: 1, tone: 'warning' })
    expect(host.chrome.status).toMatchObject({ text: '1 waiting', tone: 'warning' })
    expect(host.chrome.overview?.tone).toBe('warning')
  })

  it('answers the report tool and shows who read it', async () => {
    const { host, pulse } = await setup()
    const result = await host.callTool('report', { windowMinutes: 30 }, { agent: { id: 'lead', name: 'Lead' } })
    const text = result.content[0].type === 'text' ? result.content[0].text : ''
    expect(text).toContain('Lead [claude-code, id lead]: working')
    expect(text).toContain('bash [shell-bash') // the tool sees shells too
    expect(pulse.getSnapshot().lastRead?.agent).toBe('Lead')
  })

  it('rejects bad tool arguments before the card sees them', async () => {
    const { host } = await setup()
    // The mock checks the manifest schema like the app does (a rejected promise).
    await expect(host.callTool('report', { windowMinutes: 1 })).rejects.toThrow(/less than 5/)
  })

  it('emits finished turns downstream as ns:event', async () => {
    const { host } = await setup({ peers: [LOGGER] })
    const at = Date.now()
    host.setAgentStatus('lead', 'finished')
    host.emit('agents.turn', { agentId: 'lead', phase: 'end', at })
    await settle()
    expect(host.deliveries).toHaveLength(1)
    expect(host.deliveries[0]).toMatchObject({
      to: 'logger',
      output: 'turns',
      input: 'in',
      data: { type: 'turn', data: { agentId: 'lead', agent: 'Lead', endedAs: 'finished' } }
    })
  })

  it('asks for cards.connected before sending a report into a note', async () => {
    const requested: string[][] = []
    const { host, pulse } = await setup({
      peers: [NOTE],
      requestPermissions: (ids) => {
        requested.push(ids)
        return ids
      }
    })
    const delivered = await pulse.sendReport()
    expect(requested).toEqual([['cards.connected']])
    expect(delivered).toBe(1)
    const markdown = host.deliveries[0].data as string
    expect(markdown).toMatch(/^### Agent pulse — /)
    expect(markdown).toContain('| Lead | working |')
    expect(host.toasts.at(-1)?.message).toBe('Report sent to 1 card')
  })

  it('says how to connect when the permission is refused', async () => {
    const { host, pulse } = await setup({ peers: [NOTE], requestPermissions: () => [] })
    expect(await pulse.sendReport()).toBe(0)
    expect(host.deliveries).toHaveLength(0)
    expect(host.toasts.at(-1)?.message).toContain('Draw an arrow')
  })

  it('persists the history and restores it in a new frame', async () => {
    const { host, pulse } = await setup()
    host.setAgentStatus('back', 'working')
    await settle()
    await pulse.flush()
    const saved = host.storage.instance.get(STORAGE_KEY) as { segments: Record<string, unknown[]> }
    expect(saved.segments.back).toHaveLength(2)

    const card2 = await host.connect()
    const again = new PulseController(card2)
    live.push(again)
    await again.start()
    expect(again.history.segments.back.at(-1)?.status).toBe('working')
  })

  it('saves when the card is hidden and on suspend', async () => {
    const { host } = await setup()
    host.setAgentStatus('back', 'working')
    await settle()
    host.setVisibility('hidden')
    await settle()
    expect(host.storage.instance.has(STORAGE_KEY)).toBe(true)
    host.storage.instance.delete(STORAGE_KEY)
    host.setAgentStatus('back', 'finished')
    await settle()
    host.suspend()
    await settle()
    expect(host.storage.instance.has(STORAGE_KEY)).toBe(true)
  })

  it('nudges when an agent waits too long, and clears it when nobody waits', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { host } = await setup()
    host.setSettings({ nudgeAfterMin: 1 })
    host.setAgentStatus('back', 'needs-input')
    await settle()
    expect(host.chrome.attention).toBeNull()
    vi.advanceTimersByTime(61_000)
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'info' })
    expect(host.chrome.attention?.message).toMatch(/^Backend has been waiting for you for 1m 0\ds$/)
    host.setAgentStatus('back', 'working')
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'none' })
  })

  it('clears a stale pulse after a reload (the host keeps attention across frames)', async () => {
    const fresh = await setup()
    expect(fresh.host.chrome.attention).toBeNull() // just created: nothing to clear
    const { host } = await setup({ context: { launch: 'reloaded' } })
    expect(host.chrome.attention).toMatchObject({ level: 'none' })
  })

  it('speaks the app language live', async () => {
    const { host } = await setup()
    host.setLanguage('ru')
    await settle()
    expect(host.chrome.overview?.primary).toBe('работают 1 · ждут 0')
    expect(host.chrome.menu.map((item) => item.label)).toEqual(['Отправить отчёт', 'Очистить историю'])
    host.setLanguage('zh')
    await settle()
    expect(host.chrome.status?.text).toBe('1 个工作中')
  })

  it('shows an error when agents cannot be listed, and recovers on retry', async () => {
    let fail = true
    const host = createMockHost({ manifest: manifest as unknown as CardManifest, agents: structuredClone(TEAM) })
    host.handle('agents.list', () => {
      if (fail) throw new Error('boom')
      return structuredClone(TEAM)
    })
    const pulse = new PulseController(await host.connect())
    live.push(pulse)
    await pulse.start()
    await settle()
    expect(pulse.getSnapshot().phase).toBe('error')
    expect(host.chrome.overview?.tone).toBe('danger')
    fail = false
    await pulse.load()
    expect(pulse.getSnapshot().phase).toBe('ready')
  })

  it('clears the history after the user confirms', async () => {
    const { host, pulse } = await setup()
    host.setAgentStatus('back', 'working')
    await settle()
    expect(await pulse.clear()).toBe(true)
    expect(pulse.history.segments.back).toHaveLength(1)
    const saved = host.storage.instance.get(STORAGE_KEY) as JsonValue
    expect(saved).toBeTruthy()
  })

  it('needs nothing but agents.read', () => {
    const required = (manifest.permissions as { id: string; optional?: boolean }[]).filter(
      (p) => !p.optional
    )
    expect(required.map((p) => p.id)).toEqual(['agents.read'])
  })
})
