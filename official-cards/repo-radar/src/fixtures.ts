// A fake api.github.com for the preview and the tests: GitHub-shaped JSON,
// ETags with 304s, rate-limit headers. Plugs into createMockHost({ fetch }).
import type { MockFetchRequest, MockFetchResponse } from '@neurosquad/card-sdk/testing'

export interface FakeGithubOptions {
  owner?: string
  repo?: string
  /** State of the latest run on the default branch. */
  mainCi?: 'success' | 'failure' | 'in_progress'
  /** Fail everything with this status (e.g. 403 rate limit, 404). */
  failWith?: number
  rateLimit?: number
  now?: number
}

const hash = (text: string): string => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16)
}

const iso = (now: number, minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()

export interface FakeGithub {
  handler: (request: MockFetchRequest) => MockFetchResponse
  /** Every request, in order. */
  log: MockFetchRequest[]
  state: Required<Omit<FakeGithubOptions, 'failWith'>> & { failWith?: number; remaining: number }
  /** Adds a PR (a "just updated" change for the next poll). */
  addPull(title: string): void
}

export function fakeGithub(options: FakeGithubOptions = {}): FakeGithub {
  const state = {
    owner: options.owner ?? 'acme',
    repo: options.repo ?? 'rocket-shop',
    mainCi: options.mainCi ?? 'success',
    rateLimit: options.rateLimit ?? 60,
    now: options.now ?? Date.now(),
    failWith: options.failWith,
    remaining: options.rateLimit ?? 60
  }
  const now = state.now
  const user = (login: string): { login: string } => ({ login })
  const pulls = [
    { n: 482, title: 'Checkout: pay with saved cards', by: 'mira', ci: 'success', min: 12, labels: [['feature', '0e8a16']], rev: 2 },
    { n: 479, title: 'Fix race in cart totals when coupons stack', by: 'backend-agent', ci: 'failure', min: 38, labels: [['bug', 'd73a4a']], rev: 1 },
    { n: 477, title: 'Product grid: lazy images and skeletons', by: 'frontend-agent', ci: 'in_progress', min: 3, labels: [['ui', '1d76db']], rev: 0 },
    { n: 471, title: 'Bump vite to 7.3 and vitest to 3.2', by: 'renovate[bot]', ci: 'success', min: 190, labels: [['dependencies', '0366d6']], rev: 0 },
    { n: 468, title: 'WIP: order history export (CSV)', by: 'lead-agent', ci: 'none', min: 60 * 26, labels: [], rev: 0, draft: true },
    { n: 455, title: 'Docs: deploying to the edge', by: 'sam', ci: 'success', min: 60 * 50, labels: [['docs', 'c5def5']], rev: 1 }
  ].map((p, i) => ({ ...p, sha: `${(0xa1b2c3 + i * 7919).toString(16)}${'0'.repeat(34)}`.slice(0, 40) }))

  const shaOf = new Map(pulls.map((p) => [p.sha, p]))
  const runs = (): unknown[] => {
    const list = [
      ['CI', state.mainCi, 4],
      ['Deploy preview', state.mainCi === 'failure' ? 'skipped' : 'success', 4],
      ['CI', 'success', 55],
      ['CI', 'success', 130],
      ['Nightly e2e', 'failure', 60 * 9],
      ['CI', 'success', 60 * 14],
      ['CI', 'success', 60 * 20],
      ['CI', 'success', 60 * 30]
    ] as const
    return list.map(([name, result, min], i) => ({
      id: 9000 + i,
      name,
      head_branch: 'main',
      head_sha: `${(0xfeed00 + (i < 2 ? 0 : i)).toString(16)}${'1'.repeat(34)}`.slice(0, 40),
      event: 'push',
      status: result === 'in_progress' ? 'in_progress' : 'completed',
      conclusion: result === 'in_progress' ? null : result,
      html_url: `https://github.com/${state.owner}/${state.repo}/actions/runs/${9000 + i}`,
      created_at: iso(now, min)
    }))
  }

  const log: MockFetchRequest[] = []
  const reply = (request: MockFetchRequest, status: number, body: unknown): MockFetchResponse => {
    const text = JSON.stringify(body)
    const etag = `W/"${hash(text)}"`
    const headers: Record<string, string> = {
      'x-ratelimit-limit': String(state.rateLimit),
      'x-ratelimit-reset': String(Math.floor(now / 1000) + 1800)
    }
    if (status === 200 && request.headers['if-none-match'] === etag) {
      headers['x-ratelimit-remaining'] = String(state.remaining)
      return { status: 304, statusText: 'Not Modified', headers: { ...headers, etag }, body: '' }
    }
    state.remaining = Math.max(0, state.remaining - 1)
    headers['x-ratelimit-remaining'] = String(state.remaining)
    if (status === 200) headers.etag = etag
    return { status, statusText: status === 200 ? 'OK' : 'Error', headers, body: text }
  }

  const handler = (request: MockFetchRequest): MockFetchResponse => {
    log.push(request)
    const url = new URL(request.url)
    if (state.failWith === 403 || state.remaining === 0) {
      state.remaining = 0
      return reply(request, 403, { message: 'API rate limit exceeded for 203.0.113.9.' })
    }
    if (state.failWith) return reply(request, state.failWith, { message: state.failWith === 404 ? 'Not Found' : 'Server Error' })
    const base = `/repos/${state.owner}/${state.repo}`
    const path = url.pathname
    if (path === base) {
      return reply(request, 200, {
        full_name: `${state.owner}/${state.repo}`,
        html_url: `https://github.com/${state.owner}/${state.repo}`,
        default_branch: 'main',
        open_issues_count: pulls.length + 17,
        stargazers_count: 2841,
        private: false
      })
    }
    if (path === `${base}/pulls`) {
      return reply(
        request,
        200,
        pulls.map((p) => ({
          number: p.n,
          title: p.title,
          user: user(p.by),
          draft: p.draft === true,
          html_url: `https://github.com/${state.owner}/${state.repo}/pull/${p.n}`,
          head: { sha: p.sha, ref: `feature/${p.n}` },
          created_at: iso(now, p.min + 30),
          updated_at: iso(now, p.min),
          requested_reviewers: Array.from({ length: p.rev }, (_, i) => user(`rev${i}`)),
          labels: p.labels.map(([name, color]) => ({ name, color }))
        }))
      )
    }
    if (path === `${base}/actions/runs`) return reply(request, 200, { total_count: 8, workflow_runs: runs() })
    const checks = new RegExp(`^${base}/commits/([0-9a-f]{40})/check-runs$`).exec(path)
    if (checks) {
      const pull = shaOf.get(checks[1])
      const ci = pull?.ci ?? 'none'
      const runsFor =
        ci === 'none'
          ? []
          : [
              { name: 'build', status: 'completed', conclusion: 'success' },
              {
                name: 'test',
                status: ci === 'in_progress' ? 'in_progress' : 'completed',
                conclusion: ci === 'in_progress' ? null : ci
              }
            ]
      return reply(request, 200, { total_count: runsFor.length, check_runs: runsFor })
    }
    return reply(request, 404, { message: 'Not Found' })
  }

  return {
    handler,
    log,
    state,
    addPull(title: string) {
      const n = 490 + pulls.length
      const sha = `${(0xbeef00 + n).toString(16)}${'2'.repeat(34)}`.slice(0, 40)
      const pull = { n, title, by: 'lead-agent', ci: 'in_progress', min: 0, labels: [['agent', '8250df']], rev: 0, sha }
      pulls.unshift(pull as (typeof pulls)[number])
      shaOf.set(sha, pull as (typeof pulls)[number])
    }
  }
}
