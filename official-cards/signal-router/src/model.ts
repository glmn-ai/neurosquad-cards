// The router's rules and its inspector, as pure functions. The controller feeds
// messages in; the UI and the tests read what happened out.
import {
  pickInputFor,
  portsCompatible,
  type JsonValue,
  type PeerInfo,
  type PortInfo,
  type PortTypeId
} from '@neurosquad/card-sdk'

export type MatchKind = 'any' | 'contains' | 'field' | 'source' | 'type'
export type Format = 'text' | 'json' | 'event'

export interface Rule {
  id: string
  name: string
  enabled: boolean
  match: {
    kind: MatchKind
    /** contains: text to look for (case-insensitive); field: expected value (equals or contains). */
    text?: string
    /** field: dot path into the message ("data.agent", "items.0.text"). */
    path?: string
    /** source: the sending card's id. */
    source?: string
    /** type: the sender's output type ("ns:event"). */
    type?: string
  }
  /** Downstream peer card id. */
  target: string
  /** Explicit input on the target; empty = let the host pick (pickInputFor). */
  input?: string
  format: Format
  /** format text: `{{path}}` placeholders; `{{.}}` = the whole value. */
  template?: string
  /** format event: the event type. */
  eventType?: string
  /** Deliveries per minute this rule may make (the rest are dropped and counted). */
  perMinute: number
}

export interface RouterConfig {
  version: 1
  rules: Rule[]
  /** `first`: the first matching rule wins. `all`: every matching rule fires. */
  mode: 'first' | 'all'
}

export const OUTPUT_FOR: Record<Format, { port: string; type: PortTypeId }> = {
  text: { port: 'text', type: 'ns:markdown' },
  json: { port: 'json', type: 'ns:json' },
  event: { port: 'event', type: 'ns:event' }
}

export function defaultConfig(): RouterConfig {
  return { version: 1, rules: [], mode: 'first' }
}

export function restoreConfig(raw: unknown): RouterConfig {
  if (!raw || typeof raw !== 'object' || (raw as RouterConfig).version !== 1) return defaultConfig()
  const config = raw as RouterConfig
  return {
    version: 1,
    mode: config.mode === 'all' ? 'all' : 'first',
    rules: Array.isArray(config.rules) ? config.rules.filter((rule) => rule && rule.id) : []
  }
}

let ruleCounter = 0
export function newRule(target: string, patch: Partial<Rule> = {}): Rule {
  return {
    id: `r${Date.now().toString(36)}${(ruleCounter++).toString(36)}`,
    name: '',
    enabled: true,
    match: { kind: 'any' },
    target,
    format: 'text',
    template: '{{.}}',
    perMinute: 10,
    ...patch
  }
}

// --- messages ----------------------------------------------------------------------

export interface Route {
  ruleId: string
  ruleName: string
  to: string
  toName: string
  input: string | null
  output: string
  ok: boolean
  /** Why it did not go: disconnected, loop, rate-limited, permission, incompatible, or the host's error. */
  reason?: string
}

export interface InspectedMessage {
  seq: number
  from: string
  fromName: string
  fromKind: string
  /** The sender's output port and its declared type (from the peer list), else the input's type. */
  output: string
  type: string
  data: JsonValue
  at: number
  size: number
  routes: Route[]
  /** Set when no rule took it. */
  dropped?: 'no-rule' | 'disabled'
}

export const INSPECTOR_SIZE = 50
export const PERSISTED_MESSAGES = 10

/** Serialized size in bytes (UTF-8). */
export function jsonSize(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length
}

/** A value at a dot path: "data.agent", "items.0.text". Undefined when absent. */
export function valueAtPath(data: JsonValue, path: string): JsonValue | undefined {
  if (!path || path === '.') return data
  let current: JsonValue | undefined = data
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? current[Number(part)] : (current as Record<string, JsonValue>)[part]
    if (current === undefined) return undefined
  }
  return current
}

function asText(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function ruleMatches(rule: Rule, message: Pick<InspectedMessage, 'from' | 'type' | 'data'>): boolean {
  const m = rule.match
  switch (m.kind) {
    case 'any':
      return true
    case 'contains':
      return !!m.text && asText(message.data).toLowerCase().includes(m.text.toLowerCase())
    case 'field': {
      const value = valueAtPath(message.data, m.path ?? '')
      if (value === undefined) return false
      if (!m.text) return true // "has the field"
      const text = asText(value)
      return text === m.text || text.toLowerCase().includes(m.text.toLowerCase())
    }
    case 'source':
      return !!m.source && message.from === m.source
    case 'type':
      return !!m.type && message.type === m.type
  }
}

/** `{{path}}` placeholders; `{{.}}` is the whole value (strings as is, the rest as JSON). */
export function renderTemplate(template: string, data: JsonValue): string {
  return template.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, path: string) =>
    path === '.' || path === ''
      ? typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2)
      : asText(valueAtPath(data, path))
  )
}

/** What a rule sends: which output, and the value shaped for it. */
export function shape(
  rule: Rule,
  message: Pick<InspectedMessage, 'data' | 'at'>
): { output: string; type: PortTypeId; data: JsonValue } {
  const { port: output, type } = OUTPUT_FOR[rule.format]
  switch (rule.format) {
    case 'text':
      return { output, type, data: renderTemplate(rule.template || '{{.}}', message.data) }
    case 'json':
      return {
        output,
        type,
        data:
          message.data !== null && typeof message.data === 'object'
            ? message.data
            : { value: message.data }
      }
    case 'event':
      return { output, type, data: { type: rule.eventType || 'signal', data: message.data, at: message.at } }
  }
}

// --- peers --------------------------------------------------------------------------

export interface TargetCheck {
  connected: boolean
  /** The input the value would land on (explicit or picked). */
  input: PortInfo | null
  compatible: boolean
  /** Permission our card needs for that input (built-in cards), if any. */
  permission?: PortInfo['permission']
}

/** Can this rule deliver to its target, and where would it land? */
export function checkTarget(rule: Rule, peers: readonly PeerInfo[]): TargetCheck {
  const peer = peers.find((p) => p.cardId === rule.target && p.direction !== 'upstream')
  if (!peer) return { connected: false, input: null, compatible: false }
  const type = OUTPUT_FOR[rule.format].type
  const input = rule.input
    ? (peer.inputs.find((i) => i.id === rule.input) ?? null)
    : pickInputFor(type, peer.inputs)
  const compatible = !!input && input.mode === 'stream' && portsCompatible(type, input.type)
  return {
    connected: true,
    input,
    compatible,
    ...(input?.permission ? { permission: input.permission } : {})
  }
}

/** Which of our three outputs reach any input of this peer. */
export function compatibleFormats(peer: PeerInfo): Format[] {
  return (Object.keys(OUTPUT_FOR) as Format[]).filter((format) =>
    peer.inputs.some(
      (input) => input.mode === 'stream' && portsCompatible(OUTPUT_FOR[format].type, input.type)
    )
  )
}

// --- rate limit -----------------------------------------------------------------------

export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  allow(key: string, perMinute: number, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < 60_000)
    if (recent.length >= Math.max(1, perMinute)) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}

// --- schema inference ------------------------------------------------------------------

/**
 * A structural description of a value, TypeScript-like:
 * `{ type: string; data: { agent: string; durationMs: number } }`.
 * Arrays show the union of their items' shapes (first 20 looked at).
 */
export function inferShape(value: JsonValue, depth = 0): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'unknown[]'
    const shapes = [...new Set(value.slice(0, 20).map((item) => inferShape(item, depth + 1)))]
    const inner = shapes.length === 1 ? shapes[0] : `(${shapes.join(' | ')})`
    return `${inner}[]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    if (depth >= 4) return '{ … }'
    const pad = '  '.repeat(depth + 1)
    const fields = keys
      .slice(0, 24)
      .map((key) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${inferShape(value[key] as JsonValue, depth + 1)}`)
    if (keys.length > 24) fields.push(`${pad}… ${keys.length - 24} more`)
    return `{\n${fields.join('\n')}\n${'  '.repeat(depth)}}`
  }
  return typeof value
}

/** One-line preview of a value. */
export function preview(value: JsonValue, max = 90): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ') : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
