import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { buildAgeingPanel } from '../lib/attention'
import { useAttentionBuckets } from '../hooks/useAttentionBuckets'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp, reminderSavedMessage, lockedFollowUpIds } from '../lib/followUpQueries'
import { todayISO } from '../lib/followupDates'
import DayReviewCard from '../components/DayReviewCard'
import { DayKpiStrip } from '../components/DayReviewHeader'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import DrilldownPanel from '../components/DrilldownPanel'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import BdmPoolCard from '../components/BdmPoolCard'
import { errorMessage } from '../lib/errorMessage'

// The owner's Today screen — a bird's-eye view of the whole sales team's
// day, not a personal activity tracker. An owner doesn't log activities,
// rarely has follow-ups of their own, and doesn't touch leads or send
// quotes themselves, so Home.jsx's rep-shaped "Done today" hero and
// personal work queue read as a wall of zeros for this role (real feedback,
// 2026-09-01 — every tile on the original shared Home screen was blank for
// the owner). This is structurally the same screen as CoordinatorToday.jsx
// — same Day Review plumbing, same Hero → Overview → Act-now grammar — just
// scoped to *every* active sales exec (fetchActiveSalesExecs, unfiltered)
// instead of one coordinator's team. Kept as its own file rather than a
// shared component with CoordinatorToday: the two differ in roster source,
// in how many attention categories they surface, and in carrying a personal
// reminders card here that CoordinatorToday has no equivalent of — three
// real differences, not one abstraction away from being the same screen.
//
// Two-only attention categories (stale leads, overdue follow-ups) rather
// than all 5 computeAttentionBuckets produces, and personal reminders kept
// as a small secondary card rather than full Home.jsx billing — both
// deliberate choices, confirmed with the owner rather than assumed.
function OwnerToday() {
  const { employee } = useAuth()

  const [panel, setPanel] = useState(null)
  const [selectedExecId, setSelectedExecId] = useState(null)

  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [savedNote, setSavedNote] = useState(null)
  const [followUpError, setFollowUpError] = useState(null)

  // Remembered on the device (instant open — src/lib/queryClient.js): a
  // repeat open paints these at once and refreshes behind the "Updating…"
  // pill. The day review and reminders are keyed by the day, so yesterday's
  // never stand in for today's.
  const enabled = Boolean(employee?.id)
  const today = todayISO()
  const execsQuery = useCachedQuery(['today', 'execs'], fetchActiveSalesExecs, { enabled })
  const dayQuery = useCachedQuery(['today', 'day-review', today], () => fetchDayReview(today), { enabled })
  // The owner's own occasional reminders — a real but small use case
  // ("a few times which they want to remember themselves"), so this stays
  // its own personal fetch rather than folded into the org-wide data above.
  const followUpsQuery = useCachedQuery(
    ['today', 'due-follow-ups', employee?.id, today],
    () => fetchDueFollowUpsForEmployee(employee.id),
    { enabled }
  )

  const employees = execsQuery.result?.data ?? []
  const employeesLoaded = execsQuery.result !== undefined
  const loadError = useMemo(
    () => (execsQuery.result?.error ? errorMessage(execsQuery.result.error) : null),
    [execsQuery.result]
  )
  const dayData = dayQuery.result ?? null

  // The list is also edited in place by the row actions below (done, cancel,
  // reschedule), so it lives in state seeded from the query — and re-seeded
  // whenever the query refreshes.
  useEffect(() => {
    const res = followUpsQuery.result
    if (res && !res.error) setFollowUps(res.data ?? [])
  }, [followUpsQuery.result])

  const dayRows = dayData ? buildDayRows(employees, dayData, false) : []
  const dayTotals = buildDayTotals(dayRows)
  const dayKpis = dayData ? buildDayKpis(dayData, dayRows, false) : []

  // Org-wide under the owner's RLS — see useAttentionBuckets.
  const attentionBuckets = useAttentionBuckets(employee?.id)

  // Just the 2 most urgent categories, matching CoordinatorToday's own
  // scope — confirmed with the owner rather than defaulting to all 5, to
  // keep a screen billed as "brief" actually brief.
  const attentionRows = attentionBuckets
    ? ['stale', 'followups_overdue'].map((key) => {
        const bucket = attentionBuckets.find((b) => b.key === key)
        return {
          key,
          title: bucket.title,
          sub: bucket.sub,
          count: bucket.count,
          color: bucket.color,
          onOpen: () => setPanel(buildAgeingPanel(bucket, 'Your team', null, false)),
        }
      })
    : []
  const attentionTotal = attentionRows.reduce((s, r) => s + r.count, 0)

  function openDaySheet(employeeId) {
    if (!dayData) return
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return
    setSelectedExecId(employeeId)
    setPanel(
      buildDaySheetPanel({
        employee: emp,
        data: dayData,
        dateISO: todayISO(),
        isPast: false,
        changesUnavailable: dayData.changesUnavailable,
        changeLogStart: null,
        onReschedule: rescheduleFollowUp,
      })
    )
  }

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => prev.filter((f) => f.id !== data.id))
  }

  async function handleReschedule(id, dueDate) {
    const { error } = await rescheduleFollowUp(id, dueDate)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  async function handleCancelFollowUp(id, reason) {
    const { error } = await cancelFollowUp(id, reason)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <TodayGreetingHeader employee={employee} />

      {/* Leads a BDM sent over, waiting for the owner to assign — first thing
          on the page (owner's ruling), and absent entirely when none wait.
          Rendered outside the roster's loading gate so a slow roster can't
          hide it; Assign stays disabled until the roster arrives. */}
      <BdmPoolCard execs={employees} />

      {!employeesLoaded ? (
        <p className="vip-empty">Loading your team…</p>
      ) : loadError ? (
        <p className="vip-error" role="alert">{loadError}</p>
      ) : (
        <>
          {/* ---------- Hero: the org's headline pace for today. ---------- */}
          <div className="vip-today-hero">
            <div className="vip-today-hero-head">
              <h2 className="vip-day-head-title">Your team today</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="vip-today-hero-value">{employees.length}</span>
              <span className="vip-today-hero-sub">
                sales exec{employees.length === 1 ? '' : 's'} · {dayData ? `${dayTotals.total} logged today` : 'loading…'}
              </span>
            </div>
            {dayData && (
              <div className="vip-today-hero-kpis">
                <DayKpiStrip kpis={dayKpis} />
              </div>
            )}
          </div>

          <div className="vip-featured-row">
            <div className="vip-today-col">
              {/* ---------- Overview: what every sales exec has done today,
                  the exact same team table Dashboard's own Today period
                  already renders. ---------- */}
              <DayReviewCard rows={dayRows} totals={dayTotals} isPast={false} onOpenExec={openDaySheet} selectedExecId={selectedExecId} />
            </div>

            <div className="vip-today-col">
              {/* ---------- Act now: what sales execs are supposed to do
                  today, org-wide. ---------- */}
              <div className="vip-card">
                <div className="vip-card-head">
                  <h2 className="vip-card-title">Needs attention today</h2>
                  {attentionTotal > 0 && <span className="vip-day-head-count">{attentionTotal}</span>}
                </div>
                {!attentionBuckets ? (
                  <p className="vip-empty">Loading…</p>
                ) : attentionTotal === 0 ? (
                  <p className="vip-empty">Nothing needs attention right now.</p>
                ) : (
                  attentionRows
                    .filter((r) => r.count > 0)
                    .map((row) => (
                      <button key={row.key} type="button" className="vip-queue-row" onClick={row.onOpen}>
                        <span className="vip-queue-bar" style={{ background: row.color }} />
                        <span className="vip-queue-main">
                          <span className="vip-queue-title">{row.title}</span>
                          <span className="vip-queue-sub">{row.sub}</span>
                        </span>
                        <span className="vip-queue-count-num">{row.count}</span>
                        <span className="vip-queue-chevron" aria-hidden="true">›</span>
                      </button>
                    ))
                )}
              </div>

              {/* ---------- A small, secondary card — a few personal
                  reminders, kept out of the owner's way but not gone. ---------- */}
              <div className="vip-card">
                <div className="vip-card-head">
                  <h2 className="vip-card-title">Your reminders</h2>
                  <button type="button" className="vip-btn-link" onClick={() => { setSavedNote(null); setAddingFollowUp((v) => !v) }}>
                    {addingFollowUp ? 'Cancel' : '+ Add reminder'}
                  </button>
                </div>
                {addingFollowUp && (
                  <FollowUpForm
                    assignedTo={employee.id}
                    createdBy={employee.id}
                    onSaved={(row) => {
                      if (row.due_date <= todayISO()) setFollowUps((prev) => [...prev, row])
                      setSavedNote(reminderSavedMessage(row))
                      setAddingFollowUp(false)
                    }}
                    onCancel={() => setAddingFollowUp(false)}
                  />
                )}
                {savedNote && !addingFollowUp && <p className="vip-success" role="status" aria-live="polite">{savedNote}</p>}
                {followUpError && <p className="vip-error" role="alert">{followUpError}</p>}
                {followUps.length === 0 ? (
                  <p className="vip-empty">Nothing due today.</p>
                ) : (
                  <FollowUpList
                    followUps={followUps}
                    viewerId={employee.id}
                    onMarkDone={handleMarkDone}
                    onCancel={handleCancelFollowUp}
                    onReschedule={handleReschedule}
                    lockedIds={lockedFollowUpIds(followUps)}
                    emptyLabel="Nothing due today."
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
    </div>
  )
}

export default OwnerToday
