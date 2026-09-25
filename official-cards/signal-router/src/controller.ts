// The router, without React: receives on `in`, routes by the rules with
// explicit per-peer delivery (ports.send), answers `last`, keeps the inspector,
// persists rules/counters, and drives the badge, status and overview tile.
import {
  createTranslator,
  isCardSdkError,
  type Card,
  type CardEvents,
  type JsonValue,
  type PeerInfo,
  type PermissionId,
  type Translator
} from '@neurosquad/card-sdk'
import { catalog } from './i18n'
import {
  checkTarget,
  defaultConfig,
  INSPECTOR_SIZE,
  jsonSize,
  PERSISTED_MESSAGES,
  RateLimiter,
  restoreConfig,
  ruleMatches,
  shape,
  type InspectedMessage,
  type Route,
  type Rule,
  type RouterConfig
} from './model'

export const CONFIG_KEY = 'config'
export const STATE_KEY = 'state'

interface Counters {
  routed: number
  dropped: number
  /** Per rule: deliveries made. */
  hits: Record<string, number>
}

export interface RouterSnapshot {
  phase: 'loading' | 'error' | 'ready'
  error: string | null
  config: RouterConfig
  messages: InspectedMessage[]
  counters: Counters
  /** Drops since the user last looked at the inspector (the badge). */
  unseenDrops: number
  peers: PeerInfo[]
  paused: boolean
  /** seq of the newest message (drives the row flash). */
  lastSeq: number
}

export class RouterController {
  readonly card: Card
  readonly t: Translator
  private snap: RouterSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly disposers: (() => void)[] = []
  private readonly limiter = new RateLimiter()
  private seq = 0
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private lastChrome = ''
  private readonly now: () => number

  constructor(card: Card, options: { now?: () => number } = {}) {
    this.card = card
    this.now = options.now ?? Date.now
    this.t = createTranslator(catalog, card)
    this.snap = {
      phase: 'loading',
      error: null,
      config: defaultConfig(),
      messages: [],
      counters: { routed: 0, dropped: 0, hits: {} },
      unseenDrops: 0,
      peers: card.ports.peers,
      paused: false,
      lastSeq: 0
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): RouterSnapshot => this.snap

  private update(patch: Partial<RouterSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const listener of this.listeners) listener()
    this.refreshChrome()
  }

  // --- lifecycle -------------------------------------------------------------------

  async start(): Promise<void> {
    const card = this.card
    this.disposers.push(
      // Messages that arrive before load() finishes are buffered by the SDK (up to 100).
      card.ports.onPeersChanged((peers) => this.update({ peers })),
      card.ports.onRequest('last', () => this.lastReply()),
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
    await this.load()
  }

  async load(): Promise<void> {
    this.update({ phase: 'loading', error: null })
    try {
      const [config, state] = await Promise.all([
        this.card.storage.get(CONFIG_KEY),
        this.card.storage.get(STATE_KEY)
      ])
      const saved = (state ?? {}) as { counters?: Counters; messages?: InspectedMessage[]; paused?: boolean }
      const messages = Array.isArray(saved.messages) ? saved.messages : []
      this.seq = messages.reduce((max, m) => Math.max(max, m.seq), 0)
      this.update({
        phase: 'ready',
        config: restoreConfig(config),
        counters: saved.counters ?? { routed: 0, dropped: 0, hits: {} },
        messages,
        paused: saved.paused === true,
        peers: this.card.ports.peers
      })
      if (!this.offMessage) {
        this.offMessage = this.card.ports.onMessage((data, message) => void this.receive(data, message), {
          input: 'in'
        })
        this.disposers.push(this.offMessage)
      }
      void this.setMenu()
    } catch (error) {
      this.update({
        phase: 'error',
        error: isCardSdkError(error) ? error.hostMessage : String(error)
      })
      void this.card.setOverview({ primary: this.t('error.title'), tone: 'danger', icon: 'link' })
    }
  }

  private offMessage: (() => void) | null = null

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.t.dispose()
  }

  // --- routing ------------------------------------------------------------------------

  private peerName(id: string): string {
    return this.snap.peers.find((p) => p.cardId === id)?.name ?? id
  }

  /** One message on `in`: inspect it, route it, remember it. */
  async receive(data: JsonValue, message: CardEvents['ports.message']): Promise<InspectedMessage> {
    const sender = this.snap.peers.find((p) => p.cardId === message.from)
    // The event carries the type after coercion (ns:any here); the sender's
    // declared output type is in the peer list.
    const type = sender?.outputs.find((o) => o.id === message.output)?.type ?? message.type
    const inspected: InspectedMessage = {
      seq: ++this.seq,
      from: message.from,
      fromName: sender?.name ?? message.from,
      fromKind: message.fromKind,
      output: message.output,
      type,
      data,
      at: message.at,
      size: jsonSize(data),
      routes: []
    }
    this.push(inspected)
    if (this.snap.paused) {
      inspected.dropped = 'disabled'
    } else {
      const matching = this.snap.config.rules.filter((rule) => rule.enabled && ruleMatches(rule, inspected))
      const firing = this.snap.config.mode === 'first' ? matching.slice(0, 1) : matching
      if (firing.length === 0) inspected.dropped = 'no-rule'
      for (const rule of firing) inspected.routes.push(await this.deliver(rule, inspected))
    }
    const delivered = inspected.routes.filter((r) => r.ok).length
    const failed = inspected.routes.length - delivered + (inspected.dropped ? 1 : 0)
    const hits = { ...this.snap.counters.hits }
    for (const route of inspected.routes) if (route.ok) hits[route.ruleId] = (hits[route.ruleId] ?? 0) + 1
    this.update({
      messages: this.snap.messages.map((m) => (m.seq === inspected.seq ? { ...inspected } : m)),
      counters: {
        routed: this.snap.counters.routed + delivered,
        dropped: this.snap.counters.dropped + (failed > 0 && delivered === 0 ? 1 : 0),
        hits
      },
      unseenDrops: this.snap.unseenDrops + (failed > 0 && delivered === 0 ? 1 : 0)
    })
    this.scheduleSave()
    return inspected
  }

  private push(message: InspectedMessage): void {
    const messages = [message, ...this.snap.messages].slice(0, INSPECTOR_SIZE)
    this.update({ messages, lastSeq: message.seq })
  }

  private async deliver(rule: Rule, message: InspectedMessage): Promise<Route> {
    const base = {
      ruleId: rule.id,
      ruleName: rule.name,
      to: rule.target,
      toName: this.peerName(rule.target),
      input: null as string | null
    }
    const shaped = shape(rule, message)
    const fail = (reason: string): Route => ({ ...base, output: shaped.output, ok: false, reason })
    if (message.from === rule.target) return fail('loop')
    const check = checkTarget(rule, this.snap.peers)
    if (!check.connected) return fail('disconnected')
    if (!check.compatible || !check.input) return fail('incompatible')
    base.input = check.input.id
    if (check.permission && !this.card.permissions.has(check.permission)) return fail('permission')
    const perMinute = check.permission === 'agents.prompt' ? Math.min(rule.perMinute, 6) : rule.perMinute
    if (!this.limiter.allow(rule.id, perMinute, this.now())) return fail('rate-limited')
    try {
      const count = await this.card.ports.send(rule.target, shaped.output, shaped.data, {
        input: check.input.id
      })
      return count > 0 ? { ...base, output: shaped.output, ok: true } : fail('incompatible')
    } catch (error) {
      return fail(isCardSdkError(error) ? `${error.code}: ${error.hostMessage}` : String(error))
    }
  }

  private lastReply(): JsonValue {
    const last = this.snap.messages[0]
    return {
      last: last ? { from: last.fromName, type: last.type, data: last.data, at: last.at } : null,
      routed: this.snap.counters.routed,
      dropped: this.snap.counters.dropped,
      rules: this.snap.config.rules.filter((r) => r.enabled).length
    }
  }

  // --- editing -------------------------------------------------------------------------

  /**
   * Saves a rule. When its target is a built-in card that needs a permission we
   * do not have yet, asks for it right here (the user just clicked Save, so the
   * card is visible).
   */
  async saveRule(rule: Rule): Promise<void> {
    const rules = this.snap.config.rules.some((r) => r.id === rule.id)
      ? this.snap.config.rules.map((r) => (r.id === rule.id ? rule : r))
      : [...this.snap.config.rules, rule]
    await this.setConfig({ ...this.snap.config, rules })
    await this.ensurePermission(rule)
  }

  async ensurePermission(rule: Rule): Promise<boolean> {
    const permission = checkTarget(rule, this.snap.peers).permission as PermissionId | undefined
    if (!permission || this.card.permissions.has(permission)) return true
    try {
      const granted = await this.card.permissions.request(permission)
      this.update({}) // re-render the rule's badge
      return granted.includes(permission)
    } catch (error) {
      this.card.log.warn('permission request failed', error)
      return false
    }
  }

  async deleteRule(id: string): Promise<void> {
    await this.setConfig({ ...this.snap.config, rules: this.snap.config.rules.filter((r) => r.id !== id) })
  }

  async toggleRule(id: string): Promise<void> {
    await this.setConfig({
      ...this.snap.config,
      rules: this.snap.config.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    })
  }

  async setMode(mode: RouterConfig['mode']): Promise<void> {
    await this.setConfig({ ...this.snap.config, mode })
  }

  private async setConfig(config: RouterConfig): Promise<void> {
    this.update({ config })
    await this.card.storage.set(CONFIG_KEY, config as unknown as JsonValue)
  }

  markSeen(): void {
    if (this.snap.unseenDrops > 0) this.update({ unseenDrops: 0 })
  }

  async clearInspector(): Promise<void> {
    this.update({ messages: [], counters: { routed: 0, dropped: 0, hits: {} }, unseenDrops: 0 })
    await this.flush(true)
  }

  setPaused(paused: boolean): void {
    this.update({ paused })
    void this.setMenu()
    this.scheduleSave()
  }

  private async setMenu(): Promise<void> {
    await this.card.ui
      .setMenu([
        this.snap.paused
          ? { id: 'resume', label: this.t('menu.resume'), icon: 'play', onSelect: () => this.setPaused(false) }
          : { id: 'pause', label: this.t('menu.pause'), icon: 'pause', onSelect: () => this.setPaused(true) },
        { id: 'clear', label: this.t('menu.clear'), icon: 'trash', onSelect: () => void this.clearInspector() }
      ])
      .catch((error: unknown) => this.card.log.warn('menu', error))
  }

  // --- chrome ---------------------------------------------------------------------------

  private refreshChrome(): void {
    if (this.snap.phase !== 'ready') return
    const t = this.t
    const { routed, dropped } = this.snap.counters
    const rules = this.snap.config.rules.filter((r) => r.enabled).length
    const key = JSON.stringify([t.language, routed, dropped, rules, this.snap.unseenDrops, this.snap.paused])
    if (key === this.lastChrome) return
    this.lastChrome = key
    void this.card.setBadge(this.snap.unseenDrops > 0 ? this.snap.unseenDrops : null, { tone: 'warning' })
    void this.card.setStatus(this.snap.paused ? t('status.paused') : null, { tone: 'warning' })
    void this.card.setOverview({
      primary: routed + dropped === 0 && rules === 0 ? t('overview.idle') : t('overview.primary', { count: routed, rules }),
      secondary: dropped > 0 ? t('overview.dropped', { count: dropped }) : null,
      tone: this.snap.paused || this.snap.unseenDrops > 0 ? 'warning' : routed > 0 ? 'accent' : 'default',
      icon: 'link'
    })
  }

  // --- persistence -------------------------------------------------------------------

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => void this.flush(), 2000)
  }

  async flush(force = false): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (this.snap.phase !== 'ready' && !force) return
    // Only the newest few messages survive a reload — enough to see what just happened.
    const messages = this.snap.messages
      .slice(0, PERSISTED_MESSAGES)
      .filter((m) => m.size <= 64 * 1024)
    try {
      await this.card.storage.set(STATE_KEY, {
        counters: this.snap.counters,
        messages,
        paused: this.snap.paused
      } as unknown as JsonValue)
    } catch (error) {
      this.card.log.warn('could not save', error)
    }
  }
}
