import { ACTIVITY_TYPES } from '../lib/activityTypes'

function emptyCounts() {
  return Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, 0]))
}

function ActivityCountsCard({ activities, showByEmployee, rangeLabel }) {
  const totals = emptyCounts()
  activities.forEach((a) => {
    totals[a.activity_type] += 1
  })
  const maxCount = Math.max(1, ...Object.values(totals))

  let byEmployee = []
  if (showByEmployee) {
    const map = new Map()
    activities.forEach((a) => {
      const key = a.employee_id ?? 'unassigned'
      if (!map.has(key)) {
        map.set(key, { id: key, name: a.employees?.name ?? 'Unassigned', counts: emptyCounts() })
      }
      map.get(key).counts[a.activity_type] += 1
    })
    byEmployee = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  return (
    <div className="vip-card">
      <div className="vip-card-title">Activity · {rangeLabel}</div>

      {activities.length === 0 ? (
        <p className="vip-empty">No activity logged in this range.</p>
      ) : (
        <>
          {ACTIVITY_TYPES.map((t) => (
            <div key={t.value} className="vip-bar-row">
              <div className="vip-bar-label">{t.label}</div>
              <div className="vip-bar-track">
                <div className="vip-bar-fill" style={{ width: `${(totals[t.value] / maxCount) * 100}%` }} />
              </div>
              <div className="vip-bar-count">{totals[t.value]}</div>
            </div>
          ))}

          {showByEmployee && byEmployee.length > 0 && (
            <>
              <div className="vip-card-title">Activity by exec</div>
              <div className="vip-matrix-head">
                <div style={{ flex: 1 }}>Type</div>
                {byEmployee.map((e) => (
                  <div key={e.id} className="vip-matrix-cell">
                    {e.name}
                  </div>
                ))}
              </div>
              {ACTIVITY_TYPES.map((t) => (
                <div key={t.value} className="vip-matrix-row">
                  <div className="vip-matrix-label">{t.label}</div>
                  {byEmployee.map((e) => (
                    <div key={e.id} className="vip-matrix-cell">
                      {e.counts[t.value]}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default ActivityCountsCard
