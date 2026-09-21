import { LOSS_REASON_OPTIONS, lossReasonLabel } from '../lib/lossReasonOptions'

// loss_reasons SELECT is owner-only (RLS) — this card only ever gets
// rendered for the owner (see Dashboard.jsx's isOwner gate), so there's no
// "sales exec sees their own" case to handle here.
//
// Named competitors live in the Details popup only (owner's choice,
// 2026-09-21), under "Lost to competitor" (buildLossPanel). They used to be a
// chip list here, but the competitor field is free text and reps type whole
// sentences into it (up to ~100 characters), which ran off the card and let
// the page slide sideways on a phone.
function LossReasonsCard({ lossReasons, onOpenPanel }) {
  const reasonCounts = new Map(LOSS_REASON_OPTIONS.map((r) => [r, 0]))

  lossReasons.forEach((row) => {
    const reason = row.reason && reasonCounts.has(row.reason) ? row.reason : 'other'
    reasonCounts.set(reason, reasonCounts.get(reason) + 1)
  })

  const maxCount = Math.max(1, ...reasonCounts.values())

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h3 className="vip-card-title">Why we lose</h3>
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
        [...reasonCounts.entries()].map(([reason, count]) => (
          <div key={reason} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: 'var(--vip-body)' }}>{lossReasonLabel(reason)}</div>
              <div className="vip-bar-value" style={{ flex: '0 0 auto' }}>
                {count}
              </div>
            </div>
            <div className="vip-bar-track">
              <div className="vip-bar-fill vip-loss" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export default LossReasonsCard
