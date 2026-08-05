import { formatCurrencyCompact } from '../lib/format'
import { wonEventsInRange } from '../lib/drilldownBuilders'

// Buckets real events into 8 trailing weeks. Returns one total per week,
// oldest first — used only for the sparkline bars below; KPI tiles whose
// data has no stored history (Open pipeline, Stale leads, Weighted forecast
// are point-in-time snapshots, nothing is kept over time) simply render
// without one rather than fabricate a trend that isn't backed by anything.
function weeklyBuckets(events, getDate, getValue = () => 1, weeks = 8) {
  const now = new Date()
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now)
    end.setDate(end.getDate() - i * 7)
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    buckets.push({ start, end, total: 0 })
  }
  events.forEach((e) => {
    const d = new Date(getDate(e))
    const bucket = buckets.find((b) => d >= b.start && d <= b.end)
    if (bucket) bucket.total += getValue(e)
  })
  return buckets.map((b) => b.total)
}

function weeklyWinRate(decidedStageHistory, weeks = 8) {
  const now = new Date()
  const rates = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now)
    end.setDate(end.getDate() - i * 7)
    end.setHours(23, 59, 59, 999)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const rows = decidedStageHistory.filter((r) => r.leads && new Date(r.changed_at) >= start && new Date(r.changed_at) <= end)
    const won = rows.filter((r) => r.stage === 'won').length
    rates.push(rows.length ? Math.round((won / rows.length) * 100) : 0)
  }
  return rates
}

// This week's bucket vs the prior complete week, from the same series the
// sparkline already draws — no extra data, just the last two points read as
// a real week-over-week change instead of a fabricated trend.
function weekOverWeek(series, { points = false } = {}) {
  if (!series || series.length < 2) return null
  const prev = series[series.length - 2]
  const cur = series[series.length - 1]
  if (points) {
    const diff = cur - prev
    if (diff === 0) return { label: '±0 pts', up: null }
    return { label: `${diff > 0 ? '+' : ''}${diff} pts`, up: diff > 0 }
  }
  if (!prev) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { label: '±0%', up: null }
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, up: pct > 0 }
}

function Sparkline({ series }) {
  if (!series) return null
  const max = Math.max(1, ...series)
  const up = series[series.length - 1] >= series[0]
  return (
    <span className="vip-dd-kpi-spark">
      {series.map((v, i) => (
        <span
          key={i}
          className={up ? 'vip-dd-kpi-spark-bar vip-dd-kpi-spark-up' : 'vip-dd-kpi-spark-bar vip-dd-kpi-spark-down'}
          style={{ height: `${Math.max(12, Math.round((v / max) * 100))}%` }}
        />
      ))}
    </span>
  )
}

// The 6-tile KPI band (mockup's top row) — three tiles have a real weekly
// trend to show (order value, activities, win rate all have per-event
// timestamps to bucket); the other three are point-in-time snapshots and
// render value-only. Every tile opens its own drill-down via `onOpenPanel`.
function KpiSparkRow({
  orderValueActual,
  activitiesCount,
  openPipelineValue,
  winRatePct,
  staleCount,
  weightedForecast,
  wonStageHistory,
  activitiesTrendWindow,
  decidedStageHistory,
  onOpenOrderValue,
  onOpenActivities,
  onOpenPipeline,
  onOpenWinRate,
  onOpenStale,
  onOpenForecast,
}) {
  const eightWeeksAgo = new Date()
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)
  const orderSeries = weeklyBuckets(
    wonEventsInRange(wonStageHistory, { start: eightWeeksAgo, end: new Date() }),
    (e) => e.changedAt,
    (e) => e.value
  )
  const activitySeries = weeklyBuckets(activitiesTrendWindow, (a) => a.created_at)
  const winRateSeries = weeklyWinRate(decidedStageHistory)

  const tiles = [
    {
      label: 'Order value booked',
      value: formatCurrencyCompact(orderValueActual),
      series: orderSeries,
      delta: weekOverWeek(orderSeries),
      onOpen: onOpenOrderValue,
    },
    {
      label: 'Activities logged',
      value: String(activitiesCount),
      series: activitySeries,
      delta: weekOverWeek(activitySeries),
      onOpen: onOpenActivities,
    },
    { label: 'Open pipeline', value: formatCurrencyCompact(openPipelineValue), series: null, delta: null, onOpen: onOpenPipeline },
    {
      label: 'Win rate',
      value: winRatePct != null ? `${winRatePct}%` : '—',
      series: winRateSeries,
      delta: weekOverWeek(winRateSeries, { points: true }),
      onOpen: onOpenWinRate,
    },
    { label: 'Stale leads', value: String(staleCount), series: null, delta: null, onOpen: onOpenStale },
    { label: 'Weighted forecast', value: formatCurrencyCompact(weightedForecast), series: null, delta: null, onOpen: onOpenForecast },
  ]

  return (
    <div className="vip-dd-kpi-grid">
      {tiles.map((t) => (
        <button key={t.label} type="button" className="vip-dd-kpi-tile" onClick={t.onOpen}>
          <div className="vip-dd-kpi-label">{t.label}</div>
          <div className="vip-dd-kpi-value-row">
            <span className="vip-dd-kpi-value">{t.value}</span>
            {t.delta && (
              <span
                className={
                  t.delta.up == null ? 'vip-dd-kpi-delta' : t.delta.up ? 'vip-dd-kpi-delta vip-dd-kpi-delta-up' : 'vip-dd-kpi-delta vip-dd-kpi-delta-down'
                }
              >
                {t.delta.label}
              </span>
            )}
          </div>
          <Sparkline series={t.series} />
        </button>
      ))}
    </div>
  )
}

export default KpiSparkRow
