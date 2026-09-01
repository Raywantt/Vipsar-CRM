import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { fetchLeadsForBreakdown, fetchClosureForecast, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { fetchWonStageHistory, fetchTargetsForPeriod } from '../lib/targetQueries'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp } from '../lib/followUpQueries'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildSignificantEntries, buildDaySheetPanel } from '../lib/dayReview'
import { todayISO } from '../lib/followupDates'
import { computeOrderValueActuals, targetFor } from '../components/TargetsVsActualsCard'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
import { formatCurrencyCompact } from '../lib/format'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import { errorMessage } from '../lib/errorMessage'
import DrilldownPanel from '../components/DrilldownPanel'
import { DayKpiStrip } from '../components/DayReviewHeader'
import TodayGreetingHeader from '../components/TodayGreetingHeader'
import CoordinatorToday from './CoordinatorToday'
import OwnerToday from './OwnerToday'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const PERIOD_OPTIONS = [
  { value: 'week', short: 'W', label: 'This week' },
  { value: 'month', short: 'M', label: 'This month' },
  { value: 'quarter', short: 'Q', label: 'This quarter' },
  { value: 'year', short: 'Y', label: 'This year' },
]

// (PERIOD_LABEL_SUFFIX is gone with the "My numbers" grid — the target card's
// own W/M/Q/Y control now says which period it's showing.)

// "Days left" in the target's own period — deliberately not derived from
// rangeForPreset(period), whose `end` is always "today" (a rolling
// week/month/quarter-to-date range, see dateRanges.js), not the period's
// actual close date.
function periodEndDate(period, now = new Date()) {
  if (period === 'week') {
    const day = now.getDay() // 0=Sun..6=Sat, week starts Monday
    const diffToSunday = day === 0 ? 0 : 7 - day
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToSunday, 23, 59, 59, 999)
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  if (period === 'quarter') {
    const endMonth = Math.floor(now.getMonth() / 3) * 3 + 3
    return new Date(now.getFullYear(), endMonth, 0, 23, 59, 59, 999)
  }
  if (period === 'year') return new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
  return null
}

function daysLeftLabel(period) {
  const end = periodEndDate(period)
  if (!end) return null
  const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
  return `${days} day${days === 1 ? '' : 's'} left`
}

function followUpPanel(title, rows, onMarkDone) {
  return {
    kind: 'followup',
    eyebrow: 'Your work queue',
    title,
    value: String(rows.length),
    followUps: rows,
    onMarkDone,
  }
}

function Home() {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [period, setPeriod] = useState('week')
  const [target, setTarget] = useState(undefined) // undefined = loading, null = no target for this period
  const [closing, setClosing] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [panel, setPanel] = useState(null)
  const [followUpError, setFollowUpError] = useState(null)

  // One day-scoped fetch powering the whole "Done today" half — the same
  // queries the Dashboard's Day Review runs, scoped by RLS to this employee.
  const [dayData, setDayData] = useState(null)

  // breakdownLeads/lastActivityByLead are period-agnostic pipeline snapshots
  // (see pipelineValue.js) — fetched once here instead of once per consumer,
  // since the target effect below and the attention-bucket derivation used to
  // each call fetchLeadsForBreakdown() independently (a full, unbounded leads
  // scan, twice on every load and again on every period toggle even though
  // neither actually depends on period).
  const [breakdownLeads, setBreakdownLeads] = useState(null)
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())

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

  // The 3 stale/silent-quotes/slipped attention buckets, scoped to this
  // employee's own leads (breakdownLeads/lastActivityByLead return
  // company-wide rows for an owner under RLS, so the owner_employee_id
  // filter below is the "make it personal" step, same as EmployeeProfile's
  // myLeads/myAttention) — independent of the period switch below (the work
  // queue is always "right now", not scoped to a date range), so this is a
  // plain derived value rather than its own fetch.
  const attentionBuckets = breakdownLeads
    ? computeAttentionBuckets(
        breakdownLeads.filter((l) => l.owner_employee_id === employee?.id),
        lastActivityByLead,
      )
    : null

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => prev.filter((f) => f.id !== data.id))
    // Keep an already-open follow-up drill-down (if this row's bucket is the
    // one on screen) in sync rather than leaving a stale, already-done row.
    setPanel((prev) => {
      if (!prev || prev.kind !== 'followup') return prev
      const rows = prev.followUps.filter((f) => f.id !== data.id)
      return { ...prev, followUps: rows, value: String(rows.length) }
    })
  }

  async function handleMove(id, dueDate) {
    const { error } = await rescheduleFollowUp(id, dueDate)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    // It's no longer due today or earlier, so it leaves this list.
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  // Rule 2.1 — cancelled is a real third outcome, kept in history, and never
  // counted as done. It leaves this queue either way.
  async function handleCancelFollowUp(id, reason) {
    const { error } = await cancelFollowUp(id, reason)
    if (error) { setFollowUpError(errorMessage(error)); return }
    setFollowUpError(null)
    setFollowUps((prev) => prev.filter((f) => f.id !== id))
  }

  // Rule 4.1 — the primary way a lead-anchored reminder is completed: hand
  // off to Log Activity with the lead and type pre-filled. ActivityLog closes
  // the follow-up when the activity saves, so nothing is marked done here.
  function handleLogActivityFor(f) {
    const params = new URLSearchParams({ lead: String(f.lead_id), followup: String(f.id) })
    if (f.activity_type && f.activity_type !== 'other') params.set('type', f.activity_type)
    navigate(`/activity?${params.toString()}`)
  }

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    const range = rangeForPreset(period)
    const targetPeriod = periodForPreset(period)

    Promise.all([
      fetchWonStageHistory(),
      fetchClosureForecast(),
      targetPeriod ? fetchTargetsForPeriod(targetPeriod) : Promise.resolve({ data: [], error: null }),
    ]).then(([wonRes, forecastRes, targetsRes]) => {
      if (!active) return

      setClosing((forecastRes.data ?? []).slice(0, 4))

      if (!targetPeriod) {
        setTarget(null)
      } else {
        const targetValue = targetFor(targetsRes.data ?? [], employee.id, 'order_value')
        const myWon = computeOrderValueActuals(wonRes.data ?? [], range, true).get(employee.id) ?? 0
        setTarget(targetValue == null ? null : { value: targetValue, actual: myWon })
      }
    })

    return () => {
      active = false
    }
  }, [period, employee?.id])

  // "Done today" — one row's worth of the same aggregation the Dashboard's
  // team table builds, for this employee alone.
  const myDay = dayData && employee ? buildDayRows([employee], dayData, false)[0] : null
  const entries = dayData && employee ? buildSignificantEntries(employee, dayData) : []

  function openMyDaySheet() {
    if (!dayData || !employee) return
    setPanel(
      buildDaySheetPanel({
        employee,
        data: dayData,
        dateISO: todayISO(),
        isPast: false,
        changesUnavailable: dayData.changesUnavailable,
        changeLogStart: null,
        onReschedule: rescheduleFollowUp,
      })
    )
  }

  // Everything actually outstanding: due today or already late. These cards
  // replaced the old "Your reminders" card and the work queue's own two
  // follow-up rows — one list, not the same reminders in three places.
  const openFollowUps = followUps
  const shownFollowUps = openFollowUps.slice(0, 3)

  const queueRows = attentionBuckets
    ? ['stale', 'silent_quotes', 'slipped'].map((key) => {
        const bucket = attentionBuckets.find((b) => b.key === key)
        return {
          key,
          title: bucket.title,
          sub: bucket.sub,
          count: bucket.count,
          color: bucket.color,
          onOpen: () => setPanel(buildAgeingPanel(bucket, 'You', employee.id)),
        }
      })
    : []
  const queueTotal = queueRows.reduce((s, r) => s + r.count, 0)

  // Shaped for DayKpiStrip (src/components/DayReviewHeader.jsx), the same
  // tile component the Day Review's team table already uses — swapped in
  // during the Today Briefing redesign to stop this screen hand-rolling its
  // own copy of the same grid. The Follow-ups tile gets DayKpiStrip's
  // built-in done/pending rendering (`value: null` + done/missed/
  // missedIsPending) instead of a plain string, which is also a real fix:
  // "N still open" used to always paint in --vip-lost (red) even though a
  // follow-up that isn't yet due is amber-pending, not a miss, everywhere
  // else this app shows the same fact (DoneMissCell, splitFollowUps).
  const doneTiles = myDay
    ? [
        { key: 'activities', label: 'Activities', value: String(myDay.total), sub: `${myDay.calls} calls · ${myDay.visits} visits` },
        {
          key: 'followups',
          label: 'Follow-ups',
          value: null,
          done: myDay.done,
          missed: myDay.pending,
          missedIsPending: true,
          sub: myDay.pending > 0 ? `${myDay.pending} still open` : 'all clear',
        },
        { key: 'touched', label: 'Leads touched', value: String(myDay.touched), sub: `${myDay.newLeads} new · ${myDay.changes} changes` },
        {
          key: 'quotes',
          label: 'Quotes sent',
          value: String(myDay.quotes),
          sub: myDay.quotesValue > 0 ? formatCurrencyCompact(myDay.quotesValue) : 'none today',
        },
      ]
    : []

  const attendCount = openFollowUps.length + queueTotal

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <TodayGreetingHeader employee={employee} />

      {/* ---------- Hero: today's headline number, promoted from a buried
          card lower on the old page to the first thing seen. Everything
          below still reads/writes the exact same state as before the
          redesign — this is a re-presentation, not a rebuild. ---------- */}
      <TodayHero target={target} period={period} onPeriodChange={setPeriod} doneTiles={doneTiles} />

      <div className="vip-featured-row">
        <div className="vip-today-col">
          {/* ---------- Act now: follow-ups + cold leads, merged into one
              zone. These used to be two separate cards ("Still to do
              today" and "Work queue") with no visual link between two
              things that both answer "what needs me right now". ---------- */}
          <div className="vip-card">
            <div className="vip-card-head">
              <div className="vip-card-title">Needs your attention today</div>
              <div className="vip-day-head-actions">
                {attendCount > 0 && <span className="vip-day-head-count">{attendCount}</span>}
                <button type="button" className="vip-btn-link" onClick={() => setAddingFollowUp((v) => !v)}>
                  {addingFollowUp ? 'Cancel' : '+ Add reminder'}
                </button>
              </div>
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

            {openFollowUps.length === 0 ? (
              <p className="vip-empty">Nothing outstanding. Set a reminder and it shows up here on the day it's due.</p>
            ) : (
              <>
                {/* Was a bespoke .vip-todo-card per row with ONE action each
                    (Call on the first, Move on the rest) and neither the
                    reminder's title nor its notes rendered at all — so an
                    instruction like "chase the revised quote, client wants
                    laminated glass" showed on this screen as just the
                    client's name and "2 days late". (FOLLOWUPS.md §6.5,
                    Rules 5.6–5.8.) FollowUpList carries every action on
                    every row now. */}
                <FollowUpList
                  followUps={shownFollowUps}
                  viewerId={employee.id}
                  onMarkDone={handleMarkDone}
                  onCancel={handleCancelFollowUp}
                  onReschedule={handleMove}
                  onLogActivity={handleLogActivityFor}
                  emptyLabel="Nothing outstanding."
                />
                {openFollowUps.length > shownFollowUps.length && (
                  <button
                    type="button"
                    className="vip-day-entry-link"
                    onClick={() => setPanel(followUpPanel('Still to do', openFollowUps, handleMarkDone))}
                  >
                    +{openFollowUps.length - shownFollowUps.length} more · see all
                  </button>
                )}
              </>
            )}

            <div className="vip-attend-subhead">Stale leads</div>

            {!attentionBuckets ? (
              <p className="vip-empty">Loading…</p>
            ) : queueTotal === 0 ? (
              <p className="vip-empty">No leads are going cold right now.</p>
            ) : (
              queueRows
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

          {myDay && myDay.tomorrow > 0 && (
            <div className="vip-card vip-todo-tomorrow">
              <span>
                <span className="vip-day-foot-label">Tomorrow</span>
                <span className="vip-todo-tomorrow-text">
                  {myDay.tomorrow} follow-up{myDay.tomorrow === 1 ? '' : 's'} · {myDay.tomorrowVisits} site visit
                  {myDay.tomorrowVisits === 1 ? '' : 's'}
                </span>
              </span>
            </div>
          )}

          {/* ---------- Recap: what's already been logged today, the
              quietest section — sits between "act now" and "outlook". ---------- */}
          {entries.length > 0 && (
            <div className="vip-card">
              <div className="vip-card-head">
                <div className="vip-card-title">Today's activity</div>
                {myDay?.firstActivityAt && <span className="vip-card-note">since {myDay.firstActivityAt}</span>}
              </div>
              {entries.map((e) => (
                <div key={e.id} className="vip-day-entry">
                  <span className="vip-day-entry-dot" style={{ background: e.color }} />
                  {e.leadId ? (
                    <Link to={`/leads/${e.leadId}`} className="vip-day-entry-text">
                      {e.text}
                    </Link>
                  ) : (
                    <span className="vip-day-entry-text">{e.text}</span>
                  )}
                  <span className="vip-day-entry-time">{e.time}</span>
                </div>
              ))}
              <button type="button" className="vip-day-entry-link" onClick={openMyDaySheet}>
                See everything I logged today
              </button>
            </div>
          )}
        </div>

        <div className="vip-today-col">
          {/* ---------- Outlook: what's coming, unchanged. ---------- */}
          {closing.length > 0 && (
            <div className="vip-card">
              <div className="vip-card-title">Closing next</div>
              {closing.map((lead) => (
                <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
                  <div className="vip-row-main">
                    <div className="vip-row-title">{lead.parties?.name ?? '(no party)'}</div>
                  </div>
                  <div className="vip-row-side">
                    <div className="vip-row-value">{formatCurrencyCompact(lead.quote_value)}</div>
                    <div className="vip-row-meta">
                      {formatDate(lead.estimated_close_date)}
                      {lead.closure_probability != null ? ` · ${lead.closure_probability}%` : ''}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
    </div>
  )
}

// The page's single focal point — was "Order value vs target", a plain card
// two-thirds of the way down the old page. Same TargetBar math and the same
// Done-today KPI tiles, just given hero billing: full width, above the
// column split, first thing seen after the greeting.
function TodayHero({ target, period, onPeriodChange, doneTiles }) {
  return (
    <div className="vip-today-hero">
      <div className="vip-today-hero-head">
        <span className="vip-day-head-title">Today's pace</span>
        {target !== null && (
          <div className="vip-seg-mini" role="group" aria-label="Target period">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.label}
                className={period === opt.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => onPeriodChange(opt.value)}
              >
                {opt.short}
              </button>
            ))}
          </div>
        )}
      </div>

      {target === undefined ? (
        <p className="vip-empty">Loading…</p>
      ) : target === null ? (
        <p className="vip-empty">No target set for this period.</p>
      ) : (
        <TargetBar target={target} period={period} />
      )}

      {doneTiles.length > 0 && (
        <div className="vip-today-hero-kpis">
          <DayKpiStrip kpis={doneTiles} />
        </div>
      )}
    </div>
  )
}

function TargetBar({ target, period }) {
  const pct = target.value > 0 ? Math.round((target.actual / target.value) * 100) : 0
  const pctColor = pct >= 100 ? 'var(--vip-won)' : 'var(--vip-amber)'
  const toGo = Math.max(0, target.value - target.actual)
  const daysLeft = daysLeftLabel(period)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="vip-today-hero-value">{formatCurrencyCompact(target.actual)}</span>
          <span className="vip-today-hero-sub">of {formatCurrencyCompact(target.value)}</span>
        </span>
        <span style={{ fontFamily: 'var(--vip-display)', fontWeight: 600, fontSize: 16, color: pctColor }}>{pct}%</span>
      </div>
      <div className="vip-bar-track vip-thick">
        <div className="vip-bar-fill" style={{ width: `${Math.min(100, pct)}%`, background: pctColor }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--vip-faint)' }}>
        <span>{formatCurrencyCompact(toGo)} to go</span>
        {daysLeft && <span>{daysLeft}</span>}
      </div>
    </>
  )
}

// `/` is one route serving a different screen per role. The switch lives in
// a wrapper rather than an early return inside Home, because Home runs a
// dozen hooks and fires several fetches before it renders anything — a
// coordinator or owner hitting an early return would still pay for every one
// of those queries, all of which are scoped to leads and activities neither
// role owns.
//
// Home itself is now sales_executive-only. It used to also serve owner, but
// real feedback (2026-09-01) is that a rep-shaped "Done today" hero and
// personal work queue read as a wall of zeros for an owner — they don't log
// activities, rarely have follow-ups of their own, and don't touch leads or
// send quotes themselves. OwnerToday is the bird's-eye replacement: the
// whole sales team's day, not one person's.
function Today() {
  const { employee } = useAuth()
  if (employee?.role === 'sales_coordinator') return <CoordinatorToday />
  if (employee?.role === 'owner') return <OwnerToday />
  return <Home />
}

export default Today
