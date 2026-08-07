import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { HOME_TILES } from '../lib/homeTiles'
import { rangeForPreset } from '../lib/dateRanges'
import { fetchActivityCounts, fetchLeadsForBreakdown, fetchClosureForecast } from '../lib/dashboardQueries'
import { fetchWonStageHistory } from '../lib/targetQueries'
import { fetchDueFollowUpsForEmployee, markFollowUpDone } from '../lib/followUpQueries'
import { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import { formatCurrencyCompact, formatCurrency } from '../lib/format'
import FollowUpForm from '../components/FollowUpForm'
import FollowUpList from '../components/FollowUpList'

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

function Home() {
  const { employee } = useAuth()
  const tiles = HOME_TILES[employee?.role] ?? []
  const firstName = employee?.name?.trim().split(/\s+/)[0] ?? ''
  const now = new Date()
  const greeting = greetingForTime(now.getHours(), now.getMinutes())

  const [period, setPeriod] = useState('week')
  const [kpis, setKpis] = useState(null)
  const [closing, setClosing] = useState([])
  const [followUps, setFollowUps] = useState([])
  const [addingFollowUp, setAddingFollowUp] = useState(false)

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

  async function handleMarkDone(id) {
    const { data, error } = await markFollowUpDone(id)
    if (error) return
    setFollowUps((prev) => prev.filter((f) => f.id !== data.id))
  }

  useEffect(() => {
    let active = true
    const range = rangeForPreset(period)

    Promise.all([
      fetchLeadsForBreakdown(),
      fetchActivityCounts(range),
      fetchWonStageHistory(),
      fetchClosureForecast(),
    ]).then(([breakdownRes, activitiesRes, wonRes, forecastRes]) => {
      if (!active) return

      const openLeads = (breakdownRes.data ?? []).filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
      const pipeline = openLeads.reduce((s, l) => s + Number(l.order_value ?? 0), 0)
      const visits = (activitiesRes.data ?? []).filter((a) => a.activity_type === 'site_visit').length
      const won = computeOrderValueActuals(wonRes.data ?? [], range, false)

      setKpis({
        openLeads: openLeads.length,
        pipeline,
        visits,
        won,
      })
      setClosing((forecastRes.data ?? []).slice(0, 4))
    })

    return () => {
      active = false
    }
  }, [period])

  return (
    <div className="vip-wide">
      <div className="vip-home-head">
        {firstName && (
          <div className="vip-greeting">
            {greeting}, {firstName}
          </div>
        )}
        <div className="vip-home-head-actions">
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
          {employee && (
            <Link to="/profile" className="vip-avatar vip-only-mobile" aria-label="Profile">
              {getInitials(employee.name)}
            </Link>
          )}
        </div>
      </div>

      {kpis && (
        <div className="vip-kpi-grid">
          <div className="vip-kpi">
            <div className="vip-kpi-label">Open leads</div>
            <div className="vip-kpi-value">{kpis.openLeads}</div>
          </div>
          <div className="vip-kpi">
            <div className="vip-kpi-label">Pipeline</div>
            <div className="vip-kpi-value">{formatCurrencyCompact(kpis.pipeline)}</div>
          </div>
          <div className="vip-kpi">
            <div className="vip-kpi-label">Visits {PERIOD_LABEL_SUFFIX[period]}</div>
            <div className="vip-kpi-value">{kpis.visits}</div>
          </div>
          <div className="vip-kpi">
            <div className="vip-kpi-label">Won {PERIOD_LABEL_SUFFIX[period]}</div>
            <div className="vip-kpi-value">{formatCurrencyCompact(kpis.won)}</div>
          </div>
        </div>
      )}

      {tiles.length === 0 ? (
        <p className="vip-empty">No shortcuts set up for your role yet.</p>
      ) : (
        <div className="vip-tile-grid">
          {tiles.map((tile, i) => (
            <Link key={tile.to} to={tile.to} className={i === 0 ? 'vip-tile vip-tile-primary' : 'vip-tile'}>
              <div>
                <div className="vip-tile-label">{tile.label}</div>
                <div className="vip-tile-desc">{tile.desc}</div>
              </div>
              <div className="vip-tile-chevron">›</div>
            </Link>
          ))}
        </div>
      )}

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
        <FollowUpList followUps={followUps} onMarkDone={handleMarkDone} emptyLabel="Nothing due today." />
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
    </div>
  )
}

export default Home
