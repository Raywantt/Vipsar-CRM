import { formatCurrencyCompact } from '../lib/format'
import { wonEventsInRange } from '../lib/drilldownBuilders'
import { startOfWeek } from '../lib/dateRanges'

// Buckets real events into 8 calendar weeks (Monday–Sunday, same boundary
// dateRanges.js's own startOfWeek uses for the 'week' preset), oldest
// first — used only for the sparkline bars below; a KPI tile whose data has
// no stored history (Weighted forecast is a point-in-time snapshot, nothing
// is kept over time) simply renders without one rather than fabricate a
// trend that isn't backed by anything. The
// current (last) bucket runs Monday through *now*, not through Sunday —
// deliberately matching the still-in-progress 'week' preset range exactly,
// so this bucket's total is always the same figure the tile prints above it
// when Week is selected. Older buckets are complete Monday–Sunday weeks.
// The trend itself stays 8 weeks regardless of preset (Month/Quarter/Custom
// print a longer-period total above a recent weekly cadence, a deliberate,
// documented choice — see CLAUDE.md's Dashboard section) — only the
// boundary of each week was wrong before, not the window's overall length.
function weeklyBuckets(events, getDate, getValue = () => 1, weeks = 8) {
  const now = new Date()
  const thisWeekStart = startOfWeek(now)
  const buckets = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart)
    start.setDate(start.getDate() - i * 7)
    let end
    if (i === 0) {
      end = now
    } else {
      end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59, 999)
    }
    buckets.push({ start, end, total: 0 })
  }
  events.forEach((e) => {
    const d = new Date(getDate(e))
    const bucket = buckets.find((b) => d >= b.start && d <= b.end)
    if (bucket) bucket.total += getValue(e)
  })
  return buckets.map((b) => b.total)
}

// A week with zero decided leads has no rate at all, not a 0% rate — pushing
// 0 there would draw a real (if misleading) data point for a week nothing
// was actually decided in, indistinguishable from a week that really did see
// decisions and none of them won. null marks "no data" so Sparkline can gap
// it instead of plotting it.
function weeklyWinRate(decidedStageHistory, weeks = 8) {
  const now = new Date()
  const thisWeekStart = startOfWeek(now)
  const rates = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart)
    start.setDate(start.getDate() - i * 7)
    let end
    if (i === 0) {
      end = now
    } else {
      end = new Date(start)
      end.setDate(end.getDate() + 6)
      end.setHours(23, 59, 59, 999)
    }
    const rows = decidedStageHistory.filter((r) => r.leads && new Date(r.changed_at) >= start && new Date(r.changed_at) <= end)
    if (!rows.length) {
      rates.push(null)
      continue
    }
    const won = rows.filter((r) => r.stage === 'won').length
    rates.push(Math.round((won / rows.length) * 100))
  }
  return rates
}

// The current week's bucket runs Monday through "now", which isn't over yet
// — comparing its running total against a *complete* prior week biases the
// delta down by however much of the week hasn't happened, worst right after
// a period starts. Compare like-for-like instead: cut the prior week off at
// the same real-time offset ("this time last week"), not at its own
// end-of-day, so both sides reflect the same amount of elapsed time. Also
// keeps curStart Monday-aligned (startOfWeek), matching weeklyBuckets'
// current bucket exactly, rather than a fixed trailing-6-days window.
function likeForLikeWindows() {
  const now = new Date()
  const curStart = startOfWeek(now)
  const prevStart = new Date(curStart)
  prevStart.setDate(prevStart.getDate() - 7)
  const prevEnd = new Date(prevStart.getTime() + (now.getTime() - curStart.getTime()))
  return { now, curStart, prevStart, prevEnd }
}

function weekOverWeek(events, getDate, getValue = () => 1, { points = false } = {}) {
  const { now, curStart, prevStart, prevEnd } = likeForLikeWindows()
  let cur = 0
  let prev = 0
  events.forEach((e) => {
    const d = new Date(getDate(e))
    if (d >= curStart && d <= now) cur += getValue(e)
    else if (d >= prevStart && d <= prevEnd) prev += getValue(e)
  })
  if (points) {
    const diff = Math.round(cur - prev)
    if (diff === 0) return { label: '±0 pts', up: null }
    return { label: `${diff > 0 ? '+' : ''}${diff} pts`, up: diff > 0 }
  }
  if (!prev) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { label: '±0%', up: null }
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, up: pct > 0 }
}

// Win rate isn't summable like a count/value — needs its own cur/prev rate
// computed over the same like-for-like windows rather than a raw total.
function weekOverWeekWinRate(decidedStageHistory) {
  const { now, curStart, prevStart, prevEnd } = likeForLikeWindows()
  const rateFor = (start, end) => {
    const rows = decidedStageHistory.filter((r) => r.leads && new Date(r.changed_at) >= start && new Date(r.changed_at) <= end)
    if (!rows.length) return null
    const won = rows.filter((r) => r.stage === 'won').length
    return Math.round((won / rows.length) * 100)
  }
  const cur = rateFor(curStart, now)
  const prev = rateFor(prevStart, prevEnd)
  if (cur == null || prev == null) return null
  const diff = cur - prev
  if (diff === 0) return { label: '±0 pts', up: null }
  return { label: `${diff > 0 ? '+' : ''}${diff} pts`, up: diff > 0 }
}

// `series` entries may be null (no data for that week, e.g. win rate with
// zero decisions) — those render as a flat gap mark, not a bar, and are
// excluded from the max/trend math so an absent week can't drag either down.
// No minimum bar height either: a real 0 (0% win rate on real decisions, or
// a genuinely activity-free week) should read as flat, not as a fabricated
// ~12%-tall bar implying something happened.
function Sparkline({ series }) {
  if (!series) return null
  const values = series.filter((v) => v != null)
  if (!values.length) return null
  const max = Math.max(1, ...values)
  const firstIdx = series.findIndex((v) => v != null)
  const lastIdx = series.length - 1 - [...series].reverse().findIndex((v) => v != null)
  const up = series[lastIdx] >= series[firstIdx]
  return (
    <span className="vip-dd-kpi-spark">
      {series.map((v, i) =>
        v == null ? (
          <span key={i} className="vip-dd-kpi-spark-bar vip-dd-kpi-spark-gap" />
        ) : (
          <span
            key={i}
            className={up ? 'vip-dd-kpi-spark-bar vip-dd-kpi-spark-up' : 'vip-dd-kpi-spark-bar vip-dd-kpi-spark-down'}
            style={{ height: `${Math.round((v / max) * 100)}%` }}
          />
        )
      )}
    </span>
  )
}

// The 4-tile KPI band — three tiles have a real weekly trend to show (order
// value, activities, win rate all have per-event timestamps to bucket); the
// fourth (Weighted forecast) is a point-in-time snapshot and renders
// value-only. Every tile opens its own drill-down via `onOpenPanel`.
//
// Open pipeline and Stale leads used to sit here too — both are also
// point-in-time snapshots, exactly like Weighted forecast, which made their
// placement below the date-range selector misleading (the selector implies
// every tile above it is scoped to the chosen period, and these two never
// were). Moved out to `RightNowStrip` (Active/On-Hold Pipeline and Stale
// Leads chips respectively), which exists specifically for metrics that
// don't depend on the selected range — see that component's own header
// comment. Open pipeline in particular would have been a second, redundant
// rendering of the same figure RightNowStrip's Active/On-Hold Pipeline
// chips already cover.
function KpiSparkRow({
  orderValueActual,
  activitiesCount,
  winRatePct,
  weightedForecast,
  wonStageHistory,
  activitiesTrendWindow,
  decidedStageHistory,
  onOpenOrderValue,
  onOpenActivities,
  onOpenWinRate,
  onOpenForecast,
}) {
  const eightWeeksAgo = new Date()
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)
  const wonEvents = wonEventsInRange(wonStageHistory, { start: eightWeeksAgo, end: new Date() })
  const orderSeries = weeklyBuckets(wonEvents, (e) => e.changedAt, (e) => e.value)
  const activitySeries = weeklyBuckets(activitiesTrendWindow, (a) => a.created_at)
  const winRateSeries = weeklyWinRate(decidedStageHistory)

  const tiles = [
    {
      label: 'Order value booked',
      value: formatCurrencyCompact(orderValueActual),
      series: orderSeries,
      delta: weekOverWeek(wonEvents, (e) => e.changedAt, (e) => e.value),
      onOpen: onOpenOrderValue,
    },
    {
      label: 'Activities logged',
      value: String(activitiesCount),
      series: activitySeries,
      delta: weekOverWeek(activitiesTrendWindow, (a) => a.created_at),
      onOpen: onOpenActivities,
    },
    {
      label: 'Win rate',
      value: winRatePct != null ? `${winRatePct}%` : '—',
      series: winRateSeries,
      delta: weekOverWeekWinRate(decidedStageHistory),
      onOpen: onOpenWinRate,
    },
    { label: 'Weighted forecast', value: formatCurrencyCompact(weightedForecast), series: null, delta: null, onOpen: onOpenForecast },
  ]

  return (
    <div className="vip-dd-kpi-grid vip-dd-kpi-grid-4">
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
          {t.sub && <div className="vip-dd-kpi-sub">{t.sub}</div>}
          <Sparkline series={t.series} />
        </button>
      ))}
    </div>
  )
}

export default KpiSparkRow
