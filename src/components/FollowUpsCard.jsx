import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import FollowUpList from './FollowUpList'
import { useCachedQuery } from '../hooks/useCachedQuery'
import ShowMoreRows from './ShowMoreRows'
import {
  fetchFollowUpsInRange,
  markFollowUpDone,
  cancelFollowUp,
  rescheduleFollowUp,
  reopenFollowUp,
  isMissed,
  FOLLOW_UP_DONE,
  FOLLOW_UP_CANCELLED,
  logActivityPathFor,
  canCloseByLogging,
  lockedFollowUpIds,
} from '../lib/followUpQueries'
import { todayISO, toISODate } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'
import { getInitials } from '../lib/initials'
import { TONE_BAD, TONE_WARN, TONE_GOOD, TONE_NEUTRAL } from '../lib/statusColors'

// Dashboard's "Followups" category (?tab=followups) — the app's first place to
// see every reminder rather than only the handful due today. See FOLLOWUPS.md
// Rule 5 (a rep's own) and Rule 8 (the owner/coordinator oversight counts).
//
// Scoping is RLS's job, not this component's: an owner's query returns the
// whole company, a coordinator's their own team, a rep's only themselves. So
// there is deliberately no role branch here — the same reasoning that fixed
// the `isOwner ? all : just-me` bug shape documented in CLAUDE.md.

// This card fetches every reminder the company has ever had, all-time, so
// the bucket a viewer lands on (especially Done or Cancelled) can hold years
// of rows. Rendered in chunks, revealed in place — see ShowMoreRows.
const ROW_CHUNK = 40

const BUCKETS = [
  { key: 'overdue', label: 'Overdue', tone: TONE_BAD },
  { key: 'today', label: 'Today', tone: TONE_WARN },
  { key: 'upcoming', label: 'Upcoming', tone: TONE_NEUTRAL },
  { key: 'done', label: 'Done', tone: TONE_GOOD },
  { key: 'cancelled', label: 'Cancelled', tone: TONE_NEUTRAL },
]

function bucketOf(f) {
  if (f.status === FOLLOW_UP_CANCELLED) return 'cancelled'
  if (f.status === FOLLOW_UP_DONE) return 'done'
  if (isMissed(f)) return 'overdue'
  if (f.due_date === todayISO()) return 'today'
  return 'upcoming'
}

// Rule 8 — assigned / done / missed per exec, for the selected period.
// "Assigned" excludes cancelled: a reminder that was deliberately called off
// was not work this person failed to do, and counting it would penalise them
// for cancelling it. Same rule the Day Review's own daily column uses, so the
// two surfaces can't disagree about the same word.
//
// `roster` seeds every employee the caller wants represented — Dashboard
// passes its already-scoped `employees` list — with a zero row, BEFORE the
// period's rows are folded in. Without this, an exec with no follow-up in
// the selected period simply never appeared here at all, which read as "no
// workload" when it actually meant "not shown" (reported 2026-09-09). A row
// not in the roster (a reassigned/deactivated employee, or a self-reminder
// for a viewer the roster doesn't include) still surfaces via the existing
// fallback rather than being silently dropped.
export function buildExecCounts(rows, roster = []) {
  const byExec = new Map()
  roster.forEach((emp) => {
    byExec.set(emp.id, { id: emp.id, name: emp.name, assigned: 0, done: 0, missed: 0 })
  })
  rows.forEach((f) => {
    if (f.status === FOLLOW_UP_CANCELLED) return
    const id = f.assigned_to
    if (!byExec.has(id)) {
      byExec.set(id, { id, name: f.assigned_to_employee?.name ?? `#${id}`, assigned: 0, done: 0, missed: 0 })
    }
    const e = byExec.get(id)
    e.assigned += 1
    if (f.status === FOLLOW_UP_DONE) e.done += 1
    else if (isMissed(f)) e.missed += 1
  })
  return [...byExec.values()]
}

const EXEC_COLUMNS = [
  { key: 'assigned', label: 'Assigned' },
  { key: 'done', label: 'Done' },
  { key: 'missed', label: 'Missed' },
]

// Same shape as DayReviewCard's own sortRows — high-to-low first tap, name as
// the tiebreak, so two execs on the same count settle alphabetically rather
// than by fetch order.
function sortExecRows(rows, sortKey, dir) {
  return rows.slice().sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
    if (diff !== 0) return dir === 'desc' ? -diff : diff
    return a.name.localeCompare(b.name)
  })
}

function FollowUpsCard({ range, rangeLabel, viewer, showTeam, employees = [] }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [actionError, setActionError] = useState(null)
  const [bucket, setBucket] = useState('overdue')
  const [execFilter, setExecFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(ROW_CHUNK)
  const [execSortKey, setExecSortKey] = useState('assigned')
  const [execSortDir, setExecSortDir] = useState('desc')

  function toggleExecSort(key) {
    if (key === execSortKey) {
      setExecSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setExecSortKey(key)
      setExecSortDir('desc')
    }
  }

  // A new bucket or exec filter is a different list — start it from the top
  // rather than keeping whatever depth the previous one was expanded to.
  useEffect(() => {
    setVisibleCount(ROW_CHUNK)
  }, [bucket, execFilter])

  // Upcoming reminders sit beyond the selected range's end by definition, so
  // the fetch deliberately runs to a far horizon rather than range.end — a
  // period filter that hid everything still to come would make the Upcoming
  // bucket permanently empty.
  // Local calendar dates. toISOString() converts to UTC first, which turned
  // IST midnight into the previous day and stretched every period back by one.
  const startISO = range ? toISODate(range.start) : null
  const endISO = range ? toISODate(range.end) : null

  // Remembered on the device (instant open). The list is edited in place by
  // the row actions below, so it lives in state seeded from the query and is
  // re-seeded whenever the query refreshes (every write triggers one).
  const allQuery = useCachedQuery(['followups', 'all'], () => fetchFollowUpsInRange('2000-01-01', '2999-12-31'), {
    enabled: Boolean(startISO),
  })
  const loading = allQuery.result === undefined
  const error = allQuery.result?.error ? errorMessage(allQuery.result.error) : null
  // A layout effect, so the seeded list is there in the first paint rather
  // than one empty frame after "Loading…" clears.
  useLayoutEffect(() => {
    const res = allQuery.result
    if (!res || res.error) return
    setRows(res.data ?? [])
  }, [allQuery.result])

  function applyUpdate(data) {
    setActionError(null)
    setRows((prev) => prev.map((f) => (f.id === data.id ? data : f)))
  }
  function onErr(err) { setActionError(errorMessage(err)) }

  async function handleMarkDone(id) {
    const { data, error: e } = await markFollowUpDone(id)
    if (e) onErr(e)
    else applyUpdate(data)
  }
  async function handleCancel(id, reason) {
    const { data, error: e } = await cancelFollowUp(id, reason)
    if (e) onErr(e)
    else applyUpdate(data)
  }
  async function handleReschedule(id, dueDate) {
    const { data, error: e } = await rescheduleFollowUp(id, dueDate)
    if (e) onErr(e)
    else applyUpdate(data)
  }
  async function handleReopen(id) {
    const { data, error: e } = await reopenFollowUp(id)
    if (e) onErr(e)
    else applyUpdate(data)
  }
  function handleLogActivity(f) {
    const path = logActivityPathFor(f)
    if (path) navigate(path)
  }

  // The per-exec table is period-scoped (it's a performance read), while the
  // bucket lists are not (a reminder due next month is still "upcoming" today).
  const inPeriod = useMemo(
    () => (endISO ? rows.filter((f) => f.due_date >= startISO && f.due_date <= endISO) : []),
    [rows, startISO, endISO]
  )
  const execCounts = useMemo(() => buildExecCounts(inPeriod, employees), [inPeriod, employees])
  const sortedExecCounts = useMemo(
    () => sortExecRows(execCounts, execSortKey, execSortDir),
    [execCounts, execSortKey, execSortDir]
  )
  const execsWithWork = useMemo(() => execCounts.filter((e) => e.assigned > 0).length, [execCounts])

  const visible = useMemo(() => {
    const scoped = execFilter === 'all' ? rows : rows.filter((f) => String(f.assigned_to) === execFilter)
    return scoped.filter((f) => bucketOf(f) === bucket)
  }, [rows, bucket, execFilter])

  const counts = useMemo(() => {
    const scoped = execFilter === 'all' ? rows : rows.filter((f) => String(f.assigned_to) === execFilter)
    return scoped.reduce((a, f) => { const b = bucketOf(f); a[b] = (a[b] || 0) + 1; return a }, {})
  }, [rows, execFilter])

  if (loading) return <p className="vip-empty">Loading…</p>
  if (error) return <p className="vip-error" role="alert">{error}</p>

  return (
    <>
      {showTeam && execCounts.length > 0 && (
        <div className="vip-card">
          <div className="vip-card-head">
            <h2 className="vip-card-title">Follow-ups by exec · {rangeLabel}</h2>
            <div className="vip-dd-hint">
              {execsWithWork} of {execCounts.length} with open work · sorted by{' '}
              {EXEC_COLUMNS.find((c) => c.key === execSortKey).label.toLowerCase()}
            </div>
          </div>
          <div className="vip-fu-exec-head">
            <span>Sales exec</span>
            {EXEC_COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                className="vip-daytable-sort"
                onClick={() => toggleExecSort(c.key)}
                aria-label={`Sort by ${c.label}`}
              >
                {c.label}
                {execSortKey === c.key && (
                  <span className="vip-daytable-arrow">{execSortDir === 'desc' ? '↓' : '↑'}</span>
                )}
              </button>
            ))}
          </div>
          {sortedExecCounts.map((e) => {
            const quiet = e.assigned === 0
            const active = String(e.id) === execFilter
            return (
              <button
                key={e.id}
                type="button"
                className={active ? 'vip-fu-exec-row vip-active' : 'vip-fu-exec-row'}
                onClick={() => setExecFilter(active ? 'all' : String(e.id))}
                title={quiet ? `${e.name} — no reminders in ${rangeLabel}` : e.name}
              >
                <span className="vip-fu-exec-name">
                  <span className={quiet ? 'vip-dd-avatar vip-daytable-avatar-quiet' : 'vip-dd-avatar'}>
                    {getInitials(e.name)}
                  </span>
                  <span className={quiet ? 'vip-daytable-quiet' : undefined}>{e.name}</span>
                </span>
                <span className={quiet ? 'vip-daytable-quiet' : undefined}>{e.assigned}</span>
                <span style={{ color: e.done ? TONE_GOOD : TONE_NEUTRAL }}>{e.done}</span>
                <span style={{ color: e.missed ? TONE_BAD : TONE_NEUTRAL }}>{e.missed}</span>
              </button>
            )
          })}
          {execFilter !== 'all' && (
            <button type="button" className="vip-btn-link" onClick={() => setExecFilter('all')}>
              Clear filter
            </button>
          )}
        </div>
      )}

      <div className="vip-card">
        <div className="vip-card-head">
          <h2 className="vip-card-title">All reminders</h2>
          {/* "reminders, not leads" — Needs Attention's own overdue count is
              LEADS with an overdue reminder; a lead can carry more than one,
              so the two numbers disagree on purpose. Both are honest, but
              side by side with no note it reads as a bug. */}
          <div className="vip-dd-hint">any due date — not scoped to {rangeLabel} · counts are reminders, not leads</div>
        </div>
        <div className="vip-seg vip-seg-outline">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              type="button"
              className={bucket === b.key ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
              onClick={() => setBucket(b.key)}
            >
              {b.label}
              <span className="vip-fu-bucket-count">{counts[b.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {actionError && <p className="vip-error" role="alert">{actionError}</p>}

        <FollowUpList
          followUps={visible.slice(0, visibleCount)}
          viewerId={viewer?.id}
          onMarkDone={handleMarkDone}
          onCancel={handleCancel}
          onReschedule={handleReschedule}
          onReopen={handleReopen}
          onLogActivity={handleLogActivity}
          canLogActivityFor={(f) => canCloseByLogging(viewer, f)}
          lockedIds={lockedFollowUpIds(visible)}
          emptyLabel={`Nothing ${BUCKETS.find((b) => b.key === bucket)?.label.toLowerCase()}.`}
        />
        <ShowMoreRows
          shown={Math.min(visibleCount, visible.length)}
          total={visible.length}
          noun="reminders"
          onShowMore={() => setVisibleCount((v) => v + ROW_CHUNK)}
        />
      </div>
    </>
  )
}

export default FollowUpsCard
