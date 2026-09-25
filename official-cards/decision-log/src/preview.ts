// Standalone preview: the card on the SDK's mock host with a sample log.
// Query parameters pick a state for screenshots and manual checks:
//   ?state=filled (default) | empty | loading | error | updated
//   &lang=en|ru|zh
import type { Card, CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHost } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import { INDEX_KEY } from './controller'
import { createDecision, entryKey, withStatus, type Author, type Decision, type DecisionInput, type DecisionStatus } from './model'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'filled'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'

const LEAD: Author = { name: 'Lead', kind: 'agent' }
const BACK: Author = { name: 'Backend', kind: 'agent' }
const YOU: Author = { name: 'You', kind: 'human' }
const H = 3600_000

const SAMPLE: [DecisionInput, Author, DecisionStatus, number][] = [
  [
    {
      title: 'Monorepo with npm workspaces',
      decision: 'Keep the app, the site and the docs in one repository with npm workspaces. One lockfile, one React.',
      context: 'Three packages share types and React; version drift already broke the docs build twice.',
      alternatives: ['Separate repositories — drift between them is what hurt us', 'pnpm — faster, but another tool for everyone'],
      tags: ['repo', 'tooling']
    },
    YOU,
    'accepted',
    30 * 24 * H
  ],
  [
    {
      title: 'Store sessions in Redis',
      decision: 'Session state lives in Redis with a 24 h TTL.',
      tags: ['backend', 'storage']
    },
    BACK,
    'superseded',
    9 * 24 * H
  ],
  [
    {
      title: 'REST for the public API, not GraphQL',
      decision: 'Expose REST with OpenAPI. Clients are simple and cache well; we have no deep graph to query.',
      alternatives: ['GraphQL — flexible, but costs caching and rate limiting'],
      consequences: 'Some screens need two calls. Versioning goes in the path.',
      tags: ['api', 'backend']
    },
    LEAD,
    'accepted',
    6 * 24 * H
  ],
  [
    {
      title: 'Signed cookies instead of Redis sessions',
      decision: 'Keep the session in an encrypted, signed cookie. No server state, one less service to run.',
      context: 'Redis is our only stateful dependency besides the database, and sessions are tiny.',
      alternatives: ['Keep Redis — works, but one more thing to operate'],
      consequences: 'Logging out everywhere needs a token version on the user row.',
      tags: ['backend', 'security', 'storage']
    },
    BACK,
    'accepted',
    2 * 24 * H
  ],
  [
    {
      title: 'Tailwind v4 for the storefront',
      decision: 'Use Tailwind v4 with our design tokens as CSS variables.',
      tags: ['frontend']
    },
    LEAD,
    'rejected',
    30 * H
  ],
  [
    {
      title: 'Use SQLite for the local cache',
      decision:
        'Cache product data in SQLite (better-sqlite3) next to the app instead of JSON files. Queries by category and price get indexes; writes are transactional.',
      context: 'The JSON cache is 40 MB and every read parses all of it; startup takes 3 s on a cold disk.',
      alternatives: ['LevelDB — fast, but no ad-hoc queries', 'Keep JSON and shard it — still parses on every start'],
      consequences: 'A native module to build per platform. Migrations need a version table.',
      tags: ['storage', 'performance']
    },
    LEAD,
    'proposed',
    40 * 60_000
  ]
]

function seed(host: MockHost, now: number): void {
  const entries: Decision[] = SAMPLE.map(([input, author, status, age], i) => {
    const at = now - age
    let entry = createDecision(i + 1, input, author, at, 'proposed')
    if (status !== 'proposed') entry = withStatus(entry, status, status === 'accepted' && author.kind === 'agent' ? 'You' : author.name, at + 20 * 60_000)
    return entry
  })
  entries[1] = { ...entries[1], supersededBy: 4 }
  entries[3] = { ...entries[3], supersedes: 2 }
  for (const entry of entries) host.storage.instance.set(entryKey(entry.n), entry as unknown as JsonValue)
  host.storage.instance.set(INDEX_KEY, { version: 1, nextN: entries.length + 1, ids: entries.map((e) => e.n) })
}

let previewHost: MockHost | null = null

export async function previewCard(): Promise<Card> {
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    grant: 'all',
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    peers: [
      {
        cardId: 'note-1',
        kind: 'note',
        name: 'Architecture notes',
        direction: 'downstream',
        inputs: [
          { id: 'append', label: 'Append', type: 'ns:markdown', mode: 'stream', retain: false, default: true, permission: 'cards.connected' }
        ],
        outputs: []
      }
    ]
  })
  if (state !== 'empty') seed(host, Date.now())
  if (state === 'loading') host.handle('storage.get', () => new Promise(() => {}))
  if (state === 'error') {
    host.handle('storage.get', () => {
      throw new Error('Storage is busy — the app is still starting.')
    })
  }
  Object.assign(window, { mockHost: host }) // DevTools: mockHost.callTool('decision_log…')
  previewHost = host
  return host.connect()
}

/** Plays the "an agent just recorded a decision" moment. */
export function afterStart(): void {
  const host = previewHost
  if (!host || state !== 'updated') return
  setTimeout(
    () =>
      void host.callTool(
        'record',
        {
          title: 'Stream search results over SSE',
          decision: 'Search streams results as they arrive (SSE) instead of waiting for all shards.',
          alternatives: ['WebSockets — two-way, which search does not need'],
          tags: ['api', 'performance']
        },
        { agent: { id: 'back', name: 'Backend' } }
      ),
    300
  )
}
