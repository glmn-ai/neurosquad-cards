// Everything the card does with the host, without React: storage, the four
// MCP tools, review (accept/reject/supersede), chrome (badge, overview,
// attention), the output port and the ADR export. The UI subscribes to it; the
// unit tests drive it through createMockHost().
import {
  createTranslator,
  isCardSdkError,
  type Card,
  type JsonValue,
  type ToolCall,
  type Translator
} from '@neurosquad/card-sdk'
import { catalog } from './i18n'
import {
  adrFiles,
  adrId,
  compactLine,
  createDecision,
  DecisionError,
  editDecision,
  emptyIndex,
  entryKey,
  parseId,
  search,
  toMarkdown,
  withStatus,
  type Author,
  type Decision,
  type DecisionInput,
  type DecisionStatus,
  type LogIndex
} from './model'

export const INDEX_KEY = 'index'
export const ADR_FOLDER = 'docs/adr'
const ATTENTION_INTERVAL_MS = 10_500

export interface LogSnapshot {
  phase: 'loading' | 'error' | 'ready'
  error: string | null
  /** Newest first. */
  entries: Decision[]
  /** The last thing an agent did here — the "just written by an agent" pill. */
  lastAgent: { agent: string; n: number; kind: 'recorded' | 'changed' | 'read'; at: number } | null
  /** Entry number → when it last changed from outside the form (drives the flash). */
  flash: Record<number, number>
  /** Entry the UI should open (set after an agent writes or the user saves). */
  focus: { n: number; at: number } | null
}

export interface LogOptions {
  now?: () => number
}

interface RecordArgs extends DecisionInput {}
interface SearchArgs {
  query?: string
  tag?: string
  status?: DecisionStatus
  limit?: number
}
interface StatusArgs {
  id: string
  status: 'accepted' | 'rejected' | 'superseded'
  supersededBy?: string
  note?: string
}

export class LogController {
  readonly card: Card
  readonly t: Translator
  private index: LogIndex = emptyIndex()
  private readonly byN = new Map<number, Decision>()
  private snapshot: LogSnapshot = {
    phase: 'loading',
    error: null,
    entries: [],
    lastAgent: null,
    flash: {},
    focus: null
  }
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private lastAttentionAt = 0
  private attentionTimer: ReturnType<typeof setTimeout> | null = null
  // Unknown unless the card was just created: the host keeps the last attention
  // across frame reloads and the SDK does not report it, so after a reload the
  // first "clear" always goes out (otherwise a stale pulse would never go away).
  private attentionRaised: boolean
  private lastProposal: { agent: string; title: string } | null = null
  private readonly now: () => number
  /** Serializes storage writes so the index never goes backwards. */
  private writes: Promise<void> = Promise.resolve()

  constructor(card: Card, options: LogOptions = {}) {
    this.card = card
    this.attentionRaised = card.launch !== 'created'
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
  }

  // --- store for React ---------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): LogSnapshot => this.snapshot

  private update(patch: Partial<LogSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private publish(extra: Partial<LogSnapshot> = {}): void {
    const entries = [...this.byN.values()].sort((a, b) => b.n - a.n)
    this.update({ entries, ...extra })
    this.refreshChrome()
  }

  get(n: number): Decision | undefined {
    return this.byN.get(n)
  }

  get agentsMayAccept(): boolean {
    return this.card.settings.value<boolean>('agentsMayAccept') === true
  }

  // --- lifecycle ------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    this.disposers.push(
      card.tools.handle<RecordArgs>('record', (args, call) => this.toolRecord(args, call)),
      card.tools.handle<SearchArgs>('search', (args) => this.toolSearch(args)),
      card.tools.handle<{ id: string }>('get', (args, call) => this.toolGet(args, call)),
      card.tools.handle<StatusArgs>('set_status', (args, call) => this.toolSetStatus(args, call)),
      this.t.onChange(() => {
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
      const raw = await this.card.storage.get(INDEX_KEY)
      const index =
        raw && typeof raw === 'object' && (raw as unknown as LogIndex).version === 1
          ? (raw as unknown as LogIndex)
          : emptyIndex()
      const loaded = await Promise.all(
        index.ids.map((n) => this.card.storage.get(entryKey(n)) as Promise<unknown>)
      )
      this.byN.clear()
      for (const value of loaded) {
        const entry = value as Decision | undefined
        if (entry && typeof entry.n === 'number') this.byN.set(entry.n, entry)
      }
      index.ids = index.ids.filter((n) => this.byN.has(n))
      this.index = index
      this.update({ phase: 'ready' })
      this.clearAttentionIfReviewed() // a pulse left over from before a reload
      this.publish()
    } catch (error) {
      this.update({ phase: 'error', error: message(error) })
      void this.card.setOverview({ primary: this.t('error.title'), tone: 'danger', icon: 'book-open' })
    }
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.t.dispose()
  }

  // --- persistence -----------------------------------------------------------------

  private persist(entry: Decision | null, removed?: number): Promise<void> {
    const index: LogIndex = { ...this.index, ids: [...this.index.ids] }
    const task = async (): Promise<void> => {
      if (entry) await this.card.storage.set(entryKey(entry.n), entry as unknown as JsonValue)
      if (removed !== undefined) await this.card.storage.delete(entryKey(removed))
      await this.card.storage.set(INDEX_KEY, index as unknown as JsonValue)
    }
    const run = this.writes.then(task, task)
    this.writes = run.catch(() => {})
    return run
  }

  private async put(entry: Decision, flash: boolean): Promise<void> {
    const isNew = !this.byN.has(entry.n)
    this.byN.set(entry.n, entry)
    if (isNew) this.index.ids.push(entry.n)
    const at = this.now()
    this.publish(flash ? { flash: { ...this.snapshot.flash, [entry.n]: at } } : {})
    await this.persist(entry)
  }

  private allocate(): number {
    const n = this.index.nextN
    this.index.nextN = n + 1
    return n
  }

  // --- tools (agents) ------------------------------------------------------------------

  private async toolRecord(args: RecordArgs, call: ToolCall): Promise<string> {
    const author: Author = { name: call.agent.name, kind: 'agent' }
    const wantAccepted = args.status === 'accepted'
    const status: DecisionStatus = wantAccepted && this.agentsMayAccept ? 'accepted' : 'proposed'
    const entry = createDecision(this.allocate(), args, author, this.now(), status)
    await this.put(entry, true)
    this.update({
      lastAgent: { agent: author.name, n: entry.n, kind: 'recorded', at: this.now() },
      focus: { n: entry.n, at: this.now() }
    })
    if (status === 'proposed') this.askForReview(author.name, entry.title)
    else void this.emitDecision(entry)
    const id = adrId(entry.n)
    if (status === 'accepted') return `Recorded ${id} "${entry.title}" as accepted.`
    return `Recorded ${id} "${entry.title}" as proposed — the user reviews it${wantAccepted ? ' (agents may not accept decisions in this log)' : ''}.`
  }

  private toolSearch(args: SearchArgs): string {
    const found = search([...this.byN.values()], {
      ...(args.query ? { query: args.query } : {}),
      ...(args.tag ? { tag: args.tag } : {}),
      ...(args.status ? { status: args.status } : {}),
      limit: args.limit ?? 20
    })
    if (this.byN.size === 0) return 'The decision log is empty.'
    if (found.length === 0) return 'No decisions match.'
    return found.map(compactLine).join('\n')
  }

  private toolGet(args: { id: string }, call: ToolCall): string {
    const entry = this.require(args.id)
    this.update({ lastAgent: { agent: call.agent.name, n: entry.n, kind: 'read', at: this.now() } })
    return toMarkdown(entry)
  }

  private async toolSetStatus(args: StatusArgs, call: ToolCall): Promise<string> {
    const entry = this.require(args.id)
    if (args.status === 'accepted' && !this.agentsMayAccept && entry.status !== 'accepted') {
      throw new DecisionError(
        `Only the user can accept decisions in this log; ${adrId(entry.n)} stays ${entry.status} for review.`
      )
    }
    const replacement = args.supersededBy !== undefined ? this.require(args.supersededBy) : undefined
    await this.changeStatus(entry.n, args.status, call.agent.name, args.note, replacement?.n, true)
    this.update({
      lastAgent: { agent: call.agent.name, n: entry.n, kind: 'changed', at: this.now() },
      focus: { n: entry.n, at: this.now() }
    })
    return `${adrId(entry.n)} is now ${args.status}${replacement ? ` (superseded by ${adrId(replacement.n)})` : ''}.`
  }

  private require(id: string | number): Decision {
    const n = parseId(id)
    const entry = n === null ? undefined : this.byN.get(n)
    if (!entry) throw new DecisionError(`There is no decision "${id}". Use search to find ids.`)
    return entry
  }

  // --- review and editing (people and agents) ------------------------------------------

  async changeStatus(
    n: number,
    status: DecisionStatus,
    by: string,
    note?: string,
    supersededBy?: number,
    flash = false
  ): Promise<void> {
    const entry = this.byN.get(n)
    if (!entry) throw new DecisionError(`There is no decision ${adrId(n)}.`)
    if (supersededBy === n) throw new DecisionError('A decision cannot supersede itself.')
    let next = withStatus(entry, status, by, this.now(), note)
    if (status === 'superseded' && supersededBy !== undefined) {
      next = { ...next, supersededBy }
      const other = this.byN.get(supersededBy)
      if (other && other.supersedes !== n) await this.put({ ...other, supersedes: n }, false)
    } else if (status !== 'superseded' && next.supersededBy !== undefined) {
      next = { ...next }
      delete next.supersededBy
    }
    await this.put(next, flash)
    if (status === 'accepted' && entry.status !== 'accepted') void this.emitDecision(next)
    this.clearAttentionIfReviewed()
  }

  /** A decision written in the card's form. Returns its number. */
  async createByUser(input: DecisionInput): Promise<number> {
    const status = input.status ?? 'accepted'
    const entry = createDecision(this.allocate(), input, { name: this.youName(), kind: 'human' }, this.now(), status)
    await this.put(entry, false)
    this.update({ focus: { n: entry.n, at: this.now() } })
    if (status === 'accepted') void this.emitDecision(entry)
    return entry.n
  }

  async editByUser(n: number, input: DecisionInput): Promise<void> {
    const entry = this.byN.get(n)
    if (!entry) throw new DecisionError(`There is no decision ${adrId(n)}.`)
    let next = editDecision(entry, input, this.youName(), this.now())
    if (input.status && input.status !== entry.status) {
      next = withStatus(next, input.status, this.youName(), this.now())
    }
    await this.put(next, false)
    if (next.status === 'accepted' && entry.status !== 'accepted') void this.emitDecision(next)
    this.clearAttentionIfReviewed()
  }

  async remove(n: number): Promise<boolean> {
    const entry = this.byN.get(n)
    if (!entry) return false
    const id = adrId(n)
    const ok = await this.card.ui
      .confirm({
        title: this.t('confirmDelete.title', { id }),
        message: this.t('confirmDelete.message'),
        confirmLabel: this.t('confirmDelete.confirm'),
        tone: 'danger'
      })
      .catch(() => false)
    if (!ok) return false
    this.byN.delete(n)
    this.index.ids = this.index.ids.filter((id) => id !== n)
    this.publish()
    await this.persist(null, n)
    this.clearAttentionIfReviewed()
    return true
  }

  private youName(): string {
    return { en: 'You', ru: 'Вы', zh: '你' }[this.t.language] ?? 'You'
  }

  // --- chrome and attention -----------------------------------------------------------

  get reviewCount(): number {
    let count = 0
    for (const entry of this.byN.values()) if (entry.status === 'proposed') count++
    return count
  }

  private refreshChrome(): void {
    if (this.snapshot.phase !== 'ready') return
    const t = this.t
    const count = this.byN.size
    const review = this.reviewCount
    const latest = this.snapshot.entries[0]
    void this.card.setBadge(review > 0 ? review : null, { tone: 'warning' })
    void this.card.setOverview({
      primary:
        count === 0
          ? t('overview.none')
          : review > 0
            ? t('overview.primary', { count, review })
            : t('overview.calm', { count }),
      secondary: latest ? `${adrId(latest.n)} · ${latest.title}`.slice(0, 160) : null,
      tone: review > 0 ? 'warning' : 'default',
      icon: 'book-open'
    })
  }

  /**
   * A soft pulse and an Inbox line when an agent proposes something. The host
   * accepts one attention call per 10 s, so a burst of proposals is folded into
   * one "N decisions wait for your review".
   */
  private askForReview(agent: string, title: string): void {
    this.lastProposal = { agent, title }
    if (this.attentionTimer) return
    const wait = Math.max(0, this.lastAttentionAt + ATTENTION_INTERVAL_MS - this.now())
    const fire = (): void => {
      this.attentionTimer = null
      const review = this.reviewCount
      if (review === 0 || !this.lastProposal) return
      this.lastAttentionAt = this.now()
      this.attentionRaised = true
      const text =
        review > 1
          ? this.t('attentionMany', { count: review })
          : this.t('attention', { agent: this.lastProposal.agent, title: this.lastProposal.title })
      void this.card.attention('info', text.slice(0, 160)).catch(() => {})
    }
    if (wait === 0) fire()
    else this.attentionTimer = setTimeout(fire, wait)
  }

  private clearAttentionIfReviewed(): void {
    if (!this.attentionRaised || this.reviewCount > 0) return
    this.attentionRaised = false
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.attentionTimer = null
    this.lastAttentionAt = this.now()
    void this.card.attention('none').catch(() => {})
  }

  // --- menu, ports, export ------------------------------------------------------------

  private async setMenu(): Promise<void> {
    await this.card.ui
      .setMenu([
        {
          id: 'export',
          label: this.t('menu.export'),
          icon: 'folder',
          onSelect: () => void this.exportAdr()
        }
      ])
      .catch((error: unknown) => this.card.log.warn('menu', error))
  }

  private get hasDownstream(): boolean {
    return this.card.ports.peers.some((peer) => peer.direction !== 'upstream')
  }

  /** Automatic: sent on accept, only when something is connected downstream. */
  private async emitDecision(entry: Decision): Promise<number> {
    if (!this.hasDownstream) return 0
    try {
      return await this.card.ports.emit('decisions', toMarkdown(entry))
    } catch (error) {
      this.card.log.warn('could not emit a decision', error)
      return 0
    }
  }

  /** By hand, from the detail pane: asks for cards.connected when a built-in card is the target. */
  async send(n: number): Promise<number> {
    const entry = this.byN.get(n)
    if (!entry) return 0
    const card = this.card
    const builtin = card.ports.peers.some(
      (peer) => peer.direction !== 'upstream' && ['note', 'todo', 'kanban', 'sticky'].includes(peer.kind)
    )
    if (builtin && !card.permissions.has('cards.connected')) {
      await card.permissions.request('cards.connected').catch((error: unknown) => {
        card.log.warn('permission request failed', error)
      })
    }
    const delivered = await this.emitDecision(entry)
    await card.ui
      .toast(delivered > 0 ? this.t('sent', { count: delivered }) : this.t('notConnected'), {
        tone: delivered > 0 ? 'success' : 'default'
      })
      .catch(() => {})
    return delivered
  }

  /** Writes docs/adr/NNNN-slug.md + README.md. Asks for the optional fs.write first. */
  async exportAdr(): Promise<number> {
    const card = this.card
    const entries = [...this.byN.values()]
    if (entries.length === 0) {
      await card.ui.toast(this.t('exportEmpty')).catch(() => {})
      return 0
    }
    if (!card.permissions.has('fs.write')) {
      const granted: string[] = await card.permissions.request('fs.write').catch((): string[] => [])
      if (!granted.includes('fs.write')) {
        await card.ui.toast(this.t('exportNeedsPermission'), { tone: 'warning' }).catch(() => {})
        return 0
      }
    }
    try {
      const files = adrFiles(entries, ADR_FOLDER)
      for (const file of files) await card.fs.writeText(file.path, file.text, { createDirs: true })
      await card.ui
        .toast(this.t('exported', { count: files.length, folder: ADR_FOLDER }), { tone: 'success' })
        .catch(() => {})
      return files.length
    } catch (error) {
      await card.ui.toast(this.t('saveFailed', { error: message(error) }), { tone: 'danger' }).catch(() => {})
      return 0
    }
  }
}

function message(error: unknown): string {
  if (isCardSdkError(error)) return error.hostMessage
  return error instanceof Error ? error.message : String(error)
}
