import { useEffect, useState } from 'react'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { fetchLeadsForBreakdown, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
import { rescheduleFollowUp } from '../lib/followUpQueries'
import { todayISO } from '../lib/followupDates'
import DayReviewCard from './DayReviewCard'
import { DayKpiStrip } from './DayReviewHeader'
import FollowUpForm from './FollowUpForm'
import DrilldownPanel from './DrilldownPanel'

// "Your team today" — one supervisor's team day, shared by BOTH supervising
// roles: the sales coordinator's Today screen and the sales manager's "My
// team" tab.
//
// EXTRACTED, not written fresh (2026-09-03). This is CoordinatorToday.jsx's
// own body, lifted verbatim and parameterised. The alternative was a second
// copy inside ManagerToday differing only in which attention buckets it
// shows — and this repo has already paid for that shape twice (BottomNav's
// duplicated capability flags cost a coordinator two core actions on an
// entire breakpoint; the mobile/desktop quick-actions props on LeadDetail
// were nearly the same story). One rendering, two callers.
//
// What each caller supplies, and why it's a prop rather than a role check
// inside here:
//   execs         — the roster. The caller fetches it (fetchMyTeamExecs for
//                   a coordinator, fetchMyManagedExecs for a manager), so
//                   this component never needs to know which role it is
//                   serving. Every query below is RLS-driven and
//                   role-agnostic; scoping "my team" only ever means passing
//                   a smaller array in.
//   attentionKeys — which of computeAttentionBuckets' 5 buckets to surface.
//                   A coordinator sees 2 (the Phase 4 spec's own scope); a
//                   manager sees all 5 (the owner's ruling, 2026-09-03).
//                   Order is the caller's, so the list reads deliberately
//                   rather than in whatever order the buckets happen to come
//                   back.
//   heroTitle / attentionTitle — copy only. "Your team" reads correctly for
//                   both roles, so the drill-down's scope label is fixed.
//
// Deliberately NOT here, unchanged from CoordinatorToday's original scope: a
// date picker (Dashboard already owns past-day review, already team-scoped
// for both roles) and a team target/attainment card.
function TeamTodayPanel({
  employee,
  execs,
  attentionKeys = ['stale', 'followups_overdue'],
  heroTitle = 'Your team today',
  attentionTitle = "Needs your team's attention",
  // Inline row actions in the red-flag drill-down: swipe a lead to set a
  // follow-up on it without leaving the queue. Off by default so the
  // coordinator's Today screen keeps behaving exactly as it did before this
  // component existed; the sales manager turns it on. Only the follow-up
  // half is ever enabled — see the allowLogCall argument below.
  rowActions = false,
}) {
  const [dayData, setDayData] = useState(null)
  const [breakdownLeads, setBreakdownLeads] = useState(null)
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())

  const [panel, setPanel] = useState(null)
  const [selectedExecId, setSelectedExecId] = useState(null)

  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [pickedExec, setPickedExec] = useState(null)

  // Same day-scoped fetch Home.jsx's own "Done today" runs — RLS alone
  // decides whose rows come back (this supervisor's team, via
  // coordinator_team_select or manager_team_select), so the call is
  // byte-identical for either role.
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

  // Same pipeline-snapshot pair Home.jsx fetches once for its own work
  // queue. fetchLeadsForBreakdown() is already RLS-scoped to the team, so
  // the red-flags queue needs no owner filter the way Home's personal one
  // does.
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

  const dayRows = dayData ? buildDayRows(execs, dayData, false) : []
  const dayTotals = buildDayTotals(dayRows)
  const dayKpis = dayData ? buildDayKpis(dayData, dayRows, false) : []

  const attentionBuckets = breakdownLeads ? computeAttentionBuckets(breakdownLeads, lastActivityByLead) : null

  // Mapped over attentionKeys rather than filtering the buckets, so the
  // caller's chosen ORDER is what renders. A key with no matching bucket is
  // dropped rather than throwing — attention.js owns that list, and a rename
  // there should quietly show one row fewer, not blank the screen.
  const redFlagRows = attentionBuckets
    ? attentionKeys
        .map((key) => attentionBuckets.find((b) => b.key === key))
        .filter(Boolean)
        .map((bucket) => ({
          key: bucket.key,
          title: bucket.title,
          sub: bucket.sub,
          count: bucket.count,
          color: bucket.color,
          // viewerEmployeeId is the acting supervisor: it becomes
          // `created_by` on the follow-up the row action creates, so the
          // rep sees who asked for it ("Assigned by {name}"). The final
          // `false` withholds "Log call" — a supervisor's queue may nudge,
          // not claim credit for, a rep's work.
          onOpen: () => setPanel(buildAgeingPanel(bucket, 'Your team', employee?.id ?? null, rowActions, false)),
        }))
    : []
  const redFlagTotal = redFlagRows.reduce((s, r) => s + r.count, 0)

  function openDaySheet(employeeId) {
    if (!dayData) return
    const emp = execs.find((e) => e.id === employeeId)
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

  function closeAssignForm() {
    setAddingFollowUp(false)
    setPickedExec(null)
  }

  return (
    <>
      {/* ---------- Hero: the team's headline pace — same shell as Home's
          personal hero, team-shaped content: no target/period switch, just
          team size and today's total, with the same supporting KPI strip
          Dashboard's own Today period already renders for the owner. ---------- */}
      <div className="vip-today-hero">
        <div className="vip-today-hero-head">
          <span className="vip-day-head-title">{heroTitle}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="vip-today-hero-value">{execs.length}</span>
          <span className="vip-today-hero-sub">
            sales exec{execs.length === 1 ? '' : 's'} · {dayData ? `${dayTotals.total} logged today` : 'loading…'}
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
          {/* ---------- Overview: the team day table, reused verbatim from
              Dashboard's own Today period. ---------- */}
          <DayReviewCard rows={dayRows} totals={dayTotals} isPast={false} onOpenExec={openDaySheet} selectedExecId={selectedExecId} />
        </div>

        <div className="vip-today-col">
          {/* ---------- Act now: team red flags + assigning a follow-up to a
              team member, the same "+ Assign follow-up" pattern
              EmployeeProfile.jsx already establishes for owner→exec. ---------- */}
          <div className="vip-card">
            <div className="vip-card-head">
              <div className="vip-card-title">{attentionTitle}</div>
              <div className="vip-day-head-actions">
                {redFlagTotal > 0 && <span className="vip-day-head-count">{redFlagTotal}</span>}
                <button
                  type="button"
                  className="vip-btn-link"
                  onClick={() => (addingFollowUp ? closeAssignForm() : setAddingFollowUp(true))}
                >
                  {addingFollowUp ? 'Cancel' : '+ Assign follow-up'}
                </button>
              </div>
            </div>

            {addingFollowUp && (
              <label className="vip-field">
                Who is this for? *
                <select
                  className="vip-select"
                  value={pickedExec?.id ?? ''}
                  onChange={(e) => setPickedExec(execs.find((emp) => String(emp.id) === e.target.value) ?? null)}
                >
                  <option value="">— Choose a sales exec —</option>
                  {execs.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {addingFollowUp && pickedExec && (
              <FollowUpForm assignedTo={pickedExec.id} createdBy={employee.id} onSaved={closeAssignForm} onCancel={closeAssignForm} />
            )}

            {!attentionBuckets ? (
              <p className="vip-empty">Loading…</p>
            ) : redFlagTotal === 0 ? (
              <p className="vip-empty">Nothing needs your attention right now.</p>
            ) : (
              redFlagRows
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
        </div>
      </div>

      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
    </>
  )
}

export default TeamTodayPanel
