import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { fetchActivityCounts, fetchDecidedStageHistory, fetchLastActivityPerLead, fetchLeadsForBreakdown } from '../lib/dashboardQueries'
import { fetchTargetsForPeriod, fetchWonStageHistory } from '../lib/targetQueries'
import { fetchActiveSalesExecs, fetchActivityLogForEmployee, fetchEmployeeProfile } from '../lib/employeeQueries'
import { fetchFollowUpsForEmployee, markFollowUpDone } from '../lib/followUpQueries'
import { computeOrderValueActuals, computeQuoteSentActuals, computeWonCountActuals, targetFor } from '../components/TargetsVsActualsCard'
import { computeAttentionBuckets } from '../lib/attention'
import { ACTIVITY_LABELS } from '../lib/activityTypes'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import { getInitials } from '../lib/initials'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'

const GOOD = '#0f6b6b'
const OK = '#b8791f'
const BAD = '#b4232a'
const BLUE = '#3f7d9e'

const PERIOD_OPTIONS = ['week', 'month', 'quarter']

const METRIC_TILES = [
  { key: 'order_value', label: 'Order value', money: true },
  { key: 'site_visit', label: 'Site visits' },
  { key: 'call', label: 'Calls made' },
  { key: 'rfq_raised', label: 'RFQs raised' },
  { key: 'quote_sent', label: 'Offers sent' },
  { key: 'won_count', label: 'Bookings' },
]

const CHART_SERIES = [
  { key: 'call', label: 'Calls', color: GOOD },
  { key: 'site_visit', label: 'Site visits', color: BLUE },
  { key: 'quote_sent', label: 'Offers sent', color: OK },
  { key: 'won_count', label: 'Bookings', color: '#101617' },
]

const STAGE_NEXT_ACTION = {
  new: 'First call due',
  hot: 'Send quote',
  rfq: 'Raise RFQ',
  quote: 'Follow up on quote',
  negotiation: 'Close negotiation',
}

function pctColor(p) {
  return p >= 100 ? GOOD : p >= 75 ? OK : BAD
}

function touchColor(days) {
  return days >= 14 ? BAD : days >= 7 ? OK : GOOD
}

function leadTitle(lead) {
  return lead.parties?.name ?? lead.sites?.nickname ?? lead.sites?.locality ?? `Lead #${lead.id}`
}

function startOfISOWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

// One bucket per working day (week) / ISO week touched (month) / calendar
// month touched (quarter) — per DATA_CONTRACT.md §2. VIPSAR works Saturdays
// (see attention.js/CLAUDE.md), so Sunday is skipped in the 'week' view.
function buildChartBuckets(preset, range) {
  const buckets = []
  const cursor = new Date(range.start)
  cursor.setHours(0, 0, 0, 0)

  if (preset === 'week') {
    while (cursor <= range.end) {
      if (cursor.getDay() !== 0) {
        const start = new Date(cursor)
        const end = new Date(cursor)
        end.setHours(23, 59, 59, 999)
        buckets.push({ label: cursor.toLocaleDateString('en-IN', { weekday: 'short' }), start, end })
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return buckets
  }

  if (preset === 'month') {
    let currentWeekStart = null
    while (cursor <= range.end) {
      const weekStart = startOfISOWeek(cursor)
      if (!currentWeekStart || weekStart.getTime() !== currentWeekStart.getTime()) {
        currentWeekStart = weekStart
        buckets.push({ label: `W${buckets.length + 1}`, start: new Date(cursor), end: new Date(cursor.setHours(23, 59, 59, 999)) })
      } else {
        buckets[buckets.length - 1].end = new Date(new Date(cursor).setHours(23, 59, 59, 999))
      }
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
    }
    return buckets
  }

  // quarter: one per calendar month touched
  let currentMonth = null
  while (cursor <= range.end) {
    const m = cursor.getMonth()
    if (currentMonth !== m) {
      currentMonth = m
      buckets.push({ label: cursor.toLocaleDateString('en-IN', { month: 'short' }), start: new Date(cursor), end: new Date(cursor.setHours(23, 59, 59, 999)) })
    } else {
      buckets[buckets.length - 1].end = new Date(new Date(cursor).setHours(23, 59, 59, 999))
    }
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
  }
  return buckets
}

function inBucket(date, bucket) {
  const t = new Date(date).getTime()
  return t >= bucket.start.getTime() && t <= bucket.end.getTime()
}

// Blended attainment = mean of the six metric ratios, each capped at 1.25,
// skipping metrics with no target set (same "skip when no target" rule
// DashboardHeatmap's Overall column already uses) — per DATA_CONTRACT.md §3.
function blendedAttainment(actuals, targets, execId) {
  const ratios = METRIC_TILES.map((m) => {
    const t = targetFor(targets, execId, m.key)
    if (!t) return null
    const a = actuals[m.key]?.get(execId) ?? 0
    return Math.min(a / t, 1.25)
  }).filter((r) => r != null)
  if (!ratios.length) return null
  return Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100)
}

function EmployeeProfile() {
  const { id } = useParams()
  const execId = Number(id)
  const navigate = useNavigate()
  const { employee: viewer } = useAuth()
  const { setOverride } = useHeaderOverride()
  const [searchParams, setSearchParams] = useSearchParams()

  const isOwner = viewer?.role === 'owner'
  const isSelf = viewer?.id === execId
  const preset = PERIOD_OPTIONS.includes(searchParams.get('period')) ? searchParams.get('period') : 'month'
  const range = rangeForPreset(preset)
  const period = periodForPreset(preset)

  const [profileEmployee, setProfileEmployee] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [activeSalesExecs, setActiveSalesExecs] = useState([])
  const [activities, setActivities] = useState([])
  const [breakdownLeads, setBreakdownLeads] = useState([])
  const [wonStageHistory, setWonStageHistory] = useState([])
  const [decidedStageHistory, setDecidedStageHistory] = useState([])
  const [targets, setTargets] = useState([])
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  const [activityLog, setActivityLog] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)
  const [loading, setLoading] = useState(true)

  // Role guard — a sales exec may only open their own page (FLOW.md §4);
  // RLS on activities/leads/targets already returns empty for anyone else's
  // data, this redirect is the UI-layer half of that same rule.
  useEffect(() => {
    if (!viewer) return
    if (!isOwner && !isSelf) navigate('/dashboard', { replace: true })
  }, [viewer, isOwner, isSelf, execId, navigate])

  useEffect(() => {
    let active = true
    fetchEmployeeProfile(execId).then(({ data, error }) => {
      if (!active) return
      if (error) setProfileError(error.message)
      else setProfileEmployee(data)
    })
    return () => {
      active = false
    }
  }, [execId])

  useEffect(() => {
    let active = true
    fetchActiveSalesExecs().then(({ data, error }) => {
      if (!active) return
      if (!error) setActiveSalesExecs(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchFollowUpsForEmployee(execId).then(({ data, error }) => {
      if (!active) return
      if (!error) setFollowUps(data ?? [])
    })
    return () => {
      active = false
    }
  }, [execId])

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) return
    setFollowUps((prev) => prev.map((f) => (f.id === data.id ? data : f)))
  }

  useEffect(() => {
    if (!range) return
    let active = true
    setLoading(true)
    Promise.all([
      fetchActivityCounts(range),
      fetchLeadsForBreakdown(),
      fetchWonStageHistory(),
      fetchDecidedStageHistory(),
      period ? fetchTargetsForPeriod(period) : Promise.resolve({ data: [], error: null }),
      fetchLastActivityPerLead(),
      fetchActivityLogForEmployee(execId),
    ]).then(([act, leads, won, decided, tgt, lastAct, log]) => {
      if (!active) return
      setActivities(act.data ?? [])
      setBreakdownLeads(leads.data ?? [])
      setWonStageHistory(won.data ?? [])
      setDecidedStageHistory(decided.data ?? [])
      setTargets(tgt.data ?? [])
      const map = new Map()
      ;(lastAct.data ?? []).forEach((row) => {
        const existing = map.get(row.lead_id)
        if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
      })
      setLastActivityByLead(map)
      setActivityLog(log.data ?? [])
      setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execId, preset])

  const execName = profileEmployee?.name ?? ''
  useEffect(() => {
    if (!execName) return
    setOverride({ sub: execName })
    return () => setOverride(null)
  }, [execName, setOverride])

  if (!viewer || (!isOwner && !isSelf)) return null
  if (profileError) return <div className="vip-wide"><p className="vip-error">{profileError}</p></div>
  if (!profileEmployee) return <div className="vip-wide"><p className="vip-empty">Loading…</p></div>

  const actuals = {
    order_value: computeOrderValueActuals(wonStageHistory, range, true),
    site_visit: null,
    call: null,
    rfq_raised: null,
    quote_sent: computeQuoteSentActuals(breakdownLeads, range, true),
    won_count: computeWonCountActuals(wonStageHistory, range, true),
  }
  const activityCountFor = (execIdArg, activityType) =>
    activities.filter((a) => a.employee_id === execIdArg && a.activity_type === activityType).length
  const actualFor = (execIdArg, key) =>
    key === 'site_visit' || key === 'call' || key === 'rfq_raised'
      ? activityCountFor(execIdArg, key)
      : actuals[key].get(execIdArg) ?? 0

  const myLeads = breakdownLeads.filter((l) => l.owner_employee_id === execId)
  const myOpenLeads = myLeads.filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
  const myAttention = computeAttentionBuckets(myLeads, lastActivityByLead)
  const staleBucket = myAttention.find((b) => b.key === 'stale')

  const myDecided = decidedStageHistory.filter((r) => r.leads?.owner_employee_id === execId)
  const winRate = myDecided.length ? Math.round((myDecided.filter((r) => r.stage === 'won').length / myDecided.length) * 100) : null

  const bookedValue = actuals.order_value.get(execId) ?? 0
  const targetActuals = {
    order_value: actuals.order_value,
    quote_sent: actuals.quote_sent,
    won_count: actuals.won_count,
  }
  const att = isOwner ? blendedAttainment({ ...targetActuals, site_visit: { get: (e) => activityCountFor(e, 'site_visit') }, call: { get: (e) => activityCountFor(e, 'call') }, rfq_raised: { get: (e) => activityCountFor(e, 'rfq_raised') } }, targets, execId) : null

  let rank = null
  let teamSize = 0
  if (isOwner) {
    const scored = activeSalesExecs.map((e) => ({
      id: e.id,
      score:
        blendedAttainment(
          {
            order_value: actuals.order_value,
            quote_sent: actuals.quote_sent,
            won_count: actuals.won_count,
            site_visit: { get: (ex) => activityCountFor(ex, 'site_visit') },
            call: { get: (ex) => activityCountFor(ex, 'call') },
            rfq_raised: { get: (ex) => activityCountFor(ex, 'rfq_raised') },
          },
          targets,
          e.id
        ) ?? -1,
    }))
    scored.sort((a, b) => b.score - a.score)
    rank = scored.findIndex((s) => s.id === execId) + 1
    teamSize = scored.length
  }
  const rankTier = rank && teamSize ? (rank <= Math.ceil(teamSize / 3) ? 'top' : rank <= Math.ceil((2 * teamSize) / 3) ? 'mid' : 'bottom') : null
  const rankStyle = { top: { bg: '#dbeceb', fg: GOOD }, mid: { bg: '#f6ecdb', fg: OK }, bottom: { bg: '#f7dcdd', fg: BAD } }[rankTier] ?? { bg: 'var(--vip-canvas)', fg: 'var(--vip-muted)' }

  const metrics = METRIC_TILES.map((m) => {
    const actual = actualFor(execId, m.key)
    const target = targetFor(targets, execId, m.key)
    const p = target ? Math.round((actual / target) * 100) : null
    const gap = target ? target - actual : null
    return {
      ...m,
      actual,
      target,
      display: m.money ? formatCurrencyCompact(actual) : String(actual),
      targetDisplay: target != null ? (m.money ? formatCurrencyCompact(target) : String(target)) : null,
      pct: p,
      color: p != null ? pctColor(p) : 'var(--vip-muted)',
      gapLabel: target == null ? '— / no target' : gap > 0 ? `${m.money ? formatCurrencyCompact(gap) : gap} short` : 'target met',
    }
  })

  // Activity mix chart
  const buckets = range ? buildChartBuckets(preset, range) : []
  const chartBuckets = buckets.map((b) => {
    const segs = CHART_SERIES.map((s) => {
      let value = 0
      if (s.key === 'call' || s.key === 'site_visit') {
        value = activities.filter((a) => a.employee_id === execId && a.activity_type === s.key && inBucket(a.created_at, b)).length
      } else if (s.key === 'quote_sent') {
        value = breakdownLeads.filter((l) => l.owner_employee_id === execId && l.quote_sent_at && inBucket(l.quote_sent_at, b)).length
      } else {
        const won = new Map()
        wonStageHistory.forEach((row) => {
          if (!row.leads || row.leads.owner_employee_id !== execId) return
          if (!won.has(row.lead_id)) won.set(row.lead_id, row)
        })
        value = [...won.values()].filter((row) => inBucket(row.changed_at, b)).length
      }
      return { ...s, value }
    })
    return { label: b.label, total: segs.reduce((s, seg) => s + seg.value, 0), segs }
  })
  const rawMax = Math.max(1, ...chartBuckets.map((b) => b.total))
  const tick = Math.max(1, Math.ceil(rawMax / 4 / 5) * 5)
  const niceMax = tick * 4
  const CHART_H = 176
  const gridLines = [0, 1, 2, 3, 4].map((k) => ({ value: tick * k, bottom: ((tick * k) / niceMax) * CHART_H }))
  const chartHasActivity = chartBuckets.some((b) => b.total > 0)

  // Leads assigned
  const leadsAssigned = myOpenLeads
    .map((l) => {
      const lastAt = lastActivityByLead.get(l.id) ?? l.created_at
      const days = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000)
      const overdueFollowup = l.next_followup_date && new Date(l.next_followup_date).getTime() < Date.now()
      const nextStep = l.next_followup_date && !overdueFollowup
        ? `Follow-up ${new Date(l.next_followup_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
        : overdueFollowup
        ? 'Follow-up overdue'
        : STAGE_NEXT_ACTION[l.current_stage ?? 'new'] ?? 'No next step'
      return { lead: l, days, nextStep }
    })
    .sort((a, b) => b.days - a.days)

  // Conversion funnel (bottom-up, period-scoped — matches DATA_CONTRACT.md §3)
  const won = actualFor(execId, 'won_count')
  const quoted = Math.max(actualFor(execId, 'quote_sent'), won + 1)
  const visited = Math.max(actualFor(execId, 'site_visit'), quoted + 1)
  const contactedLeadIds = new Set(activities.filter((a) => a.employee_id === execId && a.lead_id).map((a) => a.lead_id))
  const contacted = Math.max(contactedLeadIds.size, visited + 1)
  const receivedCount = range ? myLeads.filter((l) => { const c = new Date(l.created_at); return c >= range.start && c <= range.end }).length : 0
  const received = Math.max(receivedCount, contacted + 1)
  const funnelSteps = [
    { label: 'Leads received', count: received },
    { label: 'Contacted', count: contacted },
    { label: 'Site visit done', count: visited },
    { label: 'Quoted', count: quoted },
    { label: 'Won', count: won },
  ]
  const funnel = funnelSteps.map((s, i) => ({
    ...s,
    pct: Math.round((s.count / funnelSteps[0].count) * 100),
    drop: i === 0 ? 'entry' : `−${Math.round((1 - s.count / funnelSteps[i - 1].count) * 100)}%`,
    color: ['#c9d2d2', '#9fb3b3', '#5f9a9a', '#2b8080', GOOD][i],
  }))
  const funnelWinRate = quoted ? Math.round((won / quoted) * 100) : null

  // Pipeline owned
  const pipelineByStage = new Map()
  myOpenLeads.forEach((l) => {
    const stage = l.current_stage ?? 'new'
    if (!pipelineByStage.has(stage)) pipelineByStage.set(stage, { count: 0, value: 0 })
    const entry = pipelineByStage.get(stage)
    entry.count += 1
    entry.value += Number(l.order_value ?? l.quote_value ?? 0)
  })
  const pipelineRows = [...pipelineByStage.entries()].map(([stage, v]) => ({ stage, ...v }))
  const maxPipelineCount = Math.max(1, ...pipelineRows.map((r) => r.count))
  const pipelineTotal = pipelineRows.reduce((s, r) => s + r.value, 0)

  return (
    <div className="vip-wide">
      <div className="vip-profile-band">
        <div className="vip-profile-id">
          <div className="vip-profile-avatar">{getInitials(profileEmployee.name)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <div className="vip-profile-name-row">
              <span className="vip-profile-name">{profileEmployee.name}</span>
              {rankTier && (
                <span className="vip-pill" style={{ background: rankStyle.bg, color: rankStyle.fg }}>
                  Rank {rank} of {teamSize}
                </span>
              )}
            </div>
            <span className="vip-profile-sub">
              {[profileEmployee.role === 'owner' ? 'Owner' : 'Sales Executive', profileEmployee.office_location, `with VIPSAR since ${new Date(profileEmployee.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>

        <div className="vip-seg vip-seg-outline">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              className={preset === p ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
              onClick={() => setSearchParams({ period: p })}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="vip-profile-strip">
        <div className="vip-profile-strip-cell">
          <span className="vip-profile-strip-label">Attainment</span>
          <span className="vip-profile-strip-value" style={{ color: att != null ? pctColor(att) : 'var(--vip-ink)' }}>{att != null ? `${att}%` : '—'}</span>
          <span className="vip-profile-strip-sub">this {preset}, 6 metrics</span>
        </div>
        <div className="vip-profile-strip-cell">
          <span className="vip-profile-strip-label">Booked</span>
          <span className="vip-profile-strip-value">{formatCurrencyCompact(bookedValue)}</span>
          <span className="vip-profile-strip-sub">{targetFor(targets, execId, 'order_value') != null ? `of ${formatCurrencyCompact(targetFor(targets, execId, 'order_value'))} target` : 'no target set'}</span>
        </div>
        <div className="vip-profile-strip-cell">
          <span className="vip-profile-strip-label">Open pipeline</span>
          <span className="vip-profile-strip-value">{formatCurrencyCompact(myOpenLeads.reduce((s, l) => s + Number(l.order_value ?? l.quote_value ?? 0), 0))}</span>
          <span className="vip-profile-strip-sub">{myOpenLeads.length} live leads</span>
        </div>
        <div className="vip-profile-strip-cell">
          <span className="vip-profile-strip-label">Win rate</span>
          <span className="vip-profile-strip-value" style={{ color: winRate != null ? pctColor(winRate + 30) : 'var(--vip-ink)' }}>{winRate != null ? `${winRate}%` : '—'}</span>
          <span className="vip-profile-strip-sub">lifetime, all deals</span>
        </div>
        <div className="vip-profile-strip-cell">
          <span className="vip-profile-strip-label">Stale leads</span>
          <span className="vip-profile-strip-value" style={{ color: staleBucket.count >= 4 ? BAD : OK }}>{staleBucket.count}</span>
          <span className="vip-profile-strip-sub">no touch 7+ days</span>
        </div>
      </div>

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : (
        <>
          <div className="vip-dd-kpi-grid">
            {metrics.map((m) => (
              <div key={m.key} className="vip-dd-kpi-tile" style={{ cursor: 'default' }}>
                <span className="vip-dd-kpi-label">{m.label}</span>
                <div className="vip-profile-tile-value-row">
                  <span className="vip-dd-kpi-value">{m.display}</span>
                  {m.targetDisplay != null && <span className="vip-profile-tile-target">/ {m.targetDisplay}</span>}
                </div>
                {m.target != null ? (
                  <div className="vip-bar-track">
                    <div className="vip-bar-fill" style={{ width: `${Math.min(100, m.pct)}%`, background: m.color }} />
                  </div>
                ) : (
                  <div className="vip-bar-track" style={{ background: 'var(--vip-line-soft)' }} />
                )}
                <div className="vip-profile-tile-foot">
                  <span className="vip-profile-tile-pct" style={{ color: m.color }}>{m.pct != null ? `${m.pct}%` : '—'}</span>
                  <span className="vip-profile-tile-gap">{m.gapLabel}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="vip-profile-cols">
            <div className="vip-stack">
              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Activity mix · by {preset === 'week' ? 'day' : preset === 'month' ? 'week' : 'month'}</div>
                  <span className="vip-card-note">{chartBuckets.reduce((s, b) => s + b.total, 0)} activities · {formatCurrencyCompact(bookedValue)} booked</span>
                </div>
                <div className="vip-chart">
                  <div className="vip-chart-yaxis">
                    {gridLines.map((g) => (
                      <span key={g.value} className="vip-chart-ytick" style={{ bottom: g.bottom }}>{g.value}</span>
                    ))}
                  </div>
                  <div className="vip-chart-plot">
                    <div className="vip-chart-bars">
                      {gridLines.map((g) => (
                        <span key={g.value} className="vip-chart-gridline" style={{ bottom: g.bottom, background: g.value === 0 ? '#dde3e3' : '#f0f4f4' }} />
                      ))}
                      {!chartHasActivity && <div className="vip-chart-empty">No activity logged in this period</div>}
                      <div className="vip-chart-cols">
                        {chartBuckets.map((b) => (
                          <div key={b.label} className="vip-chart-col">
                            <span className="vip-chart-total">{b.total}</span>
                            <span className="vip-chart-stack">
                              {[...b.segs].reverse().map((s) => {
                                const h = (s.value / niceMax) * CHART_H
                                return (
                                  <span key={s.key} className="vip-chart-seg" style={{ height: `${h}px`, background: s.color, color: h >= 15 ? '#fff' : 'transparent' }}>
                                    {s.value > 0 ? s.value : ''}
                                  </span>
                                )
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="vip-chart-labels">
                      {chartBuckets.map((b) => (
                        <span key={b.label} className="vip-chart-xlabel">{b.label}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="vip-chart-legend">
                  {CHART_SERIES.map((s) => (
                    <span key={s.key} className="vip-chart-legend-item">
                      <span className="vip-chart-swatch" style={{ background: s.color }} />
                      {s.label}
                      <b style={{ fontWeight: 600, color: 'var(--vip-ink)' }}>{chartBuckets.reduce((sum, b) => sum + (b.segs.find((seg) => seg.key === s.key)?.value ?? 0), 0)}</b>
                    </span>
                  ))}
                </div>
              </div>

              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Leads assigned</div>
                  {staleBucket.count > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: BAD }}>{staleBucket.count} with no touch in 7+ days</span>}
                </div>
                {leadsAssigned.length === 0 ? (
                  <p className="vip-empty">No open leads assigned.</p>
                ) : (
                  leadsAssigned.map(({ lead, days, nextStep }) => (
                    <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-dd-age-row">
                      <span className="vip-dd-age-bar" style={{ background: touchColor(days) }} />
                      <span className="vip-dd-age-main">
                        <span className="vip-dd-age-party">{leadTitle(lead)}</span>
                        <span className="vip-dd-age-last">{[lead.sites?.nickname || lead.sites?.locality, lead.current_stage ?? 'new'].filter(Boolean).join(' · ')} · {nextStep}</span>
                      </span>
                      <span className="vip-dd-age-side">
                        <span className="vip-dd-age-days" style={{ color: touchColor(days) }}>{days}d ago</span>
                        <span className="vip-dd-age-value">{formatCurrencyCompact(lead.order_value ?? lead.quote_value)}</span>
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="vip-stack">
              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Conversion funnel</div>
                  <span className="vip-card-note">win rate {funnelWinRate != null ? `${funnelWinRate}%` : '—'}</span>
                </div>
                {funnel.map((f) => (
                  <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--vip-ink)' }}>
                      <span>{f.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--vip-faint)' }}>{f.count} · {f.drop}</span>
                    </div>
                    <div className="vip-bar-track vip-thick">
                      <div className="vip-bar-fill" style={{ width: `${f.pct}%`, background: f.color }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Pipeline owned</div>
                  <span className="vip-card-note">{formatCurrencyCompact(pipelineTotal)} open</span>
                </div>
                {pipelineRows.length === 0 ? (
                  <p className="vip-empty">No open leads assigned.</p>
                ) : (
                  pipelineRows.map((r) => (
                    <div key={r.stage} className="vip-bar-row">
                      <div style={{ flex: '0 0 84px' }}>
                        <span className={stageChipClass(r.stage)}>{r.stage}</span>
                      </div>
                      <div className="vip-bar-track vip-thick">
                        <div className="vip-bar-fill" style={{ width: `${(r.count / maxPipelineCount) * 100}%` }} />
                      </div>
                      <div className="vip-bar-count">{r.count}</div>
                      <div className="vip-bar-value">{formatCurrencyCompact(r.value)}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Activity log</div>
                  <span className="vip-card-note">last active days</span>
                </div>
                {activityLog.length === 0 ? (
                  <p className="vip-empty">No activity logged recently.</p>
                ) : (
                  activityLog.map((a) => (
                    <Link key={a.id} to={a.lead_id ? `/leads/${a.lead_id}` : '#'} className="vip-dd-log-row" style={a.lead_id ? undefined : { pointerEvents: 'none' }}>
                      <span className="vip-dd-log-when">
                        <span>{new Date(a.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                        <span className="vip-dd-log-time">{new Date(a.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                      <span className="vip-dd-log-main">
                        <span className="vip-dd-log-head">
                          <b style={{ fontWeight: 600, fontSize: 12, color: 'var(--vip-ink)' }}>{ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}</b>
                          <span className="vip-dd-log-party">{a.leads ? leadTitle(a.leads) : ''}</span>
                        </span>
                        {a.notes && <span className="vip-dd-log-notes">{a.notes}</span>}
                      </span>
                    </Link>
                  ))
                )}
              </div>

              <div className="vip-card">
                <div className="vip-card-head">
                  <div className="vip-card-title">Follow-ups</div>
                  <button type="button" className="vip-btn-link" onClick={() => setAddingFollowUp((v) => !v)}>
                    {addingFollowUp ? 'Cancel' : '+ Assign follow-up'}
                  </button>
                </div>
                {addingFollowUp && (
                  <FollowUpForm
                    assignedTo={execId}
                    createdBy={viewer.id}
                    onSaved={(row) => {
                      setFollowUps((prev) => [...prev, row])
                      setAddingFollowUp(false)
                    }}
                    onCancel={() => setAddingFollowUp(false)}
                  />
                )}
                <FollowUpList followUps={followUps} onMarkDone={handleMarkDone} emptyLabel="No follow-ups set." />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default EmployeeProfile
