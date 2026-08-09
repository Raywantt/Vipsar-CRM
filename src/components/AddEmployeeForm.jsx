import { useState } from 'react'
import { insertEmployee } from '../lib/employeeQueries'
import { errorMessage } from '../lib/errorMessage'

const ROLE_OPTIONS = [
  { value: 'sales_executive', label: 'Sales Executive' },
  { value: 'owner', label: 'Owner' },
]

function AddEmployeeForm({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState('sales_executive')
  const [authUserId, setAuthUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const canSubmit = Boolean(name.trim()) && !saving

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setSavedAt(null)

    const { data, error } = await insertEmployee({
      name: name.trim(),
      mobile: mobile.trim(),
      role,
      authUserId: authUserId.trim(),
    })

    setSaving(false)

    if (error) {
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    setName('')
    setMobile('')
    setAuthUserId('')
    setRole('sales_executive')
    onCreated(data)
  }

  return (
    <>
      <p className="vip-form-note">
        This creates the CRM-side employee record only. The login itself still has to be created manually in the
        Supabase dashboard first (Authentication → Users → Add user — turn on "Auto Confirm User" so the login
        works right away without an email link), then paste that user's UID below. This can't be automated from
        here yet: creating a login needs Supabase's admin API, which requires a secret key that must never be
        exposed to the browser — that would need a small server-side function this project doesn't have yet.
        Leaving Auth User ID blank creates a record with no login attached, linkable later in Supabase directly.
      </p>

      <form className="vip-form" onSubmit={handleSubmit}>
        <label className="vip-field">
          Name
          <input className="vip-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="vip-grid-2">
          <label className="vip-field">
            Mobile
            <input className="vip-input" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </label>
          <label className="vip-field">
            Role
            <select className="vip-select" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="vip-field">
          Auth User ID (UUID)
          <input
            className="vip-input"
            value={authUserId}
            onChange={(e) => setAuthUserId(e.target.value)}
            placeholder="from Supabase Auth → Users"
          />
        </label>

        {error && <p className="vip-error" role="alert">{error}</p>}
        {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Employee added.</p>}

        <div className="vip-btn-row">
          <button className="vip-btn vip-btn-secondary vip-btn-sm" type="submit" disabled={!canSubmit}>
            {saving ? 'Saving…' : 'Add employee'}
          </button>
          {onCancel && (
            <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </>
  )
}

export default AddEmployeeForm
