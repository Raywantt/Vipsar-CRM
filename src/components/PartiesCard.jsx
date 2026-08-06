import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import EmployeeLink from './EmployeeLink'

const PARTY_TYPE_LABELS = {
  client: 'Client',
  architect: 'Architect',
  builder: 'Builder',
  firm: 'Firm',
  other: 'Other',
  pmc: 'PMC',
}

// The segmented control only has room for a handful of pills before it
// stops reading as a segmented control — these three are the common case;
// anything else discovered in the data (builder/other/pmc/...) goes in the
// overflow select instead of forcing every party_type into the row.
const PRIMARY_TYPES = ['client', 'architect', 'firm']

// Map<partyId, Map<employeeId, employeeName>> — keyed by id (not just a Set
// of names) so the "Worked with" column can link each name to /employees/:id.
function buildEmployeeMap(links) {
  const map = new Map()
  links.forEach((lead) => {
    const employeeId = lead.owner_employee_id
    const employeeName = lead.employees?.name
    if (!employeeId || !employeeName) return
    ;[lead.party_id, lead.other_party_id, lead.referred_by_party_id].forEach((partyId) => {
      if (!partyId) return
      if (!map.has(partyId)) map.set(partyId, new Map())
      map.get(partyId).set(employeeId, employeeName)
    })
  })
  return map
}

function PartiesCard({ parties, employeeLinks, mostRecentLeadByParty }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const employeeMap = useMemo(() => buildEmployeeMap(employeeLinks), [employeeLinks])
  const partyTypes = useMemo(() => [...new Set(parties.map((p) => p.party_type))].sort(), [parties])
  const primaryTypes = PRIMARY_TYPES.filter((t) => partyTypes.includes(t))
  const overflowTypes = partyTypes.filter((t) => !PRIMARY_TYPES.includes(t))

  const term = search.trim().toLowerCase()
  const filtered = parties.filter((p) => {
    if (typeFilter && p.party_type !== typeFilter) return false
    if (term && !p.name.toLowerCase().includes(term)) return false
    return true
  })

  return (
    <div className="vip-card">
      <div className="vip-card-title">Parties</div>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name…"
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="vip-seg vip-seg-outline" style={{ flex: 1 }}>
          <button
            type="button"
            className={typeFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setTypeFilter('')}
          >
            All
          </button>
          {primaryTypes.map((t) => (
            <button
              key={t}
              type="button"
              className={typeFilter === t ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
              onClick={() => setTypeFilter(t)}
            >
              {PARTY_TYPE_LABELS[t] ?? t}
            </button>
          ))}
        </div>
        {overflowTypes.length > 0 && (
          <select
            className="vip-select"
            style={{ flex: '0 0 110px', minHeight: 40 }}
            value={overflowTypes.includes(typeFilter) ? typeFilter : ''}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">More…</option>
            {overflowTypes.map((t) => (
              <option key={t} value={t}>
                {PARTY_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="vip-empty">No parties found.</p>
      ) : (
        filtered.map((p) => {
          const mostRecentLeadId = mostRecentLeadByParty?.get(p.id)
          const employees = employeeMap.has(p.id) ? [...employeeMap.get(p.id).entries()] : []
          const rowContent = (
            <>
              <div className="vip-row-main">
                <div className="vip-row-title">{p.name}</div>
                <div className="vip-row-sub">
                  {[PARTY_TYPE_LABELS[p.party_type] ?? p.party_type, p.mobile].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="vip-row-meta">
                {employees.length === 0
                  ? '—'
                  : employees.map(([empId, empName], i) => (
                      <span key={empId}>
                        <EmployeeLink id={empId} name={empName} />
                        {i < employees.length - 1 ? ', ' : ''}
                      </span>
                    ))}
              </div>
            </>
          )
          return mostRecentLeadId ? (
            <Link key={p.id} to={`/leads/${mostRecentLeadId}`} className="vip-row vip-clickable" style={{ textDecoration: 'none' }}>
              {rowContent}
            </Link>
          ) : (
            <div key={p.id} className="vip-row">
              {rowContent}
            </div>
          )
        })
      )}
    </div>
  )
}

export default PartiesCard
