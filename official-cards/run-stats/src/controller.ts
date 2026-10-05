// Everything the card does with the host, without React: finds the agent
// connected by an arrow, keeps the measuring window, asks the app for the
// run's numbers (agents.usage), freezes at the finish, drives the overview
// tile / header chip / menu and exports the results. The UI subscribes to it;
// the unit tests drive it through createMockHost().
import {
  createTranslator,
  isCardSdkError,
  permissionForPeer,
  type AgentInfo,
  type AgentUsage,
  type Card,
  type JsonValue,
  type PermissionId,
  type Translator
} from '@neurosquad/card-sdk'
import { catalog } from './i18n'
import {
  changedMetrics,
  connectedAgents,
  FREEZE_GRACE_MS,
  formatCompact,
  harnessLabel,
  METRICS,
  metricValue,
  pickAgent,
  restoreState,
  stopwatch,
  toJson,
  toMarkdown,
  type ExportMeta,
  type MetricKey,
  type RunState
} from './model'

export const STORAGE_KEY = 'run'

/** How often the numbers are refreshed while the card is on screen. */
export const POLL_MS = { working: 2000, idle: 6000, overview: 15_000 } as const
/** After a turn ends: the harness writes its last log lines a moment later. */
export const AFTER_TURN_MS = [400, 2500, 8000] as const

export type Phase =
  | 'loading'
  | 'unsupported'
  | 'error'
  /** No AI agent connected. */
  | 'empty'
  /** Several connected, none chosen. */
  | 'choose'
  | 'ready'

export interface RunSnapshot {
  phase: Phase
  error: string | null
  state: RunState
  agent: AgentInfo | null
  candidates: AgentInfo[]
  usage: AgentUsage | null
  /** When `usage` was fetched (for the live elapsed tick). */
  fetchedAt: number
  /** Metric → when its value last changed (the "just updated" flash). */
  changedAt: Partial<Record<MetricKey, number>>
  /** A short confirmation under the buttons ("Copied"). */
  notice: { text: string; at: number } | null
}

export interface RunOptions {
  now?: () => number
}

export class RunController {
  readonly card: Card
  readonly t: Translator
  private snapshot: RunSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private readonly burstTimers: ReturnType<typeof setTimeout>[] = []
  private fetching: Promise<void> | null = null
  private again: Promise<void> | null = null
  private lastChrome = ''
  private readonly now: () => number

  constructor(card: Card, options: RunOptions = {}) {
    this.card = card
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
    this.snapshot = {
      phase: 'loading',
      error: null,
      state: { since: null },
      agent: null,
      candidates: [],
      usage: null,
      fetchedAt: 0,
      changedAt: {},
      notice: null
    }
  }

  // --- store for React ---------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): RunSnapshot => this.snapshot

  private update(patch: Partial<RunSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
    this.refreshChrome()
  }

  get freezeOnFinish(): boolean {
    return this.card.settings.value('freezeOnFinish') !== false
  }

  // --- lifecycle -------------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    let supported = false
    try {
      supported = await card.host.supports('agents.usage')
    } catch {
      supported = false
    }
    if (!supported) {
      this.update({ phase: 'unsupported' })
      return
    }
    const state = restoreState(await card.storage.get(STORAGE_KEY, null))
    this.snapshot = { ...this.snapshot, state }
    this.disposers.push(
      card.agents.onChanged((agents) => void this.bind(agents)),
      card.agents.onStatus(({ agentId, status }) => {
        const agent = this.snapshot.agent
        if (agentId !== agent?.id) return
        this.update({ agent: { ...agent, status } })
        void this.refresh()
      }),
      card.agents.onTurn(({ agentId, phase }) => {
        if (agentId !== this.snapshot.agent?.id) return
        if (phase === 'end') this.burst()
        else void this.refresh()
      }),
      card.ports.onPeersChanged(() => void this.load()),
      card.settings.onChange(() => void this.refresh()),
      card.lifecycle.onVisibility(() => this.schedule()),
      this.t.onChange(() => {
        this.lastChrome = ''
        this.refreshChrome()
        void this.setMenu()
      })
    )
    await this.load()
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.pollTimer) clearTimeout(this.pollTimer)
    for (const timer of this.burstTimers.splice(0)) clearTimeout(timer)
    this.t.dispose()
  }

  /** (Re)reads the agents and binds the card — the first load, arrows changing, "Try again". */
  async load(): Promise<void> {
    try {
      await this.bind(await this.card.agents.list())
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown): void {
    this.update({
      phase: 'error',
      error: isCardSdkError(error) ? error.hostMessage : String(error)
    })
  }

  private async bind(agents: AgentInfo[]): Promise<void> {
    const candidates = connectedAgents(agents)
    const agent = pickAgent(this.snapshot.state, candidates)
    if (!agent) {
      this.update({
        phase: candidates.length === 0 ? 'empty' : 'choose',
        candidates,
        agent: null,
        usage: null
      })
      this.schedule()
      void this.setMenu()
      return
    }
    let state = this.snapshot.state
    if (state.agentId !== agent.id || state.since === null) {
      // Newly bound: the agent's whole history (a fresh agent's history is
      // the run), until the user starts measuring from a moment of their own.
      state = { agentId: agent.id, since: 0, armedAt: this.now() }
      await this.save(state)
    }
    const switched = this.snapshot.agent?.id !== agent.id
    this.update({
      phase: 'ready',
      candidates,
      agent,
      state,
      ...(switched ? { usage: null, changedAt: {} } : {})
    })
    void this.setMenu()
    await this.refresh()
  }

  private async save(state: RunState): Promise<void> {
    this.snapshot = { ...this.snapshot, state }
    try {
      await this.card.storage.set(STORAGE_KEY, state as unknown as JsonValue)
    } catch (error) {
      this.card.log.warn('could not save the run', error)
    }
  }

  // --- the numbers ---------------------------------------------------------------------

  /**
   * Fetches the run's numbers (one request in flight at a time; a call made
   * meanwhile fetches once more after it, with the window as it is then).
   */
  refresh(): Promise<void> {
    if (this.fetching) {
      this.again ??= this.fetching.then(() => {
        this.again = null
        return this.refresh()
      })
      return this.again
    }
    this.fetching = this.fetch().finally(() => {
      this.fetching = null
      this.schedule()
    })
    return this.fetching
  }

  private async fetch(): Promise<void> {
    const { agent, state } = this.snapshot
    if (!agent || state.since === null) return
    let usage: AgentUsage
    try {
      usage = await this.card.agents.usage(
        agent.id,
        state.since,
        ...(state.frozenUntil !== undefined ? [state.frozenUntil] : [])
      )
    } catch (error) {
      if (isCardSdkError(error, 'NOT_CONNECTED') || isCardSdkError(error, 'NOT_FOUND')) {
        await this.load()
        return
      }
      if (isCardSdkError(error, 'RATE_LIMITED')) return
      this.fail(error)
      return
    }
    // The answer may be stale: the user reset or switched while it was on its way.
    const current = this.snapshot.state
    if (this.snapshot.agent?.id !== agent.id || current.since !== state.since) return
    const at = this.now()
    const changedAt = { ...this.snapshot.changedAt }
    for (const key of changedMetrics(this.snapshot.usage, usage)) changedAt[key] = at
    this.update({ phase: 'ready', error: null, usage, fetchedAt: at, changedAt })
    // Freeze at the finish: the first prompt has run and the agent finished.
    if (
      this.freezeOnFinish &&
      current.frozenUntil === undefined &&
      usage.status === 'finished' &&
      usage.prompts > 0 &&
      usage.lastFinishedAt !== null &&
      usage.lastFinishedAt >= (current.armedAt ?? current.since ?? 0)
    ) {
      void this.freeze(usage.lastFinishedAt + FREEZE_GRACE_MS, true)
    }
  }

  /** Keeps refreshing at the pace the card's visibility and the agent's status call for. */
  private schedule(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer)
    this.pollTimer = null
    if (this.snapshot.phase !== 'ready') return
    const visibility = this.card.context.visibility
    if (visibility === 'hidden') return
    const status = this.snapshot.usage?.status ?? this.snapshot.agent?.status
    const delay =
      visibility === 'visible'
        ? status === 'working' || status === 'needs-input'
          ? POLL_MS.working
          : POLL_MS.idle
        : POLL_MS.overview
    this.pollTimer = setTimeout(() => void this.refresh(), delay)
  }

  /** A turn ended: the last requests reach the log a moment later — look a few times. */
  private burst(): void {
    for (const timer of this.burstTimers.splice(0)) clearTimeout(timer)
    for (const delay of AFTER_TURN_MS) {
      this.burstTimers.push(setTimeout(() => void this.refresh(), delay))
    }
  }

  // --- controls --------------------------------------------------------------------------

  /** "Start measuring now" / "New run": the run is the first prompt from now on. */
  async reset(): Promise<void> {
    const agent = this.snapshot.agent
    if (!agent) return
    const now = this.now()
    await this.save({ agentId: agent.id, since: now, armedAt: now })
    this.update({ usage: null, changedAt: {} })
    void this.setMenu()
    await this.refresh()
  }

  async freeze(until = this.now(), auto = false): Promise<void> {
    const { state } = this.snapshot
    if (state.since === null) return
    await this.save({
      ...state,
      frozenUntil: Math.max(state.since, until),
      frozenBy: auto ? 'finish' : 'user'
    })
    this.update({ state: this.snapshot.state })
    void this.setMenu()
    await this.refresh()
    // Leave the results downstream when a note is connected and allowed.
    if (auto) void this.send(false)
  }

  async unfreeze(): Promise<void> {
    const { state } = this.snapshot
    if (state.frozenUntil === undefined) return
    await this.save({
      ...(state.agentId ? { agentId: state.agentId } : {}),
      since: state.since,
      // A later finish freezes again.
      armedAt: this.now()
    })
    this.update({ state: this.snapshot.state })
    void this.setMenu()
    await this.refresh()
  }

  async choose(agentId: string): Promise<void> {
    const agent = this.snapshot.candidates.find((one) => one.id === agentId)
    if (!agent) return
    await this.save({ agentId, since: 0, armedAt: this.now() })
    await this.bind(await this.card.agents.list())
  }

  async setFreezeOnFinish(on: boolean): Promise<void> {
    await this.card.settings.set({ freezeOnFinish: on })
    void this.setMenu()
    this.update({})
  }

  // --- exports ---------------------------------------------------------------------------

  exportMeta(): ExportMeta {
    const t = this.t
    const labels = Object.fromEntries(METRICS.map((key) => [key, t(`metric.${key}`)])) as Record<
      MetricKey,
      string
    >
    return {
      agentName: this.snapshot.agent?.name ?? '',
      frozen: this.snapshot.state.frozenUntil !== undefined,
      language: t.language,
      labels: {
        ...labels,
        title: t('export.title'),
        metric: t('export.metric'),
        value: t('export.value'),
        notReported: t('notReported'),
        noPrice: t('noPrice'),
        agent: t('export.agent'),
        model: t('export.model'),
        provider: t('export.provider'),
        window: t('export.window'),
        split: t('split.title'),
        main: t('split.main'),
        subagents: t('split.subagents', { count: this.snapshot.usage?.subagents?.count ?? 0 }),
        part: t('export.part')
      }
    }
  }

  markdown(): string | null {
    const usage = this.snapshot.usage
    return usage ? toMarkdown(usage, this.exportMeta()) : null
  }

  json(): string | null {
    const usage = this.snapshot.usage
    if (!usage) return null
    return toJson(usage, this.snapshot.agent?.name ?? '', this.snapshot.state.frozenUntil !== undefined)
  }

  private notice(text: string): void {
    this.update({ notice: { text, at: this.now() } })
  }

  /** Copies the results (asks for the optional clipboard permission the first time). */
  async copy(format: 'markdown' | 'json'): Promise<boolean> {
    const text = format === 'markdown' ? this.markdown() : this.json()
    if (!text) return false
    if (!(await this.ensure('clipboard.write'))) {
      this.notice(this.t('copyDenied'))
      return false
    }
    try {
      await this.card.copyText(text)
      this.notice(this.t('copied'))
      return true
    } catch (error) {
      this.card.log.warn('copy failed', error)
      this.notice(this.t('copyDenied'))
      return false
    }
  }

  /** Sends the Markdown table to the connected notes. `interactive`: may ask for the permission. */
  async send(interactive = true): Promise<number> {
    const text = this.markdown()
    if (!text) return 0
    const peers = this.card.ports.peers.filter((peer) => peer.direction !== 'upstream')
    if (peers.length === 0) {
      if (interactive) this.notice(this.t('noNote'))
      return 0
    }
    const needed = peers
      .map((peer) => permissionForPeer(peer, { outputType: 'ns:markdown' }))
      .filter((id): id is PermissionId => id !== null)
    for (const id of new Set(needed)) {
      const ok = interactive ? await this.ensure(id) : this.card.permissions.has(id)
      if (!ok) return 0
    }
    try {
      const delivered = await this.card.ports.emit('results', text)
      if (interactive) this.notice(this.t('sent', { count: delivered }))
      return delivered
    } catch (error) {
      this.card.log.warn('could not send the results', error)
      return 0
    }
  }

  private async ensure(id: PermissionId): Promise<boolean> {
    if (this.card.permissions.has(id)) return true
    try {
      await this.card.permissions.request(id)
    } catch {
      return false
    }
    return this.card.permissions.has(id)
  }

  // --- chrome -------------------------------------------------------------------------------

  private async setMenu(): Promise<void> {
    const t = this.t
    const { state, phase } = this.snapshot
    if (phase !== 'ready') {
      await this.card.ui.setMenu([]).catch(() => {})
      return
    }
    const frozen = state.frozenUntil !== undefined
    await this.card.ui
      .setMenu([
        { id: 'reset', label: t('action.reset'), icon: 'arrow-path', onSelect: () => void this.reset() },
        frozen
          ? { id: 'unfreeze', label: t('action.unfreeze'), icon: 'play', onSelect: () => void this.unfreeze() }
          : { id: 'freeze', label: t('action.freeze'), icon: 'pause', onSelect: () => void this.freeze() },
        { id: 'copy-md', label: t('action.copyMd'), icon: 'document-text', onSelect: () => void this.copy('markdown') },
        { id: 'copy-json', label: t('action.copyJson'), icon: 'code-bracket', onSelect: () => void this.copy('json') },
        { id: 'send', label: t('action.send'), icon: 'paper-airplane', onSelect: () => void this.send() }
      ])
      .catch((error: unknown) => this.card.log.warn('menu not set', error))
  }

  /** Overview tile and header chip — the main fact readable from across the canvas. */
  private refreshChrome(): void {
    const t = this.t
    const { phase, usage, agent, state } = this.snapshot
    let primary: string
    let secondary: string | null = null
    let tone: 'default' | 'accent' | 'success' | 'warning' | 'danger' = 'default'
    let status: string | null = null
    if (phase === 'empty' || phase === 'choose') primary = t('overview.none')
    else if (phase === 'error') {
      primary = t('error.title')
      tone = 'danger'
    } else if (phase === 'unsupported') {
      primary = t('unsupported.title')
      tone = 'warning'
    } else if (!usage || !agent || usage.prompts === 0) {
      primary = t('overview.armed')
      if (agent) secondary = harnessLabel(agent.harness)
      status = phase === 'ready' ? t('phase.armed') : null
    } else {
      const lang = t.language
      const elapsed = stopwatch(this.liveElapsed() ?? 0)
      primary =
        usage.totalTokens !== null
          ? t('overview.primary', { tokens: formatCompact(usage.totalTokens, lang), elapsed })
          : elapsed
      secondary =
        usage.requests !== null
          ? t('overview.secondary', { requests: usage.requests, harness: harnessLabel(usage.harness) })
          : t('overview.secondaryNoRequests', { prompts: usage.prompts, harness: harnessLabel(usage.harness) })
      const frozen = state.frozenUntil !== undefined
      tone = frozen ? 'success' : usage.status === 'working' ? 'accent' : 'default'
      status = frozen
        ? t(state.frozenBy === 'finish' ? 'phase.frozen' : 'phase.frozenManual')
        : t('phase.measuring')
    }
    const key = JSON.stringify([primary, secondary, tone, status])
    if (key === this.lastChrome) return
    this.lastChrome = key
    void this.card.setOverview({ primary, secondary, tone, icon: 'chart-bar' }).catch(() => {})
    void this.card
      .setStatus(status, { tone: tone === 'success' ? 'success' : 'default' })
      .catch(() => {})
  }

  /** Elapsed as of now: the fetched value plus the time since, while a turn is under way. */
  liveElapsed(now = this.now()): number | null {
    const { usage, fetchedAt, state } = this.snapshot
    if (!usage || usage.elapsedMs === null) return null
    const inTurn = usage.status === 'working' || usage.status === 'needs-input'
    if (!inTurn || state.frozenUntil !== undefined) return usage.elapsedMs
    return usage.elapsedMs + Math.max(0, now - fetchedAt)
  }

  /** Working time as of now (grows only while working). */
  liveWorking(now = this.now()): number | null {
    const { usage, fetchedAt, state } = this.snapshot
    if (!usage) return null
    const value = metricValue(usage, 'working')
    if (value === null) return null
    if (usage.status !== 'working' || state.frozenUntil !== undefined) return value
    return value + Math.max(0, now - fetchedAt)
  }
}
