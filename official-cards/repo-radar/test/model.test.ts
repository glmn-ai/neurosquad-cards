import { describe, expect, it } from 'vitest'
import {
  branchCi,
  ciFromCheckRuns,
  diffSnapshots,
  mapPull,
  parseGitConfig,
  parseRepo,
  readRate,
  runState,
  toolReport,
  type RepoSnapshot,
  type RunInfo
} from '../src/model'

describe('parseRepo', () => {
  it.each([
    ['acme/rocket', 'acme/rocket'],
    [' acme/rocket.git ', 'acme/rocket'],
    ['https://github.com/acme/rocket', 'acme/rocket'],
    ['https://github.com/acme/rocket.git', 'acme/rocket'],
    ['https://github.com/acme/rocket/pulls?q=1', 'acme/rocket'],
    ['github.com/acme/rocket', 'acme/rocket'],
    ['git@github.com:acme/rocket.git', 'acme/rocket'],
    ['ssh://git@github.com/acme/rocket.git', 'acme/rocket'],
    ['https://www.github.com/Some-Org/repo.name', 'Some-Org/repo.name']
  ])('%s → %s', (input, expected) => {
    const ref = parseRepo(input)
    expect(ref && `${ref.owner}/${ref.repo}`).toBe(expected)
  })

  it.each(['', 'acme', 'https://gitlab.com/acme/rocket', 'git@gitlab.com:acme/rocket.git', 'a b/c', null])(
    'rejects %s',
    (input) => expect(parseRepo(input)).toBeNull()
  )
})

describe('parseGitConfig', () => {
  it('prefers origin, and understands https and ssh remotes', () => {
    const config = [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "upstream"]',
      '\turl = https://github.com/upstream/rocket.git',
      '\tfetch = +refs/heads/*:refs/remotes/upstream/*',
      '[remote "origin"]',
      '\turl = git@github.com:me/rocket.git',
      '[branch "main"]',
      '\tremote = origin'
    ].join('\r\n')
    expect(parseGitConfig(config)).toEqual({ owner: 'me', repo: 'rocket' })
  })

  it('falls back to any GitHub remote, and to null', () => {
    expect(
      parseGitConfig('[remote "origin"]\n url = https://gitlab.com/x/y\n[remote "gh"]\n url = https://github.com/x/y\n')
    ).toEqual({ owner: 'x', repo: 'y' })
    expect(parseGitConfig('[core]\n bare = false\n')).toBeNull()
  })
})

const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 1,
  name: 'CI',
  branch: 'main',
  sha: 'aaa',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  url: 'https://github.com/a/b/actions/runs/1',
  createdAt: '2026-09-25T10:00:00Z',
  ...over
})

describe('CI states', () => {
  it('reads runs and check-runs', () => {
    expect(runState(run({}))).toBe('success')
    expect(runState(run({ conclusion: 'timed_out' }))).toBe('failure')
    expect(runState(run({ conclusion: 'skipped' }))).toBe('success')
    expect(runState(run({ status: 'queued', conclusion: null }))).toBe('pending')
    expect(ciFromCheckRuns({ check_runs: [] })).toBe('none')
    expect(
      ciFromCheckRuns({ check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] })
    ).toBe('pending')
    expect(
      ciFromCheckRuns({ check_runs: [{ status: 'in_progress' }, { status: 'completed', conclusion: 'failure' }] })
    ).toBe('failure')
  })

  it('takes the default branch state from its latest commit', () => {
    const runs = [
      run({ id: 1, sha: 'new', createdAt: '2026-09-25T10:00:00Z', name: 'CI', conclusion: 'failure' }),
      run({ id: 2, sha: 'new', createdAt: '2026-09-25T10:00:01Z', name: 'Deploy', conclusion: 'success' }),
      run({ id: 3, sha: 'old', createdAt: '2026-09-25T09:00:00Z' }),
      run({ id: 4, sha: 'x', branch: 'feature', createdAt: '2026-09-25T11:00:00Z', conclusion: 'success' })
    ]
    expect(branchCi(runs, 'main')).toMatchObject({ state: 'failure', run: { id: 1 } })
    expect(branchCi(runs, 'develop')).toEqual({ state: 'none', run: null })
    // A newer skipped run does not hide the failure.
    runs.push(run({ id: 5, sha: 'newest', createdAt: '2026-09-25T12:00:00Z', conclusion: 'skipped' }))
    expect(branchCi(runs, 'main').state).toBe('failure')
  })
})

describe('mapping and diffs', () => {
  it('maps a pull request defensively', () => {
    const pull = mapPull({
      number: 7,
      title: 'Hi',
      user: { login: 'me' },
      head: { sha: 'abc', ref: 'feat' },
      labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'weird', color: 'url(x)' }],
      requested_reviewers: [{}, {}]
    })
    expect(pull).toMatchObject({ number: 7, author: 'me', headSha: 'abc', reviewers: 2, draft: false })
    expect(pull.labels[1].color).toBe('888888') // never a CSS injection
  })

  it('reads rate limit headers', () => {
    const headers: Record<string, string> = { 'x-ratelimit-remaining': '12', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '100' }
    expect(readRate((n) => headers[n] ?? null)).toEqual({ remaining: 12, limit: 60, resetAt: 100_000 })
  })

  it('flashes new and changed rows only', () => {
    const base: RepoSnapshot = {
      repo: { fullName: 'a/b', url: '', defaultBranch: 'main', openIssuesAndPulls: 0, stars: 0, private: false },
      pulls: [mapPull({ number: 1, updated_at: 't1', head: { sha: 's' } })],
      runs: [run({ id: 1 })],
      fetchedAt: 0,
      rate: { remaining: null, limit: null, resetAt: null }
    }
    const next = structuredClone(base)
    next.pulls.push(mapPull({ number: 2, updated_at: 't', head: { sha: 's2' } }))
    next.runs[0].status = 'in_progress'
    expect(diffSnapshots(base, next)).toEqual({ pulls: [2], runs: [1] })
    expect(diffSnapshots(null, next)).toEqual({ pulls: [], runs: [] })
    expect(diffSnapshots(base, base)).toEqual({ pulls: [], runs: [] })
  })

  it('writes the tool report', () => {
    const snapshot: RepoSnapshot = {
      repo: { fullName: 'a/b', url: 'https://github.com/a/b', defaultBranch: 'main', openIssuesAndPulls: 3, stars: 1, private: false },
      pulls: [{ ...mapPull({ number: 5, title: 'Fix', user: { login: 'bot' }, head: { sha: 'abcdef123', ref: 'fix' } }), ci: 'failure' }],
      runs: [run({ conclusion: 'failure', sha: 'deadbeef99' })],
      fetchedAt: 1000,
      rate: { remaining: 1, limit: 60, resetAt: null }
    }
    const text = toolReport(snapshot, 31_000)
    expect(text).toContain('a/b (https://github.com/a/b) — data from 30s ago.')
    expect(text).toContain('Default branch main: CI FAILING — "CI" on deadbee (completed/failure)')
    expect(text).toContain('- #5 Fix — by bot, branch fix @ abcdef1, CI FAILING.')
  })
})
