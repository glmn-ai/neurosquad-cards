// Everything the card does with the host, without React: listens to agent
// events, keeps the history, persists it, answers the tool, drives the header
// chip / badge / overview tile / attention, and sends reports over the ports.
// The UI subscribes to it; the unit tests drive it through createMockHost().
import {
  createTranslator,
  isCardSdkError,
  type AgentStatus,
  type Card,
  type JsonValue,
  type Translator
} from '@neurosquad/card-sdk'
import { duration, clock } from './format'
import { catalog } from './i18n'
import {
  applyStatus,
  applyTurn,
  emptyHistory,
  restoreHistory,
  summarize,
  syncAgents,
  toolReport,
  trimHistory,
  type PulseHistory,
  type PulseSummary
} from './model'

export const WINDOWS = { '15m': 15 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000 } as const
export type WindowKey = keyof typeof WINDOWS

export const STORAGE_KEY = 'history'
const SAVE_DEBOUNCE_MS = 3000

export interface PulseSnapshot {
  phase: 'loading' | 'error' | 'ready'
  error: string | null
  /** Bumped on every change of the history. */
  revision: number
  /** The last agent that read the report through the tool (the "just touched by an agent" state). */
  lastRead: { agent: string; at: number } | null
  /** Agent id → when its status last changed (drives the row flash). */
  changedAt: Record<string, number>
}

export interface PulseOptions {
  now?: () => number
}

export class PulseController {
  readonly card: Card
  readonly t: Translator
  history: PulseHistory
  private snapshot: PulseSnapshot = {
    phase: 'loading',
    error: null,
    revision: 0,
    lastRead: null,
    changedAt: {}
  }
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private readonly nudgeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Unknown unless the card was just created: the host keeps the last attention
  // across frame reloads and the SDK does not report it, so after a reload the
  // first "clear" always goes out (otherwise a stale pulse would never go away).
  private attentionRaised: boolean
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private lastChrome = ''
  private readonly now: () => number

  constructor(card: Card, options: PulseOptions = {}) {
    this.card = card
    this.attentionRaised = card.launch !== 'created'
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
    this.history = emptyHistory(this.now())
  }

  // --- store for React ---------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): PulseSnapshot => this.snapshot

  private update(patch: Partial<PulseSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private changed(agentIds: string[] = []): void {
    const changedAt = { ...this.snapshot.changedAt }
    for (const id of agentIds) changedAt[id] = this.now()
    this.update({ revision: this.snapshot.revision + 1, changedAt })
    this.markDirty()
    this.refreshChrome()
  }

  // --- lifecycle --------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    this.history = restoreHistory(await card.storage.get(STORAGE_KEY), this.now())

    this.disposers.push(
      card.agents.onStatus(({ agentId, status, at }) => this.onStatus(agentId, status, at)),
      card.agents.onTurn(({ agentId, phase, at }) => this.onTurn(agentId, phase, at)),
      card.agents.onChanged((agents) => {
        syncAgents(this.history, agents, this.now())
        this.changed()
      }),
      card.tools.handle<{ windowMinutes?: number }>('report', (args, call) => {
        const windowMs = (args?.windowMinutes ?? 60) * 60_000
        this.update({ lastRead: { agent: call.agent.name, at: this.now() } })
        return toolReport(this.summary(windowMs, true))
      }),
      card.settings.onChange(() => {
        this.rescheduleNudges()
        this.changed()
      }),
      card.lifecycle.onSuspend(() => this.flush()),
      card.lifecycle.onVisibility((state) => {
        if (state === 'hidden') void this.flush()
      }),
      this.t.onChange(() => {
        this.lastChrome = ''
        this.refreshChrome()
        void this.setMenu()
      })
    )
    void this.setMenu()
    await this.load()
  }

  /** (Re)reads the agent list — the first load, and "Try again" after an error. */
  async load(): Promise<void> {
    this.update({ phase: 'loading', error: null })
    try {
      const agents = await this.card.agents.list()
      syncAgents(this.history, agents, this.now())
      this.update({ phase: 'ready' })
      this.rescheduleNudges()
      this.changed()
    } catch (error) {
      this.update({
        phase: 'error',
        error: isCardSdkError(error) ? error.hostMessage : String(error)
      })
      void this.card.setOverview({ primary: this.t('error.title'), tone: 'danger', icon: 'signal' })
    }
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    for (const timer of this.nudgeTimers.values()) clearTimeout(timer)
    this.nudgeTimers.clear()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.t.dispose()
  }

  // --- events -------------------------------------------------------------------------

  onStatus(agentId: string, status: AgentStatus, at: number): void {
    if (!this.history.agents[agentId]) return // agents.changed will introduce it
    if (!applyStatus(this.history, agentId, status, at)) return
    this.scheduleNudge(agentId, status)
    this.changed([agentId])
  }

  onTurn(agentId: string, phase: 'start' | 'end', at: number): void {
    const status = this.history.segments[agentId]?.at(-1)?.status
    const turn = applyTurn(
      this.history,
      agentId,
      phase,
      at,
      status === 'needs-input' ? 'needs-input' : 'finished'
    )
    if (turn) {
      const name = this.history.agents[agentId]?.name ?? agentId
      const downstream = this.card.ports.peers.some((peer) => peer.direction !== 'upstream')
      if (downstream) {
        void this.card.ports
          .emit('turns', {
            type: 'turn',
            data: {
              agentId,
              agent: name,
              durationMs: turn.end - turn.start,
              endedAs: turn.endedAs
            },
            at: turn.end
          })
          .catch((error: unknown) => this.card.log.warn('could not emit a turn', error))
      }
    }
    this.changed()
  }

  // --- derived --------------------------------------------------------------------------

  summary(windowMs: number, includeShells = this.showShells): PulseSummary {
    return summarize(this.history, this.now(), windowMs, { includeShells })
  }

  get showShells(): boolean {
    return this.card.settings.value<boolean>('showShells') === true
  }

  /** Header chip, badge and overview tile — sent only when they change. */
  private refreshChrome(): void {
    if (this.snapshot.phase !== 'ready') return
    const t = this.t
    const s = this.summary(WINDOWS['1h'])
    const { working } = s.counts
    const waiting = s.counts['needs-input']
    const key = JSON.stringify([t.language, working, waiting, s.agents.length, s.medianTurnMs])
    if (key === this.lastChrome) return
    this.lastChrome = key
    const card = this.card
    void card.setBadge(waiting > 0 ? waiting : null, { tone: 'warning' })
    void card.setStatus(
      waiting > 0
        ? t('chip.waiting', { count: waiting })
        : working > 0
          ? t('chip.working', { count: working })
          : null,
      { tone: waiting > 0 ? 'warning' : 'accent', busy: working > 0 }
    )
    void card.setOverview({
      primary:
        s.agents.length === 0
          ? t('overview.none')
          : working + waiting > 0
            ? t('overview.primary', { working, waiting })
            : t('overview.idle', { count: s.agents.length }),
      secondary:
        s.medianTurnMs !== null
          ? t('overview.secondary', { time: duration(s.medianTurnMs, t.language) })
          : null,
      progress: s.agents.length > 0 ? working / s.agents.length : null,
      tone: waiting > 0 ? 'warning' : working > 0 ? 'accent' : 'default',
      icon: 'signal'
    })
  }

  // --- nudges (attention) -------------------------------------------------------------

  private get nudgeAfterMs(): number {
    const minutes = Number(this.card.settings.value('nudgeAfterMin') ?? 5)
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0
  }

  private scheduleNudge(agentId: string, status: AgentStatus): void {
    const timer = this.nudgeTimers.get(agentId)
    if (timer) clearTimeout(timer)
    this.nudgeTimers.delete(agentId)
    if (status === 'needs-input' && this.nudgeAfterMs > 0) {
      const since = this.history.segments[agentId]?.at(-1)?.from ?? this.now()
      const wait = Math.max(0, since + this.nudgeAfterMs - this.now())
      this.nudgeTimers.set(
        agentId,
        setTimeout(() => this.nudge(agentId), wait)
      )
    }
    if (status !== 'needs-input') this.clearAttentionIfNobodyWaits()
  }

  private rescheduleNudges(): void {
    for (const [id, list] of Object.entries(this.history.segments)) {
      const open = list.at(-1)
      if (open && open.to === null && this.history.agents[id]?.present) {
        this.scheduleNudge(id, open.status)
      }
    }
  }

  private nudge(agentId: string): void {
    this.nudgeTimers.delete(agentId)
    const open = this.history.segments[agentId]?.at(-1)
    const meta = this.history.agents[agentId]
    if (!open || open.to !== null || open.status !== 'needs-input' || !meta?.present) return
    this.attentionRaised = true
    void this.card
      .attention(
        'info',
        this.t('nudge', { name: meta.name, time: duration(this.now() - open.from, this.t.language) })
      )
      .catch(() => {}) // throttled (10 s) — the next nudge will come
  }

  private clearAttentionIfNobodyWaits(): void {
    if (!this.attentionRaised) return
    const someoneWaits = Object.entries(this.history.segments).some(([id, list]) => {
      const open = list.at(-1)
      return open?.to === null && open.status === 'needs-input' && this.history.agents[id]?.present
    })
    if (someoneWaits) return
    this.attentionRaised = false
    void this.card.attention('none').catch(() => {})
  }

  // --- menu, report, clear -------------------------------------------------------------

  private async setMenu(): Promise<void> {
    await this.card.ui
      .setMenu([
        {
          id: 'report',
          label: this.t('menu.report'),
          icon: 'paper-airplane',
          onSelect: () => void this.sendReport()
        },
        {
          id: 'clear',
          label: this.t('menu.clear'),
          icon: 'trash',
          tone: 'danger',
          onSelect: () => void this.clear()
        }
      ])
      .catch((error: unknown) => this.card.log.warn('menu', error))
  }

  /** The report as Markdown, in the app language (it is for people). */
  reportMarkdown(windowKey: WindowKey = '1h'): string {
    const t = this.t
    const s = this.summary(WINDOWS[windowKey])
    const lang = t.language
    const rows = s.agents.map((agent) => {
      const since = agent.since !== null ? duration(s.now - agent.since, lang) : '—'
      return `| ${agent.meta.name.replace(/\|/g, '\\|')} | ${t(`status.${agent.status}`)} | ${since} | ${agent.turns} | ${Math.round(agent.busyShare * 100)}% |`
    })
    return [
      `### ${t('report.title', { time: clock(s.now, t.locale) })}`,
      '',
      `| ${t('report.agent')} | ${t('report.status')} | ${t('report.for')} | ${t('report.turns', { window: t(`window.${windowKey}`) })} | ${t('report.busy')} |`,
      '| --- | --- | --- | ---: | ---: |',
      ...rows,
      '',
      t('report.summary', {
        median: s.medianTurnMs !== null ? duration(s.medianTurnMs, lang) : '—',
        longest: s.longestTurn ? `${duration(s.longestTurn.ms, lang)} (${s.longestTurn.agent})` : '—',
        waited: duration(s.waitingMs, lang)
      })
    ].join('\n')
  }

  /**
   * Emits the report on the `report` port. Notes and checklists are built-in
   * cards: reaching them needs the optional `cards.connected`, asked for here —
   * only when such a card is actually connected.
   */
  async sendReport(windowKey: WindowKey = '1h'): Promise<number> {
    const card = this.card
    const needsBuiltin = card.ports.peers.some(
      (peer) =>
        peer.direction !== 'upstream' &&
        (peer.kind === 'note' || peer.kind === 'todo' || peer.kind === 'sticky' || peer.kind === 'kanban')
    )
    if (needsBuiltin && !card.permissions.has('cards.connected')) {
      try {
        await card.permissions.request('cards.connected')
      } catch (error) {
        card.log.warn('permission request failed', error)
      }
    }
    try {
      const delivered = await card.ports.emit('report', this.reportMarkdown(windowKey))
      await card.ui
        .toast(delivered > 0 ? this.t('sent', { count: delivered }) : this.t('notConnected'), {
          tone: delivered > 0 ? 'success' : 'default'
        })
        .catch(() => {})
      return delivered
    } catch (error) {
      await card.ui
        .toast(isCardSdkError(error) ? error.hostMessage : String(error), { tone: 'danger' })
        .catch(() => {})
      return 0
    }
  }

  async clear(): Promise<boolean> {
    const ok = await this.card.ui
      .confirm({
        title: this.t('confirmClear.title'),
        message: this.t('confirmClear.message'),
        confirmLabel: this.t('confirmClear.confirm'),
        tone: 'danger'
      })
      .catch(() => false)
    if (!ok) return false
    const agents = await this.card.agents.list().catch(() => [])
    this.history = emptyHistory(this.now())
    syncAgents(this.history, agents, this.now())
    this.changed()
    await this.flush()
    return true
  }

  // --- persistence ---------------------------------------------------------------------

  private markDirty(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty) return
    this.dirty = false
    const now = this.now()
    trimHistory(this.history, now)
    this.history.savedAt = now
    try {
      await this.card.storage.set(
        STORAGE_KEY,
        this.history as unknown as JsonValue
      )
    } catch (error) {
      this.dirty = true
      this.card.log.warn('could not save the history', error)
    }
  }
}
