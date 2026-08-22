import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ACTIVITY_LABELS } from '../lib/activityTypes'
import { todayISO, addDays } from '../lib/followupDates'
import {
  FOLLOW_UP_OPEN,
  FOLLOW_UP_DONE,
  FOLLOW_UP_CANCELLED,
  isMissed,
  fetchFollowUpHistory,
} from '../lib/followUpQueries'

// ---------------------------------------------------------------------------
// PROPS CONTRACT — read this before wiring a new caller.
//
//   followUps      required. Rows from followUpQueries' FOLLOW_UP_SELECT.
//   viewerId       required for actions. The logged-in employee's id; drives
//                  the Rule 5.3 edit split (assignee vs assigner).
//   onMarkDone     (id, activityId?) => void      omit to hide the action
//   onCancel       (id, reason)      => void      omit to hide
//   onReschedule   (id, dueDateISO)  => void      omit to hide
//   onReopen       (id)              => void      omit to hide
//   onLogActivity  (followUp)        => void      omit to hide. Rule 4.1 —
//                  the PRIMARY way a lead-anchored follow-up is completed.
//   lockedIds      Set<id> that may not be cancelled (Rule 8.2 — an on-hold
//                  lead's hold review). Reschedule stays available on them.
//   emptyLabel     string
//
// The parent owns the list state: these callbacks fire after the caller's own
// write succeeds, and the caller re-renders with new data. This component
// keeps only per-row UI state (which row is expanded, which panel is open).
//
// Errors are the caller's to surface — every mark-done handler in this app
// used to `if (error) return` with no message, which is exactly why "it
// didn't disappear" was indistinguishable from a rejected write.
// ---------------------------------------------------------------------------

function formatDueDate(dateStr) {
  if (!dateStr) return '—'
  // Append the time so this parses as LOCAL, not UTC. due_date is a DATE
  // column; `new Date('2026-08-21')` is UTC midnight, which renders as the
  // previous day anywhere west of UTC.
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function formatLongDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatDueTime(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':')
  const d = new Date()
  d.setHours(Number(h), Number(m))
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// Same fallback chain every other lead-naming surface in this app uses
// (client name → site nickname → locality), falling back to the follow-up's
// own party for a party-only reminder.
//
// ⚠️ Any of these embeds can be null even when lead_id is set: a rep's
// parties/sites SELECT is scoped to their own leads, so a reminder assigned
// to them on someone else's lead resolves them to null rather than erroring.
// `Lead #id` is the honest last resort, not a bug.
function followUpLinkLabel(f) {
  return (
    f.leads?.parties?.name ??
    f.leads?.sites?.nickname ??
    f.leads?.sites?.locality ??
    f.parties?.name ??
    (f.lead_id ? `Lead #${f.lead_id}` : null)
  )
}

// Rows the data migration created from an orphaned leads.next_followup_date.
// Their title and assignee were INFERRED, not recorded — this app's standing
// rule is that a guessed value must never be indistinguishable from a real
// one, so the expanded view says so.
function isMigrated(f) {
  return typeof f.notes === 'string' && f.notes.startsWith('Migrated from the lead')
}

function statusChip(f) {
  if (f.status === FOLLOW_UP_CANCELLED) return { label: 'Cancelled', cls: 'vip-fu-chip vip-fu-chip-cancelled' }
  if (f.status === FOLLOW_UP_DONE) return { label: 'Done', cls: 'vip-fu-chip vip-fu-chip-done' }
  if (isMissed(f)) return { label: 'Missed', cls: 'vip-fu-chip vip-fu-chip-missed' }
  if (f.due_date === todayISO()) return { label: 'Today', cls: 'vip-fu-chip vip-fu-chip-today' }
  return { label: 'Open', cls: 'vip-fu-chip vip-fu-chip-open' }
}

const RESCHEDULE_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

function FollowUpRow({ f, viewerId, onMarkDone, onCancel, onReschedule, onReopen, onLogActivity, locked }) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState(null) // 'cancel' | 'move' | null
  const [reason, setReason] = useState('')
  const [moveDate, setMoveDate] = useState('')
  const [history, setHistory] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const open = f.status === FOLLOW_UP_OPEN
  const chip = statusChip(f)
  const dueTime = formatDueTime(f.due_time)
  const linkLabel = followUpLinkLabel(f)
  const typeLabel = f.activity_type ? (ACTIVITY_LABELS[f.activity_type] ?? 'Other') : null
  const assignedByOther = f.created_by !== f.assigned_to
  const isAssignee = viewerId != null && f.assigned_to === viewerId
  const mobile = f.leads?.parties?.mobile ?? f.parties?.mobile ?? null

  // Rule 10.2 — fetched lazily, never eagerly for every row in a list.
  async function loadHistory() {
    if (history || loadingHistory) return
    setLoadingHistory(true)
    const { data } = await fetchFollowUpHistory(f.id)
    setHistory(data ?? [])
    setLoadingHistory(false)
  }

  function toggle() {
    setExpanded((v) => !v)
    if (panel) setPanel(null)
  }

  return (
    <div className={expanded ? 'vip-fu-row vip-fu-row-open' : 'vip-fu-row'}>
      {/* Rule 5.7 — the whole head is the expand target. A <button> rather
          than a click handler on a div so it's reachable by keyboard and
          announced as expandable. */}
      <button
        type="button"
        className="vip-fu-head"
        onClick={toggle}
        aria-expanded={expanded}
        title={expanded ? 'Hide details' : 'Show details'}
      >
        <span className="vip-fu-head-main">
          {/* Rule 5.6 — the title ALWAYS renders, never as a fallback for
              something else. It is the actual instruction. */}
          <span className={f.status === FOLLOW_UP_OPEN ? 'vip-fu-title' : 'vip-fu-title vip-fu-title-closed'}>
            {f.title}
          </span>
          <span className="vip-fu-meta">
            {typeLabel}
            {typeLabel && linkLabel ? ' · ' : ''}
            {linkLabel}
          </span>
          {/* Rule 5.8 — a clipped note must look expandable, and the caret
              beside it is the affordance. */}
          {!expanded && f.notes && <span className="vip-fu-note-preview">{f.notes}</span>}
        </span>
        <span className="vip-fu-head-side">
          <span className={chip.cls}>{chip.label}</span>
          <span className="vip-fu-due">{formatDueDate(f.due_date)}</span>
          {dueTime && <span className="vip-fu-duetime">{dueTime}</span>}
        </span>
        <span className={expanded ? 'vip-fu-caret vip-fu-caret-open' : 'vip-fu-caret'} aria-hidden="true">›</span>
      </button>

      {expanded && (
        <div className="vip-fu-body">
          {/* Rule 5.7 — notes in FULL, wrapped, never clipped. This is the
              whole point of the expand. */}
          {f.notes ? (
            <p className="vip-fu-notes">{f.notes}</p>
          ) : (
            <p className="vip-fu-notes vip-fu-notes-empty">No notes on this reminder.</p>
          )}

          {isMigrated(f) && (
            <p className="vip-fu-warn">
              Created automatically from this lead's old follow-up date. Its title and
              the person it's assigned to were inferred — nobody recorded who set it.
            </p>
          )}

          <dl className="vip-fu-facts">
            <div><dt>Due</dt><dd>{formatLongDate(f.due_date)}{dueTime ? ` · ${dueTime}` : ''}</dd></div>
            {typeLabel && <div><dt>Type</dt><dd>{typeLabel}</dd></div>}
            {linkLabel && (
              <div>
                <dt>{f.lead_id ? 'Lead' : 'Party'}</dt>
                <dd>{f.lead_id ? <Link to={`/leads/${f.lead_id}`}>{linkLabel}</Link> : linkLabel}</dd>
              </div>
            )}
            <div>
              <dt>Assigned to</dt>
              <dd>
                {isAssignee ? 'You' : (
                  <Link to={`/employees/${f.assigned_to}`}>{f.assigned_to_employee?.name ?? `#${f.assigned_to}`}</Link>
                )}
              </dd>
            </div>
            {assignedByOther && (
              <div>
                <dt>Assigned by</dt>
                <dd><Link to={`/employees/${f.created_by}`}>{f.created_by_employee?.name ?? 'Owner'}</Link></dd>
              </div>
            )}
            {f.status === FOLLOW_UP_DONE && (
              <div>
                <dt>Completed</dt>
                <dd>
                  {f.done_at ? formatLongDate(f.done_at.slice(0, 10)) : 'yes'}
                  {/* Rule 4.2 — whether a real activity backs this completion
                      is the difference between evidence and self-report. */}
                  {f.completed_by_activity_id
                    ? ' · activity logged'
                    : ' · marked done without logging an activity'}
                </dd>
              </div>
            )}
            {f.status === FOLLOW_UP_CANCELLED && (
              <div><dt>Cancelled</dt><dd>{f.cancel_reason}</dd></div>
            )}
          </dl>

          <div className="vip-fu-actions">
            {/* A real tel: link when we know the client's number. Data-driven
                rather than a prop, so every surface gets it — Today's cards
                used to be the only place a rep could call from, and that was
                the reason those cards existed as bespoke markup. */}
            {open && mobile && (
              <a href={`tel:${mobile}`} className="vip-btn vip-fu-action-primary">Call</a>
            )}
            {open && onLogActivity && f.lead_id && (
              <button type="button" className="vip-btn vip-fu-action-primary" onClick={() => onLogActivity(f)}>
                Log activity &amp; close
              </button>
            )}
            {open && onMarkDone && (
              // Rule 4.4 — the visible secondary escape hatch. Deliberately
              // secondary styling: the primary path must be the faster one,
              // or activity counts and completion counts drift apart again.
              <button type="button" className="vip-btn-link" onClick={() => onMarkDone(f.id)}>
                {onLogActivity && f.lead_id ? 'Just mark done' : 'Mark done'}
              </button>
            )}
            {open && onReschedule && (
              <button type="button" className="vip-btn-link" onClick={() => setPanel(panel === 'move' ? null : 'move')}>
                Reschedule
              </button>
            )}
            {open && onCancel && !locked && (
              <button type="button" className="vip-btn-link" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
                Cancel
              </button>
            )}
            {open && locked && (
              // Rule 8.2 — an on-hold lead always has a live reminder on it.
              <span className="vip-fu-locked-note">Can't be cancelled while the lead is on hold</span>
            )}
            {!open && onReopen && (
              <button type="button" className="vip-btn-link" onClick={() => onReopen(f.id)}>Reopen</button>
            )}
            <button
              type="button"
              className="vip-btn-link vip-fu-history-toggle"
              onClick={() => { setHistory(history ? null : null); loadHistory() }}
            >
              History
            </button>
          </div>

          {panel === 'move' && (
            <div className="vip-action-panel">
              <span className="vip-action-panel-title">New date</span>
              <div className="vip-action-panel-opts">
                {RESCHEDULE_PRESETS.map((p) => (
                  <button key={p.label} type="button" className="vip-action-opt" onClick={() => { onReschedule(f.id, addDays(p.days)); setPanel(null) }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <input type="date" className="vip-input vip-input-inline" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
              <button type="button" className="vip-btn" disabled={!moveDate} onClick={() => { onReschedule(f.id, moveDate); setPanel(null) }}>
                Move
              </button>
            </div>
          )}

          {panel === 'cancel' && (
            <div className="vip-action-panel vip-fu-cancel-panel">
              <span className="vip-action-panel-title">Why is this no longer needed?</span>
              <input
                type="text"
                className="vip-input vip-input-inline"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Client went cold, plan changed…"
              />
              {/* Rule 2.1 — a reason is required, and a CHECK constraint
                  rejects an empty one, so gate it here rather than surfacing
                  a raw Postgres error. */}
              <button type="button" className="vip-btn" disabled={!reason.trim()} onClick={() => { onCancel(f.id, reason.trim()); setPanel(null) }}>
                Cancel reminder
              </button>
            </div>
          )}

          {loadingHistory && <p className="vip-fu-hist-empty">Loading history…</p>}
          {history && history.length > 0 && (
            <ul className="vip-fu-history">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="vip-fu-hist-field">{h.field.replace(/_/g, ' ')}</span>
                  {h.field === 'created' ? ' created' : ` ${h.old_value ?? '—'} → ${h.new_value ?? '—'}`}
                  <span className="vip-fu-hist-who">
                    {h.employees?.name ? ` · ${h.employees.name}` : ''}
                    {` · ${new Date(h.changed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {history && history.length === 0 && <p className="vip-fu-hist-empty">No changes recorded.</p>}
        </div>
      )}
    </div>
  )
}

function FollowUpList({
  followUps,
  viewerId,
  onMarkDone,
  onCancel,
  onReschedule,
  onReopen,
  onLogActivity,
  lockedIds,
  emptyLabel = 'Nothing here.',
}) {
  if (!followUps.length) return <p className="vip-empty">{emptyLabel}</p>

  return (
    <div className="vip-fu-list">
      {followUps.map((f) => (
        <FollowUpRow
          key={f.id}
          f={f}
          viewerId={viewerId}
          onMarkDone={onMarkDone}
          onCancel={onCancel}
          onReschedule={onReschedule}
          onReopen={onReopen}
          onLogActivity={onLogActivity}
          locked={lockedIds?.has(f.id) ?? false}
        />
      ))}
    </div>
  )
}

export default FollowUpList
