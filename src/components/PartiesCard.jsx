import { useMemo, useState } from 'react'
import '../pages/Dashboard.css'

const PARTY_TYPE_LABELS = {
  client: 'Client',
  architect: 'Architect',
  builder: 'Builder',
  firm: 'Firm',
  other: 'Other',
  pmc: 'PMC',
}

function buildEmployeeMap(links) {
  const map = new Map()
  links.forEach((lead) => {
    const employeeName = lead.employees?.name
    if (!employeeName) return
    ;[lead.party_id, lead.other_party_id, lead.referred_by_party_id].forEach((partyId) => {
      if (!partyId) return
      if (!map.has(partyId)) map.set(partyId, new Set())
      map.get(partyId).add(employeeName)
    })
  })
  return map
}

function PartiesCard({ parties, employeeLinks }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const employeeMap = useMemo(() => buildEmployeeMap(employeeLinks), [employeeLinks])
  const partyTypes = useMemo(() => [...new Set(parties.map((p) => p.party_type))].sort(), [parties])

  const term = search.trim().toLowerCase()
  const filtered = parties.filter((p) => {
    if (typeFilter && p.party_type !== typeFilter) return false
    if (term && !p.name.toLowerCase().includes(term)) return false
    return true
  })

  return (
    <section className="dashboard-card">
      <h2>Parties</h2>

      <div className="dashboard-filter-row">
        <label className="dashboard-field">
          Type
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">— All types —</option>
            {partyTypes.map((t) => (
              <option key={t} value={t}>
                {PARTY_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-field">
          Search by name
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="dashboard-empty">No parties found.</p>
      ) : (
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Mobile</th>
                <th>City</th>
                <th>Firm</th>
                <th>Worked with</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{PARTY_TYPE_LABELS[p.party_type] ?? p.party_type}</td>
                  <td>{p.mobile || '—'}</td>
                  <td>{p.city || '—'}</td>
                  <td>{p.firm_name || '—'}</td>
                  <td>{employeeMap.has(p.id) ? [...employeeMap.get(p.id)].join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default PartiesCard
