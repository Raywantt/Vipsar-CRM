import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { HOME_TILES } from '../lib/homeTiles'
import { rangeForPreset } from '../lib/dateRanges'
import { fetchActivityCounts, fetchLeadsForBreakdown, fetchClosureForecast } from '../lib/dashboardQueries'
import { fetchWonStageHistory } from '../lib/targetQueries'
import { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import { formatCurrencyCompact, formatCurrency } from '../lib/format'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 21) return 'Good evening'
  return 'Hello'
}

function Home() {
  const { employee } = useAuth()
  const tiles = HOME_TILES[employee?.role] ?? []
  const firstName = employee?.name?.trim().split(/\s+/)[0] ?? ''
  const greeting = greetingForHour(new Date().getHours())

  const [kpis, setKpis] = useState(null)
  const [closing, setClosing] = useState([])

  useEffect(() => {
    let active = true
    const weekRange = rangeForPreset('week')
    const monthRange = rangeForPreset('month')

    Promise.all([
      fetchLeadsForBreakdown(),
      fetchActivityCounts(weekRange),
      fetchWonStageHistory(),
      fetchClosureForecast(),
    ]).then(([breakdownRes, activitiesRes, wonRes, forecastRes]) => {
      if (!active) return

      const openLeads = (breakdownRes.data ?? []).filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
      const pipeline = openLeads.reduce((s, l) => s + Number(l.order_value ?? 0), 0)
      const visitsThisWeek = (activitiesRes.data ?? []).filter((a) => a.activity_type === 'site_visit').length
      const wonThisMonth = computeOrderValueActuals(wonRes.data ?? [], monthRange, false)

      setKpis({
        openLeads: openLeads.length,
        pipeline,
        visitsThisWeek,
        wonThisMonth,
      })
      setClosing((forecastRes.data ?? []).slice(0, 4))
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="vip-wide">
      {firstName && (
        <div className="vip-greeting">
          {greeting}, {firstName}
        </div>
      )}

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
            <div className="vip-kpi-label">Visits this week</div>
            <div className="vip-kpi-value">{kpis.visitsThisWeek}</div>
          </div>
          <div className="vip-kpi">
            <div className="vip-kpi-label">Won this month</div>
            <div className="vip-kpi-value">{formatCurrencyCompact(kpis.wonThisMonth)}</div>
          </div>
        </div>
      )}

      {tiles.length === 0 ? (
        <p className="vip-empty">No shortcuts set up for your role yet.</p>
      ) : (
        <div className="vip-tile-grid">
          {tiles.map((tile) => (
            <Link key={tile.to} to={tile.to} className="vip-tile">
              <div>
                <div className="vip-tile-label">{tile.label}</div>
                <div className="vip-tile-desc">{tile.desc}</div>
              </div>
              <div className="vip-tile-chevron">›</div>
            </Link>
          ))}
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
