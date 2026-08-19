import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchAllEmployees } from '../lib/employeeQueries'
import { roleLabel } from '../lib/roles'

// Search-only, no-create picker over real `employees` rows — for a field
// where the real-world answer might be one of our own team, not an outside
// party (New Lead's "Referral from", see LeadQuickCapture's Type toggle).
// Deliberately has no create escape hatch, unlike PartySearchOrCreate: an
// employee already exists as a real record, so "add a new one from here"
// would only ever produce a duplicate.
//
// Fetched once on mount rather than server-searched — the employee list is
// small, not a paged/searched-server-side thing like parties — via
// fetchAllEmployees, the same lookup Manage Employees uses, so this can't
// drift into a second, separate employee list. Filtered to active (an
// employee whose access has been revoked shouldn't be offered as fresh
// referral credit) and to exclude whoever is actually logged in right now —
// same "excluding yourself" rule ActivityLog's "Accompanied by" dropdown
// already applies, since crediting a referral to yourself isn't a real case
// this exists for. Deliberately the real logged-in employee, not whichever
// exec a coordinator might be entering a lead for — it's the person
// physically typing who can't be the referral.
//
// A chosen employee comes back as { _isEmployee: true, id, name, role } —
// shaped differently from a party on purpose, so a caller can tell the two
// apart (e.g. route it to a different foreign key) rather than treating an
// employee id as if it were a parties.id.
function EmployeeSearchSelect({ label = null, hint = null, onSelect, initialSelected = null }) {
  const { employee } = useAuth()
  const [allEmployees, setAllEmployees] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(initialSelected)

  useEffect(() => {
    let active = true
    fetchAllEmployees().then(({ data }) => {
      if (!active) return
      setAllEmployees((data ?? []).filter((e) => e.is_active && e.id !== employee?.id))
    })
    return () => {
      active = false
    }
  }, [employee?.id])

  function selectEmployee(emp) {
    const chosen = { _isEmployee: true, id: emp.id, name: emp.name, role: emp.role }
    setSelected(chosen)
    setQuery('')
    onSelect?.(chosen)
  }

  function changeSelection() {
    setSelected(null)
    onSelect?.(null)
  }

  if (selected) {
    return (
      <div className="vip-row">
        <div className="vip-row-main">
          <div className="vip-row-title">{selected.name}</div>
          <div className="vip-row-sub">Employee{selected.role ? ` · ${roleLabel(selected.role)}` : ''}</div>
        </div>
        <button type="button" className="vip-btn-link" onClick={changeSelection}>
          Change
        </button>
      </div>
    )
  }

  const matches =
    query.trim().length > 0
      ? allEmployees.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
      : []

  return (
    <div className="vip-stack-s">
      <label className="vip-field">
        {label}
        {hint && <span className="vip-field-hint">{hint}</span>}
        <input
          className="vip-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name"
        />
      </label>

      {matches.length > 0 && (
        <div className="vip-card">
          {matches.map((emp) => (
            <div key={emp.id} className="vip-row vip-clickable" onClick={() => selectEmployee(emp)}>
              <div className="vip-row-main">
                <div className="vip-row-title">{emp.name}</div>
                <div className="vip-row-sub">{roleLabel(emp.role)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {query.trim().length > 0 && matches.length === 0 && <p className="vip-form-note">No matching employees.</p>}
    </div>
  )
}

export default EmployeeSearchSelect
