import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import '../pages/Dashboard.css'

function emptyCounts(sourceOptions) {
  return Object.fromEntries(sourceOptions.map((t) => [t.value, 0]))
}

// A sales exec only sources leads via Scanning/Showroom Walk-in themselves —
// Lixil and referrals are distributed by the owner, so showing all 5 rows
// to a rep is mostly zeros. Owner still sees every source.
const SALES_EXEC_SOURCES = ['scanning', 'showroom_walkin']

function LeadsBySourceCard({ leads, showByEmployee }) {
  const sourceOptions = showByEmployee
    ? SOURCE_TYPE_OPTIONS
    : SOURCE_TYPE_OPTIONS.filter((t) => SALES_EXEC_SOURCES.includes(t.value))

  const totals = emptyCounts(sourceOptions)
  const visibleLeads = leads.filter((l) => l.source_type in totals)
  visibleLeads.forEach((l) => {
    totals[l.source_type] += 1
  })

  let byEmployee = []
  if (showByEmployee) {
    const map = new Map()
    leads.forEach((l) => {
      const key = l.owner_employee_id ?? 'unassigned'
      if (!map.has(key)) {
        map.set(key, { id: key, name: l.employees?.name ?? 'Unassigned', counts: emptyCounts(sourceOptions) })
      }
      map.get(key).counts[l.source_type] += 1
    })
    byEmployee = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  return (
    <section className="dashboard-card">
      <h2>New leads by source</h2>

      {visibleLeads.length === 0 ? (
        <p className="dashboard-empty">No new leads in this range.</p>
      ) : (
        <>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {sourceOptions.map((t) => (
                  <tr key={t.value}>
                    <td>{t.label}</td>
                    <td>{totals[t.value]}</td>
                  </tr>
                ))}
                <tr className="dashboard-table-total">
                  <td>Total</td>
                  <td>{visibleLeads.length}</td>
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
                    {sourceOptions.map((t) => (
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
                        {sourceOptions.map((t) => (
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

export default LeadsBySourceCard
