import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { isBdm } from '../lib/roles'
import { countUnseenBdmUpdates, markBdmUpdatesSeen } from '../lib/notificationQueries'

// "3 updates on your leads ›" — a business development manager's only in-app
// signal on Today that one of their leads was assigned, won or lost (owner's
// ruling, BDM.md Step 3: the detail lives in two Dashboard cards; Today gets a
// short line so a BDM who never opens the Dashboard still notices).
//
// Mounted inside TodayGreetingHeader beside AssignedLeadsCard, for the same
// reason that card is: one mount on the one component every Today screen
// renders. It returns null for every other role without a request, and for a
// BDM with nothing new.
function BdmUpdatesLine() {
  const { employee } = useAuth()
  const viewerIsBdm = isBdm(employee?.role)
  // Remembered on the device like the rest of Today (src/lib/queryClient.js).
  // Tapping the line hides it at once; the refetch after the "seen" write
  // brings the real count back.
  const [dismissed, setDismissed] = useState(false)
  const query = useCachedQuery(['today', 'bdm-updates-count', employee?.id], () =>
    // Silent on failure, like AssignedLeadsCard: an additive line is better
    // absent than replaced by an error above the greeting.
    countUnseenBdmUpdates().then(({ count: n, error }) => ({ data: n ?? 0, error })),
    { enabled: viewerIsBdm }
  )
  const count = dismissed || query.result?.error ? 0 : (query.result?.data ?? 0)

  if (!viewerIsBdm || count === 0) return null

  return (
    <Link
      to="/dashboard"
      className="vip-bdm-updates"
      onClick={() => {
        // The Dashboard marks them seen too; doing it here as well means the
        // line is gone on Back even if the Dashboard is still loading.
        setDismissed(true)
        markBdmUpdatesSeen()
      }}
    >
      <span className="vip-bdm-updates-dot" aria-hidden="true" />
      <span className="vip-bdm-updates-text">
        {count === 1 ? '1 update on your leads' : `${count} updates on your leads`}
      </span>
      <span className="vip-bdm-updates-sub">assigned, won or lost</span>
      <span className="vip-bdm-updates-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  )
}

export default BdmUpdatesLine
