// Standalone preview: the card on the SDK's mock host with a fake GitHub.
// Query parameters pick a state for screenshots and manual checks:
//   ?state=filled (default) | empty | loading | error | updated
//   &ci=failure|success|in_progress (the default branch)   &lang=en|ru|zh
import type { Card, CardManifest } from '@neurosquad/card-sdk'
import { createMockHost, type MockHost } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import type { RadarController } from './controller'
import { fakeGithub, type FakeGithub } from './fixtures'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'filled'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'
const ci = (params.get('ci') ?? 'failure') as 'failure' | 'success' | 'in_progress'

let previewHost: MockHost | null = null
let github: FakeGithub | null = null

export async function previewCard(): Promise<Card> {
  github = fakeGithub({ mainCi: ci, ...(state === 'error' ? { failWith: 403 } : {}) })
  const gh = github
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    files: { '.git/config': '[remote "origin"]\n\turl = git@github.com:acme/rocket-shop.git\n' },
    fetch: (request) => (state === 'loading' ? new Promise(() => {}) : gh.handler(request))
  })
  if (state !== 'empty') host.setSettings({ repo: 'acme/rocket-shop' })
  Object.assign(window, { mockHost: host, github: gh })
  previewHost = host
  return host.connect()
}

/** Plays the "just updated" state: a new PR appears, and an agent checks CI. */
export function afterStart(radar: RadarController): void {
  if (state !== 'updated' || !previewHost || !github) return
  const host = previewHost
  github.addPull('Retry flaky payment webhook test')
  setTimeout(() => {
    void radar.refresh().then(() => host.callTool('status', {}, { agent: { id: 'lead', name: 'Lead' } }))
  }, 200)
}
