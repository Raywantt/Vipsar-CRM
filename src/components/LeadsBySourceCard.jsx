import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import DonutChart from './DonutChart'

function emptyCounts(sourceOptions) {
  return Object.fromEntries(sourceOptions.map((t) => [t.value, 0]))
}

// A sales exec only sources leads via Scanning/Showroom Walk-in themselves —
// Lixil and referrals are distributed by the owner, so showing all 5 rows
// to a rep is mostly zeros. Owner still sees every source. Exported so
// src/pages/Dashboard.jsx's `mix` drill-down builder uses the exact same
// subset instead of a second copy that could drift from it.
export const SALES_EXEC_SOURCES = ['scanning', 'showroom_walkin']

const DONUT_PALETTE = ['#0f6b6b', '#2f5878', '#5a4287', '#7a6413', '#9aa5a6']

// onOpenPanel (optional) opens the `mix` drill-down (src/lib/drilldownBuilders.js).
// This card used to also render a "by exec" matrix (one column per
// employee, no cap) — dropped so the card stays a fixed height regardless
// of employee count; per-exec source detail isn't surfaced elsewhere yet.
function LeadsBySourceCard({ leads, showByEmployee, onOpenPanel }) {
  const sourceOptions = showByEmployee
    ? SOURCE_TYPE_OPTIONS
    : SOURCE_TYPE_OPTIONS.filter((t) => SALES_EXEC_SOURCES.includes(t.value))

  const totals = emptyCounts(sourceOptions)
  const visibleLeads = leads.filter((l) => l.source_type in totals)
  visibleLeads.forEach((l) => {
    totals[l.source_type] += 1
  })
  const maxCount = Math.max(1, ...Object.values(totals))

  const donutSegments = sourceOptions.map((t, i) => ({ count: totals[t.value], color: DONUT_PALETTE[i % DONUT_PALETTE.length] }))

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">New leads by source</div>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>

      {visibleLeads.length === 0 ? (
        <p className="vip-empty">No new leads in this range.</p>
      ) : (
        <>
          <div className="vip-only-desktop">
            <div className="vip-dd-mix-row">
              <DonutChart segments={donutSegments} size={104} centerValue={visibleLeads.length} centerLabel="NEW" />
              <div className="vip-dd-mix-legend">
                {sourceOptions.map((t, i) => (
                  <div key={t.value} className="vip-dd-mix-legend-row">
                    <span className="vip-dd-legend-swatch" style={{ background: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
                    <span className="vip-dd-mix-legend-label">{t.label}</span>
                    <span className="vip-dd-mix-legend-count">{totals[t.value]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="vip-only-mobile">
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
          </div>
        </>
      )}
    </div>
  )
}

export default LeadsBySourceCard
