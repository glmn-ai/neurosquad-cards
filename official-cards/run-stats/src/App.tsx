import type { AgentUsage, Translator } from '@neurosquad/card-sdk'
import { useCardContext, usePaused, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RunController } from './controller'
import { catalog } from './i18n'
import {
  formatInt,
  formatUsd,
  harnessLabel,
  stopwatch,
  type MetricKey
} from './model'

/** Re-renders once a second — only while someone can see the card and a turn is under way. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

const FLASH_MS = 1400

export function App({ run }: { run: RunController }): React.JSX.Element {
  const snap = useSyncExternalStore(run.subscribe, run.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  useCardContext() // re-render on settings / theme / size changes
  const usage = snap.usage
  const frozen = snap.state.frozenUntil !== undefined
  const live = !paused && !frozen && (usage?.status === 'working' || usage?.status === 'needs-input')
  const now = useNow(live)

  if (snap.phase === 'loading') {
    return (
      <main className="rs rs--state">
        <div className="state">
          <span className="ns-spinner" aria-hidden />
          <p className="state-body">{t('loading')}</p>
        </div>
      </main>
    )
  }
  if (snap.phase === 'unsupported' || snap.phase === 'error' || snap.phase === 'empty') {
    const key = snap.phase
    return (
      <main className="rs rs--state" data-paused={paused || undefined}>
        <div className="state">
          <div className={`state-glyph${key === 'error' ? ' state-glyph--danger' : ''}`} aria-hidden>
            <Gauge />
          </div>
          <p className="state-title">{t(`${key}.title`)}</p>
          <p className="state-body">{key === 'error' ? snap.error : t(`${key}.body`)}</p>
          {key === 'error' && (
            <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => void run.load()}>
              {t('error.retry')}
            </button>
          )}
        </div>
      </main>
    )
  }
  if (snap.phase === 'choose') {
    return (
      <main className="rs rs--state">
        <div className="state">
          <p className="state-title">{t('choose.title')}</p>
          <p className="state-body">{t('choose.body')}</p>
          <div className="choose">
            {snap.candidates.map((agent) => (
              <button
                key={agent.id}
                className="ns-btn ns-btn--outline ns-btn--sm"
                onClick={() => void run.choose(agent.id)}
              >
                <span className={`dot dot--${agent.status}`} />
                {agent.name}
                <span className="ns-muted">{harnessLabel(agent.harness)}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    )
  }

  const agent = snap.agent!
  const lang = t.language
  const status = usage?.status ?? agent.status
  const started = usage !== null && usage.prompts > 0
  const elapsed = run.liveElapsed(now)
  const working = run.liveWorking(now)
  const flashing = (key: MetricKey): boolean =>
    (snap.changedAt[key] ?? 0) > 0 && now - (snap.changedAt[key] ?? 0) < FLASH_MS
  const phaseText = frozen
    ? t(snap.state.frozenBy === 'finish' ? 'phase.frozen' : 'phase.frozenManual')
    : started
      ? t('phase.measuring')
      : t('phase.armed')
  const sinceAt = usage?.firstPromptAt ?? (snap.state.since ? snap.state.since : null)
  const sinceText =
    sinceAt !== null
      ? t('since', {
          time: new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : lang === 'zh' ? 'zh-CN' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).format(sinceAt)
        })
      : ''
  const tokens = (value: number | null): React.JSX.Element =>
    value === null ? <span className="nr">{t('notReported')}</span> : <>{formatInt(value, lang)}</>

  return (
    <main
      className="rs"
      data-paused={paused || undefined}
      data-live={live || undefined}
      data-frozen={frozen || undefined}
    >
      <header className="rs-head">
        <div className="who">
          <span className={`dot dot--${status}`} aria-hidden />
          <span className="who-name">{agent.name}</span>
          <span className="who-harness">{harnessLabel(agent.harness)}</span>
          <span className={`pill pill--${status}`}>{t(`status.${status}`)}</span>
        </div>
        {(usage?.model || usage?.provider) && (
          <div className="model ns-mono" title={usage?.model}>
            {usage?.model}
            {usage?.provider ? <span className="ns-muted"> · {usage.provider}</span> : null}
          </div>
        )}
      </header>

      <section className="hero">
        <div className={`hero-cell${flashing('total') ? ' flash' : ''}`}>
          <span className="label" title={t('hint.total')}>
            {t('metric.total')}
          </span>
          <span className="big">
            {usage && usage.totalTokens !== null ? formatInt(usage.totalTokens, lang) : started ? t('notReported') : '0'}
          </span>
        </div>
        <div className="hero-cell hero-cell--time">
          <span className="label" title={t('hint.elapsed')}>
            {t('metric.elapsed')}
          </span>
          <span className="big big--time">{elapsed !== null ? stopwatch(elapsed) : '0:00'}</span>
        </div>
      </section>

      {usage && usage.usageReadable && usage.totalTokens !== null && usage.totalTokens > 0 && (
        <Composition usage={usage} t={t} />
      )}

      <div className="phase">
        <span className={`phase-mark${frozen ? ' phase-mark--frozen' : started ? ' phase-mark--live' : ''}`} />
        <span>{phaseText}</span>
        {sinceText && <span className="ns-muted">{sinceText}</span>}
      </div>

      <section className="grid">
        <Tile k="prompts" t={t} flash={flashing('prompts')} value={usage ? formatInt(usage.prompts, lang) : '0'} />
        <Tile k="requests" t={t} flash={flashing('requests')} value={usage ? tokens(usage.requests) : '0'} />
        <Tile k="input" t={t} flash={flashing('input')} value={usage ? tokens(usage.inputTokens) : '0'} />
        <Tile
          k="output"
          t={t}
          flash={flashing('output')}
          value={usage ? tokens(usage.outputTokens) : '0'}
          sub={
            usage?.reasoningTokens ? t('reasoning', { count: formatInt(usage.reasoningTokens, lang) }) : undefined
          }
        />
        <Tile k="cacheRead" t={t} flash={flashing('cacheRead')} value={usage ? tokens(usage.cacheReadTokens) : '0'} />
        <Tile k="cacheWrite" t={t} flash={flashing('cacheWrite')} value={usage ? tokens(usage.cacheWriteTokens) : '0'} />
        <Tile k="working" t={t} value={working !== null ? stopwatch(working) : '0:00'} />
        <Tile
          k="cost"
          t={t}
          flash={flashing('cost')}
          value={
            usage?.costMicroUsd != null ? (
              <>
                {formatUsd(usage.costMicroUsd)}
                {usage.costPartial ? '+' : ''}
              </>
            ) : (
              <span className="nr">{t('noPrice')}</span>
            )
          }
        />
      </section>

      {usage && !usage.usageReadable && <p className="note">{t('unreadable')}</p>}
      {usage && !usage.timingComplete && <p className="note">{t('partial')}</p>}
      {frozen && usage && snap.agent?.status === 'working' && <p className="note">{t('workingAgain')}</p>}

      <footer className="actions">
        <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => void run.reset()}>
          <Restart />
          {started || frozen ? t('action.reset') : t('action.start')}
        </button>
        {frozen ? (
          <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => void run.unfreeze()}>
            {t('action.unfreeze')}
          </button>
        ) : (
          <button
            className="ns-btn ns-btn--secondary ns-btn--sm"
            disabled={!started}
            onClick={() => void run.freeze()}
          >
            {t('action.freeze')}
          </button>
        )}
        <span className="spacer" />
        <button
          className="ns-btn ns-btn--ghost ns-btn--sm"
          disabled={!usage}
          onClick={() => void run.copy('markdown')}
          title={t('action.copyMd')}
        >
          MD
        </button>
        <button
          className="ns-btn ns-btn--ghost ns-btn--sm"
          disabled={!usage}
          onClick={() => void run.copy('json')}
          title={t('action.copyJson')}
        >
          JSON
        </button>
        <label className="auto">
          <input
            type="checkbox"
            className="ns-switch"
            checked={run.freezeOnFinish}
            onChange={(event) => void run.setFreezeOnFinish(event.target.checked)}
          />
          <span>{t('action.autoFreeze')}</span>
        </label>
        {snap.notice && now - snap.notice.at < 4000 && (
          <span className="notice" key={snap.notice.at}>
            {snap.notice.text}
          </span>
        )}
      </footer>
    </main>
  )
}

function Tile({
  k,
  t,
  value,
  sub,
  flash
}: {
  k: MetricKey
  t: Translator
  value: React.ReactNode
  sub?: string
  flash?: boolean
}): React.JSX.Element {
  return (
    <div className={`tile tile--${k}${flash ? ' flash' : ''}`} title={t(`hint.${k}`)}>
      <span className="label">{t(`metric.${k}`)}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

/** The total split into its four kinds — the shape of the run at a glance. */
function Composition({
  usage,
  t
}: {
  usage: AgentUsage
  t: Translator
}): React.JSX.Element {
  const parts: [MetricKey, number][] = [
    ['input', usage.inputTokens ?? 0],
    ['cacheRead', usage.cacheReadTokens ?? 0],
    ['cacheWrite', usage.cacheWriteTokens ?? 0],
    ['output', usage.outputTokens ?? 0]
  ]
  const total = parts.reduce((sum, [, value]) => sum + value, 0) || 1
  return (
    <div className="mix" role="img" aria-label={t('metric.total')}>
      {parts
        .filter(([, value]) => value > 0)
        .map(([key, value]) => (
          <span
            key={key}
            className={`mix-part mix-part--${key}`}
            style={{ flexGrow: value / total }}
            title={`${t(`metric.${key}`)}: ${Math.round((value / total) * 1000) / 10}%`}
          />
        ))}
    </div>
  )
}

function Gauge(): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
      <path d="M8 34a16 16 0 1 1 32 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".35" />
      <path d="M8 34a16 16 0 0 1 22-14.8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M24 34l8-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="34" r="3" fill="currentColor" />
    </svg>
  )
}

function Restart(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M10 3a7 7 0 1 1-6.32 4H2l3-4 3 4H6.07A5 5 0 1 0 10 5V3z" />
    </svg>
  )
}
