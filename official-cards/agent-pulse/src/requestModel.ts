// The "Requests" view's pure part: per-lane statistics, the time axis and
// bar geometry from the app's `agents.timeline` data. No host, no React; the
// same data always draws the same picture (deterministic for recordings).
import type { AgentRequestSpan, AgentTimeline } from '@neurosquad/card-sdk'

export interface LaneStats {
  requests: number
  /** Requests with a send time (their duration is known). */
  timed: number
  /** Sum of the timed requests' durations. */
  modelMs: number
  avgMs: number | null
  medianMs: number | null
  longest: { ms: number; at: number } | null
  inputTokens: number | null
  outputTokens: number | null
  /** Counted turns (prompts). */
  prompts: number
  /** Contract 1.3: requests made by the agent's subagents (already in `requests`); 0 on older apps. */
  subagentRequests: number
  /** Distinct subagents that made those requests. */
  subagents: number
}

export const durationOf = (request: AgentRequestSpan): number | null =>
  request.startedAt === null ? null : Math.max(0, request.endedAt - request.startedAt)

/** Integers only; null when no request reports the number. */
function sumOrNull(values: (number | null)[]): number | null {
  let total: number | null = null
  for (const value of values) if (value !== null) total = (total ?? 0) + value
  return total
}

export function laneStats(timeline: AgentTimeline): LaneStats {
  const durations: { ms: number; at: number }[] = []
  for (const request of timeline.requests) {
    const ms = durationOf(request)
    if (ms !== null) durations.push({ ms, at: request.endedAt })
  }
  const sorted = durations.map((d) => d.ms).sort((a, b) => a - b)
  const modelMs = sorted.reduce((sum, ms) => sum + ms, 0)
  const mid = Math.floor(sorted.length / 2)
  const medianMs =
    sorted.length === 0
      ? null
      : sorted.length % 2
        ? sorted[mid]
        : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  let longest: LaneStats['longest'] = null
  for (const d of durations) if (!longest || d.ms > longest.ms) longest = d
  return {
    requests: timeline.requests.length,
    timed: durations.length,
    modelMs,
    avgMs: sorted.length ? Math.round(modelMs / sorted.length) : null,
    medianMs,
    longest,
    inputTokens: sumOrNull(timeline.requests.map((r) => r.inputTokens)),
    outputTokens: sumOrNull(timeline.requests.map((r) => r.outputTokens)),
    prompts: timeline.turns.filter((turn) => turn.counted).length,
    subagentRequests: timeline.requests.filter((r) => r.subagent).length,
    subagents: new Set(timeline.requests.flatMap((r) => (r.subagent ? [r.subagent.id] : []))).size
  }
}

/**
 * Where a lane's bars sit (SVG units, the track is 100 high). A lane with
 * subagent requests gets a thin sub-lane under the agent's own: subagent
 * requests often run while the parent waits on them, so they get their own
 * row instead of overlapping. Without any (or on an app before contract 1.3)
 * the lane is drawn exactly as before.
 */
export interface LaneGeometry {
  main: { base: number; max: number }
  sub: { base: number; max: number } | null
}

export function laneGeometry(timeline: AgentTimeline | null): LaneGeometry {
  if (!timeline?.requests.some((r) => r.subagent)) return { main: { base: 85, max: 70 }, sub: null }
  return { main: { base: 62, max: 50 }, sub: { base: 96, max: 26 } }
}

/** The span of everything worth showing: the first prompt / request → the last end (or now). */
export function dataExtent(
  timelines: readonly AgentTimeline[],
  now: number
): { from: number; to: number; origin: number } | null {
  let from = Infinity
  let to = -Infinity
  for (const timeline of timelines) {
    for (const turn of timeline.turns) {
      if (!turn.counted) continue
      from = Math.min(from, turn.start)
      to = Math.max(to, turn.end ?? now)
    }
    for (const request of timeline.requests) {
      from = Math.min(from, request.startedAt ?? request.endedAt)
      to = Math.max(to, request.endedAt)
    }
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  const origin = from
  if (to - from < 5000) to = from + 5000
  // A little air on both sides.
  const pad = (to - from) * 0.02
  return { from: from - pad, to: to + pad, origin }
}

/** Round tick step for an axis `span` ms wide with about `count` ticks. */
export function tickStep(span: number, count = 6): number {
  const steps = [
    1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000,
    3_600_000, 7_200_000, 14_400_000
  ]
  const raw = span / Math.max(1, count)
  return steps.find((step) => step >= raw) ?? steps[steps.length - 1]
}

export function ticks(from: number, to: number, count = 6): number[] {
  const step = tickStep(to - from, count)
  const first = Math.ceil(from / step) * step
  const out: number[] = []
  for (let t = first; t <= to; t += step) out.push(t)
  return out
}

/** Axis label relative to the view start: 0:00, 1:30, 12:05, 1:02:00. */
export function relLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Bar height share for `tokens` against the lane's largest (square root, so small ones stay visible). */
export function barHeight(tokens: number | null, max: number): number {
  if (tokens === null || max <= 0) return 0.5
  return 0.28 + 0.72 * Math.sqrt(Math.min(1, tokens / max))
}

const UNITS = {
  en: { ms: 'ms', s: 's', m: 'm', sep: ' ' },
  ru: { ms: 'мс', s: 'с', m: 'мин', sep: ' ' },
  zh: { ms: '毫秒', s: '秒', m: '分', sep: '' }
} as const

/** Duration for tooltips and stats: 850 ms, 4.2 s, 3 m 05 s (in the app language). */
export function shortDuration(ms: number, lang: 'en' | 'ru' | 'zh' = 'en'): string {
  const u = UNITS[lang] ?? UNITS.en
  if (ms < 1000) return `${Math.round(ms)}${u.sep}${u.ms}`
  if (ms < 60_000) {
    const s = (ms / 1000).toFixed(ms < 10_000 ? 1 : 0)
    return `${lang === 'ru' ? s.replace('.', ',') : s}${u.sep}${u.s}`
  }
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}${u.sep}${u.m} ${String(total % 60).padStart(2, '0')}${u.sep}${u.s}`
}

/** Zoom the view around `at` by `factor` (<1 zooms in), never past the minimum span. */
export function zoomView(
  view: { from: number; to: number },
  at: number,
  factor: number,
  minSpan = 2000
): { from: number; to: number } {
  const span = Math.max(minSpan, (view.to - view.from) * factor)
  const ratio = (at - view.from) / (view.to - view.from)
  const from = at - span * ratio
  return { from, to: from + span }
}
