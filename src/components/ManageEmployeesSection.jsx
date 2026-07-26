import { useState } from 'react'
import { updateEmployeeRole, updateEmployeeActive, updateEmployeeMobile } from '../lib/employeeQueries'
import '../pages/Settings.css'

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
      setError(error.message)
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
      setError(error.message)
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
      setError(error.message)
      return
    }
    onUpdated(data)
  }

  return (
    <>
      <tr>
        <td>{emp.name}</td>
        <td>
          <input value={mobile} onChange={(e) => setMobile(e.target.value)} disabled={saving} />
          {mobileDirty && (
            <button type="button" onClick={handleSaveMobile} disabled={saving}>
              Save
            </button>
          )}
        </td>
        <td>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf || saving}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {roleDirty && !isSelf && (
            <button type="button" onClick={handleSaveRole} disabled={saving}>
              Save
            </button>
          )}
        </td>
        <td>{emp.is_active ? 'Active' : 'Inactive'}</td>
        <td>
          <button type="button" onClick={handleToggleActive} disabled={isSelf || saving}>
            {emp.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="settings-error">
            {error}
          </td>
        </tr>
      )}
    </>
  )
}

function ManageEmployeesSection({ employees, currentEmployeeId, onUpdated }) {
  return (
    <section className="settings-card">
      <h2>Manage employees</h2>

      {employees.length === 0 ? (
        <p className="settings-hint">No employees yet.</p>
      ) : (
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <EmployeeRow key={emp.id} emp={emp} isSelf={emp.id === currentEmployeeId} onUpdated={onUpdated} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="settings-hint">
        You can't change your own role or deactivate your own account here, to avoid accidentally locking yourself
        out — that needs another owner, or a direct edit in Supabase.
      </p>
    </section>
  )
}

export default ManageEmployeesSection
