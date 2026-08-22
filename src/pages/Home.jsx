import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
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
import CoordinatorToday from './CoordinatorToday'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function greetingForTime(hour, minute) {
  const minutesSinceMidnight = hour * 60 + minute
  if (minutesSinceMidnight >= 5 * 60 && minutesSinceMidnight < 12 * 60) return 'Good morning'
  if (minutesSinceMidnight >= 12 * 60 && minutesSinceMidnight < 17 * 60) return 'Good afternoon'
  if (minutesSinceMidnight >= 17 * 60 && minutesSinceMidnight < 19 * 60 + 30) return 'Good evening'
  return 'Hello'
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
  const isOnline = useOnlineStatus()
  const firstName = employee?.name?.trim().split(/\s+/)[0] ?? ''
  const now = new Date()
  const greeting = greetingForTime(now.getHours(), now.getMinutes())
  const longDate = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

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

  const doneTiles = myDay
    ? [
        { label: 'Activities', value: myDay.total, sub: `${myDay.calls} calls · ${myDay.visits} visits` },
        {
          label: 'Follow-ups',
          value: `${myDay.done} / ${myDay.done + myDay.pending}`,
          sub: myDay.pending > 0 ? `${myDay.pending} still open` : 'all clear',
          subColor: myDay.pending > 0 ? 'var(--vip-lost)' : undefined,
        },
        { label: 'Leads touched', value: myDay.touched, sub: `${myDay.newLeads} new · ${myDay.changes} changes` },
        { label: 'Quotes sent', value: myDay.quotes, sub: myDay.quotesValue > 0 ? formatCurrencyCompact(myDay.quotesValue) : 'none today' },
      ]
    : []

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <div className="vip-today-head">
        <div>
          <div className="vip-greeting">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </div>
          <div className="vip-today-date">{longDate}</div>
        </div>
        <div className="vip-today-head-actions">
          <span className={isOnline ? 'vip-sync-pill' : 'vip-sync-pill vip-sync-pill-offline'}>
            <span className="vip-sync-dot" />
            {isOnline ? 'Synced' : 'Offline'}
          </span>
          <Link to="/profile" className="vip-avatar" aria-label="Profile">
            {getInitials(employee?.name)}
          </Link>
        </div>
      </div>

      {/* ---------- half 1: what's been done ---------- */}
      <div className="vip-day-head">
        <span className="vip-day-head-title">Done today</span>
        {myDay?.firstActivityAt && <span className="vip-day-head-note">since {myDay.firstActivityAt}</span>}
      </div>

      {/* vip-dd-kpi-grid-4 is required: the base class is repeat(6) above
          1024px for the Dashboard's six-tile KPI row, and this strip has four.
          Without it the row ended a third empty. DayReviewHeader's own four-tile
          strip already carried the modifier; this one, added in the same pass,
          did not. (Phase 9 finding F-P3-1.) */}
      {myDay && (
        <div className="vip-dd-kpi-grid vip-dd-kpi-grid-4">
          {doneTiles.map((t) => (
            <div key={t.label} className="vip-dd-kpi-tile vip-dd-kpi-static">
              <span className="vip-dd-kpi-label">{t.label}</span>
              <span className="vip-dd-kpi-value">{t.value}</span>
              <span className="vip-dd-kpi-sub" style={{ color: t.subColor }}>
                {t.sub}
              </span>
            </div>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="vip-card">
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

      {/* ---------- half 2: what's still open ---------- */}
      <div className="vip-day-head">
        <span className="vip-day-head-title">Still to do today</span>
        <span className="vip-day-head-actions">
          {openFollowUps.length > 0 && <span className="vip-day-head-count">{openFollowUps.length} left</span>}
          <button type="button" className="vip-btn-link" onClick={() => setAddingFollowUp((v) => !v)}>
            {addingFollowUp ? 'Cancel' : '+ Add reminder'}
          </button>
        </span>
      </div>

      {addingFollowUp && (
        <div className="vip-card">
          <FollowUpForm
            assignedTo={employee.id}
            createdBy={employee.id}
            onSaved={(row) => {
              if (row.due_date <= todayISO()) setFollowUps((prev) => [...prev, row])
              setAddingFollowUp(false)
            }}
            onCancel={() => setAddingFollowUp(false)}
          />
        </div>
      )}

      {openFollowUps.length === 0 ? (
        <div className="vip-card">
          <p className="vip-empty">Nothing outstanding. Set a reminder and it shows up here on the day it's due.</p>
        </div>
      ) : (
        <>
          {/* Was a bespoke .vip-todo-card per row with ONE action each (Call
              on the first, Move on the rest) and neither the reminder's title
              nor its notes rendered at all — so an instruction like "chase the
              revised quote, client wants laminated glass" showed on this
              screen as just the client's name and "2 days late".
              (FOLLOWUPS.md §6.5, Rules 5.6–5.8.)

              Mark-done was also unreachable here unless you happened to have
              4+ open reminders: the handler's only call site was the "+N more"
              button below, which renders only when the list overflows 3.
              (§6.4.) FollowUpList carries every action on every row now. */}
          {followUpError && <p className="vip-error" role="alert">{followUpError}</p>}
          <div className="vip-card">
            <FollowUpList
              followUps={shownFollowUps}
              viewerId={employee.id}
              onMarkDone={handleMarkDone}
              onCancel={handleCancelFollowUp}
              onReschedule={handleMove}
              onLogActivity={handleLogActivityFor}
              emptyLabel="Nothing outstanding."
            />
          </div>
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

      {/* ---------- the standing work buckets, unchanged ---------- */}
      <div className="vip-card-head">
        <div className="vip-card-title">Work queue</div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--vip-lost)' }}>
          {queueTotal} item{queueTotal === 1 ? '' : 's'}
        </span>
      </div>

      <div className="vip-card vip-queue-card">
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

      {target !== null && (
        <div className="vip-card">
          <div className="vip-card-head">
            <div className="vip-card-title">Order value vs target</div>
            {/* The W/M/Q/Y switch used to head the "My numbers" KPI grid; that
                grid is now "Done today" (a single day, no period to pick), so
                the control moved to the one block that still has a period. */}
            <div className="vip-seg-mini" role="group" aria-label="Target period">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.label}
                  className={period === opt.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                  onClick={() => setPeriod(opt.value)}
                >
                  {opt.short}
                </button>
              ))}
            </div>
          </div>
          {target === undefined ? <p className="vip-empty">Loading…</p> : <TargetBar target={target} period={period} />}
        </div>
      )}

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

      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />
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
          <span style={{ fontFamily: 'var(--vip-display)', fontWeight: 600, fontSize: 25, color: 'var(--vip-ink)' }}>
            {formatCurrencyCompact(target.actual)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--vip-faint)' }}>of {formatCurrencyCompact(target.value)}</span>
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

// `/` is one route serving different screens per role. The switch lives in a
// wrapper rather than an early return inside Home, because Home runs a dozen
// hooks and fires several fetches before it renders anything — a coordinator
// hitting an early return would still pay for every one of those queries, all
// of which are scoped to leads and activities they don't own.
//
// Owner and sales_executive both keep Home exactly as it was.
function Today() {
  const { employee } = useAuth()
  if (employee?.role === 'sales_coordinator') return <CoordinatorToday />
  return <Home />
}

export default Today
