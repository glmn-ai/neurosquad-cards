// Pure GitHub data model: parsing repository references, mapping API JSON into
// small records, deciding CI states, diffing two polls and writing the tool
// report. No SDK calls here — the unit tests drive it with plain objects.

export interface RepoRef {
  owner: string
  repo: string
}

export type CiState = 'success' | 'failure' | 'pending' | 'none'

export interface RepoInfo {
  fullName: string
  url: string
  defaultBranch: string
  /** GitHub counts open pull requests as issues too. */
  openIssuesAndPulls: number
  stars: number
  private: boolean
}

export interface PullInfo {
  number: number
  title: string
  author: string
  draft: boolean
  url: string
  headSha: string
  headRef: string
  updatedAt: string
  createdAt: string
  reviewers: number
  labels: { name: string; color: string }[]
  ci: CiState
}

export interface RunInfo {
  id: number
  name: string
  branch: string
  sha: string
  event: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
}

export interface RateInfo {
  remaining: number | null
  limit: number | null
  /** Epoch ms. */
  resetAt: number | null
}

export interface RepoSnapshot {
  repo: RepoInfo
  pulls: PullInfo[]
  runs: RunInfo[]
  fetchedAt: number
  rate: RateInfo
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/

/**
 * `owner/repo`, `https://github.com/owner/repo(.git)(/…)`, `github.com/owner/repo`,
 * `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git`.
 */
export function parseRepo(input: string | null | undefined): RepoRef | null {
  if (!input) return null
  let text = input.trim()
  const ssh = /^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i.exec(text)
  if (ssh) text = ssh[1]
  else {
    const web = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(text)
    if (web) text = web[1]
    else if (/^[a-z]+:\/\//i.test(text) || text.includes('@')) return null
  }
  const [owner, rawRepo] = text.split(/[/?#]/)
  const repo = rawRepo?.replace(/\.git$/i, '')
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null
  return { owner, repo }
}

/** The GitHub remote of a `.git/config`: `origin` first, then any GitHub remote. */
export function parseGitConfig(text: string): RepoRef | null {
  const remotes: { name: string; url: string }[] = []
  let current: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const section = /^\[remote\s+"([^"]+)"\]$/.exec(line)
    if (section) {
      current = section[1]
      continue
    }
    if (line.startsWith('[')) {
      current = null
      continue
    }
    const url = /^url\s*=\s*(.+)$/.exec(line)
    if (current && url) remotes.push({ name: current, url: url[1].trim() })
  }
  const ordered = [
    ...remotes.filter((remote) => remote.name === 'origin'),
    ...remotes.filter((remote) => remote.name !== 'origin')
  ]
  for (const remote of ordered) {
    const ref = parseRepo(remote.url)
    if (ref) return ref
  }
  return null
}

export function repoLabel(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`
}

// --- mapping GitHub JSON -----------------------------------------------------------

type Json = Record<string, unknown>
const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function mapRepo(json: Json): RepoInfo {
  return {
    fullName: str(json.full_name),
    url: str(json.html_url),
    defaultBranch: str(json.default_branch, 'main'),
    openIssuesAndPulls: num(json.open_issues_count),
    stars: num(json.stargazers_count),
    private: json.private === true
  }
}

export function mapPull(json: Json): PullInfo {
  const head = (json.head ?? {}) as Json
  const user = (json.user ?? {}) as Json
  const labels = Array.isArray(json.labels) ? (json.labels as Json[]) : []
  return {
    number: num(json.number),
    title: str(json.title),
    author: str(user.login, '?'),
    draft: json.draft === true,
    url: str(json.html_url),
    headSha: str(head.sha),
    headRef: str(head.ref),
    updatedAt: str(json.updated_at),
    createdAt: str(json.created_at),
    reviewers: Array.isArray(json.requested_reviewers) ? json.requested_reviewers.length : 0,
    labels: labels
      .slice(0, 3)
      .map((label) => ({ name: str(label.name), color: /^[0-9a-f]{6}$/i.test(str(label.color)) ? str(label.color) : '888888' })),
    ci: 'none'
  }
}

export function mapRun(json: Json): RunInfo {
  return {
    id: num(json.id),
    name: str(json.name, str(json.display_title, 'workflow')),
    branch: str(json.head_branch),
    sha: str(json.head_sha),
    event: str(json.event),
    status: str(json.status),
    conclusion: typeof json.conclusion === 'string' ? json.conclusion : null,
    url: str(json.html_url),
    createdAt: str(json.created_at)
  }
}

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'])

/** One run's state. */
export function runState(run: Pick<RunInfo, 'status' | 'conclusion'>): CiState {
  if (run.status !== 'completed') return 'pending'
  if (run.conclusion && FAILED.has(run.conclusion)) return 'failure'
  return 'success'
}

/** A commit's state from `GET /commits/{sha}/check-runs`. */
export function ciFromCheckRuns(json: Json): CiState {
  const runs = Array.isArray(json.check_runs) ? (json.check_runs as Json[]) : []
  if (runs.length === 0) return 'none'
  let pending = false
  for (const run of runs) {
    const state = runState({ status: str(run.status), conclusion: typeof run.conclusion === 'string' ? run.conclusion : null })
    if (state === 'failure') return 'failure'
    if (state === 'pending') pending = true
  }
  return pending ? 'pending' : 'success'
}

/** The default branch's CI: its latest workflow run (per workflow name, any failing → failure). */
export function branchCi(runs: RunInfo[], branch: string): { state: CiState; run: RunInfo | null } {
  // A skipped run (a workflow whose conditions did not match) says nothing about the branch.
  const onBranch = runs
    .filter((run) => run.branch === branch && run.conclusion !== 'skipped')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (onBranch.length === 0) return { state: 'none', run: null }
  const latestSha = onBranch[0].sha
  const latest = onBranch.filter((run) => run.sha === latestSha)
  const states = latest.map(runState)
  const state = states.includes('failure') ? 'failure' : states.includes('pending') ? 'pending' : 'success'
  const run = latest.find((r) => runState(r) === state) ?? latest[0]
  return { state, run }
}

/** CI states that will not change any more (no need to ask again for that commit). */
export function isFinal(state: CiState): boolean {
  return state === 'success' || state === 'failure'
}

/** Rate limit headers (`x-ratelimit-*`). */
export function readRate(get: (name: string) => string | null): RateInfo {
  const n = (name: string): number | null => {
    const value = get(name)
    return value !== null && /^\d+$/.test(value) ? Number(value) : null
  }
  const reset = n('x-ratelimit-reset')
  return { remaining: n('x-ratelimit-remaining'), limit: n('x-ratelimit-limit'), resetAt: reset !== null ? reset * 1000 : null }
}

/** What changed between two polls — the rows to flash. */
export function diffSnapshots(
  previous: RepoSnapshot | null,
  next: RepoSnapshot
): { pulls: number[]; runs: number[] } {
  if (!previous || previous.repo.fullName !== next.repo.fullName) return { pulls: [], runs: [] }
  const before = new Map(previous.pulls.map((pull) => [pull.number, pull]))
  const pulls = next.pulls
    .filter((pull) => {
      const old = before.get(pull.number)
      return !old || old.updatedAt !== pull.updatedAt || old.ci !== pull.ci || old.headSha !== pull.headSha
    })
    .map((pull) => pull.number)
  const knownRuns = new Map(previous.runs.map((run) => [run.id, run]))
  const runs = next.runs
    .filter((run) => {
      const old = knownRuns.get(run.id)
      return !old || old.status !== run.status || old.conclusion !== run.conclusion
    })
    .map((run) => run.id)
  return { pulls, runs }
}

// --- text -----------------------------------------------------------------------------

const CI_EN: Record<CiState, string> = {
  success: 'passing',
  failure: 'FAILING',
  pending: 'running',
  none: 'no CI'
}

/** Plain-English report for agents (the `status` tool). */
export function toolReport(snapshot: RepoSnapshot, now: number): string {
  const { repo, pulls, runs } = snapshot
  const ci = branchCi(runs, repo.defaultBranch)
  const age = Math.max(0, Math.round((now - snapshot.fetchedAt) / 1000))
  const lines = [
    `${repo.fullName} (${repo.url}) — data from ${age}s ago.`,
    ci.run
      ? `Default branch ${repo.defaultBranch}: CI ${CI_EN[ci.state]} — "${ci.run.name}" on ${ci.run.sha.slice(0, 7)} (${ci.run.status}${ci.run.conclusion ? `/${ci.run.conclusion}` : ''}) ${ci.run.url}`
      : `Default branch ${repo.defaultBranch}: no workflow runs found.`,
    pulls.length === 0 ? 'No open pull requests.' : `${pulls.length} open pull request${pulls.length === 1 ? '' : 's'}:`
  ]
  for (const pull of pulls) {
    lines.push(
      `- #${pull.number} ${pull.title} — by ${pull.author}${pull.draft ? ', draft' : ''}, branch ${pull.headRef} @ ${pull.headSha.slice(0, 7)}, CI ${CI_EN[pull.ci]}. ${pull.url}`
    )
  }
  const recent = runs.slice(0, 5)
  if (recent.length > 0) {
    lines.push('Latest workflow runs:')
    for (const run of recent) {
      lines.push(
        `- ${run.name} on ${run.branch} @ ${run.sha.slice(0, 7)}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} (${run.createdAt}) ${run.url}`
      )
    }
  }
  return lines.join('\n')
}
