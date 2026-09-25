import { useCardContext, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { LogController } from './controller'
import { catalog } from './i18n'
import {
  adrId,
  search,
  STATUSES,
  tagCounts,
  type Decision,
  type DecisionInput,
  type DecisionStatus
} from './model'

type Filter = DecisionStatus | 'all'
type Editing = { mode: 'new' } | { mode: 'edit'; n: number } | null

/** The card's width (#root), so the layout can switch between list+detail and one stacked pane. */
function useWidth(): number {
  const [width, setWidth] = useState(() => document.getElementById('root')?.clientWidth ?? 0)
  useLayoutEffect(() => {
    const el = document.getElementById('root')
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return width
}

function relative(at: number, locale: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const s = Math.round((at - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86_400 * 30) return rtf.format(Math.round(s / 86_400), 'day')
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at)
}

export function App({ log }: { log: LogController }): React.JSX.Element {
  const snap = useSyncExternalStore(log.subscribe, log.getSnapshot)
  const t = useTranslator(catalog)
  useCardContext() // re-render on settings / language / theme
  const width = useWidth()
  const wide = width >= 600
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<Editing>(null)

  // An agent (or a save) points at an entry: open it.
  const focusAt = snap.focus?.at
  useEffect(() => {
    if (snap.focus) {
      setSelected(snap.focus.n)
      setFilter('all')
      setTag(null)
      setQuery('')
    }
  }, [focusAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const entries = snap.entries
  const visible = useMemo(
    () =>
      search(entries, {
        query,
        status: filter,
        ...(tag ? { tag } : {})
      }),
    [entries, query, filter, tag]
  )
  const tags = useMemo(() => tagCounts(entries).slice(0, 10), [entries])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: entries.length,
      proposed: 0,
      accepted: 0,
      rejected: 0,
      superseded: 0
    }
    for (const entry of entries) c[entry.status]++
    return c
  }, [entries])

  const current =
    (selected !== null ? entries.find((e) => e.n === selected) : undefined) ??
    (wide ? visible[0] : undefined)

  if (snap.phase === 'loading') return <Loading label={t('loading')} />
  if (snap.phase === 'error') {
    return (
      <main className="log log--state">
        <div className="state">
          <LedgerGlyph danger />
          <p className="state-title">{t('error.title')}</p>
          <p className="state-body ns-mono">{snap.error}</p>
          <button className="ns-btn ns-btn--secondary ns-btn--sm" onClick={() => void log.load()}>
            {t('error.retry')}
          </button>
        </div>
      </main>
    )
  }

  if (editing) {
    const entry = editing.mode === 'edit' ? log.get(editing.n) : undefined
    return (
      <main className="log">
        <Editor
          t={t}
          entry={entry}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.mode === 'edit' && entry) {
              await log.editByUser(entry.n, input)
              setSelected(entry.n)
            } else {
              setSelected(await log.createByUser(input))
            }
            setEditing(null)
          }}
        />
      </main>
    )
  }

  if (entries.length === 0) {
    return (
      <main className="log log--state">
        <div className="state">
          <LedgerGlyph />
          <p className="state-title">{t('empty.title')}</p>
          <p className="state-body">{t('empty.body')}</p>
          <button
            className="ns-btn ns-btn--primary ns-btn--sm"
            onClick={() => setEditing({ mode: 'new' })}
          >
            {t('empty.cta')}
          </button>
        </div>
      </main>
    )
  }

  const pill =
    snap.lastAgent && Date.now() - snap.lastAgent.at < 8000 ? (
      <button
        className={`agent-pill agent-pill--${snap.lastAgent.kind}`}
        key={snap.lastAgent.at}
        onClick={() => setSelected(snap.lastAgent!.n)}
      >
        <span className="agent-pill-dot" />
        {t(
          snap.lastAgent.kind === 'recorded'
            ? 'recordedBy'
            : snap.lastAgent.kind === 'changed'
              ? 'changedBy'
              : 'readBy',
          { agent: snap.lastAgent.agent }
        )}
        <span className="ns-mono">{adrId(snap.lastAgent.n)}</span>
      </button>
    ) : null

  const showDetail = wide || selected !== null

  return (
    <main className={`log ${wide ? 'log--wide' : 'log--narrow'}`}>
      <header className="log-head">
        <div className="head-title">
          <h1>{t('title')}</h1>
          <span className="head-count">{t('count', { count: entries.length })}</span>
        </div>
        <input
          className="ns-input log-search"
          type="search"
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="ns-btn ns-btn--primary ns-btn--sm new-btn"
          onClick={() => setEditing({ mode: 'new' })}
        >
          <span aria-hidden>+</span>
          <span className="new-label">{t('new')}</span>
        </button>
      </header>

      <nav className="filters">
        {(['all', ...STATUSES] as Filter[]).map((f) => (
          <button
            key={f}
            className={`filter ${f === filter ? 'is-on' : ''} ${f === 'proposed' && counts.proposed > 0 ? 'filter--alert' : ''}`}
            onClick={() => setFilter(f)}
          >
            {t(`filter.${f}`)}
            <span className="filter-count">{counts[f]}</span>
          </button>
        ))}
        {tags.map(({ tag: name }) => (
          <button
            key={name}
            className={`tag ${tag === name ? 'is-on' : ''}`}
            onClick={() => setTag(tag === name ? null : name)}
          >
            #{name}
          </button>
        ))}
      </nav>

      {pill}

      <div className="log-body">
        {(wide || !showDetail) && (
          <ol className="ledger">
            {visible.length === 0 && (
              <li className="ledger-empty">
                <span>{t('noMatch')}</span>
                <button
                  className="ns-btn ns-btn--ghost ns-btn--sm"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                    setTag(null)
                  }}
                >
                  {t('clearFilters')}
                </button>
              </li>
            )}
            {visible.map((entry) => {
              const flashAt = snap.flash[entry.n]
              return (
                <li key={entry.n}>
                  <button
                    className={`row st-${entry.status} ${current?.n === entry.n ? 'is-on' : ''}`}
                    onClick={() => setSelected(entry.n)}
                  >
                    {flashAt && Date.now() - flashAt < 4000 && (
                      <span className="row-flash" key={flashAt} />
                    )}
                    <span className="row-id">{adrId(entry.n)}</span>
                    <span className="row-title">{entry.title}</span>
                    <span className="row-meta">
                      <span className={`status status--${entry.status}`}>
                        {t(`status.${entry.status}`)}
                      </span>
                      <span className="row-author">
                        {entry.author.name} · {relative(entry.createdAt, t.locale)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        {showDetail && (
          <section className="detail-wrap">
            {!wide && (
              <button className="back" onClick={() => setSelected(null)}>
                ← {t('back')}
              </button>
            )}
            {current ? (
              <Detail
                key={current.n}
                entry={current}
                log={log}
                t={t}
                onOpen={(n) => setSelected(n)}
                onEdit={() => setEditing({ mode: 'edit', n: current.n })}
              />
            ) : (
              <p className="detail-pick">{t('pick')}</p>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

type T = ReturnType<typeof useTranslator>

function Detail({
  entry,
  log,
  t,
  onOpen,
  onEdit
}: {
  entry: Decision
  log: LogController
  t: T
  onOpen: (n: number) => void
  onEdit: () => void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const others = log.getSnapshot().entries.filter((e) => e.n !== entry.n)
  const you = { en: 'You', ru: 'Вы', zh: '你' }[t.language] ?? 'You'
  const act = (status: DecisionStatus, supersededBy?: number): void =>
    void log.changeStatus(entry.n, status, you, undefined, supersededBy)
  return (
    <article className={`detail st-${entry.status}`}>
      <div className="detail-top">
        <span className="detail-id">{adrId(entry.n)}</span>
        <span className={`status status--${entry.status}`}>{t(`status.${entry.status}`)}</span>
      </div>
      <h2 className="detail-title">{entry.title}</h2>
      <p className="detail-meta">
        {t('by', { name: entry.author.name })}
        {entry.author.kind === 'agent' && <span className="agent-tag">{t('agent')}</span>}
        <span>
          {' '}
          ·{' '}
          {new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            entry.createdAt
          )}
        </span>
      </p>
      {(entry.supersededBy || entry.supersedes) && (
        <p className="links">
          {entry.supersededBy && (
            <button className="link" onClick={() => onOpen(entry.supersededBy!)}>
              {t('supersededBy')} {adrId(entry.supersededBy)} →
            </button>
          )}
          {entry.supersedes && (
            <button className="link" onClick={() => onOpen(entry.supersedes!)}>
              {t('supersedes')} {adrId(entry.supersedes)}
            </button>
          )}
        </p>
      )}

      {entry.status === 'proposed' && (
        <div className="review">
          <button className="ns-btn ns-btn--primary ns-btn--sm" onClick={() => act('accepted')}>
            {t('action.accept')}
          </button>
          <button className="ns-btn ns-btn--outline ns-btn--sm" onClick={() => act('rejected')}>
            {t('action.reject')}
          </button>
        </div>
      )}

      {entry.context && <Section title={t('section.context')} text={entry.context} />}
      <Section title={t('section.decision')} text={entry.decision} strong />
      {entry.alternatives && (
        <section className="sec">
          <h3>{t('section.alternatives')}</h3>
          <ul>
            {entry.alternatives.map((alt, i) => (
              <li key={i}>{alt}</li>
            ))}
          </ul>
        </section>
      )}
      {entry.consequences && (
        <Section title={t('section.consequences')} text={entry.consequences} />
      )}
      {entry.tags.length > 0 && (
        <p className="detail-tags">
          {entry.tags.map((tag) => (
            <span key={tag} className="tag tag--static">
              #{tag}
            </span>
          ))}
        </p>
      )}

      <section className="sec history">
        <h3>{t('section.history')}</h3>
        <ol>
          {entry.history.map((item, i) => (
            <li key={i}>
              <span className={`hist-dot status--${item.status}`} />
              <span>
                {item.note === 'edited' ? t('edited') : t(`status.${item.status}`)} · {item.by} ·{' '}
                {relative(item.at, t.locale)}
                {item.note && item.note !== 'edited' && <em> — {item.note}</em>}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="detail-actions">
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onEdit}>
          {t('action.edit')}
        </button>
        {entry.status !== 'superseded' && others.length > 0 && (
          <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => setPicking(!picking)}>
            {t('action.supersede')}
          </button>
        )}
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={() => void log.send(entry.n)}>
          {t('action.send')}
        </button>
        <button
          className="ns-btn ns-btn--ghost ns-btn--sm danger"
          onClick={() => void log.remove(entry.n)}
        >
          {t('action.delete')}
        </button>
      </div>
      {picking && (
        <label className="ns-field picker">
          <span className="ns-label">{t('supersedePick')}</span>
          <select
            className="ns-select"
            defaultValue=""
            onChange={(event) => {
              const n = Number(event.target.value)
              if (n) {
                act('superseded', n)
                setPicking(false)
              }
            }}
          >
            <option value="" disabled>
              —
            </option>
            {others.map((other) => (
              <option key={other.n} value={other.n}>
                {adrId(other.n)} · {other.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </article>
  )
}

function Section({
  title,
  text,
  strong
}: {
  title: string
  text: string
  strong?: boolean
}): React.JSX.Element {
  return (
    <section className={`sec ${strong ? 'sec--strong' : ''}`}>
      <h3>{title}</h3>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </section>
  )
}

function Editor({
  t,
  entry,
  onSave,
  onCancel
}: {
  t: T
  entry: Decision | undefined
  onSave: (input: DecisionInput) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [decision, setDecision] = useState(entry?.decision ?? '')
  const [context, setContext] = useState(entry?.context ?? '')
  const [alternatives, setAlternatives] = useState((entry?.alternatives ?? []).join('\n'))
  const [consequences, setConsequences] = useState(entry?.consequences ?? '')
  const [tags, setTags] = useState((entry?.tags ?? []).join(', '))
  const [status, setStatus] = useState<DecisionStatus>(entry?.status ?? 'accepted')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = title.trim().length > 0 && decision.trim().length > 0
  // Not a <form>: the card frame is sandboxed without allow-forms, so a
  // form's submit event never fires in the app. Enter and the button call this.
  const submitDraft = (event: { preventDefault(): void }) => {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    onSave({
      title,
      decision,
      context,
      consequences,
      alternatives: alternatives.split('\n'),
      tags: tags.split(','),
      status
    }).catch((err: unknown) => {
      setError(t('saveFailed', { error: err instanceof Error ? err.message : String(err) }))
      setBusy(false)
    })
  }
  return (
    <div
      role="form"
      className="editor"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submitDraft(e)
      }}
    >
      <h2 className="editor-title">
        {entry ? t('form.titleEdit', { id: adrId(entry.n) }) : t('form.titleNew')}
      </h2>
      <div className="editor-grid">
        <label className="ns-field span-2">
          <span className="ns-label">{t('form.title')}</span>
          <input
            className="ns-input"
            value={title}
            maxLength={120}
            placeholder={t('form.titlePh')}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </label>
        <label className="ns-field span-2">
          <span className="ns-label">{t('form.decision')}</span>
          <textarea
            className="ns-textarea"
            rows={4}
            value={decision}
            maxLength={4000}
            placeholder={t('form.decisionPh')}
            onChange={(e) => setDecision(e.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-label">{t('form.context')}</span>
          <textarea
            className="ns-textarea"
            rows={3}
            value={context}
            maxLength={4000}
            onChange={(e) => setContext(e.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-label">{t('form.consequences')}</span>
          <textarea
            className="ns-textarea"
            rows={3}
            value={consequences}
            maxLength={2000}
            onChange={(e) => setConsequences(e.target.value)}
          />
        </label>
        <label className="ns-field">
          <span className="ns-label">{t('form.alternatives')}</span>
          <textarea
            className="ns-textarea"
            rows={3}
            value={alternatives}
            onChange={(e) => setAlternatives(e.target.value)}
          />
        </label>
        <div className="editor-col">
          <label className="ns-field">
            <span className="ns-label">{t('form.tags')}</span>
            <input className="ns-input" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="ns-field">
            <span className="ns-label">{t('form.status')}</span>
            <select
              className="ns-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as DecisionStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error && <p className="editor-error">{error}</p>}
      <div className="editor-actions">
        <button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onCancel}>
          {t('form.cancel')}
        </button>
        <button
          type="button"
          onClick={(e) => submitDraft(e)}
          className="ns-btn ns-btn--primary ns-btn--sm"
          disabled={!valid || busy}
        >
          {t('form.save')}
        </button>
      </div>
    </div>
  )
}

function LedgerGlyph({ danger }: { danger?: boolean }): React.JSX.Element {
  return (
    <svg
      className={`glyph ${danger ? 'glyph--danger' : ''}`}
      viewBox="0 0 96 96"
      width="72"
      height="72"
      aria-hidden
    >
      <rect
        x="18"
        y="10"
        width="60"
        height="76"
        rx="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        d="M30 30 H66 M30 42 H66 M30 54 H54"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
      {danger ? (
        <path
          d="M58 62 L74 78 M74 62 L58 78"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M56 70 L63 77 L78 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

function Loading({ label }: { label: string }): React.JSX.Element {
  return (
    <main className="log" aria-busy="true">
      <header className="log-head">
        <span className="skel skel-title" />
        <span className="skel skel-search" />
      </header>
      <div className="skel-rows">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel-row">
            <span className="skel" style={{ width: 64 }} />
            <span className="skel" style={{ width: `${62 - i * 9}%` }} />
          </div>
        ))}
      </div>
      <p className="skel-label">{label}</p>
    </main>
  )
}
