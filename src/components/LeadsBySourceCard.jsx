import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'

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
  const maxCount = Math.max(1, ...Object.values(totals))

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
    <div className="vip-card">
      <div className="vip-card-title">New leads by source</div>

      {visibleLeads.length === 0 ? (
        <p className="vip-empty">No new leads in this range.</p>
      ) : (
        <>
          {sourceOptions.map((t) => (
            <div key={t.value} className="vip-bar-row">
              <div className="vip-bar-label">{t.label}</div>
              <div className="vip-bar-track">
                <div
                  className="vip-bar-fill vip-navy"
                  style={{ width: `${(totals[t.value] / maxCount) * 100}%` }}
                />
              </div>
              <div className="vip-bar-count">{totals[t.value]}</div>
            </div>
          ))}
          <div className="vip-total">
            <div>Total</div>
            <div>{visibleLeads.length}</div>
          </div>

          {showByEmployee && byEmployee.length > 0 && (
            <>
              <div className="vip-card-title">By exec</div>
              <div className="vip-matrix-head">
                <div style={{ flex: 1 }}>Source</div>
                {byEmployee.map((e) => (
                  <div key={e.id} className="vip-matrix-cell">
                    {e.name}
                  </div>
                ))}
              </div>
              {sourceOptions.map((t) => (
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

export default LeadsBySourceCard
