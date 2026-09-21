import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { fetchClosureForecast } from '../lib/dashboardQueries'
import { fetchWonStageHistory, fetchTargetsForPeriod } from '../lib/targetQueries'
import { fetchDueFollowUpsForEmployee, markFollowUpDone, cancelFollowUp, rescheduleFollowUp, logActivityPathFor, reminderSavedMessage, lockedFollowUpIds } from '../lib/followUpQueries'
import { fetchDayReview } from '../lib/dayReviewQueries'
import { buildDayRows, buildSignificantEntries, buildDaySheetPanel } from '../lib/dayReview'
import { todayISO } from '../lib/followupDates'
import { computeOrderValueActuals, targetFor } from '../components/TargetsVsActualsCard'
import { buildAgeingPanel } from '../lib/attention'
import { useAttentionBuckets } from '../hooks/useAttentionBuckets'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { formatCurrencyCompact } from '../lib/format'
import { leadDisplayName } from '../lib/leadName'
import BdmChip from '../components/BdmChip'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'
import { errorMessage } from '../lib/errorMessage'
import DrilldownPanel from '../components/DrilldownPanel'
import { DayKpiStrip } from '../components/DayReviewHeader'
import TodayGreetingHeader from '../components/TodayGreetingHeader'

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

function followUpPanel(title, rows, viewerId, onMarkDone, onCancel, onReschedule, onLogActivity) {
  return {
    kind: 'followup',
    eyebrow: 'Your work queue',
    title,
    value: String(rows.length),
    followUps: rows,
    viewerId,
    onMarkDone,
    onCancel,
    onReschedule,
    onLogActivity,
    lockedIds: lockedFollowUpIds(rows),
  }
}

function Home({ embedded = false }) {
  const { employee } = useAuth()
  const navigate = useNavigate()

  const [period, setPeriod] = useState('week')
  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [savedNote, setSavedNote] = useState(null)
  const [panel, setPanel] = useState(null)
  const [followUpError, setFollowUpError] = useState(null)

  // Remembered on the device (instant open — src/lib/queryClient.js): a
  // repeat open paints these at once and refreshes behind the "Updating…"
  // pill. Day-scoped ones are keyed by the day, so yesterday's never stand in
  // for today's.
  const enabled = Boolean(employee?.id)
  const today = todayISO()

  // Seeded into state because the row actions (done, cancel, reschedule)
  // edit the list in place; re-seeded whenever the query refreshes.
  const followUpsQuery = useCachedQuery(
    ['today', 'due-follow-ups', employee?.id, today],
    () => fetchDueFollowUpsForEmployee(employee.id),
    { enabled }
  )
  useEffect(() => {
    const res = followUpsQuery.result
    if (res && !res.error) setFollowUps(res.data ?? [])
  }, [followUpsQuery.result])

  // One day-scoped fetch powering the whole "Done today" half — the same
  // queries the Dashboard's Day Review runs, scoped by RLS to this employee.
  const dayQuery = useCachedQuery(['today', 'day-review', today], () => fetchDayReview(today), { enabled })
  const dayData = dayQuery.result ?? null

  // The attention buckets, scoped to this employee's own leads — a manager's
  // RLS also returns their team's leads, so `onlyOwnerId` is the "make it
  // personal" step, same as EmployeeProfile's myLeads/myAttention.
  // Independent of the period switch below (the work queue is always "right
  // now"). One server request — see useAttentionBuckets.
  const attentionBuckets = useAttentionBuckets(employee?.id, { onlyOwnerId: employee?.id ?? null })

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
    const path = logActivityPathFor(f)
    if (path) navigate(path)
  }

  // The period's target bar and "Closing next". Won history + forecast +
  // targets in one remembered query per period.
  const targetQuery = useCachedQuery(
    ['today', 'target', employee?.id, period],
    () => {
      const targetPeriod = periodForPreset(period)
      return Promise.all([
        fetchWonStageHistory(),
        fetchClosureForecast(),
        targetPeriod ? fetchTargetsForPeriod(targetPeriod) : Promise.resolve({ data: [], error: null }),
      ]).then(([wonRes, forecastRes, targetsRes]) => ({
        data: { won: wonRes.data ?? [], forecast: forecastRes.data ?? [], targets: targetsRes.data ?? [] },
        error: null,
      }))
    },
    { enabled }
  )
  const closing = useMemo(() => (targetQuery.result?.data?.forecast ?? []).slice(0, 4), [targetQuery.result])
  // undefined = loading, null = no target for this period
  const target = useMemo(() => {
    const data = targetQuery.result?.data
    if (!data || !employee?.id) return undefined
    const targetPeriod = periodForPreset(period)
    if (!targetPeriod) return null
    const targetValue = targetFor(data.targets, employee.id, 'order_value')
    const myWon = computeOrderValueActuals(data.won, rangeForPreset(period), true).get(employee.id) ?? 0
    return targetValue == null ? null : { value: targetValue, actual: myWon }
  }, [targetQuery.result, period, employee?.id])

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
    // `embedded` is set only by ManagerToday's "My day" tab, which supplies
    // its own page wrapper and greeting bar and would otherwise render a
    // second one inside a nested .vip-wide. Nothing else about this screen
    // changes by role: a manager IS a rep here, so they get the identical
    // hero, work queue and target bar an exec does, scoped by RLS to their
    // own leads and activities.
    <div className={embedded ? undefined : 'vip-wide vip-pad-fab-overhang'}>
      {!embedded && <TodayGreetingHeader employee={employee} />}

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
              <h2 className="vip-card-title">Needs your attention today</h2>
              <div className="vip-day-head-actions">
                {attendCount > 0 && <span className="vip-day-head-count">{attendCount}</span>}
                <button type="button" className="vip-btn-link" onClick={() => { setSavedNote(null); setAddingFollowUp((v) => !v) }}>
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
                  setSavedNote(reminderSavedMessage(row))
                  setAddingFollowUp(false)
                }}
                onCancel={() => setAddingFollowUp(false)}
              />
            )}

            {savedNote && !addingFollowUp && <p className="vip-success" role="status" aria-live="polite">{savedNote}</p>}
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
                  lockedIds={lockedFollowUpIds(shownFollowUps)}
                  emptyLabel="Nothing outstanding."
                />
                {openFollowUps.length > shownFollowUps.length && (
                  <button
                    type="button"
                    className="vip-day-entry-link"
                    onClick={() => setPanel(followUpPanel('Still to do', openFollowUps, employee.id, handleMarkDone, handleCancelFollowUp, handleMove, handleLogActivityFor))}
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
                    <span className="vip-queue-chevron" aria-hidden="true">›</span>
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
                <h2 className="vip-card-title">Today's activity</h2>
                {myDay?.firstActivityAt && <span className="vip-card-note">since {myDay.firstActivityAt}</span>}
              </div>
              {entries.map((e) => (
                <div key={e.id} className="vip-day-entry">
                  <span className="vip-day-entry-dot" style={{ background: e.color }} />
                  {e.accompanied ? (
                    // A meeting they went along to on a colleague's lead —
                    // shown here, never counted in "Done today" above, and
                    // never a link (they can't open a lead they don't own).
                    // Two lines, so "with {name}" survives a phone's width.
                    <span className="vip-day-entry-stack">
                      <span className="vip-day-entry-text">{e.text}</span>
                      <span className="vip-day-entry-sub">
                        <span className="vip-accompanied-tag">Accompanied</span>
                        <span className="vip-day-entry-sub-text">{e.withText}</span>
                      </span>
                    </span>
                  ) : e.leadId ? (
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
              <h2 className="vip-card-title">Closing next</h2>
              {closing.map((lead) => (
                <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
                  <div className="vip-row-main">
                    <div className="vip-row-title">
                      {leadDisplayName(lead)}
                      <BdmChip bdmEmployeeId={lead.bdm_employee_id} />
                    </div>
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
        <h2 className="vip-day-head-title">Today's pace</h2>
        {target !== null && (
          <div className="vip-seg-mini" role="group" aria-label="Target period">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.label}
                aria-label={opt.label}
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

export default Home
