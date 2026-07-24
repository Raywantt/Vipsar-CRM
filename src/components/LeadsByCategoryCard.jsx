import { formatCurrency } from '../lib/format'
import '../pages/Dashboard.css'

// Generic count + order_value breakdown, grouped however the caller's
// getCategory resolves a lead to a bucket label. Shared by the Stage/Area/
// Site Stage tabs — same shape, different grouping.
//
// categoryOrder (optional): a fixed list of buckets to always show, even at
// zero, in that order — used for Stage/Site Stage's suggested-list options
// so "no leads at this stage" is visible rather than the row just not
// existing. Omit it (Area) to discover buckets from the data instead,
// sorted by count desc.
function LeadsByCategoryCard({ title, categoryHeading, leads, getCategory, categoryOrder }) {
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
    <section className="dashboard-card">
      <h2>{title}</h2>

      {leads.length === 0 ? (
        <p className="dashboard-empty">No leads found.</p>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>{categoryHeading}</th>
                <th>Leads</th>
                <th>Order value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([cat, { count, orderValue }]) => (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td>{count}</td>
                  <td>{formatCurrency(orderValue)}</td>
                </tr>
              ))}
              <tr className="dashboard-table-total">
                <td>Total</td>
                <td>{leads.length}</td>
                <td>{formatCurrency(totalOrderValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default LeadsByCategoryCard
