// Everything the card does with the host, without React: polls GitHub through
// the proxy while the card is on screen, keeps the last good data in storage,
// answers the agents' `status` tool, drives the header / badge / overview /
// attention, and emits `ci` when the default branch changes state.
import {
  createTranslator,
  isCardSdkError,
  type Card,
  type JsonValue,
  type Translator
} from '@neurosquad/card-sdk'
import { GithubClient, GithubError, emptyCache, type GithubErrorKind } from './github'
import { catalog } from './i18n'
import {
  branchCi,
  diffSnapshots,
  parseGitConfig,
  parseRepo,
  repoLabel,
  toolReport,
  type CiState,
  type RepoRef,
  type RepoSnapshot
} from './model'

export const STORAGE_KEY = 'radar'
/** The tool refreshes data older than this before answering. */
export const TOOL_FRESH_MS = 60_000

export interface RadarError {
  kind: GithubErrorKind
  message: string
  status: number | null
  resetAt: number | null
}

export interface RadarSnapshot {
  phase: 'empty' | 'loading' | 'error' | 'ready'
  repo: RepoRef | null
  data: RepoSnapshot | null
  /** The last poll failed (with `data` still showing the previous one when there is some). */
  error: RadarError | null
  refreshing: boolean
  /** Rows that changed in the last poll (the "just updated" flash). */
  flash: { pulls: number[]; runs: number[]; at: number } | null
  /** The last agent that checked CI through the tool. */
  lastRead: { agent: string; at: number } | null
}

interface Stored {
  repo: string
  data: RepoSnapshot
  ci: Record<string, CiState>
  branchState: CiState
}

export interface RadarOptions {
  now?: () => number
}

export class RadarController {
  readonly card: Card
  readonly t: Translator
  readonly client: GithubClient
  private snap: RadarSnapshot = {
    phase: 'loading',
    repo: null,
    data: null,
    error: null,
    refreshing: false,
    flash: null,
    lastRead: null
  }
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private branchState: CiState | null = null
  private readonly now: () => number

  constructor(card: Card, options: RadarOptions = {}) {
    this.card = card
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
    this.client = new GithubClient(card)
  }

  // --- store for React --------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): RadarSnapshot => this.snap

  private update(patch: Partial<RadarSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const listener of this.listeners) listener()
  }

  // --- settings --------------------------------------------------------------------

  get repoSetting(): RepoRef | null {
    return parseRepo(this.card.settings.value<string>('repo'))
  }

  get intervalMs(): number {
    const minutes = Number(this.card.settings.value('intervalMin') ?? 5)
    return Math.max(2, Number.isFinite(minutes) ? minutes : 5) * 60_000
  }

  // --- lifecycle --------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    this.disposers.push(
      card.lifecycle.onVisibility(() => this.schedule()),
      card.settings.onChange(() => void this.onSettings()),
      card.tools.handle('status', async (_args, call) => {
        call.progress('asking GitHub…')
        const text = await this.statusForAgent()
        this.update({ lastRead: { agent: call.agent.name, at: this.now() } })
        return text
      }),
      this.t.onChange(() => {
        this.refreshChrome()
        void this.setMenu()
      })
    )
    void this.setMenu()

    const repo = this.repoSetting
    const stored = await card.storage.get<JsonValue>(STORAGE_KEY).catch(() => undefined)
    const saved = stored as unknown as Stored | undefined
    if (repo && saved && saved.repo === repoLabel(repo) && saved.data) {
      this.client.cache.ci = saved.ci ?? {}
      this.branchState = saved.branchState ?? null
      this.update({ phase: 'ready', repo, data: saved.data })
    } else {
      this.update({ phase: repo ? 'loading' : 'empty', repo })
    }
    this.refreshChrome()
    if (repo && this.card.visibility === 'visible') await this.refresh()
    else this.schedule()
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.t.dispose()
  }

  private async onSettings(): Promise<void> {
    const repo = this.repoSetting
    const same = repo && this.snap.repo && repoLabel(repo) === repoLabel(this.snap.repo)
    if (same) {
      this.schedule() // the interval may have changed
      return
    }
    this.client.cache = emptyCache()
    this.branchState = null
    this.update({ repo, data: null, error: null, flash: null, phase: repo ? 'loading' : 'empty' })
    this.refreshChrome()
    await this.card.storage.delete(STORAGE_KEY).catch(() => {})
    if (repo) await this.refresh()
  }

  // --- polling ------------------------------------------------------------------------

  /**
   * The next poll, only while someone can see the card. Hidden, zoomed out or
   * off-screen = no timer at all; coming back on screen polls at once if stale.
   */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.snap.repo || this.card.visibility !== 'visible') return
    let due = (this.snap.data?.fetchedAt ?? 0) + this.intervalMs
    if (this.snap.error) due = Math.max(this.now() + 60_000, this.snap.error.resetAt ?? 0)
    if (this.snap.error?.kind === 'rate-limit' && this.snap.error.resetAt) due = this.snap.error.resetAt + 1000
    this.timer = setTimeout(() => void this.refresh(), Math.max(0, due - this.now()))
  }

  /** Polls now (the refresh button, the tool, the timer). Concurrent calls share one poll. */
  refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.poll().finally(() => {
        this.inflight = null
        this.schedule()
      })
    }
    return this.inflight
  }

  private async poll(): Promise<void> {
    const repo = this.snap.repo
    if (!repo) return
    this.update({ refreshing: true })
    void this.card.setStatus(this.t('refreshing'), { busy: true }).catch(() => {})
    try {
      const data = await this.client.fetchRepo(repo, this.now())
      if (!this.snap.repo || repoLabel(this.snap.repo) !== repoLabel(repo)) return // repo changed meanwhile
      const diff = diffSnapshots(this.snap.data, data)
      const changed = diff.pulls.length + diff.runs.length > 0
      this.update({
        phase: 'ready',
        data,
        error: null,
        flash: changed ? { ...diff, at: this.now() } : this.snap.flash
      })
      this.card.log.info(
        `polled ${repoLabel(repo)}: ${this.client.requests} requests, ${this.client.notModified} not modified, ${data.rate.remaining ?? '?'} left`
      )
      await this.onBranchCi(data)
      await this.save()
    } catch (error) {
      const failure =
        error instanceof GithubError
          ? { kind: error.kind, message: error.message, status: error.status, resetAt: error.resetAt }
          : {
              kind: 'network' as const,
              message: isCardSdkError(error) ? error.hostMessage : String(error),
              status: null,
              resetAt: null
            }
      this.card.log.warn('poll failed', failure)
      this.update({ error: failure, phase: this.snap.data ? 'ready' : 'error' })
    } finally {
      this.update({ refreshing: false })
      void this.card.setStatus(null).catch(() => {})
      this.refreshChrome()
    }
  }

  private async save(): Promise<void> {
    const { repo, data } = this.snap
    if (!repo || !data) return
    const stored: Stored = {
      repo: repoLabel(repo),
      data,
      ci: this.client.cache.ci,
      branchState: this.branchState ?? 'none'
    }
    await this.card.storage
      .set(STORAGE_KEY, stored as unknown as JsonValue)
      .catch((error: unknown) => this.card.log.warn('could not save', error))
  }

  // --- CI of the default branch: badge, attention, port -------------------------------

  private async onBranchCi(data: RepoSnapshot): Promise<void> {
    const { state, run } = branchCi(data.runs, data.repo.defaultBranch)
    const previous = this.branchState
    this.branchState = state
    if (previous === state) return
    const t = this.t
    if (state === 'failure') {
      await this.card
        .attention('info', t('attention', { branch: data.repo.defaultBranch, run: run?.name ?? '' }))
        .catch(() => {})
    } else if (previous === 'failure') {
      await this.card.attention('none').catch(() => {})
    }
    if (previous !== null) {
      await this.card.ports
        .emit('ci', {
          type: 'ci',
          data: {
            repo: data.repo.fullName,
            branch: data.repo.defaultBranch,
            state,
            previous,
            sha: run?.sha ?? null,
            run: run?.name ?? null,
            url: run?.url ?? null
          },
          at: this.now()
        })
        .catch((error: unknown) => this.card.log.warn('could not emit ci', error))
    }
  }

  /** Badge and overview tile — the card read from across the canvas. */
  refreshChrome(): void {
    const t = this.t
    const { repo, data, error } = this.snap
    if (!repo) {
      void this.card.setBadge(null).catch(() => {})
      void this.card.setOverview({ primary: t('overview.noRepo'), tone: 'default', icon: 'code-bracket' }).catch(() => {})
      return
    }
    if (!data) {
      void this.card
        .setOverview({
          primary: repoLabel(repo),
          secondary: error ? t(`error.${errorKey(error.kind)}`) : t('loading'),
          tone: error ? 'danger' : 'default',
          icon: 'code-bracket'
        })
        .catch(() => {})
      return
    }
    const { state } = branchCi(data.runs, data.repo.defaultBranch)
    void this.card
      .setBadge(state === 'failure' ? t('badge') : null, { tone: 'danger' })
      .catch(() => {})
    void this.card
      .setOverview({
        primary: t('overview.primary', {
          count: data.pulls.length,
          branch: data.repo.defaultBranch,
          state: t(`ci.${state}`)
        }),
        secondary: data.repo.fullName,
        tone: state === 'failure' ? 'danger' : state === 'success' ? 'success' : state === 'pending' ? 'accent' : 'default',
        icon: 'code-bracket'
      })
      .catch(() => {})
  }

  // --- the agents' tool ----------------------------------------------------------------

  async statusForAgent(): Promise<string> {
    if (!this.snap.repo) throw new Error('No repository is set on the Repo Radar card yet.')
    const stale = !this.snap.data || this.now() - this.snap.data.fetchedAt > TOOL_FRESH_MS
    const limited = this.snap.error?.kind === 'rate-limit' && (this.snap.error.resetAt ?? 0) > this.now()
    if (stale && !limited) await this.refresh()
    if (!this.snap.data) {
      throw new Error(`GitHub could not be read: ${this.snap.error?.message ?? 'unknown error'}`)
    }
    const note = this.snap.error ? `\n(Latest refresh failed: ${this.snap.error.message}; the data above is older.)` : ''
    return toolReport(this.snap.data, this.now()) + note
  }

  // --- user actions -----------------------------------------------------------------

  /** From the empty state's field. */
  async watch(input: string): Promise<boolean> {
    const ref = parseRepo(input)
    if (!ref) return false
    await this.card.settings.set({ repo: repoLabel(ref) })
    return true
  }

  /** Reads `.git/config` of the workspace (asks for the optional `fs.read` first). */
  async detect(): Promise<RepoRef | null> {
    const card = this.card
    if (!card.permissions.has('fs.read')) {
      const granted = await card.permissions.request('fs.read').catch((): string[] => [])
      if (!granted.includes('fs.read') && !card.permissions.has('fs.read')) {
        await card.ui.toast(this.t('detect.denied'), { tone: 'warning' }).catch(() => {})
        return null
      }
    }
    let ref: RepoRef | null = null
    try {
      ref = parseGitConfig(await card.fs.readText('.git/config', { maxBytes: 256 * 1024 }))
    } catch (error) {
      card.log.info('no .git/config', error)
    }
    if (!ref) {
      await card.ui.toast(this.t('detect.none'), { tone: 'warning' }).catch(() => {})
      return null
    }
    await card.settings.set({ repo: repoLabel(ref) })
    await card.ui.toast(this.t('detect.found', { repo: repoLabel(ref) }), { tone: 'success' }).catch(() => {})
    return ref
  }

  openLink(url: string): void {
    if (url.startsWith('https://')) void this.card.openLink(url).catch(() => {})
  }

  private async setMenu(): Promise<void> {
    await this.card.ui
      .setMenu([
        { id: 'refresh', label: this.t('menu.refresh'), icon: 'arrow-path', onSelect: () => void this.refresh() },
        {
          id: 'open',
          label: this.t('menu.open'),
          icon: 'link',
          onSelect: () => {
            const url = this.snap.data?.repo.url
            if (url) this.openLink(url)
          }
        },
        { id: 'detect', label: this.t('menu.detect'), icon: 'folder', onSelect: () => void this.detect() }
      ])
      .catch((error: unknown) => this.card.log.warn('menu', error))
  }
}

/** i18n key of an error kind. */
export function errorKey(kind: GithubErrorKind): string {
  return kind === 'rate-limit' ? 'rateLimit' : kind === 'not-found' ? 'notFound' : kind
}
