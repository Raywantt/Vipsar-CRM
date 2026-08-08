import { useState } from 'react'
import { updateEmployeeRole, updateEmployeeActive, updateEmployeeMobile } from '../lib/employeeQueries'
import { errorMessage } from '../lib/errorMessage'

const ROLE_OPTIONS = ['sales_executive', 'owner']

function EmployeeRow({ emp, isSelf, onUpdated }) {
  const [role, setRole] = useState(emp.role)
  const [mobile, setMobile] = useState(emp.mobile ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const roleDirty = role !== emp.role
  const mobileDirty = mobile.trim() !== (emp.mobile ?? '')

  async function handleSaveRole() {
    setSaving(true)
    setError(null)
    const { data, error } = await updateEmployeeRole(emp.id, role)
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
        />
        {mobileDirty && (
          <button type="button" className="vip-btn-link" onClick={handleSaveMobile} disabled={saving}>
            Save
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select className="vip-select" style={{ flex: 1 }} value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf || saving}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
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

      {error && <p className="vip-error">{error}</p>}
    </div>
  )
}

function ManageEmployeesSection({ employees, currentEmployeeId, onUpdated }) {
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
      />

      {employees.length === 0 ? (
        <p className="vip-empty">No employees yet.</p>
      ) : !term ? (
        <p className="vip-empty">Type a name to search.</p>
      ) : matches.length === 0 ? (
        <p className="vip-empty">No employees found.</p>
      ) : (
        matches.map((emp) => (
          <EmployeeRow key={emp.id} emp={emp} isSelf={emp.id === currentEmployeeId} onUpdated={onUpdated} />
        ))
      )}

      <p className="vip-form-note">
        You can't change your own role or deactivate your own account here, to avoid accidentally locking yourself
        out — that needs another owner, or a direct edit in Supabase.
      </p>
    </div>
  )
}

export default ManageEmployeesSection
