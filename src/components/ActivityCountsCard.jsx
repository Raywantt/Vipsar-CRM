import { ACTIVITY_TYPES } from '../lib/activityTypes'
import '../pages/Dashboard.css'

function emptyCounts() {
  return Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.value, 0]))
}

function ActivityCountsCard({ activities, showByEmployee }) {
  const totals = emptyCounts()
  activities.forEach((a) => {
    totals[a.activity_type] += 1
  })

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
    <section className="dashboard-card">
      <h2>Activity counts</h2>

      {activities.length === 0 ? (
        <p className="dashboard-empty">No activity logged in this range.</p>
      ) : (
        <>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {ACTIVITY_TYPES.map((t) => (
                  <tr key={t.value}>
                    <td>{t.label}</td>
                    <td>{totals[t.value]}</td>
                  </tr>
                ))}
                <tr className="dashboard-table-total">
                  <td>Total</td>
                  <td>{activities.length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {showByEmployee && (
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {ACTIVITY_TYPES.map((t) => (
                      <th key={t.value}>{t.label}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {byEmployee.map((e) => {
                    const total = Object.values(e.counts).reduce((s, n) => s + n, 0)
                    return (
                      <tr key={e.id}>
                        <td>{e.name}</td>
                        {ACTIVITY_TYPES.map((t) => (
                          <td key={t.value}>{e.counts[t.value]}</td>
                        ))}
                        <td>{total}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default ActivityCountsCard
