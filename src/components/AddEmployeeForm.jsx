import { useState } from 'react'
import { insertEmployee } from '../lib/employeeQueries'
import '../pages/Settings.css'

const ROLE_OPTIONS = [
  { value: 'sales_executive', label: 'Sales Executive' },
  { value: 'owner', label: 'Owner' },
]

function AddEmployeeForm({ onCreated }) {
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState('sales_executive')
  const [authUserId, setAuthUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const canSubmit = Boolean(name.trim()) && !saving

  async function handleSubmit() {
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
      setError(error.message)
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
    <section className="settings-card">
      <h2>Add employee</h2>
      <p className="settings-hint">
        This creates the CRM-side employee record only. The login itself still has to be created manually in the
        Supabase dashboard first (Authentication → Users → Add user — turn on "Auto Confirm User" so the login
        works right away without an email link), then paste that user's UID below. This can't be automated from
        here yet: creating a login needs Supabase's admin API, which requires a secret key that must never be
        exposed to the browser — that would need a small server-side function this project doesn't have yet.
        Leaving Auth User ID blank creates a record with no login attached, linkable later in Supabase directly.
      </p>

      <label className="settings-field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="settings-field">
        Mobile
        <input value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </label>

      <label className="settings-field">
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-field">
        Auth User ID (UUID)
        <input
          value={authUserId}
          onChange={(e) => setAuthUserId(e.target.value)}
          placeholder="from Supabase Auth → Users"
        />
      </label>

      {error && <p className="settings-error">{error}</p>}
      {savedAt && !error && <p className="settings-success">Employee added.</p>}

      <button type="button" onClick={handleSubmit} disabled={!canSubmit}>
        {saving ? 'Saving…' : 'Add employee'}
      </button>
    </section>
  )
}

export default AddEmployeeForm
