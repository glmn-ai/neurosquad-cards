// Pure part of the card: what is stored, the definitions of the numbers as
// shown, formatting and the Markdown / JSON exports. No host, no React.
import type { AgentInfo, AgentUsage, CardLanguage } from '@neurosquad/card-sdk'

/** What the card keeps in its instance storage (`run`). */
export interface RunState {
  /** The agent the run is measured for (chosen when several are connected). */
  agentId?: string
  /**
   * Measuring window start (epoch ms). 0 = the agent's whole history as the
   * app knows it (a card bound to an agent measures everything it did until
   * you press "Start measuring now"). Null = not bound yet.
   */
  since: number | null
  /** When the card started watching this run (bound, reset): only a finish after it freezes. */
  armedAt?: number
  /** Set when the numbers are frozen: the window ends here. */
  frozenUntil?: number
  /** Frozen automatically at the agent's finish, or by the user. */
  frozenBy?: 'finish' | 'user'
}

export const EMPTY_STATE: RunState = { since: null }

/** A freeze keeps requests logged this long after the finish (the log lands a moment after the hook). */
export const FREEZE_GRACE_MS = 2000

export function restoreState(value: unknown): RunState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE }
  const raw = value as Record<string, unknown>
  const state: RunState = {
    since: typeof raw.since === 'number' && Number.isFinite(raw.since) ? raw.since : null
  }
  if (typeof raw.agentId === 'string' && raw.agentId) state.agentId = raw.agentId
  if (typeof raw.armedAt === 'number' && Number.isFinite(raw.armedAt)) state.armedAt = raw.armedAt
  if (typeof raw.frozenUntil === 'number' && Number.isFinite(raw.frozenUntil))
    state.frozenUntil = raw.frozenUntil
  if (state.frozenUntil !== undefined && (raw.frozenBy === 'finish' || raw.frozenBy === 'user'))
    state.frozenBy = raw.frozenBy
  return state
}

/** AI agents connected to the card by an arrow. */
export function connectedAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((agent) => agent.kind === 'ai' && agent.connected)
}

/** Which connected agent the card measures: the stored one if still connected, else the only one. */
export function pickAgent(state: RunState, connected: readonly AgentInfo[]): AgentInfo | null {
  const stored = connected.find((agent) => agent.id === state.agentId)
  if (stored) return stored
  return connected.length === 1 ? connected[0] : null
}

// --- formatting -----------------------------------------------------------------------

const LOCALES: Record<CardLanguage, string> = { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }

/** An exact integer with the locale's grouping: 1,234,567 / 1 234 567. */
export function formatInt(value: number, language: CardLanguage): string {
  return new Intl.NumberFormat(LOCALES[language] ?? 'en-US', { maximumFractionDigits: 0 }).format(
    value
  )
}

/** Compact for the overview tile: 12.3K / 1.2M. */
export function formatCompact(value: number, language: CardLanguage): string {
  return new Intl.NumberFormat(LOCALES[language] ?? 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value)
}

/** Stopwatch style, exact to the second: 0:42, 4:05, 1:02:09. */
export function stopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Micro-dollars as dollars: $0.000123 → "$0.0001", $1.234 → "$1.23". */
export function formatUsd(micro: number): string {
  const dollars = micro / 1_000_000
  if (dollars === 0) return '$0'
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`
  return `$${dollars.toFixed(2)}`
}

const HARNESS_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex',
  opencode: 'OpenCode',
  'kilo-code': 'Kilo Code',
  'qwen-code': 'Qwen Code',
  'gemini-cli': 'Gemini CLI',
  'copilot-cli': 'Copilot CLI',
  'cursor-cli': 'Cursor',
  'hermes-agent': 'Hermes',
  'kimi-cli': 'Kimi Code',
  'cline-cli': 'Cline',
  droid: 'Factory Droid',
  auggie: 'Auggie',
  goose: 'Goose',
  crush: 'Crush',
  aider: 'aider',
  amp: 'Amp',
  pi: 'pi',
  omp: 'omp'
}

export function harnessLabel(harness: string): string {
  return HARNESS_LABELS[harness] ?? harness
}

// --- the numbers ----------------------------------------------------------------------

/** Rows in the order the card and the exports show them. */
export const METRICS = [
  'prompts',
  'requests',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'total',
  'elapsed',
  'working',
  'cost'
] as const
export type MetricKey = (typeof METRICS)[number]

/** A metric's raw value: a number, or null when not reported / not yet measured. */
export function metricValue(usage: AgentUsage, key: MetricKey): number | null {
  switch (key) {
    case 'prompts':
      return usage.prompts
    case 'requests':
      return usage.requests
    case 'input':
      return usage.inputTokens
    case 'output':
      return usage.outputTokens
    case 'cacheRead':
      return usage.cacheReadTokens
    case 'cacheWrite':
      return usage.cacheWriteTokens
    case 'total':
      return usage.totalTokens
    case 'elapsed':
      return usage.elapsedMs
    case 'working':
      return usage.firstPromptAt === null ? null : usage.workingMs
    case 'cost':
      return usage.costMicroUsd
  }
}

export const TIME_METRICS: ReadonlySet<MetricKey> = new Set(['elapsed', 'working'])

export interface ExportMeta {
  agentName: string
  frozen: boolean
  /** The card's own labels in the app language (the Markdown is for people). */
  labels: Record<MetricKey, string> & {
    title: string
    metric: string
    value: string
    notReported: string
    noPrice: string
    agent: string
    model: string
    provider: string
    window: string
  }
  language: CardLanguage
}

/** A metric as text for the exports and the card ("not reported" / "no price" when null). */
export function metricText(usage: AgentUsage, key: MetricKey, meta: ExportMeta): string {
  const value = metricValue(usage, key)
  if (key === 'cost') return value === null ? meta.labels.noPrice : formatUsd(value)
  if (value === null) return key === 'elapsed' || key === 'working' ? '—' : meta.labels.notReported
  return TIME_METRICS.has(key) ? stopwatch(value) : formatInt(value, meta.language)
}

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString())

/** Markdown table (for notes, issues, chat). */
export function toMarkdown(usage: AgentUsage, meta: ExportMeta): string {
  const { labels } = meta
  const head = [
    `### ${labels.title}`,
    '',
    `- ${labels.agent}: **${meta.agentName}** (${harnessLabel(usage.harness)})`,
    ...(usage.model ? [`- ${labels.model}: \`${usage.model}\``] : []),
    ...(usage.provider ? [`- ${labels.provider}: ${usage.provider}`] : []),
    `- ${labels.window}: ${iso(usage.firstPromptAt) ?? iso(usage.since)} → ${iso(usage.lastFinishedAt) ?? iso(usage.until)}`,
    '',
    `| ${labels.metric} | ${labels.value} |`,
    '| --- | ---: |'
  ]
  const rows = METRICS.map((key) => `| ${labels[key]} | ${metricText(usage, key, meta)} |`)
  return [...head, ...rows].join('\n') + '\n'
}

/** Machine-readable: raw integers, null = not reported. */
export function toJson(usage: AgentUsage, agentName: string, frozen: boolean): string {
  return (
    JSON.stringify(
      {
        agent: { id: usage.agentId, name: agentName, harness: usage.harness },
        model: usage.model ?? null,
        provider: usage.provider ?? null,
        status: usage.status,
        frozen,
        window: {
          since: iso(usage.since),
          until: iso(usage.until),
          firstPromptAt: iso(usage.firstPromptAt),
          lastFinishedAt: iso(usage.lastFinishedAt),
          timingComplete: usage.timingComplete
        },
        prompts: usage.prompts,
        modelRequests: usage.requests,
        tokens: {
          input: usage.inputTokens,
          output: usage.outputTokens,
          reasoning: usage.reasoningTokens,
          cacheRead: usage.cacheReadTokens,
          cacheWrite: usage.cacheWriteTokens,
          total: usage.totalTokens
        },
        elapsedMs: usage.elapsedMs,
        workingMs: usage.firstPromptAt === null ? null : usage.workingMs,
        costMicroUsd: usage.costMicroUsd,
        costPartial: usage.costPartial
      },
      null,
      2
    ) + '\n'
  )
}

/** Did any number the card shows change? (drives the "just updated" flash). */
export function changedMetrics(before: AgentUsage | null, after: AgentUsage): MetricKey[] {
  if (!before) return []
  return METRICS.filter(
    (key) => !TIME_METRICS.has(key) && metricValue(before, key) !== metricValue(after, key)
  )
}
