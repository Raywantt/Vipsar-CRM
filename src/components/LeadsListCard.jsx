import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeadsList } from '../lib/dashboardQueries'
import { SOURCE_TYPE_LABELS } from '../lib/sourceTypeOptions'
import { formatCurrency } from '../lib/format'
import '../pages/Dashboard.css'

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function LeadsListCard({ isOwner, employees }) {
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    fetchLeadsList(employeeFilter || null).then(({ data, error }) => {
      if (!active) return
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setError(null)
        setLeads(data ?? [])
      }
    })

    return () => {
      active = false
    }
  }, [employeeFilter])

  return (
    <section className="dashboard-card">
      <h2>{isOwner ? 'All leads' : 'My leads'}</h2>

      {isOwner && (
        <label className="dashboard-field">
          Sales exec
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">— All employees —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="dashboard-error">{error}</p>}

      {loading ? (
        <p className="dashboard-empty">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="dashboard-empty">No leads found.</p>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Site</th>
                <th>Owner</th>
                <th>Source</th>
                <th>Stage</th>
                <th>Order value</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link to={`/leads/${lead.id}`}>{lead.parties?.name ?? '(no party)'}</Link>
                  </td>
                  <td>{lead.sites?.nickname || lead.sites?.locality || '—'}</td>
                  <td>{lead.employees?.name ?? 'Unassigned'}</td>
                  <td>{SOURCE_TYPE_LABELS[lead.source_type] ?? lead.source_type}</td>
                  <td>{lead.current_stage ?? 'new'}</td>
                  <td>{lead.order_value ? formatCurrency(lead.order_value) : '—'}</td>
                  <td>{formatDate(lead.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default LeadsListCard
