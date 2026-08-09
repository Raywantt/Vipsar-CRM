import { useState } from 'react'
import { changePassword } from '../lib/authQueries'
import { errorMessage } from '../lib/errorMessage'

function ChangePasswordForm({ email, onCancel }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const canSubmit = currentPassword && newPassword && confirmPassword && !saving

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSavedAt(null)

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.")
      return
    }

    setSaving(true)
    const { error } = await changePassword({ email, currentPassword, newPassword })
    setSaving(false)

    if (error) {
      setError(errorMessage(error))
      return
    }

    setSavedAt(Date.now())
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <form className="vip-form" onSubmit={handleSubmit}>
      <label className="vip-field">
        Current password
        <input
          className="vip-input"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>

      <label className="vip-field">
        New password
        <input
          className="vip-input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>

      <label className="vip-field">
        Confirm new password
        <input
          className="vip-input"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>

      {error && <p className="vip-error" role="alert">{error}</p>}
      {savedAt && !error && <p className="vip-success" role="status" aria-live="polite">Password changed.</p>}

      <div className="vip-btn-row">
        <button className="vip-btn vip-btn-dark vip-btn-sm" type="submit" disabled={!canSubmit}>
          {saving ? 'Changing…' : 'Change password'}
        </button>
        {onCancel && (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export default ChangePasswordForm
