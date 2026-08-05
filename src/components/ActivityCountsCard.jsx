import { ACTIVITY_TYPES } from '../lib/activityTypes'

function emptyCounts() {
  return Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, 0]))
}

// This card used to also render a "by exec" matrix (one column per
// employee, no cap) — dropped so the card stays a fixed height regardless
// of employee count. Per-exec activity counts are still real and visible
// on the Targets heatmap (one row per exec, a column per activity type);
// the Details link here opens the `attain` drill-down instead, which
// breaks the same totals down by activity type rather than by exec.
function ActivityCountsCard({ activities, rangeLabel, onOpenPanel }) {
  const totals = emptyCounts()
  activities.forEach((a) => {
    totals[a.activity_type] += 1
  })
  const maxCount = Math.max(1, ...Object.values(totals))

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Activity · {rangeLabel}</div>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>

      {activities.length === 0 ? (
        <p className="vip-empty">No activity logged in this range.</p>
      ) : (
        ACTIVITY_TYPES.map((t) => (
          <div key={t.value} className="vip-bar-row">
            <div className="vip-bar-label">{t.label}</div>
            <div className="vip-bar-track">
              <div className="vip-bar-fill" style={{ width: `${(totals[t.value] / maxCount) * 100}%` }} />
            </div>
            <div className="vip-bar-count">{totals[t.value]}</div>
          </div>
        ))
      )}
    </div>
  )
}

export default ActivityCountsCard
