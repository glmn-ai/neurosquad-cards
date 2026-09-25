// Standalone preview: the card on the SDK's mock host with a sample release.
// Query parameters pick a state for screenshots and manual checks:
//   ?state=filled (default) | empty | loading | error | updated | hold | go | launched
//   &skin=phosphor|blueprint|app  &accent=%23ff6a00  &lang=en|ru|zh
import type { Card, CardManifest, JsonValue } from '@neurosquad/card-sdk'
import { createMockHost, type MockHost } from '@neurosquad/card-sdk/testing'
import manifest from '../neurosquad-card.json'
import type { Board, Check } from './model'

const params = new URLSearchParams(location.search)
const state = params.get('state') ?? 'filled'
const lang = (params.get('lang') ?? 'en') as 'en' | 'ru' | 'zh'

const NAMES: Record<'en' | 'ru' | 'zh', string[]> = {
  en: ['Tests green', 'Changelog written', 'Migrations reviewed', 'Staging smoke test', 'Rollback plan', 'Docs updated', 'On-call notified'],
  ru: ['Тесты зелёные', 'Changelog написан', 'Миграции проверены', 'Смоук на стейдже', 'План отката', 'Документация обновлена', 'Дежурные предупреждены'],
  zh: ['测试全部通过', '更新日志已写', '迁移已审查', '预发环境冒烟测试', '回滚方案', '文档已更新', '已通知值班']
}

function sampleBoard(now: number): Board {
  const names = NAMES[lang]
  const note: Record<string, string> = {
    en: '412 passed · 0 failed',
    ru: '412 прошло · 0 упало',
    zh: '412 通过 · 0 失败'
  }
  const checks: Check[] = [
    { id: 'c1', name: names[0], status: 'go', note: note[lang], by: 'Backend', byAgent: true, at: now - 300_000 },
    { id: 'c2', name: names[1], status: 'go', by: 'Docs writer', byAgent: true, at: now - 600_000 },
    { id: 'c3', name: names[2], status: 'pending' },
    { id: 'c4', name: names[3], status: 'go', by: lang === 'en' ? 'you' : lang === 'ru' ? 'вы' : '你', at: now - 200_000 },
    { id: 'c5', name: names[4], status: 'pending' },
    { id: 'c6', name: names[5], status: 'go', by: 'Frontend', byAgent: true, at: now - 900_000 },
    { id: 'c7', name: names[6], status: 'pending' }
  ]
  const board: Board = { version: 1, checks, target: now + 12 * 60_000 + 30_000, goAt: null }
  if (state === 'hold') checks[2].status = 'nogo'
  if (state === 'go' || state === 'launched') {
    for (const check of checks) check.status = 'go'
    board.target = state === 'go' ? now + 3 * 60_000 + 8_000 : now + 1200
  }
  return board
}

let previewHost: MockHost | null = null

export async function previewCard(): Promise<Card> {
  const now = Date.now()
  const host = createMockHost({
    manifest: manifest as unknown as CardManifest,
    context: { i18n: { language: lang, locale: { en: 'en-US', ru: 'ru-RU', zh: 'zh-CN' }[lang] } },
    peers: [
      {
        cardId: 'lead',
        kind: 'agent',
        name: 'Lead',
        type: 'claude-code',
        direction: 'downstream',
        inputs: [
          { id: 'prompt', label: 'Prompt', type: 'ns:text', mode: 'stream', retain: false, default: true, permission: 'agents.prompt' }
        ],
        outputs: []
      }
    ]
  })
  host.setSettings({
    skin: params.get('skin') ?? 'phosphor',
    title: { en: 'v2.4 release', ru: 'Релиз v2.4', zh: 'v2.4 发布' }[lang],
    brief:
      state === 'filled' || state === 'updated'
        ? { en: 'Ship payments v2 to everyone. Hold if a migration touches billing.', ru: 'Выкатываем payments v2 на всех. Стоп, если миграция трогает биллинг.', zh: '向所有用户发布 payments v2。如迁移涉及计费则暂停。' }[lang]
        : '',
    ...(params.get('accent') ? { accent: params.get('accent')! } : {})
  })
  if (state !== 'empty') host.storage.instance.set('board', sampleBoard(now) as unknown as JsonValue)
  if (state === 'loading') host.handle('storage.get', () => new Promise(() => {}))
  if (state === 'error') {
    host.handle('storage.get', () => {
      throw new Error('Card storage is unavailable (disk full?)')
    })
  }
  Object.assign(window, { mockHost: host }) // DevTools: mockHost.callTool('set_check', { check: 'c3', status: 'go' })
  previewHost = host
  return host.connect()
}

/** Plays the "an agent just changed the board" state. */
export function afterStart(): void {
  const host = previewHost
  if (!host || state !== 'updated') return
  const note = {
    en: 'Migration 0042 drops users.legacy_id — needs a backfill first',
    ru: 'Миграция 0042 удаляет users.legacy_id — сначала нужен бэкфилл',
    zh: '迁移 0042 删除了 users.legacy_id——需要先回填'
  }[lang]
  setTimeout(
    () =>
      void host.callTool(
        'set_check',
        { check: 'c3', status: 'nogo', note },
        { agent: { id: 'back', name: 'Backend' } }
      ),
    300
  )
}
