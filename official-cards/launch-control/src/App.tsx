import { useCardContext, useExpanded, usePaused, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { LaunchController } from './controller'
import { catalog } from './i18n'
import { counts, countdown, isWarning, phaseOf, type Check, type CheckStatus } from './model'
import { SevenSeg } from './SevenSeg'

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

const pad = (n: number): string => String(n).padStart(2, '0')

/** Epoch ms → the value a datetime-local input wants (local time). */
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function App({ lc }: { lc: LaunchController }): React.JSX.Element {
  const snap = useSyncExternalStore(lc.subscribe, lc.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  const expanded = useExpanded()
  useCardContext() // settings, theme and size changes re-render
  const now = useNow(paused)

  const rootProps = {
    className: 'lc',
    'data-skin': lc.skin,
    'data-paused': paused || undefined,
    'data-expanded': expanded || undefined,
    style: { '--accent-in': lc.accent } as CSSProperties
  }

  if (snap.phase === 'loading') {
    return (
      <main {...rootProps} data-phase="loading" aria-busy="true">
        <div className="lc-state">
          <SevenSeg text="88:88:88" label={t('loading')} />
          <p className="lc-state-body">{t('loading')}</p>
        </div>
      </main>
    )
  }
  if (snap.phase === 'error') {
    return (
      <main {...rootProps} data-phase="error">
        <div className="lc-state">
          <SevenSeg text="--:--:--" label={t('error.title')} />
          <p className="lc-state-title">{t('error.title')}</p>
          <p className="lc-state-body lc-mono">{snap.error}</p>
          <button className="lc-btn" onClick={() => void lc.load()}>
            {t('error.retry')}
          </button>
        </div>
      </main>
    )
  }

  const board = snap.board
  const phase = phaseOf(board, now)
  const c = counts(board)
  const cd = countdown(board.target, now)
  const warn = isWarning(board, now, lc.warnMinutes)
  const digits = cd
    ? `${pad(Math.min(cd.hours, 99))}:${pad(cd.minutes)}${lc.showSeconds ? `:${pad(cd.seconds)}` : ''}`
    : lc.showSeconds
      ? '--:--:--'
      : '--:--'
  const clockLabel = cd ? `T${cd.sign < 0 ? '−' : '+'}${digits}` : t('noClock')
  const agentNote = snap.lastAgent && now - snap.lastAgent.at < 8000 ? snap.lastAgent : null

  return (
    <main {...rootProps} data-phase={phase} data-warn={warn || undefined}>
      <div className="lc-fx" aria-hidden />
      <header className="lc-head">
        <div className="lc-mission">
          <h1 className="lc-title">{lc.title}</h1>
          {lc.brief && <p className="lc-brief">{lc.brief}</p>}
        </div>
        <span className={`lc-phase lc-phase--${phase}`}>{t(`phase.${phase}`)}</span>
      </header>

      <section className="lc-clock">
        <div className="lc-clock-face">
          <span className="lc-t">{cd ? (cd.sign < 0 ? 'T−' : 'T+') : 'T'}</span>
          <SevenSeg text={digits} label={clockLabel} />
        </div>
        <GoRing checks={board.checks} go={c.go} total={c.total} label={t('goCount', { go: c.go, total: c.total })} />
        <ul className="lc-legend">
          {(['go', 'nogo', 'pending'] as const).map((status) => (
            <li key={status} className={`lc-legend--${status}`}>
              <i />
              <span>{t(`status.${status}`)}</span>
              <b>{c[status]}</b>
            </li>
          ))}
        </ul>
        <div className="lc-clock-ctl">
          <label className="lc-field">
            <span className="lc-sr">{t('clock.label')}</span>
            <input
              type="datetime-local"
              className="lc-input lc-time"
              value={board.target !== null ? toLocalInput(board.target) : ''}
              onChange={(e) => {
                const ms = e.target.value ? new Date(e.target.value).getTime() : NaN
                if (Number.isFinite(ms)) lc.setTarget(ms)
              }}
            />
          </label>
          <button className="lc-btn lc-btn--ghost" onClick={() => lc.setTarget(Math.max(now, board.target ?? now) + 15 * 60_000)}>
            {t('clock.plus15')}
          </button>
          <button className="lc-btn lc-btn--ghost" onClick={() => lc.setTarget(Math.max(now, board.target ?? now) + 60 * 60_000)}>
            {t('clock.plus60')}
          </button>
          {board.target !== null && (
            <button
              className="lc-btn lc-btn--ghost lc-btn--icon"
              aria-label={t('clock.clear')}
              title={t('clock.clear')}
              onClick={() => lc.setTarget(null)}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
      </section>

      <section className="lc-checks">
        {agentNote && (
          <div className="lc-agent" key={agentNote.at} role="status">
            <span className="lc-agent-dot" />
            {agentNote.text}
          </div>
        )}
        {board.checks.length === 0 ? (
          <div className="lc-empty">
            <p className="lc-empty-title">{t('empty.title')}</p>
            <p className="lc-empty-body">{t('empty.body')}</p>
          </div>
        ) : (
          <ol className="lc-list">
            {board.checks.map((check) => (
              <Row key={check.id} check={check} lc={lc} flash={snap.flash[check.id]} now={now} t={t} />
            ))}
          </ol>
        )}
        <AddCheck lc={lc} placeholder={t('add.placeholder')} button={t('add.button')} />
      </section>

      {phase === 'launched' && <Launch key={board.target ?? 0} label={t('phase.launched')} />}
    </main>
  )
}

function GoRing({ checks, go, total, label }: { checks: Check[]; go: number; total: number; label: string }): React.JSX.Element {
  const r = 26
  const len = 2 * Math.PI * r
  const gap = checks.length > 1 ? Math.min(4, len / checks.length / 3) : 0
  const seg = checks.length > 0 ? len / checks.length : len
  return (
    <div className="lc-ring" role="img" aria-label={label}>
      <svg viewBox="0 0 64 64">
        <circle className="ring-track" cx="32" cy="32" r={r} />
        {checks.map((check, i) => (
          <circle
            key={check.id}
            className={`ring-seg ring-seg--${check.status}`}
            cx="32"
            cy="32"
            r={r}
            strokeDasharray={`${Math.max(0.5, seg - gap)} ${len}`}
            strokeDashoffset={-i * seg}
          />
        ))}
      </svg>
      <span className="lc-ring-text">
        <b>{go}</b>
        <span>/{total}</span>
      </span>
    </div>
  )
}

const NEXT_LABEL: Record<CheckStatus, CheckStatus> = { pending: 'go', go: 'nogo', nogo: 'pending' }

function Row({
  check,
  lc,
  flash,
  now,
  t
}: {
  check: Check
  lc: LaunchController
  flash: { at: number; by: string; agent: boolean } | undefined
  now: number
  t: ReturnType<typeof useTranslator>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const fresh = flash && now - flash.at < 2600
  return (
    <li className={`lc-row lc-row--${check.status}`} data-flash={fresh ? (flash.agent ? 'agent' : 'user') : undefined}>
      {fresh && <span className="lc-row-flash" key={flash.at} aria-hidden />}
      <button
        className={`lc-pill lc-pill--${check.status}`}
        title={t('cycle')}
        aria-label={`${check.name}: ${t(`status.${check.status}`)} → ${t(`status.${NEXT_LABEL[check.status]}`)}`}
        onClick={() => lc.userCycle(check.id)}
      >
        {t(`status.${check.status}`)}
      </button>
      <div className="lc-row-main">
        {editing ? (
          <input
            className="lc-input lc-rename"
            defaultValue={check.name}
            autoFocus
            onBlur={(e) => {
              lc.userRename(check.id, e.target.value)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <button className="lc-name" onClick={() => setEditing(true)}>
            {check.name}
          </button>
        )}
        {(check.note || check.by) && (
          <span className="lc-meta">
            {check.byAgent && <span className="lc-agent-tag">{check.by}</span>}
            {check.note && <span className="lc-note">{check.note}</span>}
            {check.by && !check.byAgent && (
              <span className="lc-by">
                {check.source === 'port' ? t('fromPort', { who: check.by }) : t('setBy', { who: check.by })}
              </span>
            )}
          </span>
        )}
      </div>
      <button className="lc-x" aria-label={t('remove', { name: check.name })} onClick={() => lc.userRemove(check.id)}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </li>
  )
}

function AddCheck({ lc, placeholder, button }: { lc: LaunchController; placeholder: string; button: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const submit = (): void => {
    if (!text.trim()) return
    lc.userAdd(text)
    setText('')
    input.current?.focus()
  }
  return (
    // Not a <form>: the card frame is sandboxed without allow-forms, so a form's
    // submit event never fires. Enter and the button add the check instead.
    <div className="lc-add" role="group">
      <input
        ref={input}
        className="lc-input"
        value={text}
        maxLength={120}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <button className="lc-btn" type="button" disabled={!text.trim()} onClick={submit}>
        {button}
      </button>
    </div>
  )
}

/** Plays once when it mounts (the moment of launch), then stays as a quiet badge. */
function Launch({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="lc-launch" aria-hidden>
      <span className="lc-launch-ring" />
      <span className="lc-launch-ring lc-launch-ring--2" />
      <span className="lc-launch-word">{label}</span>
    </div>
  )
}
