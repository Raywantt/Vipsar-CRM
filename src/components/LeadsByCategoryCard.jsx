import { formatCurrency } from '../lib/format'
import { stageChipClass } from '../lib/statusColors'
import { dealValueFor } from '../lib/pipelineValue'

// colorStages (optional): render the category label as a colored chip using
// src/lib/statusColors.js — only meaningful for the Stage instance of this
// card (Area/Site stage/Product have no stage-color mapping). categoryHeading
// is unused now that vip-card-title (the `title` prop) is the only heading
// row-based cards show — kept as a prop so call sites don't need editing.
// maxRows (optional): only meaningful for the data-driven instances (Area,
// Product) whose category count isn't bounded by a fixed list the way
// Stage/Site stage's `categoryOrder` already is — those two stay
// uncapped since trimming a short, fixed, meaningful order (e.g. dropping
// "lost" off the end of Stage) would hide the wrong thing. onOpenPanel
// (optional) opens the matching `mix`/`pipeline` drill-down for the rows
// this card doesn't show.
function LeadsByCategoryCard({ title, leads, getCategory, categoryOrder, colorStages, maxRows, onOpenPanel }) {
  const map = new Map()
  if (categoryOrder) {
    categoryOrder.forEach((c) => map.set(c, { count: 0, dealValue: 0 }))
  }
  leads.forEach((lead) => {
    const cat = getCategory(lead)
    if (!map.has(cat)) map.set(cat, { count: 0, dealValue: 0 })
    const entry = map.get(cat)
    entry.count += 1
    entry.dealValue += dealValueFor(lead)
  })

  const rows = categoryOrder ? [...map.entries()] : [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  const visibleRows = maxRows ? rows.slice(0, maxRows) : rows
  const remaining = rows.length - visibleRows.length
  const totalDealValue = leads.reduce((s, l) => s + dealValueFor(l), 0)

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">{title}</div>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>

      {leads.length === 0 ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        <>
          {visibleRows.map(([cat, { count, dealValue }]) => (
            <div key={cat} className="vip-row">
              <div className="vip-row-main">
                {colorStages ? <span className={stageChipClass(cat)}>{cat}</span> : <div className="vip-row-title">{cat}</div>}
              </div>
              <div className="vip-row-side" style={{ display: 'flex', gap: 14 }}>
                <div className="vip-row-value">{count}</div>
                <div className="vip-row-meta vip-num" style={{ width: 48, textAlign: 'right' }}>
                  {formatCurrency(dealValue)}
                </div>
              </div>
            </div>
          ))}
          {remaining > 0 && (
            <button type="button" className="vip-dd-more-row" onClick={onOpenPanel}>
              +{remaining} more · View all
            </button>
          )}
          <div className="vip-total">
            <div>Total</div>
            <div style={{ display: 'flex', gap: 14 }}>
              <div>{leads.length}</div>
              <div style={{ width: 48, textAlign: 'right' }}>{formatCurrency(totalDealValue)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default LeadsByCategoryCard
