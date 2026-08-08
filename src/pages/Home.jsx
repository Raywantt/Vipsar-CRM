import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { fetchActivityCounts, fetchLeadsForBreakdown, fetchClosureForecast, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { fetchWonStageHistory, fetchTargetsForPeriod } from '../lib/targetQueries'
import { fetchDueFollowUpsForEmployee, markFollowUpDone } from '../lib/followUpQueries'
import { todayISO } from '../lib/followupDates'
import { computeOrderValueActuals, targetFor } from '../components/TargetsVsActualsCard'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
import { dealValueFor } from '../lib/pipelineValue'
import { formatCurrencyCompact, formatCurrency } from '../lib/format'
import FollowUpForm from '../components/FollowUpForm'
import DrilldownPanel from '../components/DrilldownPanel'

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

const PERIOD_LABEL_SUFFIX = {
  week: 'this week',
  month: 'this month',
  quarter: 'this quarter',
  year: 'this year',
}

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

// Names + "oldest Nd late" for the Overdue follow-ups row's sub-line.
function overdueSummary(rows) {
  if (!rows.length) return ''
  const names = [...new Set(rows.map((r) => r.parties?.name).filter(Boolean))]
  const nameLabel = names.length === 0 ? rows[0].title : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  const oldest = Math.max(...rows.map((r) => Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000)))
  return `${nameLabel} · oldest ${oldest}d late`
}

function formatTime(timeStr) {
  if (!timeStr) return null
  const [h, m] = timeStr.split(':')
  const d = new Date()
  d.setHours(Number(h), Number(m))
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// "Next {time} · {place}" for the Due today row's sub-line.
function dueTodaySummary(rows) {
  if (!rows.length) return ''
  const withTime = rows.find((r) => r.due_time)
  const place = rows[0].parties?.name ?? rows[0].title
  return withTime ? `Next ${formatTime(withTime.due_time)} · ${place}` : place
}

// Drives both the mobile hairline grid and the desktop separated-card grid
// below, so the two markup variants can't drift out of sync on values.
const KPI_TILES = [
  { label: () => 'Open leads', value: (k) => k.openLeads, sub: 'in your pipeline' },
  { label: () => 'Pipeline', value: (k) => formatCurrencyCompact(k.pipeline), sub: 'open, not won/lost' },
  { label: (p) => `Visits ${PERIOD_LABEL_SUFFIX[p]}`, value: (k) => k.visits, sub: 'site visits logged' },
  {
    label: (p) => `Won ${PERIOD_LABEL_SUFFIX[p]}`,
    value: (k) => formatCurrencyCompact(k.won),
    sub: 'booked',
    color: 'var(--vip-won)',
  },
]

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
  const isOnline = useOnlineStatus()
  const firstName = employee?.name?.trim().split(/\s+/)[0] ?? ''
  const now = new Date()
  const greeting = greetingForTime(now.getHours(), now.getMinutes())
  const longDate = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  const [period, setPeriod] = useState('week')
  const [kpis, setKpis] = useState(null)
  const [target, setTarget] = useState(undefined) // undefined = loading, null = no target for this period
  const [closing, setClosing] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [attentionBuckets, setAttentionBuckets] = useState(null)
  const [panel, setPanel] = useState(null)

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

  // The 3 stale/silent-quotes/slipped attention buckets, scoped to this
  // employee's own leads (breakdownLeads/fetchLastActivityPerLead return
  // company-wide rows for an owner under RLS, so the owner_employee_id
  // filter below is the "make it personal" step, same as EmployeeProfile's
  // myLeads/myAttention) — computed independent of the period switch below
  // (the work queue is always "right now", not scoped to a date range).
  useEffect(() => {
    if (!employee?.id) return
    let active = true
    Promise.all([fetchLeadsForBreakdown(), fetchLastActivityPerLead()]).then(([leadsRes, activityRes]) => {
      if (!active) return
      const myLeads = (leadsRes.data ?? []).filter((l) => l.owner_employee_id === employee.id)
      const map = new Map()
      ;(activityRes.data ?? []).forEach((row) => {
        const existing = map.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
      })
      setAttentionBuckets(computeAttentionBuckets(myLeads, map))
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) return
    setFollowUps((prev) => prev.filter((f) => f.id !== data.id))
    // Keep an already-open follow-up drill-down (if this row's bucket is the
    // one on screen) in sync rather than leaving a stale, already-done row.
    setPanel((prev) => {
      if (!prev || prev.kind !== 'followup') return prev
      const rows = prev.followUps.filter((f) => f.id !== data.id)
      return { ...prev, followUps: rows, value: String(rows.length) }
    })
  }

  useEffect(() => {
    if (!employee?.id) return
    let active = true
    const range = rangeForPreset(period)
    const targetPeriod = periodForPreset(period)

    Promise.all([
      fetchLeadsForBreakdown(),
      fetchActivityCounts(range),
      fetchWonStageHistory(),
      fetchClosureForecast(),
      targetPeriod ? fetchTargetsForPeriod(targetPeriod) : Promise.resolve({ data: [], error: null }),
    ]).then(([breakdownRes, activitiesRes, wonRes, forecastRes, targetsRes]) => {
      if (!active) return

      const openLeads = (breakdownRes.data ?? []).filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
      const pipeline = openLeads.reduce((s, l) => s + dealValueFor(l), 0)
      const visits = (activitiesRes.data ?? []).filter((a) => a.activity_type === 'site_visit').length
      const won = computeOrderValueActuals(wonRes.data ?? [], range, false)

      setKpis({ openLeads: openLeads.length, pipeline, visits, won })
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

  const overdueFollowUps = followUps.filter((f) => f.due_date < todayISO())
  const dueTodayFollowUps = followUps.filter((f) => f.due_date === todayISO())

  const queueRows = attentionBuckets
    ? [
        {
          key: 'followups_overdue',
          title: 'Overdue follow-ups',
          sub: overdueSummary(overdueFollowUps),
          count: overdueFollowUps.length,
          color: '#b4232a',
          onOpen: () => setPanel(followUpPanel('Overdue follow-ups', overdueFollowUps, handleMarkDone)),
        },
        {
          key: 'followups_today',
          title: 'Due today',
          sub: dueTodaySummary(dueTodayFollowUps),
          count: dueTodayFollowUps.length,
          color: '#0f6b6b',
          onOpen: () => setPanel(followUpPanel('Due today', dueTodayFollowUps, handleMarkDone)),
        },
        ...['stale', 'silent_quotes', 'slipped'].map((key) => {
          const bucket = attentionBuckets.find((b) => b.key === key)
          return {
            key,
            title: bucket.title,
            sub: bucket.sub,
            count: bucket.count,
            color: bucket.color,
            onOpen: () => setPanel(buildAgeingPanel(bucket, 'You', employee.id)),
          }
        }),
      ]
    : []
  const queueTotal = queueRows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="vip-wide">
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

      <div className="vip-card-head">
        <div className="vip-card-title">My numbers</div>
        <div className="vip-seg-mini" role="group" aria-label="KPI time frame">
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

      {kpis && (
        <>
          {/* .vip-dd-kpi-grid is shared with KpiSparkRow/EmployeeProfile's
              6-tile grids, whose ≥1024px override widens it to 6 columns —
              wrong for Home's 4 tiles (2 columns would sit empty), so
              desktop keeps the original separated .vip-kpi-grid cards
              instead, same vip-only-mobile/vip-only-desktop split Dashboard
              already uses for its own KPI band. */}
          <div className="vip-only-mobile">
            <div className="vip-dd-kpi-grid">
              {KPI_TILES.map((t) => (
                <div key={t.label} className="vip-dd-kpi-tile" style={{ cursor: 'default' }}>
                  <span className="vip-dd-kpi-label">{t.label(period)}</span>
                  <span className="vip-dd-kpi-value" style={{ color: t.color }}>
                    {t.value(kpis, period)}
                  </span>
                  <span className="vip-dd-kpi-sub">{t.sub}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="vip-only-desktop">
            <div className="vip-kpi-grid">
              {KPI_TILES.map((t) => (
                <div key={t.label} className="vip-kpi">
                  <div className="vip-kpi-label">{t.label(period)}</div>
                  <div className="vip-kpi-value" style={{ color: t.color }}>
                    {t.value(kpis, period)}
                  </div>
                  <div className="vip-kpi-note">{t.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {target !== null && (
        <div className="vip-card">
          <div className="vip-card-head">
            <div className="vip-card-title">Order value vs target</div>
            <span className="vip-card-note">{PERIOD_LABEL_SUFFIX[period]}</span>
          </div>
          {target === undefined ? (
            <p className="vip-empty">Loading…</p>
          ) : (
            <TargetBar target={target} period={period} />
          )}
        </div>
      )}

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
          <p className="vip-empty">Nothing needs your attention right now.</p>
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
              setFollowUps((prev) => [...prev, row])
              setAddingFollowUp(false)
            }}
            onCancel={() => setAddingFollowUp(false)}
          />
        )}
        {!addingFollowUp && (
          <p className="vip-empty">Set a personal reminder — it also shows in the work queue above once due.</p>
        )}
      </div>

      {closing.length > 0 && (
        <div className="vip-card">
          <div className="vip-card-title">Closing next</div>
          {closing.map((lead) => (
            <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
              <div className="vip-row-main">
                <div className="vip-row-title">{lead.parties?.name ?? '(no party)'}</div>
              </div>
              <div className="vip-row-side">
                <div className="vip-row-value">{formatCurrency(lead.quote_value)}</div>
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

export default Home
