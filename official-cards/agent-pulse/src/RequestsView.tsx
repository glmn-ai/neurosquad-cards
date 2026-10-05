import type { AgentRequestSpan, AgentTimeline, Translator } from '@neurosquad/card-sdk'
import { useExpanded, usePaused } from '@neurosquad/card-sdk/react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { harnessLabel } from './format'
import {
  barHeight,
  dataExtent,
  durationOf,
  laneGeometry,
  laneStats,
  relLabel,
  shortDuration,
  ticks,
  zoomView,
  type LaneStats
} from './requestModel'
import { REQUEST_WINDOWS, type RequestsController, type RequestWindowKey } from './requests'

const WINDOW_KEYS = Object.keys(REQUEST_WINDOWS) as RequestWindowKey[]
const W = 1000 // SVG user units across a track

/** Re-renders once a second while a turn is under way and someone can see it. */
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

interface Hover {
  lane: number
  request: number
  x: number
  y: number
}

export function RequestsView({
  requests,
  t
}: {
  requests: RequestsController
  t: Translator
}): React.JSX.Element {
  const snap = useSyncExternalStore(requests.subscribe, requests.getSnapshot)
  const paused = usePaused()
  const expanded = useExpanded()
  const live = requests.live
  const now = useNow(live && !paused)
  const [manual, setManual] = useState<{ from: number; to: number } | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const drag = useRef<{ x: number; view: { from: number; to: number }; width: number } | null>(null)
  const lang = t.language

  const timelines = useMemo(
    () => snap.lanes.map((lane) => lane.timeline).filter((tl): tl is AgentTimeline => tl !== null),
    [snap.lanes]
  )
  const stats = useMemo(
    () => snap.lanes.map((lane) => (lane.timeline ? laneStats(lane.timeline) : null)),
    [snap.lanes]
  )
  const extent = dataExtent(timelines, live ? now : snap.fetchedAt || now)

  if (
    snap.phase === 'unsupported' ||
    snap.phase === 'empty' ||
    snap.phase === 'permission' ||
    snap.phase === 'error'
  ) {
    const key = snap.phase
    return (
      <div className="state rq-state">
        <p className="state-title">{t(`requests.${key}.title`)}</p>
        <p className="state-body">{key === 'error' ? snap.error : t(`requests.${key}.body`)}</p>
        {key === 'permission' && (
          <button
            className="ns-btn ns-btn--primary ns-btn--sm"
            onClick={() => void requests.allow()}
          >
            {t('requests.permission.allow')}
          </button>
        )}
        {key === 'error' && (
          <button
            className="ns-btn ns-btn--secondary ns-btn--sm"
            onClick={() => void requests.load()}
          >
            {t('error.retry')}
          </button>
        )}
      </div>
    )
  }

  const view = manual ?? extent ?? { from: now - 60_000, to: now }
  const span = Math.max(1, view.to - view.from)
  const origin = extent?.origin ?? view.from
  const x = (at: number): number => ((at - view.from) / span) * W
  const total = summarizeAll(timelines)

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!expanded) return
    const rect = event.currentTarget.getBoundingClientRect()
    const at = view.from + ((event.clientX - rect.left) / rect.width) * span
    setManual(zoomView(view, at, event.deltaY > 0 ? 1.25 : 0.8))
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!expanded) return
    drag.current = {
      x: event.clientX,
      view,
      width: event.currentTarget.getBoundingClientRect().width
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const shift = ((event.clientX - d.x) / d.width) * (d.view.to - d.view.from)
    setManual({ from: d.view.from - shift, to: d.view.to - shift })
  }
  const hovered =
    hover && snap.lanes[hover.lane]?.timeline?.requests[hover.request]
      ? {
          lane: snap.lanes[hover.lane],
          request: snap.lanes[hover.lane].timeline!.requests[hover.request]
        }
      : null

  return (
    <section className="rq" data-paused={paused || undefined}>
      <header className="pulse-head">
        <div className="kpis">
          <div className="kpi">
            <span className="kpi-value">{total.requests}</span>
            <span className="kpi-label">{t('requests.kpi.requests')}</span>
          </div>
          <div className="kpi kpi--wide">
            <span className="kpi-value">
              {total.timed ? shortDuration(total.modelMs, t.language) : '—'}
            </span>
            <span className="kpi-label">{t('requests.kpi.modelTime')}</span>
          </div>
          <div className="kpi kpi--wide">
            <span className="kpi-value">
              {total.median !== null ? shortDuration(total.median, t.language) : '—'}
            </span>
            <span className="kpi-label">{t('requests.kpi.median')}</span>
          </div>
          <div className="kpi kpi--wide">
            <span className="kpi-value">
              {total.longest ? shortDuration(total.longest, t.language) : '—'}
            </span>
            <span className="kpi-label">{t('requests.kpi.longest')}</span>
          </div>
        </div>
        <div className="rq-controls">
          <div className="segmented" role="radiogroup" aria-label={t('window.label')}>
            {WINDOW_KEYS.map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={k === snap.windowKey}
                className={k === snap.windowKey ? 'is-on' : undefined}
                onClick={() => {
                  setManual(null)
                  void requests.setWindow(k)
                }}
              >
                {t(`requests.window.${k}`)}
              </button>
            ))}
          </div>
          {manual && (
            <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setManual(null)}>
              {t('requests.fit')}
            </button>
          )}
        </div>
      </header>

      <div className="rq-axis" aria-hidden>
        <span />
        <div className="rq-axis-track">
          {ticks(view.from - origin, view.to - origin)
            .filter((rel) => rel >= 0)
            .map((rel) => rel + origin)
            .map((tick) => (
              <span key={tick} className="axis-tick" style={{ left: `${(x(tick) / W) * 100}%` }}>
                {relLabel(tick - origin)}
              </span>
            ))}
        </div>
      </div>

      <div
        className={`rq-lanes${expanded ? ' rq-lanes--zoom' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
      >
        {snap.lanes.map((lane, laneIndex) => {
          const timeline = lane.timeline
          const s = stats[laneIndex]
          const maxOut = Math.max(1, ...(timeline?.requests.map((r) => r.outputTokens ?? 0) ?? [0]))
          const geo = laneGeometry(timeline)
          const status = timeline?.statuses.at(-1)?.status ?? lane.agent.status
          return (
            <div
              key={lane.agent.id}
              className={`rq-lane st-${status}${geo.sub ? ' rq-lane--sub' : ''}`}
            >
              <div className="lane-meta">
                <span className="lane-dot" />
                <div className="lane-names">
                  <span className="lane-title">
                    <span className="lane-name" title={lane.agent.name}>
                      {lane.agent.name}
                    </span>
                    <span className="lane-harness">{harnessLabel(lane.agent.harness)}</span>
                  </span>
                  <span className="lane-sub rq-sub">
                    {s ? laneLine(s, timeline!, t) : t('loading')}
                  </span>
                </div>
              </div>
              <svg
                className="rq-track"
                viewBox={`0 0 ${W} 100`}
                preserveAspectRatio="none"
                role="img"
                aria-label={lane.agent.name}
              >
                {timeline?.statuses.map((band) =>
                  band.status === 'working' || band.status === 'needs-input' ? (
                    <rect
                      key={`b${band.from}`}
                      className={`rq-band rq-band--${band.status}`}
                      x={x(band.from)}
                      width={Math.max(0.5, x(band.to) - x(band.from))}
                      y={0}
                      height={100}
                    />
                  ) : null
                )}
                {geo.sub && (
                  <line className="rq-sublane" x1={0} x2={W} y1={geo.sub.base - geo.sub.max - 3} y2={geo.sub.base - geo.sub.max - 3} />
                )}
                {timeline?.requests.map((request, i) => {
                  const start = request.startedAt ?? request.endedAt
                  const row = request.subagent && geo.sub ? geo.sub : geo.main
                  const h = barHeight(request.outputTokens, maxOut) * row.max
                  const w = Math.max(
                    request.startedAt === null ? 1.2 : 2.4,
                    x(request.endedAt) - x(start)
                  )
                  return (
                    <rect
                      key={`r${i}`}
                      className={`rq-bar${request.startedAt === null ? ' rq-bar--tick' : ''}${request.subagent ? ' rq-bar--sub' : ''}${hover?.lane === laneIndex && hover.request === i ? ' is-hover' : ''}`}
                      x={request.startedAt === null ? x(request.endedAt) - w / 2 : x(start)}
                      width={w}
                      y={row.base - h}
                      data-subagent={request.subagent?.name ?? request.subagent?.id}
                      height={h}
                      rx={1.5}
                      data-start={request.startedAt ?? undefined}
                      data-end={request.endedAt}
                      tabIndex={0}
                      onPointerEnter={(event) =>
                        setHover({
                          lane: laneIndex,
                          request: i,
                          x: event.clientX,
                          y: event.clientY
                        })
                      }
                      onFocus={(event) => {
                        const r = (event.target as SVGRectElement).getBoundingClientRect()
                        setHover({ lane: laneIndex, request: i, x: r.left + r.width / 2, y: r.top })
                      }}
                      onBlur={() => setHover(null)}
                    />
                  )
                })}
                {timeline?.turns
                  .filter((turn) => turn.counted)
                  .map((turn) => (
                    <g key={`t${turn.start}`}>
                      <path
                        className="rq-prompt"
                        d={`M${x(turn.start) - 7} 0 L${x(turn.start) + 7} 0 L${x(turn.start)} 14 Z`}
                      />
                      {turn.end !== null && turn.endedAs === 'finished' && (
                        <rect
                          className="rq-finish"
                          x={x(turn.end) - 1.2}
                          width={2.4}
                          y={0}
                          height={100}
                        />
                      )}
                    </g>
                  ))}
              </svg>
            </div>
          )
        })}
      </div>

      {hovered && hover && (
        <div className="rq-tip" style={{ left: hover.x, top: hover.y }} role="tooltip">
          <TipBody request={hovered.request} t={t} lang={lang} />
        </div>
      )}

      <footer className="pulse-foot rq-legend">
        <span>
          <i className="lg lg-bar" /> {t('requests.legend.request')}
        </span>
        {stats.some((s) => s && s.subagentRequests > 0) && (
          <span>
            <i className="lg lg-sub" /> {t('requests.legend.subagent')}
          </span>
        )}
        <span>
          <i className="lg lg-band" /> {t('requests.legend.working')}
        </span>
        <span>
          <i className="lg lg-prompt" /> {t('requests.legend.prompt')}
        </span>
        <span>
          <i className="lg lg-finish" /> {t('requests.legend.finished')}
        </span>
        {expanded && <span className="ns-muted">{t('requests.zoomHint')}</span>}
      </footer>
    </section>
  )
}

function TipBody({
  request,
  t,
  lang
}: {
  request: AgentRequestSpan
  t: Translator
  lang: 'en' | 'ru' | 'zh'
}): React.JSX.Element {
  const ms = durationOf(request)
  const fmt = (value: number | null): string =>
    value === null
      ? t('requests.notReported')
      : new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'zh' ? 'zh-CN' : 'en-US').format(
          value
        )
  return (
    <>
      <strong>{ms !== null ? shortDuration(ms, t.language) : t('requests.noStart')}</strong>
      {request.subagent && (
        <span className="rq-tip-sub">
          {request.subagent.name
            ? t('requests.tip.subagent', { name: request.subagent.name })
            : t('requests.tip.subagentUnnamed')}
        </span>
      )}
      {request.model && <span className="ns-mono">{request.model}</span>}
      <span>
        {t('requests.tip.tokens', {
          input: fmt(request.inputTokens),
          output: fmt(request.outputTokens)
        })}
      </span>
      {request.cacheReadTokens !== null && request.cacheReadTokens > 0 && (
        <span>{t('requests.tip.cache', { count: fmt(request.cacheReadTokens) })}</span>
      )}
      {request.tools && request.tools.length > 0 && (
        <span className="rq-tools">
          {request.tools.slice(0, 6).join(', ')}
          {request.tools.length > 6 ? '…' : ''}
        </span>
      )}
    </>
  )
}

function laneLine(s: LaneStats, timeline: AgentTimeline, t: Translator): string {
  const parts = [t('requests.lane.requests', { count: s.requests })]
  if (s.subagentRequests > 0) parts.push(t('requests.lane.inclSub', { count: s.subagentRequests }))
  if (s.timed > 0) {
    parts.push(t('requests.lane.model', { time: shortDuration(s.modelMs, t.language) }))
    if (s.medianMs !== null)
      parts.push(t('requests.lane.median', { time: shortDuration(s.medianMs, t.language) }))
    if (s.longest)
      parts.push(t('requests.lane.longest', { time: shortDuration(s.longest.ms, t.language) }))
  } else if (timeline.requestTimes === 'end' && s.requests > 0)
    parts.push(t('requests.lane.endOnly'))
  else if (timeline.requestTimes === 'none') parts.push(t('requests.lane.none'))
  return parts.join(' · ')
}

/** All lanes' requests together: the KPIs are over every request, not lane averages. */
function summarizeAll(timelines: readonly AgentTimeline[]): {
  requests: number
  timed: number
  modelMs: number
  median: number | null
  longest: number | null
} {
  const all = laneStats({
    ...(timelines[0] ?? ({} as AgentTimeline)),
    requests: timelines.flatMap((tl) => tl.requests),
    turns: []
  })
  return {
    requests: all.requests,
    timed: all.timed,
    modelMs: all.modelMs,
    median: all.medianMs,
    longest: all.longest?.ms ?? null
  }
}
