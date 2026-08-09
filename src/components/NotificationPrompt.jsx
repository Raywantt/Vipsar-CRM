import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPushPermissionState, hasActiveSubscription, subscribeToPush } from '../lib/pushSubscription'
import { errorMessage } from '../lib/errorMessage'

const DISMISS_KEY = 'notificationPromptDismissed'

// Same shape as InstallPrompt.jsx (sessionStorage dismiss flag, .vip-install
// classes) — necessary for push to be discoverable at all: without this
// banner, push never fires for anyone who doesn't independently find the
// toggle buried in Account. Only shown when permission has never been asked
// (Notification.permission === 'default') and this device isn't already
// subscribed — a "denied" or already-subscribed state never shows it.
// Requires SW support, so this stays effectively inert under `npm run dev`
// (no service worker registered there) — real behavior only shows up via
// `npm run build && npm run preview`, same as every other PWA feature here.
function NotificationPrompt() {
  const { employee } = useAuth()
  const [show, setShow] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!employee) return
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return
    if (getPushPermissionState() !== 'default') return

    let active = true
    hasActiveSubscription().then((subscribed) => {
      if (active && !subscribed) setShow(true)
    })
    return () => {
      active = false
    }
  }, [employee])

  async function handleEnable() {
    setSubscribing(true)
    setError(null)
    const { error: subError } = await subscribeToPush(employee.id)
    setSubscribing(false)
    if (subError) {
      setError(errorMessage(subError))
      return
    }
    setShow(false)
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div style={{ maxWidth: 'var(--vip-app-max)', margin: '0 auto', padding: '10px 16px 0' }}>
      <div className="vip-install">
        <div>
          <div className="vip-install-title">Turn on reminders</div>
          <div className="vip-install-sub">Get notified on this device when a follow-up is due.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <button type="button" className="vip-btn-link" onClick={dismiss}>
            Not now
          </button>
          <button type="button" className="vip-btn" onClick={handleEnable} disabled={subscribing}>
            {subscribing ? 'Enabling…' : 'Enable'}
          </button>
        </div>
      </div>
      {error && (
        <p className="vip-error" role="alert" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
    </div>
  )
}

export default NotificationPrompt
