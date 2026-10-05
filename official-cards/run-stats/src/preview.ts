// Standalone preview: the card on the SDK's mock host with a simulated run.
// Query parameters pick a state for screenshots and manual checks:
//   ?state=frozen (default) | subagents | live | local | empty | choose | unsupported | loading | error
//   &lang=en|ru|zh
import type { AgentInfo, AgentUsage, Card, CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHost } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import type { RunController } from './controller'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'frozen'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'

const AGENT: AgentInfo = {
  id: 'bench',
  name: 'Bench · Claude Code',
  harness: 'claude-code',
  kind: 'ai',
  status: state === 'live' ? 'working' : 'finished',
  connected: true,
  model: 'claude-sonnet-4-5'
}
const OTHER: AgentInfo = {
  id: 'codex',
  name: 'Bench · Codex',
  harness: 'codex-cli',
  kind: 'ai',
  status: 'idle',
  connected: true
}

let previewHost: MockHost | null = null
let started = 0

/** A believable run: grows while "live", a finished 6-minute run otherwise. */
/** Contract 1.3: two subagents made this part of the frozen run (?state=subagents). */
const SUBAGENTS = {
  count: 2,
  requests: 11,
  inputTokens: 6_120,
  outputTokens: 3_388,
  reasoningTokens: 640,
  cacheReadTokens: 214_506,
  cacheWriteTokens: 17_902,
  totalTokens: 6_120 + 3_388 + 214_506 + 17_902,
  costMicroUsd: 201_337
}

function withSubagents(usage: Partial<AgentUsage>): Partial<AgentUsage> {
  if (state !== 'subagents') return usage
  const minus = (a: number | null | undefined, b: number): number | null => (a == null ? null : a - b)
  return {
    ...usage,
    subagents: SUBAGENTS,
    mainOnly: {
      requests: minus(usage.requests, SUBAGENTS.requests),
      inputTokens: minus(usage.inputTokens, SUBAGENTS.inputTokens),
      outputTokens: minus(usage.outputTokens, SUBAGENTS.outputTokens),
      reasoningTokens: minus(usage.reasoningTokens, SUBAGENTS.reasoningTokens),
      cacheReadTokens: minus(usage.cacheReadTokens, SUBAGENTS.cacheReadTokens),
      cacheWriteTokens: minus(usage.cacheWriteTokens, SUBAGENTS.cacheWriteTokens),
      totalTokens: minus(usage.totalTokens, SUBAGENTS.totalTokens),
      costMicroUsd: minus(usage.costMicroUsd, SUBAGENTS.costMicroUsd)
    }
  }
}

function usageAt(since: number, until: number): Partial<AgentUsage> {
  return withSubagents(baseUsageAt(since, until))
}

function baseUsageAt(since: number, until: number): Partial<AgentUsage> {
  const live = state === 'live'
  const runMs = live ? Math.max(0, until - started) : 6 * 60_000 + 42_000
  const k = live ? Math.min(1, runMs / 240_000) : 1
  const requests = Math.max(1, Math.round(37 * k))
  const local = state === 'local'
  return {
    since,
    until,
    status: live ? 'working' : 'finished',
    requests,
    inputTokens: Math.round(18_406 * k),
    outputTokens: Math.round(9_212 * k),
    reasoningTokens: Math.round(2_310 * k),
    cacheReadTokens: local ? null : Math.round(611_884 * k),
    cacheWriteTokens: local ? null : Math.round(48_127 * k),
    totalTokens: local
      ? Math.round(18_406 * k) + Math.round(9_212 * k)
      : Math.round(18_406 * k) + Math.round(9_212 * k) + Math.round(611_884 * k) + Math.round(48_127 * k),
    costMicroUsd: local ? null : Math.round(593_418 * k),
    model: local ? 'qwen3-coder-30b' : 'claude-sonnet-4-5',
    provider: local ? 'Strata' : 'anthropic',
    prompts: 1,
    firstPromptAt: live ? started : since + 3000,
    lastFinishedAt: live ? null : since + 3000 + runMs,
    elapsedMs: runMs,
    workingMs: live ? runMs : runMs - 31_000,
    timingComplete: true
  }
}

export async function previewCard(): Promise<Card> {
  started = Date.now() - 95_000
  if (state === 'local') {
    AGENT.name = 'Bench · OpenCode'
    AGENT.harness = 'opencode'
  }
  const agents =
    state === 'empty' ? [] : state === 'choose' ? [AGENT, OTHER] : [structuredClone(AGENT)]
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    grant: 'all',
    agents,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    agentUsage: (_agentId, since, until) => usageAt(since, until)
  })
  if (state === 'unsupported') {
    host.handle('host.capabilities', () => ({ protocol: 1, methods: [], events: [] }))
  }
  if (state === 'loading') host.handle('agents.list', () => new Promise(() => {}))
  if (state === 'error') {
    host.handle('agents.list', () => {
      throw new Error('The workspace is closing — try again in a moment.')
    })
  }
  if (state === 'frozen' || state === 'local' || state === 'subagents') {
    const since = Date.now() - 9 * 60_000
    host.storage.instance.set('run', {
      agentId: 'bench',
      since,
      frozenUntil: since + 3000 + 6 * 60_000 + 44_000,
      frozenBy: 'finish'
    })
  }
  Object.assign(window, { mockHost: host }) // play from DevTools: mockHost.setAgentStatus('bench', 'working')
  previewHost = host
  return host.connect()
}

export function afterStart(run: RunController): void {
  void previewHost
  void run
}
