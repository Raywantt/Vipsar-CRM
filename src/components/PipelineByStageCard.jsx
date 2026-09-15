import { stageChipClass } from '../lib/statusColors'
import { stageLabel } from '../lib/leadStageOptions'
import { formatCurrencyCompact } from '../lib/format'

// "Pipeline by stage" — count + value per stage as a plain bar-row list, every
// stage shown even at zero. Moved out of Dashboard.jsx so the business
// development manager's Dashboard renders the identical card rather than a
// copy. `rows` is [{ stage, count, value }] (stageRowsFromLeads, or the
// Dashboard's category RPC); `onOpenPanel` opens the pipeline drill-down.
function PipelineByStageCard({ rows, onOpenPanel }) {
  const maxCount = Math.max(1, ...rows.map((r) => r.count))

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h3 className="vip-card-title">Pipeline by stage</h3>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>
      {rows.every((r) => r.count === 0) ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        rows.map(({ stage, count, value }) => (
          <div key={stage} className="vip-bar-row">
            <div style={{ flex: '0 0 92px' }}>
              <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>
            </div>
            <div className="vip-bar-count" style={{ flex: '0 0 20px' }}>
              {count}
            </div>
            <div className="vip-bar-track vip-thick">
              <div className="vip-bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
            <div className="vip-bar-value">{formatCurrencyCompact(value)}</div>
          </div>
        ))
      )}
    </div>
  )
}

export default PipelineByStageCard
