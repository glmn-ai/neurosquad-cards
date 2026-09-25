// The Go/No-Go board: pure functions over a small, serializable state.
// The controller feeds user actions, agent tool calls and port messages in;
// the UI, the tools and the overview tile read summaries out.

export type CheckStatus = 'go' | 'nogo' | 'pending'

export interface Check {
  id: string
  name: string
  status: CheckStatus
  note?: string
  /** Who set the status last ("you", or an agent's name). */
  by?: string
  byAgent?: boolean
  at?: number
  /** Came from the `checks` input port (a connected checklist owns it). */
  source?: 'port'
}

export interface Board {
  version: 1
  checks: Check[]
  /** Epoch ms of T−0, or null (no countdown). */
  target: number | null
  /** When all checks last turned GO (the GO signal was sent); null when not all GO. */
  goAt: number | null
}

export const MAX_CHECKS = 40
export const NAME_MAX = 120
export const NOTE_MAX = 280

export function emptyBoard(): Board {
  return { version: 1, checks: [], target: null, goAt: null }
}

/** A board read from storage; anything unexpected becomes an empty board. */
export function restoreBoard(raw: unknown): Board {
  if (!raw || typeof raw !== 'object' || (raw as Board).version !== 1) return emptyBoard()
  const board = structuredClone(raw) as Board
  board.checks = Array.isArray(board.checks)
    ? board.checks.filter(
        (c) => c && typeof c.id === 'string' && typeof c.name === 'string' && isStatus(c.status)
      )
    : []
  board.target = typeof board.target === 'number' ? board.target : null
  board.goAt = typeof board.goAt === 'number' ? board.goAt : null
  return board
}

export function isStatus(value: unknown): value is CheckStatus {
  return value === 'go' || value === 'nogo' || value === 'pending'
}

const norm = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()

/** Short, stable-ish ids: "c1", "c2"… (agents type them back). */
function nextId(board: Board): string {
  let max = 0
  for (const check of board.checks) {
    const n = /^c(\d+)$/.exec(check.id)
    if (n) max = Math.max(max, Number(n[1]))
  }
  return `c${max + 1}`
}

/** By id, or by name ignoring case and extra spaces. */
export function findCheck(board: Board, ref: string): Check | undefined {
  const key = ref.trim()
  return (
    board.checks.find((check) => check.id === key) ??
    board.checks.find((check) => norm(check.name) === norm(key))
  )
}

export class BoardError extends Error {}

export function addCheck(board: Board, name: string): { check: Check; created: boolean } {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
  if (!clean) throw new BoardError('The check needs a name.')
  const existing = findCheck(board, clean)
  if (existing) return { check: existing, created: false }
  if (board.checks.length >= MAX_CHECKS) {
    throw new BoardError(`The board holds at most ${MAX_CHECKS} checks.`)
  }
  const check: Check = { id: nextId(board), name: clean, status: 'pending' }
  board.checks.push(check)
  return { check, created: true }
}

export function setCheck(
  board: Board,
  ref: string,
  status: CheckStatus,
  options: { note?: string; by?: string; byAgent?: boolean; at: number }
): Check {
  const check = findCheck(board, ref)
  if (!check) {
    const names = board.checks.map((c) => `${c.id} "${c.name}"`).join(', ')
    throw new BoardError(
      `No check "${ref}". ${names ? `Checks: ${names}.` : 'The board has no checks yet.'}`
    )
  }
  check.status = status
  const note = options.note?.trim().slice(0, NOTE_MAX)
  if (note) check.note = note
  else if (options.note !== undefined) delete check.note
  if (options.by) check.by = options.by
  else delete check.by
  if (options.byAgent) check.byAgent = true
  else delete check.byAgent
  check.at = options.at
  return check
}

export function removeCheck(board: Board, id: string): boolean {
  const before = board.checks.length
  board.checks = board.checks.filter((check) => check.id !== id)
  return board.checks.length !== before
}

export function renameCheck(board: Board, id: string, name: string): void {
  const check = board.checks.find((c) => c.id === id)
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
  if (check && clean) check.name = clean
}

export function resetAll(board: Board): void {
  for (const check of board.checks) {
    check.status = 'pending'
    delete check.note
    delete check.by
    delete check.byAgent
    delete check.at
  }
}

/**
 * One task on an `ns:tasks` port. A `type`, not an `interface`: the SDK's
 * `onMessage<T extends JsonValue>` rejects interfaces (no index signature).
 */
export type PortTask = {
  id?: string
  text: string
  status?: 'pending' | 'active' | 'done' | 'error'
}

export function taskStatus(status: PortTask['status']): CheckStatus {
  return status === 'done' ? 'go' : status === 'error' ? 'nogo' : 'pending'
}

/**
 * A connected checklist is the source of truth for the checks it sent: they
 * follow its items (added, updated, removed). Checks added by hand or by
 * agents are left alone.
 */
export function mergeTasks(board: Board, tasks: PortTask[], from: string, at: number): string[] {
  const touched: string[] = []
  const keep = new Set<string>()
  for (const task of tasks.slice(0, MAX_CHECKS)) {
    const name = task.text.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
    if (!name) continue
    let check = findCheck(board, name)
    if (!check) {
      if (board.checks.length >= MAX_CHECKS) break
      check = { id: nextId(board), name, status: 'pending', source: 'port' }
      board.checks.push(check)
      touched.push(check.id)
    }
    keep.add(check.id)
    const status = taskStatus(task.status)
    if (check.source === 'port' && check.status !== status) {
      check.status = status
      check.by = from
      check.at = at
      delete check.byAgent
      touched.push(check.id)
    }
  }
  board.checks = board.checks.filter((check) => check.source !== 'port' || keep.has(check.id))
  return touched
}

// --- summaries ---------------------------------------------------------------------

export interface Counts {
  go: number
  nogo: number
  pending: number
  total: number
}

export function counts(board: Board): Counts {
  const c = { go: 0, nogo: 0, pending: 0, total: board.checks.length }
  for (const check of board.checks) c[check.status]++
  return c
}

export type Phase =
  /** No checks. */
  | 'empty'
  /** At least one NO-GO. */
  | 'hold'
  /** Checks pending. */
  | 'pending'
  /** Everything GO, T−0 not reached (or no countdown). */
  | 'go'
  /** Everything GO and T−0 passed. */
  | 'launched'
  /** T−0 passed but not everything is GO. */
  | 'scrubbed'

export function phaseOf(board: Board, now: number): Phase {
  const c = counts(board)
  if (c.total === 0) return 'empty'
  const allGo = c.go === c.total
  const past = board.target !== null && now >= board.target
  if (past) return allGo ? 'launched' : 'scrubbed'
  if (c.nogo > 0) return 'hold'
  return allGo ? 'go' : 'pending'
}

export function allGo(board: Board): boolean {
  const c = counts(board)
  return c.total > 0 && c.go === c.total
}

export interface Countdown {
  /** −1 before T−0 ("T−"), +1 after ("T+"). */
  sign: -1 | 1
  hours: number
  minutes: number
  seconds: number
}

export function countdown(target: number | null, now: number): Countdown | null {
  if (target === null) return null
  const diff = target - now
  const sign = diff > 0 ? -1 : 1
  // Before T−0 round up (T−00:00:01 until the very last second), after it round down.
  const total = sign < 0 ? Math.ceil(diff / 1000) : Math.floor(-diff / 1000)
  return {
    sign,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "T−01:12:30" (or without seconds: "T−01:12"). */
export function formatT(cd: Countdown | null, seconds = true): string {
  if (!cd) return 'T−−:−−'
  const base = `T${cd.sign < 0 ? '−' : '+'}${pad(Math.min(cd.hours, 99))}:${pad(cd.minutes)}`
  return seconds ? `${base}:${pad(cd.seconds)}` : base
}

/** Is the clock in its warning window (checks still pending close to T−0)? */
export function isWarning(board: Board, now: number, warnMinutes: number): boolean {
  if (board.target === null || warnMinutes <= 0) return false
  const left = board.target - now
  const c = counts(board)
  return left > 0 && left <= warnMinutes * 60_000 && c.go < c.total
}

const STATUS_EN: Record<CheckStatus, string> = { go: 'GO', nogo: 'NO-GO', pending: 'pending' }

/** Plain-English board for agents (list_checks). */
export function toolListing(
  board: Board,
  now: number,
  info: { title: string; brief: string }
): string {
  const c = counts(board)
  const cd = countdown(board.target, now)
  const lines = [
    `Mission: ${info.title}${info.brief ? ` — ${info.brief}` : ''}`,
    board.target === null
      ? 'No countdown is set.'
      : `Countdown: ${formatT(cd)} (T−0 at ${new Date(board.target).toISOString()}).`,
    `Phase: ${phaseOf(board, now)}. ${c.go}/${c.total} GO, ${c.nogo} NO-GO, ${c.pending} pending.`
  ]
  if (c.total === 0) lines.push('There are no checks yet — add some with add_check.')
  for (const check of board.checks) {
    const who = check.by ? ` (set by ${check.by})` : ''
    lines.push(
      `- ${check.id} "${check.name}": ${STATUS_EN[check.status]}${who}${check.note ? ` — ${check.note}` : ''}`
    )
  }
  return lines.join('\n')
}
