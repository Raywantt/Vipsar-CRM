import { formatCurrencyCompact } from '../lib/format'
import { stageChipClass } from '../lib/statusColors'
import { stageLabel } from '../lib/leadStageOptions'
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
//
// aggregated (optional): pre-grouped [{ category, count, value }] rows from
// a server-side RPC (see Dashboard.jsx's fastCategoryBreakdown and
// Schema/migration_leads_category_breakdown_rpc.sql) — when present, this
// is used INSTEAD of reducing `leads` client-side, and the empty-state/
// total are derived from it too rather than from `leads.length`, so this
// card can render before the (slower) full `leads` fetch even finishes.
// `leads`/`getCategory` are still required as the fallback path — every
// caller keeps passing them so the card degrades to the exact old
// behaviour whenever `aggregated` is undefined (migration not run yet, or
// a role fastCategoryBreakdown deliberately withholds it from — see that
// variable's own comment in Dashboard.jsx).
function LeadsByCategoryCard({ title, leads, getCategory, categoryOrder, colorStages, maxRows, onOpenPanel, aggregated }) {
  const map = new Map()
  if (categoryOrder) {
    categoryOrder.forEach((c) => map.set(c, { count: 0, dealValue: 0 }))
  }

  if (aggregated) {
    aggregated.forEach(({ category, count, value }) => {
      const entry = map.get(category) ?? { count: 0, dealValue: 0 }
      entry.count += count
      entry.dealValue += value
      map.set(category, entry)
    })
  } else {
    leads.forEach((lead) => {
      const cat = getCategory(lead)
      if (!map.has(cat)) map.set(cat, { count: 0, dealValue: 0 })
      const entry = map.get(cat)
      entry.count += 1
      entry.dealValue += dealValueFor(lead)
    })
  }

  const rows = categoryOrder ? [...map.entries()] : [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  const visibleRows = maxRows ? rows.slice(0, maxRows) : rows
  const remaining = rows.length - visibleRows.length
  const totalCount = aggregated ? aggregated.reduce((s, r) => s + r.count, 0) : leads.length
  const totalDealValue = aggregated ? aggregated.reduce((s, r) => s + r.value, 0) : leads.reduce((s, l) => s + dealValueFor(l), 0)
  const isEmpty = aggregated ? totalCount === 0 : leads.length === 0

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

      {isEmpty ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        <>
          {visibleRows.map(([cat, { count, dealValue }]) => (
            <div key={cat} className="vip-row">
              <div className="vip-row-main">
                {colorStages ? <span className={stageChipClass(cat)}>{stageLabel(cat)}</span> : <div className="vip-row-title">{cat}</div>}
              </div>
              <div className="vip-row-side" style={{ display: 'flex', gap: 14 }}>
                <div className="vip-row-value">{count}</div>
                <div className="vip-row-meta vip-num" style={{ width: 48, textAlign: 'right' }}>
                  {formatCurrencyCompact(dealValue)}
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
              <div>{totalCount}</div>
              <div style={{ width: 48, textAlign: 'right' }}>{formatCurrencyCompact(totalDealValue)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default LeadsByCategoryCard
