// A small GitHub REST client over the card's network proxy (`card.net.fetch`).
// Conditional requests: every GET remembers its ETag, and a 304 answers from
// the cached body (GitHub does not count a 304 against the rate limit). The
// token is never known here — the header carries `{{secret:token}}` and the
// host fills it in, only for api.github.com.
import { isCardSdkError, type Card, type JsonValue } from '@neurosquad/card-sdk'
import {
  ciFromCheckRuns,
  isFinal,
  mapPull,
  mapRepo,
  mapRun,
  readRate,
  type CiState,
  type RateInfo,
  type RepoRef,
  type RepoSnapshot
} from './model'

export const API = 'https://api.github.com'

/** How many open PRs get their CI looked up per poll (each is one request until final). */
export const CI_LOOKUPS = 8

export type GithubErrorKind = 'rate-limit' | 'not-found' | 'unauthorized' | 'network' | 'http' | 'denied'

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly resetAt: number | null = null
  ) {
    super(message)
  }
}

export interface EtagEntry {
  etag: string
  body: string
}

export interface ClientCache {
  etags: Record<string, EtagEntry>
  /** CI of commits already known to be final (sha → state). */
  ci: Record<string, CiState>
}

export function emptyCache(): ClientCache {
  return { etags: {}, ci: {} }
}

export class GithubClient {
  rate: RateInfo = { remaining: null, limit: null, resetAt: null }
  /** Requests actually sent in the last `fetchRepo` (for the log and the tests). */
  requests = 0
  notModified = 0

  constructor(
    private readonly card: Card,
    public cache: ClientCache = emptyCache()
  ) {}

  private headers(url: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    }
    if (this.card.settings.hasSecret('token')) headers.authorization = 'Bearer {{secret:token}}'
    const cached = this.cache.etags[url]
    if (cached) headers['if-none-match'] = cached.etag
    return headers
  }

  /** GET a path; JSON body (from the cache on 304). */
  async get<T = JsonValue>(path: string): Promise<T> {
    const url = `${API}${path}`
    let res
    try {
      this.requests++
      res = await this.card.net.fetch(url, { headers: this.headers(url), responseType: 'text', timeoutMs: 20_000 })
    } catch (error) {
      if (isCardSdkError(error, 'HOST_NOT_ALLOWED') || isCardSdkError(error, 'PERMISSION_DENIED')) {
        throw new GithubError('denied', error.hostMessage)
      }
      throw new GithubError('network', isCardSdkError(error) ? error.hostMessage : String(error))
    }
    const rate = readRate((name) => res.headers.get(name))
    if (rate.remaining !== null) this.rate = rate
    if (res.status === 304) {
      const cached = this.cache.etags[url]
      if (cached) {
        this.notModified++
        return JSON.parse(cached.body) as T
      }
    }
    const body = await res.text()
    if (res.ok) {
      const etag = res.headers.get('etag')
      if (etag) this.cache.etags[url] = { etag, body }
      try {
        return JSON.parse(body) as T
      } catch {
        throw new GithubError('http', 'GitHub sent something that is not JSON', res.status)
      }
    }
    let message = res.statusText || `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(body) as { message?: string }
      if (parsed.message) message = parsed.message
    } catch {
      /* not JSON */
    }
    if ((res.status === 403 || res.status === 429) && (rate.remaining === 0 || /rate limit/i.test(message))) {
      const retry = Number(res.headers.get('retry-after'))
      const resetAt = rate.resetAt ?? (Number.isFinite(retry) && retry > 0 ? Date.now() + retry * 1000 : null)
      throw new GithubError('rate-limit', message, res.status, resetAt)
    }
    if (res.status === 404) throw new GithubError('not-found', message, 404)
    if (res.status === 401) throw new GithubError('unauthorized', message, 401)
    throw new GithubError('http', message, res.status)
  }

  /** One poll: repo, open PRs, default-branch runs, then CI of the PRs that still need it. */
  async fetchRepo(ref: RepoRef, now = Date.now()): Promise<RepoSnapshot> {
    this.requests = 0
    this.notModified = 0
    const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
    const repo = mapRepo(await this.get<Record<string, unknown>>(base))
    const [pullsJson, runsJson] = await Promise.all([
      this.get<Record<string, unknown>[]>(`${base}/pulls?state=open&per_page=20`),
      this.get<Record<string, unknown>>(
        `${base}/actions/runs?branch=${encodeURIComponent(repo.defaultBranch)}&event=push&per_page=10`
      ).catch((error: unknown) => {
        // Actions disabled or not visible: the rest of the card still works.
        if (error instanceof GithubError && (error.kind === 'not-found' || error.status === 403)) {
          return { workflow_runs: [] }
        }
        throw error
      })
    ])
    const pulls = (Array.isArray(pullsJson) ? pullsJson : []).map(mapPull)
    const runs = (
      Array.isArray((runsJson as { workflow_runs?: unknown }).workflow_runs)
        ? ((runsJson as { workflow_runs: Record<string, unknown>[] }).workflow_runs)
        : []
    ).map(mapRun)

    // CI per PR: known final states come from the cache; the rest cost one request each.
    const lowOnRequests = this.rate.remaining !== null && this.rate.remaining < 10
    const lookups = pulls.slice(0, CI_LOOKUPS).filter((pull) => {
      const known = this.cache.ci[pull.headSha]
      if (known) pull.ci = known
      return pull.headSha && !known && !lowOnRequests
    })
    await Promise.all(
      lookups.map(async (pull) => {
        try {
          const state = ciFromCheckRuns(
            await this.get<Record<string, unknown>>(`${base}/commits/${pull.headSha}/check-runs?per_page=50`)
          )
          pull.ci = state
          if (isFinal(state)) this.cache.ci[pull.headSha] = state
        } catch (error) {
          if (error instanceof GithubError && error.kind === 'rate-limit') throw error
          pull.ci = 'none'
        }
      })
    )
    this.prune(pulls.map((pull) => pull.headSha))
    return { repo, pulls, runs, fetchedAt: now, rate: this.rate }
  }

  /** Keeps the caches small: CI only for current heads, ETags for at most 60 URLs. */
  private prune(heads: string[]): void {
    const keep = new Set(heads)
    for (const sha of Object.keys(this.cache.ci)) if (!keep.has(sha)) delete this.cache.ci[sha]
    const urls = Object.keys(this.cache.etags)
    for (const url of urls) {
      const sha = /\/commits\/([0-9a-f]{7,40})\/check-runs/.exec(url)?.[1]
      if (sha && !keep.has(sha)) delete this.cache.etags[url]
    }
    const rest = Object.keys(this.cache.etags)
    for (const url of rest.slice(0, Math.max(0, rest.length - 60))) delete this.cache.etags[url]
  }
}
