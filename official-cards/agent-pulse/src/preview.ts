// Standalone preview: the card on the SDK's mock host with a simulated team.
// Query parameters pick a state for screenshots and manual checks:
//   ?state=filled (default) | empty | loading | error | updated | requests | requests-live
//   &lang=en|ru|zh   &live=0 (freeze the simulation)
import type {
  AgentInfo,
  AgentRequestSpan,
  AgentStatus,
  AgentTimeline,
  Card,
  CardManifest,
  JsonValue
} from '@neurosquad/card-sdk'
import { createMockHost, type MockHost } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import type { PulseController } from './controller'
import { applyStatus, applyTurn, emptyHistory, type PulseHistory } from './model'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'filled'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'
const live = params.get('live') !== '0'

const TEAM: AgentInfo[] = [
  {
    id: 'lead',
    name: 'Lead',
    harness: 'claude-code',
    kind: 'ai',
    status: 'working',
    connected: true
  },
  {
    id: 'front',
    name: 'Frontend',
    harness: 'claude-code',
    kind: 'ai',
    status: 'needs-input',
    connected: false
  },
  {
    id: 'back',
    name: 'Backend',
    harness: 'codex-cli',
    kind: 'ai',
    status: 'working',
    connected: false
  },
  {
    id: 'review',
    name: 'Reviewer',
    harness: 'opencode',
    kind: 'ai',
    status: 'finished',
    connected: false
  },
  {
    id: 'docs',
    name: 'Docs writer',
    harness: 'qwen-code',
    kind: 'ai',
    status: 'idle',
    connected: false
  },
  {
    id: 'sh',
    name: 'PowerShell',
    harness: 'shell-powershell',
    kind: 'shell',
    status: 'idle',
    connected: false
  }
]

/** Small deterministic PRNG, so every screenshot shows the same afternoon. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An hour and a bit of believable history ending in each agent's current status. */
function seedHistory(now: number): PulseHistory {
  const history = emptyHistory(now)
  const rand = rng(7)
  const between = (a: number, b: number): number => (a + rand() * (b - a)) * 60_000
  for (const agent of TEAM) {
    history.agents[agent.id] = {
      id: agent.id,
      name: agent.name,
      harness: agent.harness,
      kind: agent.kind,
      present: true
    }
    if (agent.kind === 'shell') continue
    let t = now - 75 * 60_000
    let status: AgentStatus = 'idle'
    const end = now - between(1, 6)
    while (t < end) {
      applyStatus(history, agent.id, status, t)
      if (status === 'working') {
        const len = between(2, agent.id === 'back' ? 14 : 8)
        applyTurn(history, agent.id, 'start', t)
        t += len
        status = rand() < 0.3 ? 'needs-input' : 'finished'
        applyTurn(
          history,
          agent.id,
          'end',
          t,
          status === 'needs-input' ? 'needs-input' : 'finished'
        )
      } else {
        t += status === 'needs-input' ? between(0.5, 4) : between(1, 7)
        status = agent.id === 'docs' && rand() < 0.6 ? 'idle' : 'working'
      }
    }
    applyStatus(history, agent.id, agent.status, end)
    agent.turnStartedAt = end
    if (agent.status === 'working') history.openTurns[agent.id] = end
  }
  history.savedAt = now
  return history
}

export async function previewCard(): Promise<Card> {
  if (state.startsWith('requests')) return requestsPreview()
  const now = Date.now()
  const agents = state === 'empty' ? [] : structuredClone(TEAM)
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    agents,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    peers: [
      {
        cardId: 'note-1',
        kind: 'note',
        name: 'Standup notes',
        direction: 'downstream',
        inputs: [
          {
            id: 'append',
            label: 'Append',
            type: 'ns:markdown',
            mode: 'stream',
            retain: false,
            default: true
          }
        ],
        outputs: []
      }
    ]
  })
  if (state !== 'empty') {
    const history = seedHistory(now)
    for (const agent of agents) {
      const seeded = TEAM.find((a) => a.id === agent.id)
      if (seeded?.turnStartedAt) agent.turnStartedAt = seeded.turnStartedAt
    }
    host.storage.instance.set('history', history as unknown as JsonValue)
  }
  host.storage.instance.set('view', 'status')
  if (state === 'loading') host.handle('agents.list', () => new Promise(() => {}))
  if (state === 'error') {
    host.handle('agents.list', () => {
      throw new Error('The workspace is closing — try again in a moment.')
    })
  }
  Object.assign(window, { mockHost: host }) // play from DevTools: mockHost.setAgentStatus('docs', 'working')
  previewHost = host
  return host.connect()
}

let previewHost: MockHost | null = null

/** Keeps the team moving so the timelines live, and plays the "read by an agent" state. */
export function afterStart(pulse: PulseController): void {
  const host = previewHost
  if (!host) return
  if (state === 'updated') {
    setTimeout(() => void host.callTool('report', {}, { agent: { id: 'lead', name: 'Lead' } }), 400)
  }
  if (!live || state === 'empty' || state === 'loading' || state === 'error') return
  const rand = rng(99)
  const statuses = new Map(TEAM.map((agent) => [agent.id, agent.status]))
  setInterval(() => {
    const ai = TEAM.filter((agent) => agent.kind === 'ai')
    const agent = ai[Math.floor(rand() * ai.length)]
    const current = statuses.get(agent.id)!
    const next: AgentStatus =
      current === 'working' ? (rand() < 0.35 ? 'needs-input' : 'finished') : 'working'
    statuses.set(agent.id, next)
    const at = Date.now()
    host.setAgentStatus(agent.id, next)
    host.emit('agents.turn', { agentId: agent.id, phase: next === 'working' ? 'start' : 'end', at })
  }, 5000)
  void pulse
}

// --- the Requests view (1.1): three CLIs run one after another on one model --------

const BENCH: AgentInfo[] = [
  {
    id: 'cc',
    name: 'Claude Code',
    harness: 'claude-code',
    kind: 'ai',
    status: 'finished',
    connected: true
  },
  {
    id: 'oc',
    name: 'OpenCode',
    harness: 'opencode',
    kind: 'ai',
    status: 'finished',
    connected: true
  },
  { id: 'cx', name: 'Codex', harness: 'codex-cli', kind: 'ai', status: 'working', connected: true }
]

const TOOLS: Record<string, string[]> = {
  cc: ['Write', 'Bash', 'mcp__neurosquad__browser_navigate', 'Read', 'Edit'],
  oc: ['write', 'bash', 'neurosquad_browser_navigate', 'read', 'edit'],
  cx: ['exec_command', 'apply_patch', 'neurosquad__browser_navigate']
}

/** A deterministic sequential run per agent (same seed → same picture). */
function benchTimeline(
  agentId: string,
  since: number,
  until: number,
  t0: number
): Partial<AgentTimeline> {
  const order = ['cc', 'oc', 'cx'].indexOf(agentId)
  const rand = rng(11 + order)
  const start = t0 + order * 7 * 60_000
  const count = [14, 11, 9][order]
  const requests: AgentRequestSpan[] = []
  let t = start + 1500
  const liveCut =
    state === 'requests-live' && agentId === 'cx' ? t0 + 2 * 7 * 60_000 + 150_000 : Infinity
  for (let i = 0; i < count; i++) {
    const ms = 2500 + rand() * 18_000 + (i === 5 ? 21_000 : 0)
    if (t + ms > liveCut) break
    const tools =
      i === count - 1 ? [] : [TOOLS[agentId][Math.floor(rand() * TOOLS[agentId].length)]]
    requests.push({
      startedAt: Math.round(t),
      endedAt: Math.round(t + ms),
      model: 'qwen3.8-flash-next',
      inputTokens: Math.round(1200 + rand() * 9000),
      outputTokens: Math.round(60 + rand() * 1400),
      cacheReadTokens: Math.round(20_000 + i * 2500),
      cacheWriteTokens: null,
      ...(tools.length ? { tools } : {})
    })
    t += ms + 800 + rand() * 9000
  }
  const end = requests.at(-1)!.endedAt + 600
  const open = liveCut !== Infinity
  return {
    since,
    until,
    requests: requests.filter((r) => r.endedAt >= since && r.endedAt <= until),
    statuses: [
      { status: 'idle', from: since, to: start },
      { status: 'working', from: start, to: open ? until : end },
      ...(open ? [] : [{ status: 'finished' as const, from: end, to: until }])
    ],
    turns: [
      {
        start,
        end: open ? null : end,
        ...(open ? {} : { endedAs: 'finished' as const }),
        counted: true
      }
    ]
  }
}

async function requestsPreview(): Promise<Card> {
  const now = Date.now()
  const t0 = now - (state === 'requests-live' ? 2 * 7 * 60_000 + 160_000 : 22 * 60_000)
  const agents = structuredClone(BENCH)
  if (state === 'requests') agents[2].status = 'finished'
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    grant: 'all',
    agents,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    agentTimeline: (agentId, since, until) => benchTimeline(agentId, since, until, t0)
  })
  host.storage.instance.set('view', 'requests')
  Object.assign(window, { mockHost: host })
  previewHost = host
  return host.connect()
}
