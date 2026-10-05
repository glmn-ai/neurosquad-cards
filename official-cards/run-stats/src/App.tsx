import type { AgentUsage, Translator } from '@neurosquad/card-sdk'
import { useCardContext, usePaused, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RunController } from './controller'
import { catalog } from './i18n'
import {
  formatInt,
  formatUsd,
  harnessLabel,
  partValue,
  stopwatch,
  subagentSplit,
  type MetricKey,
  type PartKey,
  type SubagentSplit
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

/** The card's height (the frame is the card): decides whether the breakdown opens by itself. */
function useWindowHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = (): void => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

export function App({ run }: { run: RunController }): React.JSX.Element {
  const snap = useSyncExternalStore(run.subscribe, run.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  const context = useCardContext() // re-render on settings / theme / size changes
  const usage = snap.usage
  const frozen = snap.state.frozenUntil !== undefined
  const live = !paused && !frozen && (usage?.status === 'working' || usage?.status === 'needs-input')
  const now = useNow(live)
  const height = useWindowHeight()
  const [splitToggled, setSplitToggled] = useState<boolean | null>(null)

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
  // Contract 1.3: the part subagents made (null on older apps or when none ran: nothing extra).
  const split = subagentSplit(usage)
  const incl = (value: number | null): string | undefined =>
    split
      ? value === null
        ? t('incl.plain', { count: split.subagents.count })
        : t('incl.value', { count: split.subagents.count, value: formatInt(value, lang) })
      : undefined
  const splitOpen = splitToggled ?? (context.expanded || height >= SPLIT_ROOMY_H)
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
          {split && <span className="hero-sub">{incl(split.subagents.totalTokens)}</span>}
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
        {split && !splitOpen && (
          <button
            type="button"
            className="split-chip"
            aria-expanded={false}
            title={t('split.title')}
            onClick={() => setSplitToggled(true)}
          >
            <Chevron />
            {t('split.subagents', { count: split.subagents.count })}
            <SplitBar split={split} t={t} />
          </button>
        )}
      </div>

      <section className="grid">
        <Tile k="prompts" t={t} flash={flashing('prompts')} value={usage ? formatInt(usage.prompts, lang) : '0'} />
        <Tile
          k="requests"
          t={t}
          flash={flashing('requests')}
          value={usage ? tokens(usage.requests) : '0'}
          sub={
            split && split.subagents.requests !== null
              ? t('incl.requests', { value: formatInt(split.subagents.requests, lang) })
              : undefined
          }
        />
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

      {split && splitOpen && <SplitPanel split={split} t={t} onCollapse={() => setSplitToggled(false)} />}

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

const SPLIT_COLUMNS: readonly PartKey[] = ['requests', 'input', 'output', 'cacheRead', 'cacheWrite', 'total']
/** From this card height the breakdown opens by itself; below it is one line until clicked. */
const SPLIT_ROOMY_H = 540

/** "Main agent vs subagents": the totals above, split into the agent's own loop and its subagents. */
function SplitPanel({
  split,
  t,
  onCollapse
}: {
  split: SubagentSplit
  t: Translator
  onCollapse: () => void
}): React.JSX.Element {
  const lang = t.language
  const subLabel = t('split.subagents', { count: split.subagents.count })
  const rows = [
    { key: 'main', label: t('split.main'), part: split.main },
    { key: 'sub', label: subLabel, part: split.subagents }
  ] as const
  return (
    <section className="split" aria-label={t('split.title')}>
      <button type="button" className="split-head" aria-expanded onClick={onCollapse}>
        <Chevron />
        <span className="label">{t('split.title')}</span>
        <span className="split-hint">{t('split.hint')}</span>
      </button>
      <SplitBar split={split} t={t} />
      <table className="split-table">
        <thead>
          <tr>
            <th scope="col" />
            {SPLIT_COLUMNS.map((key) => (
              <th key={key} scope="col" className={`col col--${key}`} title={t(`hint.${key}`)}>
                {key === 'requests' ? t('split.requests') : t(`metric.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={`split-row split-row--${row.key}`}>
              <th scope="row">
                <span className="split-dot" aria-hidden />
                {row.label}
              </th>
              {SPLIT_COLUMNS.map((key) => {
                const value = partValue(row.part, key)
                return (
                  <td key={key} className={`col col--${key}`}>
                    {value === null ? <span className="nr">{t('notReported')}</span> : formatInt(value, lang)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Main agent vs subagents as a two-part bar (share of the total tokens). */
function SplitBar({ split, t }: { split: SubagentSplit; t: Translator }): React.JSX.Element | null {
  const lang = t.language
  const subLabel = t('split.subagents', { count: split.subagents.count })
  const mainTokens = split.main.totalTokens ?? 0
  const subTokens = split.subagents.totalTokens ?? 0
  const sum = mainTokens + subTokens
  const pct = (value: number): string =>
    new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'percent',
      maximumFractionDigits: 1
    }).format(value / sum)
  if (sum <= 0) return null
  return (
    <div className="split-bar" aria-hidden>
      {mainTokens > 0 && (
        <span
          className="split-seg split-seg--main"
          style={{ flexGrow: mainTokens / sum }}
          title={t('split.share', { part: t('split.main'), percent: pct(mainTokens) })}
        />
      )}
      {subTokens > 0 && (
        <span
          className="split-seg split-seg--sub"
          style={{ flexGrow: subTokens / sum }}
          title={t('split.share', { part: subLabel, percent: pct(subTokens) })}
        />
      )}
    </div>
  )
}

function Chevron(): React.JSX.Element {
  return (
    <svg className="split-chevron" viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden>
      <path d="M7.2 4.2a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.5 10 7.2 5.7a1 1 0 0 1 0-1.5z" />
    </svg>
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
