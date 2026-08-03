import { formatCurrency } from '../lib/format'
import { stageChipClass } from '../lib/statusColors'

// colorStages (optional): render the category label as a colored chip using
// src/lib/statusColors.js — only meaningful for the Stage instance of this
// card (Area/Site stage/Product have no stage-color mapping). categoryHeading
// is unused now that vip-card-title (the `title` prop) is the only heading
// row-based cards show — kept as a prop so call sites don't need editing.
function LeadsByCategoryCard({ title, leads, getCategory, categoryOrder, colorStages }) {
  const map = new Map()
  if (categoryOrder) {
    categoryOrder.forEach((c) => map.set(c, { count: 0, orderValue: 0 }))
  }
  leads.forEach((lead) => {
    const cat = getCategory(lead)
    if (!map.has(cat)) map.set(cat, { count: 0, orderValue: 0 })
    const entry = map.get(cat)
    entry.count += 1
    entry.orderValue += Number(lead.order_value ?? 0)
  })

  const rows = categoryOrder ? [...map.entries()] : [...map.entries()].sort((a, b) => b[1].count - a[1].count)
  const totalOrderValue = leads.reduce((s, l) => s + Number(l.order_value ?? 0), 0)

  return (
    <div className="vip-card">
      <div className="vip-card-title">{title}</div>

      {leads.length === 0 ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        <>
          {rows.map(([cat, { count, orderValue }]) => (
            <div key={cat} className="vip-row">
              <div className="vip-row-main">
                {colorStages ? <span className={stageChipClass(cat)}>{cat}</span> : <div className="vip-row-title">{cat}</div>}
              </div>
              <div className="vip-row-side" style={{ display: 'flex', gap: 14 }}>
                <div className="vip-row-value">{count}</div>
                <div className="vip-row-meta vip-num" style={{ width: 48, textAlign: 'right' }}>
                  {formatCurrency(orderValue)}
                </div>
              </div>
            </div>
          ))}
          <div className="vip-total">
            <div>Total</div>
            <div style={{ display: 'flex', gap: 14 }}>
              <div>{leads.length}</div>
              <div style={{ width: 48, textAlign: 'right' }}>{formatCurrency(totalOrderValue)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default LeadsByCategoryCard
