import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/format'
import '../pages/Dashboard.css'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ClosureForecastCard({ leads }) {
  return (
    <section className="dashboard-card">
      <h2>Closure forecast</h2>

      {leads.length === 0 ? (
        <p className="dashboard-empty">No leads currently in the closure pipeline.</p>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Owner</th>
                <th>Quote value</th>
                <th>Probability</th>
                <th>Est. close date</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link to={`/leads/${lead.id}`}>{lead.parties?.name ?? '(no party)'}</Link>
                  </td>
                  <td>{lead.employees?.name ?? '—'}</td>
                  <td>{formatCurrency(lead.quote_value)}</td>
                  <td>{lead.closure_probability != null ? `${lead.closure_probability}%` : '—'}</td>
                  <td>{formatDate(lead.estimated_close_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ClosureForecastCard
