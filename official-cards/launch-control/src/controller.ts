// Everything the card does with the host, without React: the board in
// storage, the tools agents call, the `checks` input, the `go` / `report`
// outputs, the header chip / badge / overview tile, attention on a NO-GO,
// the kebab menu and the size toggle. The UI subscribes to it; the unit tests
// drive it through createMockHost().
import {
  createTranslator,
  isCardSdkError,
  type Card,
  type CardTone,
  type JsonValue,
  type Translator
} from '@neurosquad/card-sdk'
import { catalog } from './i18n'
import {
  addCheck,
  allGo,
  BoardError,
  counts,
  countdown,
  emptyBoard,
  formatT,
  isWarning,
  mergeTasks,
  phaseOf,
  removeCheck,
  renameCheck,
  resetAll,
  restoreBoard,
  setCheck,
  toolListing,
  type Board,
  type CheckStatus,
  type Phase,
  type PortTask
} from './model'

export const STORAGE_KEY = 'board'
export const FULL_SIZE = { w: 640, h: 420 }
export const COMPACT_SIZE = { w: 300, h: 220 }
const MAX_TIMEOUT = 2_147_000_000

export type Skin = 'phosphor' | 'blueprint' | 'app'

export interface LaunchSnapshot {
  phase: 'loading' | 'error' | 'ready'
  error: string | null
  board: Board
  /** Check id → when it last changed and who changed it (drives the row flash). */
  flash: Record<string, { at: number; by: string; agent: boolean }>
  /** The last change an agent made (the "just touched by an agent" banner). */
  lastAgent: { text: string; at: number } | null
}

export interface LaunchOptions {
  now?: () => number
}

export class LaunchController {
  readonly card: Card
  readonly t: Translator
  private board: Board = emptyBoard()
  private snapshot: LaunchSnapshot = {
    phase: 'loading',
    error: null,
    board: emptyBoard(),
    flash: {},
    lastAgent: null
  }
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private readonly now: () => number
  private launchTimer: ReturnType<typeof setTimeout> | null = null
  private attentionTimer: ReturnType<typeof setTimeout> | null = null
  // Unknown unless the card was just created: the host keeps the last attention
  // across frame reloads and the SDK does not report it, so after a reload the
  // first "clear" always goes out (otherwise a stale pulse would never go away).
  private attentionRaised: boolean
  private lastChrome = ''
  private saving: Promise<void> = Promise.resolve()

  constructor(card: Card, options: LaunchOptions = {}) {
    this.card = card
    this.attentionRaised = card.launch !== 'created'
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
  }

  // --- store for React --------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): LaunchSnapshot => this.snapshot

  private update(patch: Partial<LaunchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  // --- settings ---------------------------------------------------------------------

  get title(): string {
    return String(this.card.settings.value('title') ?? '').trim() || 'Release'
  }
  get brief(): string {
    return String(this.card.settings.value('brief') ?? '').trim()
  }
  get skin(): Skin {
    const skin = this.card.settings.value('skin')
    return skin === 'blueprint' || skin === 'app' ? skin : 'phosphor'
  }
  get accent(): string {
    const accent = this.card.settings.value('accent')
    return typeof accent === 'string' && accent ? accent : '#ffb000'
  }
  get showSeconds(): boolean {
    return this.card.settings.value('showSeconds') !== false
  }
  get warnMinutes(): number {
    const n = Number(this.card.settings.value('warnMinutes') ?? 10)
    return Number.isFinite(n) ? n : 10
  }

  // --- lifecycle --------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    this.disposers.push(
      card.tools.handle('list_checks', () =>
        toolListing(this.board, this.now(), { title: this.title, brief: this.brief })
      ),
      card.tools.handle<{ check: string; status: CheckStatus; note?: string }>(
        'set_check',
        (args, call) => this.agentSet(args, call.agent.name)
      ),
      card.tools.handle<{ name: string }>('add_check', (args, call) => {
        const { check, created } = this.change(
          (board) => addCheck(board, args.name),
          (result) => (result.created ? [result.check.id] : []),
          call.agent.name,
          true
        )
        if (created) this.agentBanner(this.t('agentSet', { agent: call.agent.name, check: check.name, status: this.t('status.pending') }))
        return created
          ? `Added ${check.id} "${check.name}" (pending). ${this.countLine()}`
          : `A check named "${check.name}" already exists: ${check.id} (${check.status}).`
      }),
      card.ports.onMessage<PortTask[]>(
        (tasks, message) => {
          if (!Array.isArray(tasks)) return
          const from =
            card.ports.peers.find((peer) => peer.cardId === message.from)?.name ?? message.from
          this.change(
            (board) => mergeTasks(board, tasks, from, this.now()),
            (ids) => ids,
            from,
            false
          )
        },
        { input: 'checks' }
      ),
      card.settings.onChange(() => {
        this.lastChrome = ''
        this.refreshChrome()
        this.update({})
      }),
      card.lifecycle.onVisibility((state) => {
        // The clock ticks only on screen; the tile gets a fresh T− whenever the card leaves it.
        if (state !== 'visible') this.refreshChrome(true)
      }),
      card.lifecycle.onSuspend(() => this.saving),
      card.lifecycle.onResized(() => void this.setMenu()),
      this.t.onChange(() => {
        this.lastChrome = ''
        this.refreshChrome()
        void this.setMenu()
      })
    )
    void this.setMenu()
    await this.load()
  }

  async load(): Promise<void> {
    this.update({ phase: 'loading', error: null })
    try {
      this.board = restoreBoard(await this.card.storage.get(STORAGE_KEY))
      this.update({ phase: 'ready', board: structuredClone(this.board) })
      this.afterChange()
    } catch (error) {
      this.update({
        phase: 'error',
        error: isCardSdkError(error) ? error.hostMessage : String(error)
      })
      void this.card.setOverview({ primary: this.t('error.title'), tone: 'danger', icon: 'rocket-launch' })
    }
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.launchTimer) clearTimeout(this.launchTimer)
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.t.dispose()
  }

  // --- changes ------------------------------------------------------------------------

  /** Applies a change, flashes the rows it touched, saves, and updates everything derived. */
  private change<R>(
    apply: (board: Board) => R,
    touched: (result: R) => string[],
    by: string,
    agent: boolean
  ): R {
    if (this.snapshot.phase !== 'ready') throw new BoardError('The board is not loaded yet.')
    const result = apply(this.board)
    const ids = touched(result)
    const flash = { ...this.snapshot.flash }
    for (const id of ids) flash[id] = { at: this.now(), by, agent }
    this.update({ board: structuredClone(this.board), flash })
    this.save()
    this.afterChange()
    return result
  }

  // User actions (from the UI).
  userAdd(name: string): void {
    try {
      this.change((board) => addCheck(board, name), (r) => [r.check.id], this.t('you'), false)
    } catch (error) {
      void this.card.ui.toast((error as Error).message, { tone: 'warning' }).catch(() => {})
    }
  }
  userSet(id: string, status: CheckStatus): void {
    this.change(
      (board) => setCheck(board, id, status, { by: this.t('you'), at: this.now() }),
      (check) => [check.id],
      this.t('you'),
      false
    )
  }
  userCycle(id: string): void {
    const check = this.board.checks.find((c) => c.id === id)
    if (!check) return
    const next: Record<CheckStatus, CheckStatus> = { pending: 'go', go: 'nogo', nogo: 'pending' }
    this.userSet(id, next[check.status])
  }
  userRemove(id: string): void {
    this.change((board) => removeCheck(board, id), () => [], this.t('you'), false)
  }
  userRename(id: string, name: string): void {
    this.change((board) => renameCheck(board, id, name), () => [id], this.t('you'), false)
  }
  setTarget(target: number | null): void {
    this.change(
      (board) => {
        board.target = target
      },
      () => [],
      this.t('you'),
      false
    )
  }

  private agentSet(args: { check: string; status: CheckStatus; note?: string }, agent: string): string {
    const check = this.change(
      (board) =>
        setCheck(board, args.check, args.status, {
          note: args.note ?? '',
          by: agent,
          byAgent: true,
          at: this.now()
        }),
      (c) => [c.id],
      agent,
      true
    )
    this.agentBanner(
      this.t('agentSet', { agent, check: check.name, status: this.t(`status.${check.status}`) })
    )
    if (check.status === 'nogo') {
      this.raiseAttention(this.t('attention', { agent, check: check.name }))
    }
    return `${check.id} "${check.name}" is now ${check.status === 'nogo' ? 'NO-GO' : check.status.toUpperCase()}. ${this.countLine()}`
  }

  private countLine(): string {
    const c = counts(this.board)
    return `${c.go}/${c.total} GO, ${c.nogo} NO-GO, ${c.pending} pending.`
  }

  private agentBanner(text: string): void {
    this.update({ lastAgent: { text, at: this.now() } })
  }

  async resetAllChecks(): Promise<boolean> {
    const ok = await this.card.ui
      .confirm({
        title: this.t('confirmReset.title'),
        message: this.t('confirmReset.message'),
        confirmLabel: this.t('confirmReset.confirm'),
        tone: 'danger'
      })
      .catch(() => false)
    if (!ok) return false
    this.change((board) => resetAll(board), () => [], this.t('you'), false)
    return true
  }

  // --- derived state, GO signal, timers ------------------------------------------------

  phaseNow(): Phase {
    return phaseOf(this.board, this.now())
  }

  private afterChange(): void {
    // GO signal: once per "everything turned GO", reset when something is not GO any more.
    if (allGo(this.board)) {
      if (this.board.goAt === null) {
        this.board.goAt = this.now()
        this.save()
        void this.card.ports
          .emit('go', {
            type: 'go',
            data: {
              title: this.title,
              checks: this.board.checks.map((c) => ({ id: c.id, name: c.name, note: c.note ?? null }))
            },
            at: this.board.goAt
          })
          .then((n) => {
            if (n > 0) void this.card.ui.toast(this.t('goSent'), { tone: 'success' }).catch(() => {})
          })
          .catch((error: unknown) => this.card.log.warn('could not emit GO', error))
      }
    } else if (this.board.goAt !== null) {
      this.board.goAt = null
      this.save()
    }
    if (counts(this.board).nogo === 0) this.clearAttention()
    this.scheduleLaunchTimer()
    this.refreshChrome()
  }

  /** One timer at T−0 (not a ticking clock): the header and tile change at launch even when nobody looks. */
  private scheduleLaunchTimer(): void {
    if (this.launchTimer) clearTimeout(this.launchTimer)
    this.launchTimer = null
    const target = this.board.target
    if (target === null) return
    const wait = target - this.now()
    if (wait <= 0) return
    this.launchTimer = setTimeout(
      () => {
        this.launchTimer = null
        this.lastChrome = ''
        this.refreshChrome(true)
        this.update({})
        this.scheduleLaunchTimer()
      },
      Math.min(wait + 50, MAX_TIMEOUT)
    )
  }

  /** Header chip, badge and overview tile — sent only when something in them changed. */
  refreshChrome(force = false): void {
    if (this.snapshot.phase !== 'ready') return
    const t = this.t
    const now = this.now()
    const phase = phaseOf(this.board, now)
    const c = counts(this.board)
    const warn = isWarning(this.board, now, this.warnMinutes)
    const cd = countdown(this.board.target, now)
    const tText = formatT(cd, false)
    const tone: CardTone =
      phase === 'hold' || phase === 'scrubbed'
        ? 'danger'
        : phase === 'go' || phase === 'launched'
          ? 'success'
          : warn
            ? 'warning'
            : 'default'
    // The minute part of T− is in the key: a forced refresh (visibility) moves it on.
    const key = JSON.stringify([t.language, phase, c, warn, this.title, force ? tText : ''])
    if (!force && key === this.lastChrome) return
    this.lastChrome = key
    const card = this.card
    void card.setBadge(c.nogo > 0 ? c.nogo : null, { tone: 'danger' })
    void card.setStatus(phase === 'empty' ? null : t(`phase.${phase}`), { tone })
    void card.setOverview({
      primary:
        phase === 'empty'
          ? t('overview.empty')
          : this.board.target === null
            ? t('overview.noClock', { go: c.go, total: c.total })
            : t('overview.clock', { t: tText, go: c.go, total: c.total }),
      secondary: this.title,
      progress: c.total > 0 ? c.go / c.total : null,
      tone,
      icon: 'rocket-launch'
    })
  }

  // --- attention -----------------------------------------------------------------------

  private raiseAttention(message: string): void {
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.attentionTimer = null
    this.card.attention('needs-input', message).then(
      () => {
        this.attentionRaised = true
      },
      (error: unknown) => {
        // At most one attention call per 10 s: retry once when the host allows it.
        if (isCardSdkError(error, 'RATE_LIMITED')) {
          const after = Number((error.data as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 10_000)
          this.attentionTimer = setTimeout(() => {
            this.attentionTimer = null
            if (counts(this.board).nogo > 0) this.raiseAttention(message)
          }, after + 100)
        }
      }
    )
  }

  private clearAttention(): void {
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.attentionTimer = null
    if (!this.attentionRaised) return
    this.attentionRaised = false
    void this.card.attention('none').catch(() => {})
  }

  // --- menu, size, report ------------------------------------------------------------------

  get isCompact(): boolean {
    return this.card.size.w < 400
  }

  private async setMenu(): Promise<void> {
    await this.card.ui
      .setMenu([
        { id: 'report', label: this.t('menu.report'), icon: 'paper-airplane', onSelect: () => void this.sendReport() },
        {
          id: 'size',
          label: this.isCompact ? this.t('menu.full') : this.t('menu.compact'),
          icon: 'arrow-path',
          onSelect: () => void this.toggleSize()
        },
        { id: 'reset', label: this.t('menu.reset'), icon: 'stop', tone: 'danger', onSelect: () => void this.resetAllChecks() }
      ])
      .catch((error: unknown) => this.card.log.warn('menu', error))
  }

  async toggleSize(): Promise<void> {
    try {
      await this.card.requestResize(this.isCompact ? FULL_SIZE : COMPACT_SIZE)
    } catch (error) {
      this.card.log.warn('resize', error)
    }
    await this.setMenu()
  }

  reportMarkdown(): string {
    const t = this.t
    const now = this.now()
    const c = counts(this.board)
    const mark: Record<CheckStatus, string> = { go: '[x]', nogo: '[ ]', pending: '[ ]' }
    return [
      `### ${t('report.title', { title: this.title, t: formatT(countdown(this.board.target, now), false) })}`,
      '',
      `**${t(`phase.${phaseOf(this.board, now)}`)}** · ${t('report.summary', { go: c.go, total: c.total, nogo: c.nogo, pending: c.pending })}`,
      '',
      ...this.board.checks.map((check) => {
        const label = t(`status.${check.status}`)
        const who = check.by ? ` — ${check.by}` : ''
        return `- ${mark[check.status]} **${label}** ${check.name}${who}${check.note ? `: ${check.note}` : ''}`
      })
    ].join('\n')
  }

  async sendReport(): Promise<number> {
    const card = this.card
    const builtin = card.ports.peers.some(
      (peer) =>
        peer.direction !== 'upstream' &&
        (peer.kind === 'note' || peer.kind === 'todo' || peer.kind === 'sticky' || peer.kind === 'kanban')
    )
    if (builtin && !card.permissions.has('cards.connected')) {
      await card.permissions.request('cards.connected').catch((e: unknown) => card.log.warn('permission', e))
    }
    try {
      const delivered = await card.ports.emit('report', this.reportMarkdown())
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

  // --- persistence ----------------------------------------------------------------------

  /** Saves the board (the host writes atomically and debounces the disk). */
  private save(): void {
    const value = structuredClone(this.board) as unknown as JsonValue
    this.saving = this.saving
      .then(() => this.card.storage.set(STORAGE_KEY, value))
      .catch((error: unknown) => this.card.log.warn('could not save the board', error))
  }

  /** Resolves when every save issued so far is done (tests, suspend). */
  flush(): Promise<void> {
    return this.saving
  }
}
