import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchLeadsList } from '../lib/dashboardQueries'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'

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
    <div className="vip-card">
      <div className="vip-card-title">{isOwner ? 'All leads' : 'My leads'}</div>

      {isOwner &&
        (employees.length <= 4 ? (
          <div className="vip-seg vip-seg-outline">
            <button
              type="button"
              className={employeeFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
              onClick={() => setEmployeeFilter('')}
            >
              All
            </button>
            {employees.map((e) => (
              <button
                key={e.id}
                type="button"
                className={employeeFilter === String(e.id) ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => setEmployeeFilter(String(e.id))}
              >
                {e.name.split(' ')[0]}
              </button>
            ))}
          </div>
        ) : (
          <select className="vip-select" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">— All employees —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        ))}

      {error && <p className="vip-error">{error}</p>}

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : leads.length === 0 ? (
        <p className="vip-empty">No leads found.</p>
      ) : (
        leads.map((lead) => (
          <Link key={lead.id} to={`/leads/${lead.id}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
            <div className="vip-row-main">
              <div className="vip-row-title">{lead.parties?.name ?? '(no party)'}</div>
              <div className="vip-row-sub">
                {[lead.sites?.nickname || lead.sites?.locality, lead.employees?.name].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="vip-row-side" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={stageChipClass(lead.current_stage ?? 'new')}>{lead.current_stage ?? 'new'}</span>
              <div className="vip-row-meta vip-num">{formatCurrencyCompact(lead.order_value)}</div>
            </div>
          </Link>
        ))
      )}
    </div>
  )
}

export default LeadsListCard
