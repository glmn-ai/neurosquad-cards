import type { JsonValue, PeerInfo } from '@neurosquad/card-sdk'
import { usePaused, useTranslator } from '@neurosquad/card-sdk/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RouterController } from './controller'
import { catalog } from './i18n'
import {
  checkTarget,
  compatibleFormats,
  formatBytes,
  inferShape,
  newRule,
  OUTPUT_FOR,
  preview,
  type Format,
  type InspectedMessage,
  type MatchKind,
  type Rule
} from './model'

type T = ReturnType<typeof useTranslator>

export function App({
  router,
  initialTab = 'rules',
  initialEdit,
  openNewest
}: {
  router: RouterController
  initialTab?: 'rules' | 'inspector'
  /** Preview only: open this rule in the editor once it is loaded. */
  initialEdit?: string
  /** Preview only: show the newest message expanded. */
  openNewest?: boolean
}): React.JSX.Element {
  const snap = useSyncExternalStore(router.subscribe, router.getSnapshot)
  const t = useTranslator(catalog)
  const paused = usePaused()
  const [tab, setTab] = useState<'rules' | 'inspector'>(initialTab)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [opened, setOpened] = useState(false)
  if (!opened && initialEdit && snap.phase === 'ready') {
    setOpened(true)
    setEditing(snap.config.rules.find((r) => r.id === initialEdit) ?? null)
  }

  // Looking at the inspector clears the "dropped" badge.
  useEffect(() => {
    if (!paused && tab === 'inspector') router.markSeen()
  }, [paused, tab, snap.unseenDrops, router])

  if (snap.phase === 'loading') {
    return (
      <main className="router router--state" aria-busy="true">
        <div className="bay skel-bay" />
        <div className="state">
          <span className="ns-spinner" />
          <p className="state-body">{t('loading')}</p>
        </div>
      </main>
    )
  }
  if (snap.phase === 'error') {
    return (
      <main className="router router--state">
        <div className="state">
          <Plug broken />
          <p className="state-title">{t('error.title')}</p>
          <p className="state-body ns-mono">{snap.error}</p>
          <button
            className="ns-btn ns-btn--secondary ns-btn--sm"
            onClick={() => void router.load()}
          >
            {t('error.retry')}
          </button>
        </div>
      </main>
    )
  }

  const sources = snap.peers.filter((p) => p.direction !== 'downstream')
  const targets = snap.peers.filter((p) => p.direction !== 'upstream')
  const nothingYet = snap.config.rules.length === 0 && snap.messages.length === 0

  return (
    <main className="router" data-paused={paused || undefined} data-tab={tab}>
      <PatchBay
        sources={sources}
        targets={targets}
        snapPaused={snap.paused}
        counters={snap.counters}
        t={t}
      />

      <div className="toolbar">
        <nav className="tabs" role="tablist">
          {(['rules', 'inspector'] as const).map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? 'is-on' : undefined}
              onClick={() => setTab(key)}
            >
              {t(`tabs.${key}`)}
              {key === 'inspector' && snap.unseenDrops > 0 && (
                <span className="tab-badge">{snap.unseenDrops}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="toolbar-slot">
          {tab === 'rules' ? (
            <ModeSelect router={router} mode={snap.config.mode} t={t} />
          ) : (
            <Counts counters={snap.counters} t={t} />
          )}
        </span>
      </div>

      <div className="panes">
        <section className="pane pane--rules">
          <header className="pane-head">
            <h2>{t('tabs.rules')}</h2>
            <ModeSelect router={router} mode={snap.config.mode} t={t} />
          </header>
          {editing ? (
            <RuleEditor
              rule={editing}
              targets={targets}
              sources={sources}
              t={t}
              onCancel={() => setEditing(null)}
              onSave={(rule) => {
                setEditing(null)
                void router.saveRule(rule)
              }}
            />
          ) : (
            <div className="rules ns-scroll">
              {nothingYet && (
                <div className="state state--inline">
                  <Plug />
                  <p className="state-title">{t('empty.title')}</p>
                  <p className="state-body">{t('empty.body')}</p>
                </div>
              )}
              {snap.config.rules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={i}
                  peers={snap.peers}
                  hits={snap.counters.hits[rule.id] ?? 0}
                  granted={(id) => router.card.permissions.has(id)}
                  t={t}
                  onEdit={() => setEditing(rule)}
                  onToggle={() => void router.toggleRule(rule.id)}
                  onDelete={() => void router.deleteRule(rule.id)}
                  onGrant={() => void router.ensurePermission(rule)}
                />
              ))}
              <button
                className="ns-btn ns-btn--outline ns-btn--sm add-rule"
                disabled={targets.length === 0}
                title={targets.length === 0 ? t('noTargets') : undefined}
                onClick={() => setEditing(newRule(targets[0]?.cardId ?? ''))}
              >
                + {t('rule.add')}
              </button>
            </div>
          )}
        </section>

        <section className="pane pane--inspector">
          <header className="pane-head">
            <h2>{t('tabs.inspector')}</h2>
            <Counts counters={snap.counters} t={t} />
          </header>
          <div className="messages ns-scroll">
            {snap.messages.length === 0 && <p className="state-body pad">{t('empty.inspector')}</p>}
            {snap.messages.map((message) => (
              <MessageRow
                key={message.seq}
                message={message}
                fresh={message.seq === snap.lastSeq}
                initialOpen={openNewest && message.seq === snap.lastSeq}
                t={t}
              />
            ))}
          </div>
        </section>
      </div>
      {snap.paused && <div className="paused-banner">{t('paused')}</div>}
    </main>
  )
}

function ModeSelect({
  router,
  mode,
  t
}: {
  router: RouterController
  mode: 'first' | 'all'
  t: T
}): React.JSX.Element {
  return (
    <select
      className="ns-select mini"
      aria-label={t('mode.label')}
      title={t('mode.label')}
      value={mode}
      onChange={(e) => void router.setMode(e.target.value as 'first' | 'all')}
    >
      <option value="first">{t('mode.first')}</option>
      <option value="all">{t('mode.all')}</option>
    </select>
  )
}

function Counts({
  counters,
  t
}: {
  counters: { routed: number; dropped: number }
  t: T
}): React.JSX.Element {
  return (
    <span className="counts">
      <span>
        <b>{counters.routed.toLocaleString(t.locale)}</b> {t('counters.routed')}
      </span>
      <span className={counters.dropped ? 'warn' : undefined}>
        <b>{counters.dropped.toLocaleString(t.locale)}</b> {t('counters.dropped')}
      </span>
    </span>
  )
}

// --- patch bay --------------------------------------------------------------------------

function PatchBay({
  sources,
  targets,
  snapPaused,
  counters,
  t
}: {
  sources: PeerInfo[]
  targets: PeerInfo[]
  snapPaused: boolean
  counters: { routed: number; dropped: number }
  t: T
}): React.JSX.Element {
  return (
    <div className="bay">
      <div className="jacks jacks--in">
        <span className="bay-label">{t('sources')}</span>
        {sources.length === 0 && <span className="jack jack--ghost">{t('noSources')}</span>}
        {sources.map((peer) => (
          <span
            key={peer.cardId}
            className="jack"
            title={peer.outputs.map((o) => `${o.id}: ${o.type}`).join('\n')}
          >
            <i className={`kind kind--${peer.kind}`} />
            <span className="jack-name">{peer.name}</span>
          </span>
        ))}
      </div>
      <div className={`core ${snapPaused ? 'is-paused' : ''}`} aria-hidden>
        <svg viewBox="0 0 64 40">
          <path d="M2 20 H20 M44 12 H62 M44 20 H62 M44 28 H62 M20 20 C30 20 34 12 44 12 M20 20 H44 M20 20 C30 20 34 28 44 28" />
          <circle cx="20" cy="20" r="5" />
        </svg>
        <span className="core-count">{counters.routed.toLocaleString(t.locale)}</span>
      </div>
      <div className="jacks jacks--out">
        <span className="bay-label">{t('targets')}</span>
        {targets.length === 0 && <span className="jack jack--ghost">{t('noTargets')}</span>}
        {targets.map((peer) => {
          const formats = compatibleFormats(peer)
          return (
            <span
              key={peer.cardId}
              className="jack"
              title={peer.inputs
                .map((i) => `${i.id}: ${i.type}${i.permission ? ` (${i.permission})` : ''}`)
                .join('\n')}
            >
              <i className={`kind kind--${peer.kind}`} />
              <span className="jack-name">{peer.name}</span>
              <span className="jack-formats">
                {(['text', 'json', 'event'] as Format[]).map((f) => (
                  <i
                    key={f}
                    className={formats.includes(f) ? 'on' : undefined}
                    title={OUTPUT_FOR[f].type}
                  />
                ))}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// --- rules ----------------------------------------------------------------------------------

function matchSummary(rule: Rule, peers: PeerInfo[], t: T): string {
  const m = rule.match
  switch (m.kind) {
    case 'contains':
      return t('match.summary.contains', { text: m.text ?? '' })
    case 'field':
      return m.text
        ? t('match.summary.field', { path: m.path ?? '', text: m.text })
        : t('match.summary.fieldExists', { path: m.path ?? '' })
    case 'source':
      return t('match.summary.source', {
        source: peers.find((p) => p.cardId === m.source)?.name ?? m.source ?? '?'
      })
    case 'type':
      return t('match.summary.type', { type: m.type ?? '' })
    default:
      return t('match.summary.any')
  }
}

function RuleRow({
  rule,
  index,
  peers,
  hits,
  granted,
  t,
  onEdit,
  onToggle,
  onDelete,
  onGrant
}: {
  rule: Rule
  index: number
  peers: PeerInfo[]
  hits: number
  granted: (id: NonNullable<ReturnType<typeof checkTarget>['permission']>) => boolean
  t: T
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onGrant: () => void
}): React.JSX.Element {
  const check = checkTarget(rule, peers)
  const target = peers.find((p) => p.cardId === rule.target)
  const problem = !check.connected
    ? t('rule.disconnected')
    : !check.compatible
      ? t('rule.incompatible', { type: OUTPUT_FOR[rule.format].type })
      : check.permission && !granted(check.permission)
        ? t('rule.needsPermission')
        : null
  return (
    <div className={`rule ${rule.enabled ? '' : 'is-off'} ${problem ? 'has-problem' : ''}`}>
      <label className="ns-switch" title={t('rule.enabled')}>
        <input type="checkbox" checked={rule.enabled} onChange={onToggle} />
      </label>
      <div className="rule-body" onDoubleClick={onEdit}>
        <span className="rule-name">{rule.name || t('rule.unnamed', { n: index + 1 })}</span>
        <span className="rule-flow">
          <span className="rule-when">{matchSummary(rule, peers, t)}</span>
          <span className="arrow">→</span>
          <span className="rule-target">
            {target?.name ?? rule.target}
            {check.input && <span className="rule-input">.{check.input.id}</span>}
          </span>
          <span className={`fmt fmt--${rule.format}`}>{t(`format.${rule.format}`)}</span>
        </span>
        {problem && (
          <span className="rule-problem">
            {problem}
            {check.connected &&
              check.compatible &&
              check.permission &&
              !granted(check.permission) && (
                <button className="linkish" onClick={onGrant}>
                  {t('rule.grant')}
                </button>
              )}
          </span>
        )}
      </div>
      <span className="rule-hits">{t('rule.hits', { count: hits })}</span>
      <span className="rule-actions">
        <button className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onEdit}>
          {t('rule.edit')}
        </button>
        <button
          className="ns-btn ns-btn--ghost ns-btn--sm danger"
          onClick={onDelete}
          aria-label={t('rule.delete')}
        >
          ×
        </button>
      </span>
    </div>
  )
}

const MATCH_KINDS: MatchKind[] = ['any', 'contains', 'field', 'source', 'type']
const TYPES = [
  'ns:text',
  'ns:markdown',
  'ns:json',
  'ns:event',
  'ns:tasks',
  'ns:table',
  'ns:number',
  'ns:url'
]

function RuleEditor({
  rule,
  targets,
  sources,
  t,
  onSave,
  onCancel
}: {
  rule: Rule
  targets: PeerInfo[]
  sources: PeerInfo[]
  t: T
  onSave: (rule: Rule) => void
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Rule>(rule)
  const set = (patch: Partial<Rule>): void => setDraft((d) => ({ ...d, ...patch }))
  const setMatch = (patch: Partial<Rule['match']>): void =>
    setDraft((d) => ({ ...d, match: { ...d.match, ...patch } }))
  const target = targets.find((p) => p.cardId === draft.target)
  const check = checkTarget(draft, targets)
  // Not a <form>: the card frame is sandboxed without allow-forms, so a
  // form's submit event never fires in the app. Enter and the button call this.
  const submitDraft = (e: { preventDefault(): void }) => {
    e.preventDefault()
    onSave(draft)
  }
  return (
    <div
      role="form"
      className="editor ns-scroll"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') submitDraft(e)
      }}
    >
      <label className="field">
        <span>{t('rule.name')}</span>
        <input
          className="ns-input"
          value={draft.name}
          maxLength={60}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <div className="field">
        <span>{t('rule.match')}</span>
        <div className="row">
          <select
            className="ns-select"
            value={draft.match.kind}
            onChange={(e) => setMatch({ kind: e.target.value as MatchKind })}
          >
            {MATCH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`match.${kind}`)}
              </option>
            ))}
          </select>
          {draft.match.kind === 'contains' && (
            <input
              className="ns-input"
              placeholder={t('match.text')}
              value={draft.match.text ?? ''}
              onChange={(e) => setMatch({ text: e.target.value })}
            />
          )}
          {draft.match.kind === 'field' && (
            <>
              <input
                className="ns-input ns-mono"
                placeholder={t('match.fieldPath')}
                value={draft.match.path ?? ''}
                onChange={(e) => setMatch({ path: e.target.value })}
              />
              <input
                className="ns-input"
                placeholder={t('match.fieldValue')}
                value={draft.match.text ?? ''}
                onChange={(e) => setMatch({ text: e.target.value })}
              />
            </>
          )}
          {draft.match.kind === 'source' && (
            <select
              className="ns-select"
              value={draft.match.source ?? ''}
              onChange={(e) => setMatch({ source: e.target.value })}
            >
              <option value="" />
              {sources.map((p) => (
                <option key={p.cardId} value={p.cardId}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {draft.match.kind === 'type' && (
            <select
              className="ns-select"
              value={draft.match.type ?? ''}
              onChange={(e) => setMatch({ type: e.target.value })}
            >
              <option value="" />
              {[
                ...new Set([...TYPES, ...sources.flatMap((p) => p.outputs.map((o) => o.type))])
              ].map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="field">
        <span>{t('rule.target')}</span>
        <div className="row">
          <select
            className="ns-select"
            value={draft.target}
            onChange={(e) => set({ target: e.target.value, input: undefined })}
          >
            {targets.map((p) => (
              <option key={p.cardId} value={p.cardId}>
                {p.name} · {t(`kind.${p.kind}`)}
              </option>
            ))}
          </select>
          <select
            className="ns-select"
            aria-label={t('rule.input')}
            value={draft.input ?? ''}
            onChange={(e) => set({ input: e.target.value || undefined })}
          >
            <option value="">
              {t('rule.autoInput', {
                input: checkTarget({ ...draft, input: undefined }, targets).input?.id ?? '—'
              })}
            </option>
            {target?.inputs
              .filter((i) => i.mode === 'stream')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label} ({i.type})
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="field">
        <span>{t('rule.format')}</span>
        <div className="segmented">
          {(['text', 'json', 'event'] as Format[]).map((format) => {
            const ok = !target || compatibleFormats(target).includes(format)
            return (
              <button
                type="button"
                key={format}
                className={`${draft.format === format ? 'is-on' : ''} ${ok ? '' : 'is-incompatible'}`}
                title={OUTPUT_FOR[format].type}
                onClick={() => set({ format })}
              >
                {t(`format.${format}`)}
              </button>
            )
          })}
        </div>
        {!check.compatible && check.connected && (
          <span className="hint warn">
            {t('rule.incompatible', { type: OUTPUT_FOR[draft.format].type })}
          </span>
        )}
      </div>
      {draft.format === 'text' && (
        <label className="field">
          <span>{t('rule.template')}</span>
          <textarea
            className="ns-textarea ns-mono"
            rows={2}
            value={draft.template ?? ''}
            onChange={(e) => set({ template: e.target.value })}
          />
          <span className="hint">{t('rule.templateHint')}</span>
        </label>
      )}
      {draft.format === 'event' && (
        <label className="field">
          <span>{t('rule.eventType')}</span>
          <input
            className="ns-input ns-mono"
            value={draft.eventType ?? ''}
            placeholder="signal"
            maxLength={64}
            onChange={(e) => set({ eventType: e.target.value })}
          />
        </label>
      )}
      <label className="field field--inline">
        <span>{t('rule.perMinute')}</span>
        <input
          className="ns-input"
          type="number"
          min={1}
          max={600}
          value={draft.perMinute}
          onChange={(e) =>
            set({ perMinute: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })
          }
        />
      </label>
      <div className="editor-actions">
        <button type="button" className="ns-btn ns-btn--ghost ns-btn--sm" onClick={onCancel}>
          {t('rule.cancel')}
        </button>
        <button
          type="button"
          onClick={(e) => submitDraft(e)}
          className="ns-btn ns-btn--primary ns-btn--sm"
          disabled={!draft.target}
        >
          {t('rule.save')}
        </button>
      </div>
    </div>
  )
}

// --- inspector ------------------------------------------------------------------------------

function MessageRow({
  message,
  fresh,
  initialOpen,
  t
}: {
  message: InspectedMessage
  fresh: boolean
  initialOpen?: boolean
  t: T
}): React.JSX.Element {
  // null = not touched yet: follow `initialOpen` (the preview's newest message).
  const [touched, setOpen] = useState<boolean | null>(null)
  const open = touched ?? initialOpen === true
  const time = new Intl.DateTimeFormat(t.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(message.at)
  const ok = message.routes.filter((r) => r.ok)
  const failed = message.routes.filter((r) => !r.ok)
  return (
    <div className={`msg ${fresh ? 'is-fresh' : ''} ${ok.length ? 'is-routed' : 'is-dropped'}`}>
      <button className="msg-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="msg-time">{time}</span>
        <span className="msg-from">
          <i className={`kind kind--${message.fromKind}`} />
          {message.fromName}
        </span>
        <span className="msg-type">{message.type}</span>
        <span className="msg-preview">{preview(message.data)}</span>
        <span className="msg-size">{formatBytes(message.size)}</span>
      </button>
      <div className="msg-routes">
        {ok.map((route) => (
          <span key={route.ruleId + route.to} className="route route--ok">
            {t('msg.routedTo', { name: route.toName })}
            <span className="route-port">
              {route.output}→{route.input}
            </span>
          </span>
        ))}
        {failed.map((route) => (
          <span key={route.ruleId + route.to} className="route route--bad" title={route.reason}>
            {route.toName}:{' '}
            {t(`msg.reason.${route.reason}`) === `msg.reason.${route.reason}`
              ? route.reason
              : t(`msg.reason.${route.reason}`)}
          </span>
        ))}
        {message.dropped && (
          <span className="route route--bad">{t(`msg.dropped.${message.dropped}`)}</span>
        )}
      </div>
      {open && (
        <div className="msg-detail">
          <div>
            <p className="detail-label">{t('msg.value')}</p>
            <JsonTree value={message.data} />
          </div>
          <div>
            <p className="detail-label">{t('msg.shape')}</p>
            <pre className="shape">{inferShape(message.data)}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function JsonTree({
  value,
  name,
  depth = 0
}: {
  value: JsonValue
  name?: string
  depth?: number
}): React.JSX.Element {
  const label = name !== undefined ? <span className="jt-key">{name}: </span> : null
  if (value === null || typeof value !== 'object') {
    return (
      <div className="jt-leaf">
        {label}
        <span className={`jt-${value === null ? 'null' : typeof value}`}>
          {typeof value === 'string' ? JSON.stringify(value) : String(value)}
        </span>
      </div>
    )
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value)
  return (
    <details className="jt-node" open={depth < 2}>
      <summary>
        {label}
        <span className="jt-brace">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      <div className="jt-children">
        {entries.slice(0, 200).map(([key, child]) => (
          <JsonTree key={key} name={key} value={child as JsonValue} depth={depth + 1} />
        ))}
      </div>
    </details>
  )
}

function Plug({ broken }: { broken?: boolean }): React.JSX.Element {
  return (
    <svg
      className={`plug ${broken ? 'plug--broken' : ''}`}
      viewBox="0 0 120 40"
      width="120"
      height="40"
      aria-hidden
    >
      <path
        d={
          broken
            ? 'M4 20 H46 M74 20 H116'
            : 'M4 20 H40 C52 20 52 8 64 8 H116 M40 20 C52 20 52 32 64 32 H116'
        }
      />
      <circle cx={broken ? 50 : 40} cy="20" r="5" />
      <circle cx={broken ? 70 : 116} cy={broken ? 20 : 8} r="4" />
      {!broken && <circle cx="116" cy="32" r="4" />}
    </svg>
  )
}
