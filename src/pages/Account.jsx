import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPushPermissionState, hasActiveSubscription, subscribeToPush, unsubscribeFromPush } from '../lib/pushSubscription'

const ROLE_LABELS = {
  owner: 'Owner',
  sales_executive: 'Sales Executive',
}

function Account() {
  const { employee, user, signOut } = useAuth()

  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notifError, setNotifError] = useState(null)

  useEffect(() => {
    setPermission(getPushPermissionState())
    hasActiveSubscription().then(setSubscribed)
  }, [])

  async function handleToggleNotifications() {
    setBusy(true)
    setNotifError(null)

    if (subscribed) {
      const { error } = await unsubscribeFromPush(employee.id)
      setBusy(false)
      if (error) {
        setNotifError(error.message)
        return
      }
      setSubscribed(false)
      return
    }

    const { error } = await subscribeToPush(employee.id)
    setBusy(false)
    if (error) {
      setNotifError(error.message)
      return
    }
    setSubscribed(true)
    setPermission(getPushPermissionState())
  }

  return (
    <div className="vip-narrow">
      <div className="vip-card">
        <div className="vip-facts" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div>
            <div className="vip-fact-label">Name</div>
            <div className="vip-fact-value">{employee?.name}</div>
          </div>
          <div>
            <div className="vip-fact-label">Role</div>
            <div className="vip-fact-value">{ROLE_LABELS[employee?.role] ?? employee?.role}</div>
          </div>
          <div>
            <div className="vip-fact-label">Mobile</div>
            <div className="vip-fact-value">{employee?.mobile || 'Not set'}</div>
          </div>
          <div>
            <div className="vip-fact-label">Email</div>
            <div className="vip-fact-value">{user?.email}</div>
          </div>
        </div>
      </div>

      <div className="vip-card">
        <div className="vip-card-title">Notifications</div>
        {permission === 'unsupported' ? (
          <p className="vip-form-note">Push notifications aren't supported on this browser or device.</p>
        ) : permission === 'denied' ? (
          <p className="vip-form-note">
            Notifications are blocked for this site. Enable them in your browser's site settings to get follow-up reminders.
          </p>
        ) : (
          <label className="vip-check">
            <input type="checkbox" checked={subscribed} disabled={busy} onChange={handleToggleNotifications} />
            {subscribed ? 'Reminders enabled on this device' : 'Get follow-up reminders on this device'}
          </label>
        )}
        {notifError && <p className="vip-error">{notifError}</p>}
      </div>

      <button type="button" className="vip-btn vip-btn-secondary" onClick={signOut}>
        Log out
      </button>
    </div>
  )
}

export default Account
