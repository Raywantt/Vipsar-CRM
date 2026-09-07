import { useEffect, useState } from 'react'
import { applyUpdateNow, initAppUpdate } from '../lib/appUpdate'

// The visible half of the auto-update flow — and the half almost nobody should
// ever see. src/lib/appUpdate.js reloads silently the moment a new build is
// ready and nothing is being typed, which covers reading a dashboard, sitting
// on a lead, or having walked away from the desk. This banner exists only for
// the case it deliberately refuses to reload through: a rep part-way into a
// New Lead or Log Activity form, or a save still on the wire.
//
// So it is not a "click here to update" prompt in the usual sense. It is a
// note that the update is already waiting and will apply itself, plus a button
// for someone who would rather take it now than finish what they were typing.
// The wording matters for that reason: it must not read as a chore, because
// the whole point of this feature is that employees stop having to do one.
//
// Mounted once, globally, in App.jsx alongside OfflineIndicator/InstallPrompt
// — outside ProtectedRoute, so it also works on /login and on any route.
function UpdateBanner() {
  const [deferred, setDeferred] = useState(false)

  useEffect(() => initAppUpdate({ onDeferredChange: setDeferred }), [])

  if (!deferred) return null

  return (
    <div className="vip-update-bar" role="status">
      <div className="vip-update-text">
        <div className="vip-update-title">Update ready</div>
        <div className="vip-update-sub">Applies as soon as you finish here.</div>
      </div>
      <button type="button" className="vip-btn" onClick={applyUpdateNow}>
        Update now
      </button>
    </div>
  )
}

export default UpdateBanner
