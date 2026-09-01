import { Link } from 'react-router-dom'
import { getInitials } from '../lib/initials'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// The greeting bar shared by every role's Today screen (Home.jsx for
// owner/sales_executive, CoordinatorToday.jsx for sales_coordinator) — was
// two byte-identical copies until the Today Briefing redesign touched both
// files heavily enough that keeping them in sync by hand stopped being
// reasonable. This markup itself is unchanged from before the redesign.
function greetingForTime(hour, minute) {
  const minutesSinceMidnight = hour * 60 + minute
  if (minutesSinceMidnight >= 5 * 60 && minutesSinceMidnight < 12 * 60) return 'Good morning'
  if (minutesSinceMidnight >= 12 * 60 && minutesSinceMidnight < 17 * 60) return 'Good afternoon'
  if (minutesSinceMidnight >= 17 * 60 && minutesSinceMidnight < 19 * 60 + 30) return 'Good evening'
  return 'Hello'
}

function TodayGreetingHeader({ employee }) {
  const isOnline = useOnlineStatus()
  const now = new Date()
  const greeting = greetingForTime(now.getHours(), now.getMinutes())
  const firstName = employee?.name?.trim().split(/\s+/)[0] ?? ''
  const longDate = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="vip-today-head">
      <div>
        <div className="vip-greeting">
          {greeting}
          {firstName ? `, ${firstName}` : ''}
        </div>
        <div className="vip-today-date">{longDate}</div>
      </div>
      <div className="vip-today-head-actions">
        <span className={isOnline ? 'vip-sync-pill' : 'vip-sync-pill vip-sync-pill-offline'}>
          <span className="vip-sync-dot" />
          {isOnline ? 'Synced' : 'Offline'}
        </span>
        <Link to="/profile" className="vip-avatar" aria-label="Profile">
          {getInitials(employee?.name)}
        </Link>
      </div>
    </div>
  )
}

export default TodayGreetingHeader
