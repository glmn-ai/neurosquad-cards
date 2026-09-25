import type { AgentStatus } from '@neurosquad/card-sdk'
import { useCardContext, usePaused, useStorage, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { WINDOWS, type PulseController, type WindowKey } from './controller'
import { duration, harnessLabel } from './format'
import { catalog } from './i18n'
import { laneBlocks, type AgentSummary } from './model'

/** Re-renders once a second — only while someone can see the card. */
function useNow(paused: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (paused) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [paused])
  return now
}

const WINDOW_KEYS = Object.keys(WINDOWS) as WindowKey[]

const AXIS_UNITS = { en: ['m', 'h'], ru: [' мин', ' ч'], zh: ['分', '时'] } as const

/** Axis ticks: whole minutes or hours only ("−45m", "−2h"). */
function axisLabel(ms: number, lang: 'en' | 'ru' | 'zh'): string {
  const [m, h] = AXIS_UNITS[lang] ?? AXIS_UNITS.en
  const minutes = Math.round(ms / 60_000)
  return minutes >= 120 && minutes % 60 === 0 ? `${minutes / 60}${h}` : `${minutes}${m}`
}

export function App({ pulse }: { pulse: PulseController }): React.JSX.Element {
  const snap = useSyncExternalStore(pulse.subscribe, pulse.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  const now = useNow(paused)
  const [windowKey, setWindowKey] = useStorage<string>('window', '1h')
  const key: WindowKey = windowKey in WINDOWS ? (windowKey as WindowKey) : '1h'
  useCardContext() // re-render on settings / theme changes

  if (snap.phase === 'loading') return <Loading label={t('loading')} />
  if (snap.phase === 'error') {
    return (
      <main className="pulse pulse--state" data-paused={paused || undefined}>
        <div className="state">
          <div className="state-glyph state-glyph--danger" aria-hidden>
            <Wave />
          </div>
          <p className="state-title">{t('error.title')}</p>
          <p className="state-body ns-mono">{snap.error}</p>
          <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => void pulse.load()}>
            {t('error.retry')}
          </button>
        </div>
      </main>
    )
  }

  const windowMs = WINDOWS[key]
  const summary = pulse.summary(windowMs)
  const lang = t.language
  if (summary.agents.length === 0) {
    return (
      <main className="pulse pulse--state" data-paused={paused || undefined}>
        <div className="state">
          <div className="state-glyph" aria-hidden>
            <Wave flat />
          </div>
          <p className="state-title">{t('empty.title')}</p>
          <p className="state-body">{t('empty.body')}</p>
        </div>
      </main>
    )
  }

  const readRecently = snap.lastRead && now - snap.lastRead.at < 8000
  const ticks = [0.25, 0.5, 0.75]

  return (
    <main className="pulse" data-paused={paused || undefined}>
      <header className="pulse-head">
        <div className="kpis">
          <Kpi tone="accent" label={t('kpi.working')} value={summary.counts.working} live={summary.counts.working > 0} />
          <Kpi tone="warning" label={t('kpi.waiting')} value={summary.counts['needs-input']} live={summary.counts['needs-input'] > 0} />
          <Kpi label={t('kpi.turns')} value={summary.turns} className="kpi--wide" />
          <Kpi
            label={t('kpi.median')}
            value={summary.medianTurnMs !== null ? duration(summary.medianTurnMs, lang) : '—'}
            className="kpi--wide"
          />
        </div>
        <div className="segmented" role="radiogroup" aria-label={t('window.label')}>
          {WINDOW_KEYS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={k === key}
              className={k === key ? 'is-on' : undefined}
              onClick={() => setWindowKey(k)}
            >
              {t(`window.${k}`)}
            </button>
          ))}
        </div>
      </header>

      {readRecently && (
        <div className="read-pill" key={snap.lastRead!.at}>
          <span className="read-dot" />
          {t('read', { agent: snap.lastRead!.agent })}
        </div>
      )}

      <section className="lanes" aria-live="polite">
        <div className="axis" aria-hidden>
          <span />
          <div className="axis-track">
            {ticks.map((f) => (
              <span key={f} className="axis-tick" style={{ left: `${f * 100}%` }}>
                −{axisLabel(windowMs * (1 - f), lang)}
              </span>
            ))}
            <span className="axis-now">{t('ago')}</span>
          </div>
        </div>
        {summary.agents.map((agent) => (
          <Lane
            key={agent.meta.id}
            agent={agent}
            blocks={laneBlocks(pulse.history, agent.meta.id, now, windowMs)}
            now={now}
            changedAt={snap.changedAt[agent.meta.id]}
            statusText={t(`status.${agent.status}`)}
            busyText={t('busy', { percent: Math.round(agent.busyShare * 100) })}
            turnsText={t('turnsCount', { count: agent.turns })}
            lang={lang}
          />
        ))}
      </section>

      <footer className="pulse-foot">
        <span className={summary.waitingMs > 0 ? 'foot-warn' : undefined}>
          {summary.waitingMs > 0
            ? t('footer.waited', { time: duration(summary.waitingMs, lang) })
            : t('footer.noWait')}
        </span>
        {summary.longestTurn && (
          <span className="foot-longest">
            {t('footer.longest', {
              time: duration(summary.longestTurn.ms, lang),
              agent: summary.longestTurn.agent
            })}
          </span>
        )}
      </footer>
    </main>
  )
}

function Kpi({
  label,
  value,
  tone,
  live,
  className
}: {
  label: string
  value: number | string
  tone?: 'accent' | 'warning'
  live?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div className={['kpi', tone && `kpi--${tone}`, live && 'is-live', className].filter(Boolean).join(' ')}>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  )
}

const STATUS_CLASS: Record<AgentStatus, string> = {
  working: 'st-working',
  'needs-input': 'st-waiting',
  finished: 'st-finished',
  idle: 'st-idle',
  exited: 'st-exited'
}

function Lane({
  agent,
  blocks,
  now,
  changedAt,
  statusText,
  busyText,
  turnsText,
  lang
}: {
  agent: AgentSummary
  blocks: ReturnType<typeof laneBlocks>
  now: number
  changedAt: number | undefined
  statusText: string
  busyText: string
  turnsText: string
  lang: 'en' | 'ru' | 'zh'
}): React.JSX.Element {
  const since = agent.since !== null ? duration(now - agent.since, lang) : ''
  const max = Math.max(1, ...agent.recentTurns)
  return (
    <div className={`lane ${STATUS_CLASS[agent.status]}`}>
      {changedAt && now - changedAt < 2500 && <span className="lane-flash" key={changedAt} />}
      <div className="lane-meta">
        <span className="lane-dot" />
        <div className="lane-names">
          <span className="lane-title">
            <span className="lane-name" title={agent.meta.name}>
              {agent.meta.name}
            </span>
            <span className="lane-harness">{harnessLabel(agent.meta.harness)}</span>
          </span>
          <span className="lane-sub">
            <span className="lane-status">{statusText}</span>
            {since && <span className="lane-since">{since}</span>}
          </span>
        </div>
      </div>
      <div className="lane-track" aria-hidden>
        {blocks.map((block) => (
          <span
            key={block.from}
            className={`blk ${STATUS_CLASS[block.status]}`}
            style={{ left: `${block.left * 100}%`, width: `max(2px, ${block.width * 100}%)` }}
          />
        ))}
      </div>
      <div className="lane-stats">
        <span className="spark" aria-hidden>
          {agent.recentTurns.map((ms, i) => (
            <i key={i} style={{ height: `${Math.max(12, (ms / max) * 100)}%` }} />
          ))}
        </span>
        <span className="lane-stat">{turnsText}</span>
        <span className="lane-stat lane-busy">{busyText}</span>
      </div>
    </div>
  )
}

function Wave({ flat }: { flat?: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 120 40" width="120" height="40">
      <path
        d={flat ? 'M0 20 H120' : 'M0 20 H34 L42 6 L52 34 L60 12 L66 20 H120'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Loading({ label }: { label: string }): React.JSX.Element {
  return (
    <main className="pulse" aria-busy="true">
      <header className="pulse-head">
        <div className="kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`kpi skel ${i > 1 ? 'kpi--wide' : ''}`}>
              <span className="kpi-value">&nbsp;</span>
              <span className="kpi-label">&nbsp;</span>
            </div>
          ))}
        </div>
      </header>
      <section className="lanes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="lane skel-lane">
            <div className="lane-meta">
              <span className="skel-line" style={{ width: `${70 - i * 12}%` }} />
            </div>
            <div className="lane-track skel" />
          </div>
        ))}
      </section>
      <footer className="pulse-foot">
        <span className="ns-muted">{label}</span>
      </footer>
    </main>
  )
}
