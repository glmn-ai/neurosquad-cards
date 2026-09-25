// The decision log as plain data: entries, ids, search, Markdown and ADR files.
// No SDK calls here — the controller persists and routes, the tests use a fake clock.

export const STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'] as const
export type DecisionStatus = (typeof STATUSES)[number]

export interface Author {
  name: string
  kind: 'agent' | 'human'
}

export interface HistoryItem {
  at: number
  status: DecisionStatus
  by: string
  note?: string
}

export interface Decision {
  /** Sequence number: ADR-0007 is n = 7. Never reused. */
  n: number
  title: string
  decision: string
  context?: string
  alternatives?: string[]
  consequences?: string
  tags: string[]
  status: DecisionStatus
  author: Author
  createdAt: number
  updatedAt: number
  /** This entry was replaced by ADR-n. */
  supersededBy?: number
  /** This entry replaces ADR-n. */
  supersedes?: number
  history: HistoryItem[]
}

/** Stored under `index`; each entry under `entry:<n>` (one value per entry keeps writes small). */
export interface LogIndex {
  version: 1
  nextN: number
  ids: number[]
}

export const LIMITS = {
  title: 120,
  decision: 4000,
  context: 4000,
  consequences: 2000,
  alternatives: 10,
  alternative: 300,
  tags: 8,
  tag: 32,
  note: 500
} as const

export const emptyIndex = (): LogIndex => ({ version: 1, nextN: 1, ids: [] })

export function entryKey(n: number): string {
  return `entry:${n}`
}

export function adrId(n: number): string {
  return `ADR-${String(n).padStart(4, '0')}`
}

/** "ADR-0007", "adr-7", "7", "#7", 7 → 7. Anything else → null. */
export function parseId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(?:adr-?|#)?0*(\d{1,6})\s*$/i.exec(value)
  if (!match) return null
  const n = Number(match[1])
  return n > 0 ? n : null
}

export class DecisionError extends Error {}

export interface DecisionInput {
  title: string
  decision: string
  context?: string
  alternatives?: string[]
  consequences?: string
  tags?: string[]
  status?: DecisionStatus
}

const clean = (text: unknown, max: number): string =>
  typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim().slice(0, max) : ''

/** Trims, bounds and dedupes an input (from a tool or the form). Throws on a missing title/decision. */
export function normalizeInput(input: DecisionInput): Required<Omit<DecisionInput, 'status'>> & {
  status?: DecisionStatus
} {
  const title = clean(input.title, LIMITS.title).replace(/\s+/g, ' ')
  const decision = clean(input.decision, LIMITS.decision)
  if (!title) throw new DecisionError('A decision needs a title.')
  if (!decision) throw new DecisionError('A decision needs the decision text.')
  const tags: string[] = []
  for (const raw of input.tags ?? []) {
    const tag = clean(raw, LIMITS.tag)
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/\s+/g, '-')
    if (tag && !tags.includes(tag)) tags.push(tag)
    if (tags.length === LIMITS.tags) break
  }
  const alternatives = (input.alternatives ?? [])
    .map((alt) => clean(alt, LIMITS.alternative))
    .filter(Boolean)
    .slice(0, LIMITS.alternatives)
  return {
    title,
    decision,
    context: clean(input.context, LIMITS.context),
    alternatives,
    consequences: clean(input.consequences, LIMITS.consequences),
    tags,
    ...(input.status ? { status: input.status } : {})
  }
}

/** A new entry. Optional fields that are empty are left out (not ''). */
export function createDecision(
  n: number,
  input: DecisionInput,
  author: Author,
  at: number,
  status: DecisionStatus
): Decision {
  const clean = normalizeInput(input)
  return {
    n,
    title: clean.title,
    decision: clean.decision,
    ...(clean.context ? { context: clean.context } : {}),
    ...(clean.alternatives.length ? { alternatives: clean.alternatives } : {}),
    ...(clean.consequences ? { consequences: clean.consequences } : {}),
    tags: clean.tags,
    status,
    author,
    createdAt: at,
    updatedAt: at,
    history: [{ at, status, by: author.name }]
  }
}

/** Applies an edit from the form; status changes go through `withStatus`. */
export function editDecision(entry: Decision, input: DecisionInput, by: string, at: number): Decision {
  const clean = normalizeInput(input)
  const next: Decision = {
    ...entry,
    title: clean.title,
    decision: clean.decision,
    tags: clean.tags,
    updatedAt: at
  }
  delete next.context
  delete next.alternatives
  delete next.consequences
  if (clean.context) next.context = clean.context
  if (clean.alternatives.length) next.alternatives = clean.alternatives
  if (clean.consequences) next.consequences = clean.consequences
  next.history = [...entry.history, { at, status: entry.status, by, note: 'edited' }]
  return next
}

export function withStatus(
  entry: Decision,
  status: DecisionStatus,
  by: string,
  at: number,
  note?: string
): Decision {
  const trimmed = clean(note, LIMITS.note)
  return {
    ...entry,
    status,
    updatedAt: at,
    history: [...entry.history, { at, status, by, ...(trimmed ? { note: trimmed } : {}) }]
  }
}

// --- search ------------------------------------------------------------------------

export interface SearchQuery {
  query?: string
  tag?: string
  status?: DecisionStatus | 'all'
  limit?: number
}

function haystack(entry: Decision): string {
  return [
    adrId(entry.n),
    entry.title,
    entry.decision,
    entry.context,
    entry.consequences,
    ...(entry.alternatives ?? []),
    ...entry.tags,
    entry.author.name
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

/** Every word of the query must appear somewhere. Newest first. */
export function search(entries: Decision[], q: SearchQuery = {}): Decision[] {
  const words = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const tag = q.tag?.toLowerCase().replace(/^#/, '')
  const out = entries.filter((entry) => {
    if (q.status && q.status !== 'all' && entry.status !== q.status) return false
    if (tag && !entry.tags.includes(tag)) return false
    if (words.length === 0) return true
    const text = haystack(entry)
    return words.every((word) => text.includes(word))
  })
  out.sort((a, b) => b.n - a.n)
  return q.limit ? out.slice(0, q.limit) : out
}

/** Tags by how often they are used, then alphabetically. */
export function tagCounts(entries: Decision[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// --- text --------------------------------------------------------------------------------

const isoDay = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** One line per entry, for the `search` tool. */
export function compactLine(entry: Decision): string {
  const tags = entry.tags.length ? ` — tags: ${entry.tags.join(', ')}` : ''
  const link =
    entry.status === 'superseded' && entry.supersededBy ? ` → ${adrId(entry.supersededBy)}` : ''
  return `${adrId(entry.n)} [${entry.status}${link}] ${entry.title}${tags} (by ${entry.author.name}, ${isoDay(entry.createdAt)})`
}

/** The full entry as Markdown (the `get` tool, the port, ADR files). English headings: ADRs are for the repo. */
export function toMarkdown(entry: Decision): string {
  const lines = [
    `# ${adrId(entry.n)}: ${entry.title}`,
    '',
    `- Status: **${entry.status}**${entry.supersededBy ? ` (superseded by ${adrId(entry.supersededBy)})` : ''}`,
    `- Date: ${isoDay(entry.createdAt)}`,
    `- Author: ${entry.author.name}${entry.author.kind === 'agent' ? ' (agent)' : ''}`
  ]
  if (entry.supersedes) lines.push(`- Supersedes: ${adrId(entry.supersedes)}`)
  if (entry.tags.length) lines.push(`- Tags: ${entry.tags.join(', ')}`)
  if (entry.context) lines.push('', '## Context', '', entry.context)
  lines.push('', '## Decision', '', entry.decision)
  if (entry.alternatives?.length) {
    lines.push('', '## Alternatives considered', '', ...entry.alternatives.map((alt) => `- ${alt}`))
  }
  if (entry.consequences) lines.push('', '## Consequences', '', entry.consequences)
  return lines.join('\n')
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || 'decision'
}

/** `docs/adr/0007-use-sqlite.md` for each entry plus `docs/adr/README.md`, oldest first. */
export function adrFiles(entries: Decision[], folder = 'docs/adr'): { path: string; text: string }[] {
  const sorted = [...entries].sort((a, b) => a.n - b.n)
  const files = sorted.map((entry) => ({
    path: `${folder}/${String(entry.n).padStart(4, '0')}-${slugify(entry.title)}.md`,
    text: toMarkdown(entry) + '\n'
  }))
  const index = [
    '# Architecture decision records',
    '',
    '| ADR | Title | Status | Date |',
    '| --- | --- | --- | --- |',
    ...sorted.map((entry, i) => {
      const file = files[i].path.slice(folder.length + 1)
      return `| [${adrId(entry.n)}](${file}) | ${entry.title.replace(/\|/g, '\\|')} | ${entry.status} | ${isoDay(entry.createdAt)} |`
    }),
    ''
  ].join('\n')
  return [...files, { path: `${folder}/README.md`, text: index }]
}
