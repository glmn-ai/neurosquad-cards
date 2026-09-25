import { usePaused, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { errorKey, type RadarController, type RadarError } from './controller'
import { catalog } from './i18n'
import { branchCi, repoLabel, runState, type CiState, type PullInfo, type RunInfo } from './model'

/** Re-renders every 30 s for the "3 min ago" texts — only while the card is seen. */
function useNow(paused: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (paused) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [paused])
  return now
}

function useAgo(locale: string): (at: number | string, now: number) => string {
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    return (at, now) => {
      const ms = (typeof at === 'string' ? Date.parse(at) : at) - now
      const abs = Math.abs(ms)
      if (abs < 60_000) return rtf.format(0, 'minute')
      if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), 'minute')
      if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), 'hour')
      if (abs < 30 * 86_400_000) return rtf.format(Math.round(ms / 86_400_000), 'day')
      return rtf.format(Math.round(ms / (30 * 86_400_000)), 'month')
    }
  }, [locale])
}

function compact(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function App({ radar }: { radar: RadarController }): React.JSX.Element {
  const snap = useSyncExternalStore(radar.subscribe, radar.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  const now = useNow(paused)
  const ago = useAgo(t.locale)

  if (snap.phase === 'empty') return <Empty radar={radar} />
  if (snap.phase === 'loading' || (snap.phase !== 'error' && !snap.data)) {
    return <Loading label={t('loading')} repo={snap.repo ? repoLabel(snap.repo) : ''} />
  }
  if (snap.phase === 'error' || !snap.data) {
    return (
      <ErrorState radar={radar} error={snap.error!} repo={snap.repo ? repoLabel(snap.repo) : ''} />
    )
  }

  const { repo, pulls, runs, rate } = snap.data
  const main = branchCi(runs, repo.defaultBranch)
  const issues = pulls.length < 20 ? Math.max(0, repo.openIssuesAndPulls - pulls.length) : null
  const flash = snap.flash && now - snap.flash.at < 60_000 ? snap.flash : null
  const [owner, name] = repo.fullName.split('/')
  const readRecently = snap.lastRead && Date.now() - snap.lastRead.at < 10_000

  return (
    <main className="radar" data-paused={paused || undefined}>
      <header className="rr-head">
        <div className="rr-id">
          <button className="rr-repo" onClick={() => radar.openLink(repo.url)} title={repo.url}>
            <RepoIcon />
            <span className="rr-full">
              <span className="rr-owner">{owner}/</span>
              <span className="rr-name">{name}</span>
            </span>
          </button>
          <span className="rr-meta">
            {t('stars', { n: compact(repo.stars, t.locale) })}
            {issues !== null && <> · {t('issues', { count: issues })}</>}
          </span>
        </div>
        <button
          className={`ci-pill ci-${main.state}`}
          onClick={() => main.run && radar.openLink(main.run.url)}
          disabled={!main.run}
          title={main.run ? t('openRun', { name: main.run.name }) : undefined}
        >
          <span className="ci-dot" />
          <span className="ci-branch">{repo.defaultBranch}</span>
          <span className="ci-state">{t(`ci.${main.state}`)}</span>
        </button>
        <button
          className={`rr-refresh${snap.refreshing ? ' is-spinning' : ''}`}
          onClick={() => void radar.refresh()}
          aria-label={t('refresh')}
          title={t('refresh')}
          disabled={snap.refreshing}
        >
          <RefreshIcon />
        </button>
      </header>

      {snap.error && (
        <div className="rr-banner" role="status">
          <strong>{t(`error.${errorKey(snap.error.kind)}`)}</strong>
          <span>{t('error.stale', { ago: ago(snap.data.fetchedAt, now) })}</span>
        </div>
      )}
      {readRecently && (
        <div className="rr-read" key={snap.lastRead!.at}>
          <span className="rr-read-dot" />
          {t('readBy', { agent: snap.lastRead!.agent })}
        </div>
      )}

      <div className="rr-body">
        <section className="rr-pulls">
          <h2>
            {t('pulls')} <span className="rr-count">{pulls.length}</span>
          </h2>
          {pulls.length === 0 ? (
            <p className="rr-none">{t('noPulls')}</p>
          ) : (
            <ul className="rr-list">
              {pulls.map((pull) => (
                <PullRow
                  key={pull.number}
                  pull={pull}
                  flash={flash?.pulls.includes(pull.number) ? flash.at : null}
                  meta={`${t('by', { author: pull.author })} · ${ago(pull.updatedAt, now)}`}
                  draft={t('draft')}
                  reviewers={pull.reviewers > 0 ? t('review', { count: pull.reviewers }) : null}
                  ciLabel={t(`ci.${pull.ci}`)}
                  onOpen={() => radar.openLink(pull.url)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rr-runs">
          <h2>{t('runs', { branch: repo.defaultBranch })}</h2>
          {runs.length === 0 ? (
            <p className="rr-none">{t('noRuns')}</p>
          ) : (
            <>
              <div className="run-strip">
                {[...runs].reverse().map((run) => (
                  <button
                    key={run.id}
                    className={`run-dot ci-${runState(run)}${flash?.runs.includes(run.id) ? ' is-new' : ''}`}
                    title={`${run.name} · ${run.sha.slice(0, 7)} · ${ago(run.createdAt, now)}`}
                    aria-label={t('openRun', { name: run.name })}
                    onClick={() => radar.openLink(run.url)}
                  />
                ))}
              </div>
              <ul className="run-list">
                {runs.slice(0, 6).map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    when={ago(run.createdAt, now)}
                    onOpen={() => radar.openLink(run.url)}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <footer className="rr-foot">
        <span>
          {snap.refreshing ? t('refreshing') : t('checked', { ago: ago(snap.data.fetchedAt, now) })}
        </span>
        {rate.remaining !== null && rate.limit !== null && (
          <span className={rate.remaining < 10 ? 'rr-low' : undefined}>
            {t('rate', { remaining: rate.remaining, limit: rate.limit })}
          </span>
        )}
      </footer>
    </main>
  )
}

function PullRow({
  pull,
  flash,
  meta,
  draft,
  reviewers,
  ciLabel,
  onOpen
}: {
  pull: PullInfo
  flash: number | null
  meta: string
  draft: string
  reviewers: string | null
  ciLabel: string
  onOpen: () => void
}): React.JSX.Element {
  return (
    <li className={`pr ci-${pull.ci}${pull.draft ? ' is-draft' : ''}${flash ? ' is-new' : ''}`}>
      {flash && <span className="row-flash" key={flash} />}
      <button className="pr-btn" onClick={onOpen} title={pull.url}>
        <span className="pr-ci" title={ciLabel} />
        <span className="pr-main">
          <span className="pr-title">
            <span className="pr-num">#{pull.number}</span> {pull.title}
          </span>
          <span className="pr-meta">
            {pull.draft && <span className="chip chip-draft">{draft}</span>}
            {pull.labels.map((label) => (
              <span
                key={label.name}
                className="chip chip-label"
                style={{ ['--lc' as string]: `#${label.color}` }}
              >
                {label.name}
              </span>
            ))}
            <span className="pr-sub">{meta}</span>
            {reviewers && <span className="pr-sub pr-rev">· {reviewers}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

function RunRow({
  run,
  when,
  onOpen
}: {
  run: RunInfo
  when: string
  onOpen: () => void
}): React.JSX.Element {
  const state: CiState = runState(run)
  return (
    <li className={`run ci-${state}`}>
      <button className="run-btn" onClick={onOpen} title={run.url}>
        <span className="pr-ci" />
        <span className="run-name">{run.name}</span>
        <span className="run-sha">{run.sha.slice(0, 7)}</span>
        <span className="run-when">{when}</span>
      </button>
    </li>
  )
}

function Empty({ radar }: { radar: RadarController }): React.JSX.Element {
  const t = useTranslator(catalog)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submit = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault()
    const ok = await radar.watch(value)
    setInvalid(!ok)
  }
  // Not a <form>: the card frame is sandboxed without allow-forms, so a
  // form's submit event never fires in the app. Enter and the button call this.
  const submitDraft = (event: { preventDefault(): void }) => void submit(event)
  return (
    <main className="radar radar--state">
      <div
        role="form"
        className="rr-state"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submitDraft(e)
        }}
      >
        <div className="rr-glyph" aria-hidden>
          <RadarGlyph />
        </div>
        <p className="rr-state-title">{t('empty.title')}</p>
        <p className="rr-state-body">{t('empty.body')}</p>
        <div className="rr-field">
          <input
            className="ns-input"
            value={value}
            placeholder={t('empty.placeholder')}
            spellCheck={false}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
          />
          <button
            className="ns-btn ns-btn--primary ns-btn--sm"
            type="button"
            onClick={(e) => submitDraft(e)}
            disabled={!value.trim()}
          >
            {t('empty.save')}
          </button>
        </div>
        {invalid && <p className="rr-invalid">{t('empty.invalid')}</p>}
        <div className="rr-actions">
          <button
            className="ns-btn ns-btn--ghost ns-btn--sm"
            type="button"
            onClick={() => void radar.detect()}
          >
            {t('empty.detect')}
          </button>
          <button
            className="ns-btn ns-btn--ghost ns-btn--sm"
            type="button"
            onClick={() => void radar.card.settings.open().catch(() => {})}
          >
            {t('empty.settings')}
          </button>
        </div>
      </div>
    </main>
  )
}

function ErrorState({
  radar,
  error,
  repo
}: {
  radar: RadarController
  error: RadarError
  repo: string
}): React.JSX.Element {
  const t = useTranslator(catalog)
  const key = errorKey(error.kind)
  const body =
    error.kind === 'rate-limit'
      ? t('error.rateLimitBody', {
          time: error.resetAt
            ? new Intl.DateTimeFormat(t.locale, { hour: '2-digit', minute: '2-digit' }).format(
                error.resetAt
              )
            : '—'
        })
      : error.kind === 'not-found'
        ? t('error.notFoundBody', { repo })
        : error.kind === 'unauthorized'
          ? t('error.unauthorizedBody')
          : error.message
  return (
    <main className="radar radar--state">
      <div className="rr-state">
        <div className="rr-glyph rr-glyph--danger" aria-hidden>
          <RadarGlyph />
        </div>
        <p className="rr-state-title">{t(`error.${key}`)}</p>
        <p className="rr-state-body">{body}</p>
        <div className="rr-actions">
          <button
            className="ns-btn ns-btn--secondary ns-btn--sm"
            onClick={() => void radar.refresh()}
          >
            {t('error.retry')}
          </button>
          <button
            className="ns-btn ns-btn--ghost ns-btn--sm"
            onClick={() => void radar.card.settings.open().catch(() => {})}
          >
            {t('error.settings')}
          </button>
        </div>
      </div>
    </main>
  )
}

function Loading({ label, repo }: { label: string; repo: string }): React.JSX.Element {
  return (
    <main className="radar" aria-busy="true">
      <header className="rr-head">
        <div className="rr-id">
          <span className="rr-repo rr-repo--static">
            <RepoIcon />
            <span className="rr-name">{repo}</span>
          </span>
          <span className="skel-line" style={{ width: 120 }} />
        </div>
        <span className="ci-pill skel" style={{ width: 110 }} />
      </header>
      <div className="rr-body">
        <section className="rr-pulls">
          <ul className="rr-list">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="pr skel-row">
                <span className="skel-line" style={{ width: `${80 - i * 12}%` }} />
                <span className="skel-line skel-line--thin" style={{ width: `${40 - i * 5}%` }} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="rr-foot">
        <span>{label}</span>
      </footer>
    </main>
  )
}

function RepoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"
      />
    </svg>
  )
}

function RefreshIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16.023 9.348h4.992V4.356M2.985 19.644v-4.992h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  )
}

function RadarGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 96 96" width="72" height="72" aria-hidden>
      <circle
        cx="48"
        cy="48"
        r="40"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <circle
        cx="48"
        cy="48"
        r="26"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="2"
      />
      <circle
        cx="48"
        cy="48"
        r="12"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <g className="rr-sweep">
        <path d="M48 48 L48 8 A40 40 0 0 1 82.6 28 Z" fill="currentColor" fillOpacity="0.18" />
        <line
          x1="48"
          y1="48"
          x2="48"
          y2="8"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </g>
      <circle cx="66" cy="34" r="4" fill="currentColor" />
    </svg>
  )
}
