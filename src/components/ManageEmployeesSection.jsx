import { useState } from 'react'
import {
  updateEmployeeRole,
  updateEmployeeActive,
  updateEmployeeMobile,
  updateEmployeeCoordinator,
  fetchEmployeeDataCounts,
} from '../lib/employeeQueries'
import { ROLE_OPTIONS, canHaveCoordinator, roleLabel } from '../lib/roles'
import { errorMessage } from '../lib/errorMessage'

function EmployeeRow({ emp, isSelf, coordinators, onUpdated }) {
  const [role, setRole] = useState(emp.role)
  const [coordinatorId, setCoordinatorId] = useState(emp.coordinator_id ?? '')
  const [mobile, setMobile] = useState(emp.mobile ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Set when a role change would strand data — holds the counts so the
  // confirmation can state them, rather than warning in the abstract.
  const [pendingRoleChange, setPendingRoleChange] = useState(null)

  const roleDirty = role !== emp.role
  const mobileDirty = mobile.trim() !== (emp.mobile ?? '')
  const coordinatorDirty = String(coordinatorId) !== String(emp.coordinator_id ?? '')

  // Gated on the SAVED role, not the dropdown's current value: a coordinator
  // can only be attached to someone who is actually a sales executive right
  // now, so offering the field mid-way through an unsaved promotion would
  // just produce a rejected write.
  const showCoordinator = canHaveCoordinator(emp.role)

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
    onUpdated(data)
  }

  async function handleSaveRole() {
    // Warn, don't block (product decision 2026-08-10). A coordinator or owner
    // holds no leads of their own, so moving someone out of the sales_executive
    // role leaves whatever they carry attributed to a non-rep. The owner may
    // well want that — they just shouldn't find out afterwards.
    if (emp.role === 'sales_executive' && role !== 'sales_executive') {
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
        <input
          className="vip-input"
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
                  Reports to {c.name}
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

function ManageEmployeesSection({ employees, coordinators, currentEmployeeId, onUpdated }) {
  const [search, setSearch] = useState('')

  const term = search.trim().toLowerCase()
  const matches = term ? employees.filter((emp) => emp.name?.toLowerCase().includes(term)) : []

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
        matches.map((emp) => (
          <EmployeeRow
            key={emp.id}
            emp={emp}
            isSelf={emp.id === currentEmployeeId}
            coordinators={coordinators}
            onUpdated={onUpdated}
          />
        ))
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
    </div>
  )
}

export default ManageEmployeesSection
