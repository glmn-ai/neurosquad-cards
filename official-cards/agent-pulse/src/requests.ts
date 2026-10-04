// The "Requests" view (since 1.1): every model request of the agents
// connected to the card by arrows, one swimlane each, from the app's
// `agents.timeline` (Card SDK 1.2, NeuroSquad 0.1.257+, optional `usage.read`).
// Fetches while someone can see the card; everything drawn comes from the
// fetched data and the clock, nothing random.
import {
  isCardSdkError,
  type AgentInfo,
  type AgentTimeline,
  type Card,
  type JsonValue,
  type Translator
} from '@neurosquad/card-sdk'
import { laneStats, shortDuration } from './requestModel'

export const REQUEST_WINDOWS = {
  all: 0,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000
} as const
export type RequestWindowKey = keyof typeof REQUEST_WINDOWS

export const REQUESTS_POLL_MS = { live: 2000, idle: 6000, overview: 15_000 } as const

export type RequestsPhase = 'unsupported' | 'permission' | 'empty' | 'loading' | 'ready' | 'error'

export interface Lane {
  agent: AgentInfo
  timeline: AgentTimeline | null
}

export interface RequestsSnapshot {
  phase: RequestsPhase
  error: string | null
  lanes: Lane[]
  windowKey: RequestWindowKey
  fetchedAt: number
}

export const WINDOW_STORAGE_KEY = 'requestsWindow'

export class RequestsController {
  private snapshot: RequestsSnapshot = {
    phase: 'loading',
    error: null,
    lanes: [],
    windowKey: 'all',
    fetchedAt: 0
  }
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private fetching: Promise<void> | null = null
  private again = false
  private supported = false
  private readonly now: () => number

  /** The Requests view is the one shown (it owns the overview tile then). */
  active = false
  private readonly t: Translator | undefined
  private lastOverview = ''

  constructor(
    readonly card: Card,
    options: { now?: () => number; t?: Translator } = {}
  ) {
    this.now = options.now ?? Date.now
    this.t = options.t
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): RequestsSnapshot => this.snapshot

  private update(patch: Partial<RequestsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
    this.refreshOverview()
  }

  /** The overview tile's main fact: requests and the median request time. */
  private refreshOverview(): void {
    const t = this.t
    if (!t || !this.active || this.snapshot.phase !== 'ready') return
    const all = laneStats({
      ...(this.snapshot.lanes.find((lane) => lane.timeline)?.timeline ?? ({} as AgentTimeline)),
      requests: this.snapshot.lanes.flatMap((lane) => lane.timeline?.requests ?? []),
      turns: []
    })
    const overview = {
      primary: t('requests.overview.primary', {
        count: all.requests,
        median: all.medianMs !== null ? shortDuration(all.medianMs, t.language) : '—'
      }),
      secondary: all.longest
        ? t('requests.overview.secondary', { time: shortDuration(all.longest.ms, t.language) })
        : null,
      tone: (this.live ? 'accent' : 'default') as 'accent' | 'default',
      icon: 'signal' as const
    }
    const key = JSON.stringify(overview)
    if (key === this.lastOverview) return
    this.lastOverview = key
    void this.card.setOverview(overview).catch(() => {})
  }

  async start(): Promise<void> {
    const card = this.card
    try {
      this.supported = await card.host.supports('agents.timeline')
    } catch {
      this.supported = false
    }
    if (!this.supported) {
      this.update({ phase: 'unsupported' })
      return
    }
    const stored = await card.storage.get(WINDOW_STORAGE_KEY, 'all').catch(() => 'all')
    if (typeof stored === 'string' && stored in REQUEST_WINDOWS) {
      this.snapshot = { ...this.snapshot, windowKey: stored as RequestWindowKey }
    }
    this.disposers.push(
      card.agents.onChanged((agents) => this.bind(agents)),
      card.agents.onStatus(({ agentId }) => {
        if (this.snapshot.lanes.some((lane) => lane.agent.id === agentId)) void this.refresh()
      }),
      card.agents.onTurn(({ agentId, phase }) => {
        if (!this.snapshot.lanes.some((lane) => lane.agent.id === agentId)) return
        // The last request of a turn reaches the log a moment after its end.
        if (phase === 'end')
          for (const ms of [500, 2500, 8000]) setTimeout(() => void this.refresh(), ms)
        else void this.refresh()
      }),
      card.ports.onPeersChanged(() => void this.load()),
      card.permissions.onChange(() => void this.load()),
      card.lifecycle.onVisibility(() => this.schedule())
    )
    await this.load()
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.timer) clearTimeout(this.timer)
  }

  /** (Re)reads the connected agents. */
  async load(): Promise<void> {
    if (!this.supported) return
    try {
      this.bind(await this.card.agents.list())
    } catch (error) {
      this.update({
        phase: 'error',
        error: isCardSdkError(error) ? error.hostMessage : String(error)
      })
    }
  }

  private bind(agents: AgentInfo[]): void {
    const connected = agents.filter((agent) => agent.kind === 'ai' && agent.connected)
    if (connected.length === 0) {
      this.update({ phase: 'empty', lanes: [] })
      this.schedule()
      return
    }
    if (!this.card.permissions.has('usage.read')) {
      this.update({
        phase: 'permission',
        lanes: connected.map((agent) => ({ agent, timeline: null }))
      })
      return
    }
    const previous = new Map(this.snapshot.lanes.map((lane) => [lane.agent.id, lane.timeline]))
    this.update({
      phase: this.snapshot.phase === 'ready' ? 'ready' : 'loading',
      lanes: connected.map((agent) => ({ agent, timeline: previous.get(agent.id) ?? null }))
    })
    void this.refresh()
  }

  /** Asks for the optional permission (the card must be on screen). */
  async allow(): Promise<boolean> {
    try {
      await this.card.permissions.request('usage.read')
    } catch (error) {
      this.card.log.warn('usage.read not granted', error)
    }
    await this.load()
    return this.card.permissions.has('usage.read')
  }

  async setWindow(key: RequestWindowKey): Promise<void> {
    this.update({ windowKey: key })
    await this.card.storage.set(WINDOW_STORAGE_KEY, key as JsonValue).catch(() => {})
    await this.refresh()
  }

  sinceOf(key = this.snapshot.windowKey, now = this.now()): number {
    const ms = REQUEST_WINDOWS[key]
    return ms === 0 ? 0 : Math.max(0, now - ms)
  }

  /** Fetches every lane's timeline (one round at a time; a call meanwhile runs once more). */
  refresh(): Promise<void> {
    if (this.fetching) {
      this.again = true
      return this.fetching
    }
    this.fetching = this.fetchAll().finally(() => {
      this.fetching = null
      if (this.again) {
        this.again = false
        void this.refresh()
      } else this.schedule()
    })
    return this.fetching
  }

  private async fetchAll(): Promise<void> {
    const lanes = this.snapshot.lanes
    if (lanes.length === 0 || !this.card.permissions.has('usage.read')) return
    const now = this.now()
    const since = this.sinceOf(this.snapshot.windowKey, now)
    const results = await Promise.all(
      lanes.map(async (lane) => {
        try {
          return await this.card.agents.timeline(lane.agent.id, since, now)
        } catch (error) {
          if (isCardSdkError(error, 'RATE_LIMITED')) return lane.timeline
          if (isCardSdkError(error, 'NOT_CONNECTED')) return null
          throw error
        }
      })
    ).catch((error: unknown) => {
      this.update({
        phase: 'error',
        error: isCardSdkError(error) ? error.hostMessage : String(error)
      })
      return null
    })
    if (!results) return
    // The lanes may have changed meanwhile: match by agent.
    const byAgent = new Map(lanes.map((lane, i) => [lane.agent.id, results[i]]))
    this.update({
      phase: 'ready',
      error: null,
      fetchedAt: now,
      lanes: this.snapshot.lanes.map((lane) => ({
        agent: {
          ...lane.agent,
          status: byAgent.get(lane.agent.id)?.statuses.at(-1)?.status ?? lane.agent.status
        },
        timeline: byAgent.has(lane.agent.id) ? (byAgent.get(lane.agent.id) ?? null) : lane.timeline
      }))
    })
  }

  /** Any lane in a turn right now. */
  get live(): boolean {
    return this.snapshot.lanes.some((lane) => {
      const status = lane.timeline?.statuses.at(-1)?.status ?? lane.agent.status
      return status === 'working' || status === 'needs-input'
    })
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.snapshot.lanes.length === 0) return
    const visibility = this.card.context.visibility
    if (visibility === 'hidden') return
    const delay =
      visibility === 'visible'
        ? this.live
          ? REQUESTS_POLL_MS.live
          : REQUESTS_POLL_MS.idle
        : REQUESTS_POLL_MS.overview
    this.timer = setTimeout(() => void this.refresh(), delay)
  }
}
