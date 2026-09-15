import { TargetRow, targetFor } from './TargetsVsActualsCard'
import { BDM_METRIC_OPTIONS } from '../lib/targetMetrics'

// The business development manager's Targets vs. actuals (BDM.md Step 5):
// their three metrics, each always shown — "no target set" rather than a
// missing row, same as an exec's own card. Only mounted for Week/Month/
// Quarter, like the shared card: targets are period-keyed.
//
// No "+ Set a target" here. The owner sets a BDM's targets, and only from
// Architect Network (owner's ruling at Step 5 — built in Step 6).
//
// `targets` is already this BDM's rows for the period on screen; `actuals`
// is computeBdmTargetActuals(...) (src/lib/bdmDashboard.js).
function BdmTargetsCard({ targets, actuals, rangeLabel, loading }) {
  const noneSet = !loading && BDM_METRIC_OPTIONS.every((m) => targetFor(targets, null, m.value) == null)

  return (
    <div className="vip-card">
      <h2 className="vip-card-title">Targets vs. actuals · {rangeLabel}</h2>
      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : (
        <div className="vip-stack-s">
          {BDM_METRIC_OPTIONS.map((m) => (
            <TargetRow
              key={m.value}
              row={{ label: m.label, actual: actuals[m.value] ?? 0, target: targetFor(targets, null, m.value), metric: m.value }}
            />
          ))}
        </div>
      )}
      {noneSet && <p className="vip-form-note">No targets set for {rangeLabel} yet — the owner sets them.</p>}
    </div>
  )
}

export default BdmTargetsCard
