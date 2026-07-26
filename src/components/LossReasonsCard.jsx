import { LOSS_REASON_OPTIONS } from '../lib/lossReasonOptions'
import '../pages/Dashboard.css'

// loss_reasons SELECT is owner-only (RLS) — this card only ever gets
// rendered for the owner (see Dashboard.jsx's isOwner gate), so there's no
// "sales exec sees their own" case to handle here.
function LossReasonsCard({ lossReasons }) {
  const reasonCounts = new Map(LOSS_REASON_OPTIONS.map((r) => [r, 0]))
  const competitorCounts = new Map()

  lossReasons.forEach((row) => {
    const reason = row.reason && reasonCounts.has(row.reason) ? row.reason : 'other'
    reasonCounts.set(reason, reasonCounts.get(reason) + 1)

    if (row.competitor_name) {
      const name = row.competitor_name.trim()
      competitorCounts.set(name, (competitorCounts.get(name) ?? 0) + 1)
    }
  })

  const competitorRows = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <section className="dashboard-card">
      <h2>Why we lose</h2>

      {lossReasons.length === 0 ? (
        <p className="dashboard-empty">No lost leads recorded yet.</p>
      ) : (
        <>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {[...reasonCounts.entries()].map(([reason, count]) => (
                  <tr key={reason}>
                    <td>{reason}</td>
                    <td>{count}</td>
                  </tr>
                ))}
                <tr className="dashboard-table-total">
                  <td>Total</td>
                  <td>{lossReasons.length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {competitorRows.length > 0 && (
            <div>
              <p className="dashboard-subhead">Named competitors</p>
              <ul className="dashboard-competitor-list">
                {competitorRows.map(([name, count]) => (
                  <li key={name}>
                    {name} — {count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default LossReasonsCard
