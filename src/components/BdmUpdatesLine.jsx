import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
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
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!viewerIsBdm) return
    let active = true
    countUnseenBdmUpdates().then(({ count: n, error }) => {
      // Silent on failure, like AssignedLeadsCard: an additive line is better
      // absent than replaced by an error above the greeting.
      if (active && !error) setCount(n ?? 0)
    })
    return () => {
      active = false
    }
  }, [viewerIsBdm, employee?.id])

  if (!viewerIsBdm || count === 0) return null

  return (
    <Link
      to="/dashboard"
      className="vip-bdm-updates"
      onClick={() => {
        // The Dashboard marks them seen too; doing it here as well means the
        // line is gone on Back even if the Dashboard is still loading.
        setCount(0)
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
