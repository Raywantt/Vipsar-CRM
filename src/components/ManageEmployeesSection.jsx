import { useState } from 'react'
import NumPadInput from './NumPadInput'
import {
  updateEmployeeRole,
  updateEmployeeActive,
  updateEmployeeMobile,
  updateEmployeeCoordinator,
  updateEmployeeManager,
  fetchEmployeeDataCounts,
} from '../lib/employeeQueries'
import { ROLE_OPTIONS, canHaveCoordinator, canHaveManager, carriesOwnLeads, roleLabel } from '../lib/roles'
import { errorMessage } from '../lib/errorMessage'

function EmployeeRow({ emp, isSelf, coordinators, managers, onUpdated }) {
  const [role, setRole] = useState(emp.role)
  const [coordinatorId, setCoordinatorId] = useState(emp.coordinator_id ?? '')
  const [managerId, setManagerId] = useState(emp.manager_id ?? '')
  const [mobile, setMobile] = useState(emp.mobile ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Set when a role change would strand data — holds the counts so the
  // confirmation can state them, rather than warning in the abstract.
  const [pendingRoleChange, setPendingRoleChange] = useState(null)

  const roleDirty = role !== emp.role
  const mobileDirty = mobile.trim() !== (emp.mobile ?? '')
  const coordinatorDirty = String(coordinatorId) !== String(emp.coordinator_id ?? '')
  const managerDirty = String(managerId) !== String(emp.manager_id ?? '')

  // Gated on the SAVED role, not the dropdown's current value: a coordinator
  // can only be attached to someone who is actually a sales executive right
  // now, so offering the field mid-way through an unsaved promotion would
  // just produce a rejected write.
  const showCoordinator = canHaveCoordinator(emp.role)
  // The second, independent reporting line. Same gate, same reasoning — and
  // deliberately its own flag rather than reusing showCoordinator, so the two
  // lines stay independent if either rule ever changes.
  const showManager = canHaveManager(emp.role)

  async function commitRole() {
    setPendingRoleChange(null)
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeRole(emp.id, role)
    setSaving(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    setCoordinatorId(data.coordinator_id ?? '')
    // updateEmployeeRole clears BOTH reporting lines for a non-exec role, so
    // the local state for both has to follow the row that came back or the
    // dropdowns would keep showing a link the database has just dropped.
    setManagerId(data.manager_id ?? '')
    onUpdated(data)
  }

  async function handleSaveRole() {
    // Warn, don't block (product decision 2026-08-10). A coordinator or owner
    // holds no leads of their own, so moving someone out of the sales_executive
    // role leaves whatever they carry attributed to a non-rep. The owner may
    // well want that — they just shouldn't find out afterwards.
    //
    // carriesOwnLeads(), not `role !== 'sales_executive'`: a sales MANAGER
    // does carry their own leads, so promoting an exec to manager strands
    // nothing and must not raise this warning. Testing the literal role here
    // would tell the owner that a manager "carries no leads of their own",
    // which is the opposite of true.
    if (carriesOwnLeads(emp.role) && !carriesOwnLeads(role)) {
      setSaving(true)
      setError(null)
      const counts = await fetchEmployeeDataCounts(emp.id)
      setSaving(false)
      if (counts.error) {
        setError(errorMessage(counts.error))
        return
      }
      if (counts.leads + counts.activities > 0) {
        setPendingRoleChange(counts)
        return
      }
    }
    await commitRole()
  }

  async function handleSaveCoordinator() {
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeCoordinator(emp.id, coordinatorId)
    setSaving(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    onUpdated(data)
  }

  async function handleSaveManager() {
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeManager(emp.id, managerId)
    setSaving(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    onUpdated(data)
  }

  async function handleSaveMobile() {
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeMobile(emp.id, mobile.trim())
    setSaving(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    setMobile(data.mobile ?? '')
    onUpdated(data)
  }

  async function handleToggleActive() {
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeActive(emp.id, !emp.is_active)
    setSaving(false)
    if (error) {
      setError(errorMessage(error))
      return
    }
    onUpdated(data)
  }

  return (
    <div className="vip-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="vip-row-title">{emp.name}</div>
        <div className="vip-row-meta">{emp.is_active ? 'Active' : 'Inactive'}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <NumPadInput
          variant="integer"
          label={`Mobile number for ${emp.name}`}
          type="text"
          style={{ flex: 1 }}
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          disabled={saving}
          aria-label={`Mobile number for ${emp.name}`}
        />
        {mobileDirty && (
          <button type="button" className="vip-btn-link" onClick={handleSaveMobile} disabled={saving}>
            Save
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="vip-select"
          style={{ flex: 1 }}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={isSelf || saving}
          aria-label={`Role for ${emp.name}`}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {roleDirty && !isSelf && (
          <button type="button" className="vip-btn-link" onClick={handleSaveRole} disabled={saving}>
            Save
          </button>
        )}
        <button
          type="button"
          className="vip-btn vip-btn-secondary vip-btn-sm"
          style={{ width: 'auto', flex: '0 0 auto' }}
          onClick={handleToggleActive}
          disabled={isSelf || saving}
        >
          {emp.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      {showCoordinator && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="vip-select"
            style={{ flex: 1 }}
            value={coordinatorId}
            onChange={(e) => setCoordinatorId(e.target.value)}
            disabled={saving}
            aria-label={`Reports to, for ${emp.name}`}
          >
            <option value="">— No coordinator —</option>
            {coordinators
              .filter((c) => c.id !== emp.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  Coordinator: {c.name}
                </option>
              ))}
          </select>
          {coordinatorDirty && (
            <button type="button" className="vip-btn-link" onClick={handleSaveCoordinator} disabled={saving}>
              Save
            </button>
          )}
        </div>
      )}

      {showManager && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="vip-select"
            style={{ flex: 1 }}
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            disabled={saving}
            aria-label={`Reports to which manager, for ${emp.name}`}
          >
            <option value="">— No manager —</option>
            {managers
              .filter((m) => m.id !== emp.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  Manager: {m.name}
                </option>
              ))}
          </select>
          {managerDirty && (
            <button type="button" className="vip-btn-link" onClick={handleSaveManager} disabled={saving}>
              Save
            </button>
          )}
        </div>
      )}

      {pendingRoleChange && (
        <div className="vip-action-panel">
          <p className="vip-form-note" style={{ marginTop: 0 }}>
            {emp.name} still holds{' '}
            <strong>
              {pendingRoleChange.leads} lead{pendingRoleChange.leads === 1 ? '' : 's'}
            </strong>{' '}
            and{' '}
            <strong>
              {pendingRoleChange.activities} activit{pendingRoleChange.activities === 1 ? 'y' : 'ies'}
            </strong>
            . A {roleLabel(role)} carries no leads of their own, so these stay on their name but they'll no longer
            work them. Reassign the leads first if that's not what you want.
          </p>
          <div className="vip-btn-row">
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={commitRole} disabled={saving}>
              Change anyway
            </button>
            <button
              type="button"
              className="vip-btn vip-btn-secondary vip-btn-sm"
              onClick={() => {
                setPendingRoleChange(null)
                setRole(emp.role)
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="vip-error" role="alert">{error}</p>}
    </div>
  )
}

// Same cap + note LeadsListCard/Search.jsx already use for their own
// search-result lists — a broad query (a single common letter) had no
// ceiling here before, unlike those two.
const MATCH_CAP = 50

function ManageEmployeesSection({ employees, coordinators, managers, currentEmployeeId, onUpdated }) {
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const allMatches = term ? employees.filter((emp) => emp.name?.toLowerCase().includes(term)) : []
  const matches = allMatches.slice(0, MATCH_CAP)

  return (
    <div className="vip-card">
      <div className="vip-card-title">Manage employees</div>

      <input
        className="vip-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search employees by name"
      />

      {employees.length === 0 ? (
        <p className="vip-empty">No employees yet.</p>
      ) : !term ? (
        <p className="vip-empty">Type a name to search.</p>
      ) : matches.length === 0 ? (
        <p className="vip-empty">No employees found.</p>
      ) : (
        <>
          {allMatches.length > MATCH_CAP && (
            <p className="vip-form-note">
              Showing the first {MATCH_CAP} matches — refine your search for a complete list.
            </p>
          )}
          {matches.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              isSelf={emp.id === currentEmployeeId}
              coordinators={coordinators}
              managers={managers}
              onUpdated={onUpdated}
            />
          ))}
        </>
      )}

      <p className="vip-form-note">
        You can't change your own role or deactivate your own account here, to avoid accidentally locking yourself
        out — that needs another owner, or a direct edit in Supabase.
      </p>
      {coordinators.length === 0 && (
        <p className="vip-form-note">
          No sales coordinators yet. Set someone's role to Sales Coordinator first, then you can assign executives to
          report to them.
        </p>
      )}
      {managers.length === 0 && (
        <p className="vip-form-note">
          No sales managers yet. Set someone's role to Sales Manager first, then you can assign executives to report to
          them. A manager keeps working their own leads — the two reporting lines are independent, so an executive can
          have a coordinator, a manager, both, or neither.
        </p>
      )}
    </div>
  )
}

export default ManageEmployeesSection
