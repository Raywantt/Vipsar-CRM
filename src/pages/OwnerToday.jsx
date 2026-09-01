import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { fetchLeadsForBreakdown, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp } from '../lib/followUpQueries'
import { todayISO } from '../lib/followupDates'
import DayReviewCard from '../components/DayReviewCard'
import { DayKpiStrip } from '../components/DayReviewHeader'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import DrilldownPanel from '../components/DrilldownPanel'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
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

  const [employees, setEmployees] = useState([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const [dayData, setDayData] = useState(null)
  const [breakdownLeads, setBreakdownLeads] = useState(null)
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())

  const [panel, setPanel] = useState(null)
  const [selectedExecId, setSelectedExecId] = useState(null)

  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [followUpError, setFollowUpError] = useState(null)

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchActiveSalesExecs().then(({ data, error }) => {
      if (!active) return
      if (error) setLoadError(errorMessage(error))
      setEmployees(data ?? [])
      setEmployeesLoaded(true)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchDayReview(todayISO()).then((res) => {
      if (!active) return
      setDayData(res)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    Promise.all([fetchLeadsForBreakdown(), fetchLastActivityPerLead()]).then(([leadsRes, activityRes]) => {
      if (!active) return
      setBreakdownLeads(leadsRes.data ?? [])
      const map = new Map()
      ;(activityRes.data ?? []).forEach((row) => {
        const existing = map.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
      })
      setLastActivityByLead(map)
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  // The owner's own occasional reminders — a real but small use case
  // ("a few times which they want to remember themselves"), so this stays
  // its own personal fetch rather than folded into the org-wide data above.
  useEffect(() => {
    if (!employee?.id) return
    let active = true
    fetchDueFollowUpsForEmployee(employee.id).then(({ data, error }) => {
      if (!active) return
      if (!error) setFollowUps(data ?? [])
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  const dayRows = dayData ? buildDayRows(employees, dayData, false) : []
  const dayTotals = buildDayTotals(dayRows)
  const dayKpis = dayData ? buildDayKpis(dayData, dayRows, false) : []

  const attentionBuckets = breakdownLeads ? computeAttentionBuckets(breakdownLeads, lastActivityByLead) : null

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

      {!employeesLoaded ? (
        <p className="vip-empty">Loading your team…</p>
      ) : loadError ? (
        <p className="vip-error" role="alert">{loadError}</p>
      ) : (
        <>
          {/* ---------- Hero: the org's headline pace for today. ---------- */}
          <div className="vip-today-hero">
            <div className="vip-today-hero-head">
              <span className="vip-day-head-title">Your team today</span>
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
                  <div className="vip-card-title">Needs attention today</div>
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
                        <span className="vip-queue-chevron">›</span>
                      </button>
                    ))
                )}
              </div>

              {/* ---------- A small, secondary card — a few personal
                  reminders, kept out of the owner's way but not gone. ---------- */}
              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Your reminders</div>
                  <button type="button" className="vip-btn-link" onClick={() => setAddingFollowUp((v) => !v)}>
                    {addingFollowUp ? 'Cancel' : '+ Add reminder'}
                  </button>
                </div>
                {addingFollowUp && (
                  <FollowUpForm
                    assignedTo={employee.id}
                    createdBy={employee.id}
                    onSaved={(row) => {
                      if (row.due_date <= todayISO()) setFollowUps((prev) => [...prev, row])
                      setAddingFollowUp(false)
                    }}
                    onCancel={() => setAddingFollowUp(false)}
                  />
                )}
                {followUpError && <p className="vip-error" role="alert">{followUpError}</p>}
                {followUps.length === 0 ? (
                  <p className="vip-empty">Nothing set.</p>
                ) : (
                  <FollowUpList
                    followUps={followUps}
                    viewerId={employee.id}
                    onMarkDone={handleMarkDone}
                    onCancel={handleCancelFollowUp}
                    onReschedule={handleReschedule}
                    emptyLabel="Nothing set."
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
