// The pulse model: pure functions over a small, serializable history.
// No SDK calls here — the controller feeds events in, the UI and the tool
// read summaries out, and the unit tests drive it with a fake clock.
import type { AgentInfo, AgentStatus } from '@neurosquad/card-sdk'

/** One stretch of time an agent spent in one status. `to: null` = still in it. */
export interface Segment {
  status: AgentStatus
  from: number
  to: number | null
}

/** A finished turn (from `agents.turn` start → end). */
export interface Turn {
  agentId: string
  start: number
  end: number
  endedAs: 'finished' | 'needs-input'
}

export interface AgentMeta {
  id: string
  name: string
  harness: string
  kind: 'ai' | 'shell'
  /** Still on the canvas. Removed agents keep their history for the stats. */
  present: boolean
  model?: string
}

export interface PulseHistory {
  version: 1
  agents: Record<string, AgentMeta>
  segments: Record<string, Segment[]>
  turns: Turn[]
  /** Open turns: agentId → start. */
  openTurns: Record<string, number>
  savedAt: number
}

export const HISTORY_KEEP_MS = 24 * 60 * 60 * 1000
export const MAX_SEGMENTS_PER_AGENT = 400
export const MAX_TURNS = 600
/** A status seen again this soon after the card stopped is treated as uninterrupted. */
export const REOPEN_WITHIN_MS = 2 * 60_000

export function emptyHistory(now: number): PulseHistory {
  return { version: 1, agents: {}, segments: {}, turns: [], openTurns: {}, savedAt: now }
}

/**
 * A history loaded from storage. Open segments are closed at the moment it was
 * saved: what happened while the card was not running is unknown, and a gap is
 * more honest than a bar that pretends to know.
 */
export function restoreHistory(raw: unknown, now: number): PulseHistory {
  if (!raw || typeof raw !== 'object' || (raw as PulseHistory).version !== 1) return emptyHistory(now)
  const history = structuredClone(raw) as PulseHistory
  const closedAt = Math.min(history.savedAt ?? now, now)
  for (const list of Object.values(history.segments)) {
    const last = list[list.length - 1]
    if (last && last.to === null) last.to = Math.max(last.from, closedAt)
  }
  history.openTurns = {}
  for (const meta of Object.values(history.agents)) meta.present = false
  return trimHistory(history, now)
}

/** Current status of an agent as far as the history knows. */
export function currentSegment(history: PulseHistory, agentId: string): Segment | undefined {
  const list = history.segments[agentId]
  const last = list?.[list.length - 1]
  return last && last.to === null ? last : undefined
}

/** Records a status. Same status as now = no-op (the host repeats itself sometimes). */
export function applyStatus(
  history: PulseHistory,
  agentId: string,
  status: AgentStatus,
  at: number
): boolean {
  const list = (history.segments[agentId] ??= [])
  const open = list[list.length - 1]
  if (open && open.to === null) {
    if (open.status === status) return false
    open.to = Math.max(open.from, at)
  }
  list.push({ status, from: at, to: null })
  if (list.length > MAX_SEGMENTS_PER_AGENT) list.splice(0, list.length - MAX_SEGMENTS_PER_AGENT)
  return true
}

export function applyTurn(
  history: PulseHistory,
  agentId: string,
  phase: 'start' | 'end',
  at: number,
  endedAs: 'finished' | 'needs-input' = 'finished'
): Turn | null {
  if (phase === 'start') {
    history.openTurns[agentId] = at
    return null
  }
  const start = history.openTurns[agentId]
  delete history.openTurns[agentId]
  if (start === undefined || at < start) return null
  const turn: Turn = { agentId, start, end: at, endedAs }
  history.turns.push(turn)
  if (history.turns.length > MAX_TURNS) history.turns.splice(0, history.turns.length - MAX_TURNS)
  return turn
}

/**
 * Merges a fresh agent list: new agents get a segment from `turnStartedAt`
 * (working) or now; agents missing from the list are marked gone and their
 * open segment closed.
 */
export function syncAgents(history: PulseHistory, agents: AgentInfo[], now: number): void {
  const seen = new Set<string>()
  for (const agent of agents) {
    seen.add(agent.id)
    history.agents[agent.id] = {
      id: agent.id,
      name: agent.name,
      harness: agent.harness,
      kind: agent.kind,
      present: true,
      ...(agent.model ? { model: agent.model } : {})
    }
    let open = currentSegment(history, agent.id)
    const last = history.segments[agent.id]?.at(-1)
    if (!open && last && last.to !== null && last.status === agent.status) {
      // Closed when the card last stopped. The same status a moment later (a
      // reload, a short suspension) or the same turn still running → continue it.
      const sameTurn =
        agent.status === 'working' &&
        agent.turnStartedAt !== undefined &&
        agent.turnStartedAt >= last.from &&
        agent.turnStartedAt <= last.to
      if (sameTurn || now - last.to < REOPEN_WITHIN_MS) {
        last.to = null
        open = last
      }
    }
    if (!open || open.status !== agent.status) {
      const since =
        agent.status === 'working' && agent.turnStartedAt && agent.turnStartedAt <= now
          ? agent.turnStartedAt
          : now
      applyStatus(history, agent.id, agent.status, Math.max(since, open?.from ?? 0))
    }
    if (agent.status === 'working' && history.openTurns[agent.id] === undefined) {
      history.openTurns[agent.id] = agent.turnStartedAt ?? now
    }
  }
  for (const meta of Object.values(history.agents)) {
    if (seen.has(meta.id)) continue
    meta.present = false
    const open = currentSegment(history, meta.id)
    if (open) open.to = Math.max(open.from, now)
    delete history.openTurns[meta.id]
  }
}

/** Drops what is older than a day, and agents with nothing left. */
export function trimHistory(history: PulseHistory, now: number): PulseHistory {
  const cutoff = now - HISTORY_KEEP_MS
  for (const [id, list] of Object.entries(history.segments)) {
    const kept = list.filter((segment) => segment.to === null || segment.to > cutoff)
    if (kept.length > 0) history.segments[id] = kept
    else delete history.segments[id]
  }
  history.turns = history.turns.filter((turn) => turn.end > cutoff)
  for (const meta of Object.values(history.agents)) {
    const used = history.segments[meta.id] || history.turns.some((turn) => turn.agentId === meta.id)
    if (!meta.present && !used) delete history.agents[meta.id]
  }
  return history
}

// --- summaries ------------------------------------------------------------------

/** How long a segment overlaps [from, to]. */
function overlap(segment: Segment, from: number, to: number, now: number): number {
  const end = segment.to ?? now
  return Math.max(0, Math.min(end, to) - Math.max(segment.from, from))
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export interface AgentSummary {
  meta: AgentMeta
  status: AgentStatus
  /** When the current status began (null when unknown). */
  since: number | null
  turns: number
  medianTurnMs: number | null
  busyMs: number
  waitingMs: number
  /** Share of the window spent working, 0..1. */
  busyShare: number
  /** Durations of the last turns, oldest first (for the spark bars). */
  recentTurns: number[]
}

export interface PulseSummary {
  now: number
  windowMs: number
  agents: AgentSummary[]
  counts: Record<AgentStatus, number>
  turns: number
  medianTurnMs: number | null
  longestTurn: { ms: number; agent: string } | null
  /** Total time agents spent waiting for the user in the window. */
  waitingMs: number
  /** The agent waiting the longest right now. */
  longestWaiting: { name: string; ms: number } | null
}

export function summarize(
  history: PulseHistory,
  now: number,
  windowMs: number,
  options: { includeShells?: boolean } = {}
): PulseSummary {
  const from = now - windowMs
  const counts: Record<AgentStatus, number> = {
    working: 0,
    'needs-input': 0,
    finished: 0,
    idle: 0,
    exited: 0
  }
  const agents: AgentSummary[] = []
  const windowTurns = history.turns.filter((turn) => turn.end > from)
  let waitingMs = 0
  let longestWaiting: PulseSummary['longestWaiting'] = null
  for (const meta of Object.values(history.agents)) {
    if (!meta.present) continue
    if (meta.kind === 'shell' && !options.includeShells) continue
    const segments = history.segments[meta.id] ?? []
    const open = currentSegment(history, meta.id)
    const status = open?.status ?? 'idle'
    counts[status]++
    let busyMs = 0
    let agentWaiting = 0
    for (const segment of segments) {
      if (segment.status === 'working') busyMs += overlap(segment, from, now, now)
      if (segment.status === 'needs-input') agentWaiting += overlap(segment, from, now, now)
    }
    waitingMs += agentWaiting
    if (open && status === 'needs-input') {
      const ms = now - open.from
      if (!longestWaiting || ms > longestWaiting.ms) longestWaiting = { name: meta.name, ms }
    }
    const mine = windowTurns.filter((turn) => turn.agentId === meta.id)
    const allMine = history.turns.filter((turn) => turn.agentId === meta.id)
    agents.push({
      meta,
      status,
      since: open?.from ?? null,
      turns: mine.length,
      medianTurnMs: median(mine.map((turn) => turn.end - turn.start)),
      busyMs,
      waitingMs: agentWaiting,
      busyShare: windowMs > 0 ? Math.min(1, busyMs / windowMs) : 0,
      recentTurns: allMine.slice(-12).map((turn) => turn.end - turn.start)
    })
  }
  const order: Record<AgentStatus, number> = {
    'needs-input': 0,
    working: 1,
    finished: 2,
    idle: 3,
    exited: 4
  }
  agents.sort(
    (a, b) => order[a.status] - order[b.status] || a.meta.name.localeCompare(b.meta.name)
  )
  let longestTurn: PulseSummary['longestTurn'] = null
  for (const turn of windowTurns) {
    const ms = turn.end - turn.start
    if (!longestTurn || ms > longestTurn.ms) {
      longestTurn = { ms, agent: history.agents[turn.agentId]?.name ?? '?' }
    }
  }
  return {
    now,
    windowMs,
    agents,
    counts,
    turns: windowTurns.length,
    medianTurnMs: median(windowTurns.map((turn) => turn.end - turn.start)),
    longestTurn,
    waitingMs,
    longestWaiting
  }
}

/** Segments of one agent clipped to the window, as fractions 0..1 of its width. */
export function laneBlocks(
  history: PulseHistory,
  agentId: string,
  now: number,
  windowMs: number
): { status: AgentStatus; left: number; width: number; from: number }[] {
  const from = now - windowMs
  const blocks: { status: AgentStatus; left: number; width: number; from: number }[] = []
  for (const segment of history.segments[agentId] ?? []) {
    const start = Math.max(segment.from, from)
    const end = Math.min(segment.to ?? now, now)
    if (end <= start) continue
    blocks.push({
      status: segment.status,
      left: (start - from) / windowMs,
      width: (end - start) / windowMs,
      from: segment.from
    })
  }
  return blocks
}

// --- text ---------------------------------------------------------------------------

/** "4m 05s", "1h 12m", "12s" — compact, language-neutral units for the tool and reports. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

const STATUS_EN: Record<AgentStatus, string> = {
  working: 'working',
  'needs-input': 'waiting for the user',
  finished: 'finished its turn',
  idle: 'idle',
  exited: 'stopped'
}

/** Plain-English report for agents (the tool). */
export function toolReport(summary: PulseSummary): string {
  if (summary.agents.length === 0) return 'There are no agents in this workspace.'
  const window = formatDuration(summary.windowMs)
  const lines = summary.agents.map((agent) => {
    const since = agent.since !== null ? ` for ${formatDuration(summary.now - agent.since)}` : ''
    const turns =
      agent.turns > 0
        ? `${agent.turns} turn${agent.turns === 1 ? '' : 's'} in the last ${window} (median ${formatDuration(agent.medianTurnMs ?? 0)})`
        : `no finished turns in the last ${window}`
    return `- ${agent.meta.name} [${agent.meta.harness}, id ${agent.meta.id}]: ${STATUS_EN[agent.status]}${since}; ${turns}; busy ${Math.round(agent.busyShare * 100)}% of the window.`
  })
  const c = summary.counts
  const head = `${summary.agents.length} agents: ${c.working} working, ${c['needs-input']} waiting for the user, ${c.finished} finished, ${c.idle} idle${c.exited ? `, ${c.exited} stopped` : ''}.`
  const tail =
    summary.turns > 0
      ? `Across all agents: ${summary.turns} turns finished in the last ${window}, median ${formatDuration(summary.medianTurnMs ?? 0)}, longest ${formatDuration(summary.longestTurn?.ms ?? 0)} (${summary.longestTurn?.agent}).`
      : `No turns finished in the last ${window}.`
  return [head, ...lines, tail].join('\n')
}
