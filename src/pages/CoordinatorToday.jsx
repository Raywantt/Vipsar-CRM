import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// The sales coordinator's Today screen. Phase 8 builds this in two passes:
// Phase 3 (this file) gets a coordinator logged in and oriented, without the
// rep-shaped Home screen misrepresenting their job — a coordinator owns no
// leads or activities, so every figure on the exec's Today would read zero for
// them, which looks like a broken screen rather than an empty one.
//
// Phase 4 replaces the card below with the real content: team overview rows
// (last activity, open leads, follow-ups due/overdue), red flags (10+ days
// with no activity on a lead, missed follow-up due dates), follow-up
// assignment, and lead/activity entry on a team member's behalf. The greeting
// bar is already the final one, so that part won't be rebuilt.
//
// The bar's markup is copied from Home.jsx rather than shared: it's ~15 lines
// of static JSX, and Phase 4's version grows a team-scoped subtitle the exec's
// doesn't have. Worth revisiting if a third Today screen ever appears.
function greetingForTime(hour, minute) {
  const minutesSinceMidnight = hour * 60 + minute
  if (minutesSinceMidnight >= 5 * 60 && minutesSinceMidnight < 12 * 60) return 'Good morning'
  if (minutesSinceMidnight >= 12 * 60 && minutesSinceMidnight < 17 * 60) return 'Good afternoon'
  if (minutesSinceMidnight >= 17 * 60 && minutesSinceMidnight < 19 * 60 + 30) return 'Good evening'
  return 'Hello'
}

function CoordinatorToday() {
  const { employee } = useAuth()
  const isOnline = useOnlineStatus()

  const now = new Date()
  const greeting = greetingForTime(now.getHours(), now.getMinutes())
  const firstName = employee?.name?.split(' ')[0] ?? ''
  const longDate = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="vip-wide vip-pad-fab-overhang">
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

      <div className="vip-card">
        <div className="vip-card-title">Your team view is being built</div>
        <p className="vip-form-note" style={{ marginTop: 0 }}>
          Your account is set up correctly. The coordinator screen — your team's activity, red flags, and follow-up
          assignment — is the next piece of work.
        </p>
        <p className="vip-form-note">
          In the meantime <Link to="/dashboard">Dashboard</Link> and <Link to="/search">Search</Link> already work and
          are scoped to your own team, so you can see their leads and activity there.
        </p>
      </div>
    </div>
  )
}

export default CoordinatorToday
