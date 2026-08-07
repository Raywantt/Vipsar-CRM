import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchTeamMembers } from '../lib/employeeQueries'
import { fetchLeadsForBreakdown, fetchLastActivityPerLead } from '../lib/dashboardQueries'
import { computeAttentionBuckets } from '../lib/attention'
import { formatCurrencyCompact } from '../lib/format'
import { getInitials } from '../lib/initials'

const BAD = '#b4232a'
const OK = '#7a6413'

// Only sales_executive exists today (fetchTeamMembers already excludes
// owner rows) — kept as a map, not a hardcoded label, so a future role
// added to the team just needs an entry here, same spirit as PARTY_TYPE_LABELS.
const ROLE_LABELS = {
  sales_executive: 'Sales Executive',
}

function MyTeam() {
  const [employees, setEmployees] = useState([])
  const [leads, setLeads] = useState([])
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([fetchTeamMembers(), fetchLeadsForBreakdown(), fetchLastActivityPerLead()]).then(
      ([teamRes, leadsRes, activityRes]) => {
        if (!active) return
        setLoading(false)
        if (teamRes.error) {
          setError(teamRes.error.message)
          return
        }
        setEmployees(teamRes.data ?? [])
        setLeads(leadsRes.data ?? [])
        const map = new Map()
        ;(activityRes.data ?? []).forEach((row) => {
          const existing = map.get(row.lead_id)
          if (!existing || new Date(row.created_at) > new Date(existing)) map.set(row.lead_id, row.created_at)
        })
        setLastActivityByLead(map)
      }
    )
    return () => {
      active = false
    }
  }, [])

  // Open-lead count + open pipeline value per employee, from the same
  // unbounded breakdown query Dashboard/EmployeeProfile already fetch —
  // no dedicated per-employee query needed.
  const statsByEmployee = useMemo(() => {
    const map = new Map()
    leads.forEach((l) => {
      if (!l.owner_employee_id) return
      if (['won', 'lost'].includes(l.current_stage ?? 'new')) return
      const entry = map.get(l.owner_employee_id) ?? { count: 0, value: 0 }
      entry.count += 1
      entry.value += Number(l.order_value ?? l.quote_value ?? 0)
      map.set(l.owner_employee_id, entry)
    })
    return map
  }, [leads])

  // Needs-attention count per employee — sum of all 5 attention.js buckets
  // (stale/silent quotes/overdue follow-ups/slipped close/pending RFQ) for
  // that employee's own leads, the same holistic total the Dashboard's own
  // Needs Attention card badge shows, just scoped to one exec at a time.
  const attentionByEmployee = useMemo(() => {
    const map = new Map()
    employees.forEach((emp) => {
      const empLeads = leads.filter((l) => l.owner_employee_id === emp.id)
      const buckets = computeAttentionBuckets(empLeads, lastActivityByLead)
      map.set(emp.id, buckets.reduce((s, b) => s + b.count, 0))
    })
    return map
  }, [employees, leads, lastActivityByLead])

  const roles = useMemo(() => [...new Set(employees.map((e) => e.role))].sort(), [employees])

  const term = search.trim().toLowerCase()
  const filtered = employees.filter((e) => {
    if (roleFilter && e.role !== roleFilter) return false
    if (term && !e.name.toLowerCase().includes(term)) return false
    return true
  })

  return (
    <div className="vip-wide">
      {employees.length > 0 && (
        <div className="vip-stack-s">
          <input
            className="vip-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team members…"
          />
          {roles.length > 0 && (
            <div className="vip-seg vip-seg-outline">
              <button
                type="button"
                className={roleFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => setRoleFilter('')}
              >
                All
              </button>
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={roleFilter === r ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                  onClick={() => setRoleFilter(r)}
                >
                  {ROLE_LABELS[r] ?? r}
                </button>
              ))}
            </div>
          )}
          <p className="vip-card-note">
            {filtered.length} of {employees.length} team member{employees.length === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {error && <p className="vip-error">{error}</p>}

      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="vip-empty">
          {employees.length === 0 ? 'No team members yet — add one from Settings.' : 'No team members found.'}
        </p>
      ) : (
        <div className="vip-team-grid">
          {filtered.map((emp) => {
            const stats = statsByEmployee.get(emp.id)
            const needsAttn = attentionByEmployee.get(emp.id) ?? 0
            return (
              <Link key={emp.id} to={`/employees/${emp.id}`} className="vip-team-card">
                <div className="vip-team-card-top">
                  <div className="vip-team-avatar">{getInitials(emp.name)}</div>
                  <div className="vip-team-id">
                    <div className="vip-team-name-row">
                      <span className="vip-team-name">{emp.name}</span>
                      {!emp.is_active && (
                        <span className="vip-pill" style={{ background: 'var(--vip-line-soft)', color: 'var(--vip-muted)' }}>
                          Inactive
                        </span>
                      )}
                    </div>
                    <span className="vip-team-sub">
                      {[ROLE_LABELS[emp.role] ?? emp.role, emp.office_location].filter(Boolean).join(' · ')}
                    </span>
                    {emp.mobile && <span className="vip-team-sub">{emp.mobile}</span>}
                  </div>
                </div>

                <div className="vip-team-stats">
                  <div className="vip-team-stat">
                    <span className="vip-team-stat-label">Open leads</span>
                    <span className="vip-team-stat-value">{stats?.count ?? 0}</span>
                  </div>
                  <div className="vip-team-stat">
                    <span className="vip-team-stat-label">Open pipeline</span>
                    <span className="vip-team-stat-value">{formatCurrencyCompact(stats?.value ?? 0)}</span>
                  </div>
                  <div className="vip-team-stat">
                    <span className="vip-team-stat-label">Needs attn.</span>
                    <span className="vip-team-stat-value" style={{ color: needsAttn >= 5 ? BAD : OK }}>
                      {needsAttn}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MyTeam
