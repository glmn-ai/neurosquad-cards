import type { CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHostOptions, type MockPeer } from '@neurosquad/card-sdk/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../neurosquad-card.json'
import { RadarController, STORAGE_KEY } from '../src/controller'
import { fakeGithub, type FakeGithub } from '../src/fixtures'
import { GithubClient } from '../src/github'

const LOGGER: MockPeer = {
  cardId: 'router',
  kind: 'custom',
  name: 'Signal router',
  type: 'signal-router',
  direction: 'downstream',
  inputs: [{ id: 'in', label: 'In', type: 'ns:any', mode: 'stream', retain: false, default: true }],
  outputs: []
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

let live: RadarController[] = []
async function setup(
  options: MockHostOptions & { gh?: FakeGithub; repo?: string | null } = {}
): Promise<{ host: ReturnType<typeof createMockHost>; radar: RadarController; gh: FakeGithub }> {
  const gh = options.gh ?? fakeGithub()
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    fetch: gh.handler,
    ...options
  })
  if (options.repo !== null) host.setSettings({ repo: options.repo ?? 'acme/rocket-shop' })
  const card = await host.connect()
  const radar = new RadarController(card)
  live.push(radar)
  await radar.start()
  await settle()
  return { host, radar, gh }
}

afterEach(() => {
  for (const radar of live) radar.dispose()
  live = []
  vi.useRealTimers()
})

describe('RadarController', () => {
  it('asks for a repository when none is set', async () => {
    const { host, radar, gh } = await setup({ repo: null })
    expect(radar.getSnapshot().phase).toBe('empty')
    expect(gh.log).toHaveLength(0)
    expect(host.chrome.overview?.primary).toBe('No repository set')
  })

  it('polls GitHub through the proxy with the documented headers', async () => {
    const { radar, gh, host } = await setup()
    const snap = radar.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.data?.pulls).toHaveLength(6)
    expect(snap.data?.pulls.find((p) => p.number === 479)?.ci).toBe('failure')
    expect(snap.data?.pulls.find((p) => p.number === 477)?.ci).toBe('pending')
    const paths = gh.log.map((r) => new URL(r.url).pathname + new URL(r.url).search)
    expect(paths.slice(0, 3)).toEqual([
      '/repos/acme/rocket-shop',
      '/repos/acme/rocket-shop/pulls?state=open&per_page=20',
      '/repos/acme/rocket-shop/actions/runs?branch=main&event=push&per_page=10'
    ])
    expect(gh.log).toHaveLength(3 + 6) // + one check-runs per PR
    expect(gh.log[0].headers).toMatchObject({
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    })
    expect(gh.log[0].headers.authorization).toBeUndefined() // no token set
    expect(host.chrome.overview).toMatchObject({ primary: '6 PRs · main passing', tone: 'success' })
    expect(host.storage.instance.has(STORAGE_KEY)).toBe(true)
  })

  it('sends the token as a host-filled secret only when the user set one', async () => {
    const gh = fakeGithub()
    const host = createMockHost({ manifest: manifest as unknown as CardManifest, fetch: gh.handler })
    host.setSettings({ repo: 'acme/rocket-shop' })
    host.setSecret('token', 'ghp_test')
    const radar = new RadarController(await host.connect())
    live.push(radar)
    await radar.start()
    // The host fills the placeholder; the card itself never sees the value.
    expect(gh.log[0].headers.authorization).toBe('Bearer ghp_test')
  })

  it('uses ETags: a second poll is answered by 304s and final CI is not asked again', async () => {
    const { radar, gh } = await setup()
    const first = gh.log.length
    const remaining = gh.state.remaining
    await radar.refresh()
    const second = gh.log.slice(first)
    // repo + pulls + runs + the PRs whose CI is not final yet (477 running, 468 no checks);
    // passed/failed commits come from the cache
    expect(second).toHaveLength(5)
    expect(second.every((r) => r.headers['if-none-match'])).toBe(true)
    expect(gh.state.remaining).toBe(remaining) // 304s cost nothing
    expect(radar.client.notModified).toBe(5)
    expect(radar.getSnapshot().data?.pulls).toHaveLength(6)
  })

  it('flashes what changed since the last poll', async () => {
    const { radar, gh } = await setup()
    gh.addPull('New thing')
    await radar.refresh()
    const flash = radar.getSnapshot().flash
    expect(flash?.pulls).toEqual([496])
  })

  it('shows the rate limit with its reset time', async () => {
    const { radar, host } = await setup({ gh: fakeGithub({ failWith: 403 }) })
    const snap = radar.getSnapshot()
    expect(snap.phase).toBe('error')
    expect(snap.error).toMatchObject({ kind: 'rate-limit', status: 403 })
    expect(snap.error?.resetAt).toBeGreaterThan(Date.now())
    expect(host.chrome.overview?.tone).toBe('danger')
  })

  it('keeps showing the last good data when a later poll fails', async () => {
    const gh = fakeGithub()
    const { radar } = await setup({ gh })
    gh.state.failWith = 500
    await radar.refresh()
    const snap = radar.getSnapshot()
    expect(snap.phase).toBe('ready')
    expect(snap.error?.kind).toBe('http')
    expect(snap.data?.pulls).toHaveLength(6)
  })

  it('reports a missing repository', async () => {
    const { radar } = await setup({ repo: 'acme/nope' })
    expect(radar.getSnapshot().error?.kind).toBe('not-found')
  })

  it('cannot reach any host but api.github.com', async () => {
    const { host } = await setup()
    const card = await host.connect()
    await expect(card.net.fetch('https://evil.example.com/x')).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' })
    await expect(card.net.fetch('http://api.github.com/repos')).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' })
    const client = new GithubClient(card)
    // The client itself only ever builds api.github.com URLs.
    await expect(client.get('/repos/acme/rocket-shop')).resolves.toMatchObject({ full_name: 'acme/rocket-shop' })
  })

  it('does not poll while hidden or zoomed out, and catches up when seen again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const gh = fakeGithub()
    const host = createMockHost({ manifest: manifest as unknown as CardManifest, fetch: gh.handler })
    host.setSettings({ repo: 'acme/rocket-shop', intervalMin: 2 })
    host.setVisibility('hidden')
    const radar = new RadarController(await host.connect())
    live.push(radar)
    await radar.start()
    await settle()
    expect(gh.log).toHaveLength(0) // hidden at start: nothing

    host.setVisibility('visible')
    await settle()
    vi.advanceTimersByTime(1) // stale: the poll is due at once
    await settle(20)
    const afterShow = gh.log.length
    expect(afterShow).toBeGreaterThan(0) // stale → polled at once

    host.setVisibility('overview')
    await settle()
    vi.advanceTimersByTime(30 * 60_000)
    await settle()
    expect(gh.log).toHaveLength(afterShow) // no timer while zoomed out

    host.setVisibility('visible')
    await settle()
    vi.advanceTimersByTime(1)
    await settle(20)
    expect(gh.log.length).toBeGreaterThan(afterShow)

    const before = gh.log.length
    vi.advanceTimersByTime(2 * 60_000 + 10)
    await settle(20)
    expect(gh.log.length).toBeGreaterThan(before) // the interval runs while visible
  })

  it('alerts, badges and emits when the default branch goes red', async () => {
    const gh = fakeGithub({ mainCi: 'success' })
    const { radar, host } = await setup({ gh, peers: [LOGGER] })
    expect(host.chrome.badge).toMatchObject({ text: null })
    gh.state.mainCi = 'failure'
    await radar.refresh()
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'info' })
    expect(host.chrome.attention?.message).toContain('CI on main is failing')
    expect(host.chrome.badge).toMatchObject({ text: 'CI', tone: 'danger' })
    expect(host.deliveries.at(-1)).toMatchObject({
      to: 'router',
      output: 'ci',
      data: { type: 'ci', data: { branch: 'main', state: 'failure', previous: 'success' } }
    })
    gh.state.mainCi = 'success'
    await radar.refresh()
    await settle()
    expect(host.chrome.attention).toMatchObject({ level: 'none' })
    expect(host.chrome.badge).toMatchObject({ text: null })
  })

  it('answers the status tool with fresh data and shows who asked', async () => {
    const { radar, host, gh } = await setup()
    const before = gh.log.length
    const result = await host.callTool('status', {}, { agent: { id: 'a', name: 'Backend' } })
    const text = result.content[0].type === 'text' ? result.content[0].text : ''
    expect(text).toContain('acme/rocket-shop (https://github.com/acme/rocket-shop)')
    expect(text).toContain('#479 Fix race in cart totals when coupons stack')
    expect(gh.log.length).toBe(before) // data was fresh (< 1 min): no new requests
    expect(radar.getSnapshot().lastRead?.agent).toBe('Backend')
  })

  it('detects the repository from .git/config after asking for fs.read', async () => {
    const asked: string[][] = []
    const { radar, host } = await setup({
      repo: null,
      files: { '.git/config': '[remote "origin"]\n\turl = https://github.com/acme/rocket-shop.git\n' },
      requestPermissions: (ids) => {
        asked.push(ids)
        return ids
      }
    })
    const ref = await radar.detect()
    await settle(20)
    expect(asked).toEqual([['fs.read']])
    expect(ref).toEqual({ owner: 'acme', repo: 'rocket-shop' })
    expect(radar.getSnapshot().phase).toBe('ready')
    expect(host.toasts.at(-1)?.message).toBe('Watching acme/rocket-shop')
  })

  it('does nothing when fs.read is refused', async () => {
    const { radar, host } = await setup({ repo: null, requestPermissions: () => [] })
    expect(await radar.detect()).toBeNull()
    expect(host.calls.some((c) => c.method === 'fs.read')).toBe(false)
    expect(host.toasts.at(-1)?.message).toContain('permission')
  })

  it('restores the last data from storage without a request when hidden', async () => {
    const gh = fakeGithub()
    const { host } = await setup({ gh })
    const count = gh.log.length
    host.setVisibility('hidden')
    const radar2 = new RadarController(await host.connect())
    live.push(radar2)
    await radar2.start()
    expect(radar2.getSnapshot().phase).toBe('ready')
    expect(radar2.getSnapshot().data?.pulls).toHaveLength(6)
    expect(gh.log.length).toBe(count)
  })

  it('speaks the app language live', async () => {
    const { host } = await setup()
    host.setLanguage('ru')
    await settle()
    expect(host.chrome.overview?.primary).toBe('6 PR · main: проходит')
    expect(host.chrome.menu.map((m) => m.label)).toEqual(['Обновить', 'Открыть на GitHub', 'Определить репозиторий'])
  })

  it('asks for nothing but api.github.com (and fs.read as optional)', () => {
    const perms = manifest.permissions as { id: string; hosts?: string[]; optional?: boolean }[]
    expect(perms.filter((p) => !p.optional)).toEqual([expect.objectContaining({ id: 'network', hosts: ['api.github.com'] })])
    expect(perms.filter((p) => p.optional).map((p) => p.id)).toEqual(['fs.read'])
  })
})
