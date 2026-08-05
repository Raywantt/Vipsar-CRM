import { LOSS_REASON_OPTIONS } from '../lib/lossReasonOptions'

// loss_reasons SELECT is owner-only (RLS) — this card only ever gets
// rendered for the owner (see Dashboard.jsx's isOwner gate), so there's no
// "sales exec sees their own" case to handle here.
function LossReasonsCard({ lossReasons, onOpenPanel }) {
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

  const maxCount = Math.max(1, ...reasonCounts.values())
  const competitorRows = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Why we lose</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onOpenPanel && (
            <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
              Details ›
            </button>
          )}
          <div className="vip-card-note">Owner only</div>
        </div>
      </div>

      {lossReasons.length === 0 ? (
        <p className="vip-empty">No lost leads recorded yet.</p>
      ) : (
        <>
          {[...reasonCounts.entries()].map(([reason, count]) => (
            <div key={reason} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 12, color: 'var(--vip-body)' }}>{reason}</div>
                <div className="vip-bar-value" style={{ flex: '0 0 auto' }}>
                  {count}
                </div>
              </div>
              <div className="vip-bar-track">
                <div className="vip-bar-fill vip-loss" style={{ width: `${(count / maxCount) * 100}%` }} />
              </div>
            </div>
          ))}

          {competitorRows.length > 0 && (
            <div>
              <div className="vip-fact-label">Named competitors</div>
              <div className="vip-chip-wrap" style={{ marginTop: 7 }}>
                {competitorRows.map(([name, count]) => (
                  <span key={name} className="vip-chip vip-chip-new">
                    {name} — {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default LossReasonsCard
