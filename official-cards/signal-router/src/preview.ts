// Standalone preview: the router on the SDK's mock host with simulated peers.
//   ?state=filled (default) | empty | loading | error | updated
//   &lang=en|ru|zh   &live=0 (no new messages)   &tab=inspector
import type { Card, CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHost, type MockPeer } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import type { RouterController } from './controller'
import { newRule, type RouterConfig } from './model'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'filled'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'
const live = params.get('live') !== '0'

const stream = { mode: 'stream' as const, retain: false, default: false }

export const PEERS: MockPeer[] = [
  {
    cardId: 'pulse',
    kind: 'custom',
    name: 'Agent Pulse',
    type: 'agent-pulse',
    direction: 'upstream',
    inputs: [],
    outputs: [
      { id: 'turns', label: 'Finished turns', type: 'ns:event', ...stream },
      { id: 'report', label: 'Report', type: 'ns:markdown', ...stream }
    ]
  },
  {
    cardId: 'inbox',
    kind: 'note',
    name: 'Ideas inbox',
    direction: 'upstream',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'ns:markdown', ...stream, retain: true, permission: 'cards.connected' }]
  },
  {
    cardId: 'notes',
    kind: 'note',
    name: 'Standup notes',
    direction: 'downstream',
    inputs: [
      { id: 'append', label: 'Append', type: 'ns:markdown', ...stream, default: true, permission: 'cards.connected' },
      { id: 'replace', label: 'Replace', type: 'ns:markdown', ...stream, permission: 'cards.connected' }
    ],
    outputs: []
  },
  {
    cardId: 'lead',
    kind: 'agent',
    name: 'Lead',
    type: 'claude-code',
    direction: 'downstream',
    inputs: [{ id: 'prompt', label: 'Prompt', type: 'ns:text', ...stream, default: true, permission: 'agents.prompt' }],
    outputs: []
  },
  {
    cardId: 'ops',
    kind: 'custom',
    name: 'Ops dashboard',
    type: 'ops-dashboard',
    direction: 'downstream',
    inputs: [{ id: 'events', label: 'Events', type: 'ns:event', ...stream, default: true }],
    outputs: []
  }
]

function seedConfig(): RouterConfig {
  return {
    version: 1,
    mode: 'all',
    rules: [
      newRule('lead', {
        id: 'r-wait',
        name: 'Blocked agents → Lead',
        match: { kind: 'field', path: 'data.endedAs', text: 'needs-input' },
        format: 'text',
        template: '{{data.agent}} is waiting for the user after a long turn. Check whether you can unblock it.',
        perMinute: 4
      }),
      newRule('notes', {
        id: 'r-log',
        name: 'Turn log',
        match: { kind: 'source', source: 'pulse' },
        format: 'text',
        template: '- **{{data.agent}}** finished a turn ({{data.endedAs}})'
      }),
      newRule('ops', {
        id: 'r-ops',
        name: 'Events to ops',
        match: { kind: 'type', type: 'ns:event' },
        format: 'event',
        eventType: 'agent-turn'
      })
    ]
  }
}

const AGENTS = ['Frontend', 'Backend', 'Reviewer', 'Docs writer']
let n = 0
function turnEvent(): JsonValue {
  n++
  return {
    type: 'turn',
    data: {
      agentId: `a${n % 4}`,
      agent: AGENTS[n % 4],
      durationMs: 40_000 + ((n * 7919) % 400_000),
      endedAs: n % 3 === 0 ? 'needs-input' : 'finished'
    },
    at: Date.now()
  }
}

let host: MockHost | null = null

export async function previewCard(): Promise<Card> {
  host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    grant: 'all',
    peers: state === 'empty' ? [] : PEERS,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } }
  })
  if (state !== 'empty') host.storage.instance.set('config', seedConfig() as unknown as JsonValue)
  if (state === 'loading') host.handle('storage.get', () => new Promise(() => {}))
  if (state === 'error') {
    host.handle('storage.get', () => {
      throw new Error('Storage is not available — the card data file is locked.')
    })
  }
  Object.assign(window, { mockHost: host })
  return host.connect()
}

/** Plays a burst of traffic, then (live) a new message every few seconds. */
export function afterStart(router: RouterController): void {
  const h = host
  if (!h || state === 'empty' || state === 'loading' || state === 'error') return
  const send = (): void => {
    if (n % 5 === 4) {
      n++
      h.sendPortMessage('in', 'Idea: cache the product list in memory, the API is slow', {
        cardId: 'inbox',
        kind: 'note',
        output: 'text'
      })
    } else h.sendPortMessage('in', turnEvent(), { cardId: 'pulse', kind: 'custom', output: 'turns' })
  }
  for (let i = 0; i < 9; i++) send()
  if (state === 'updated') {
    setTimeout(() => h.sendPortMessage('in', turnEvent(), { cardId: 'pulse', kind: 'custom', output: 'turns' }), 600)
  }
  if (live) setInterval(send, 4000)
  void router
}
