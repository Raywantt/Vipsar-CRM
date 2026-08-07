import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { IconActivity, IconGrid, IconHome, IconList, IconPlus, IconSearch, IconTeam } from './NavIcons'

function tabClass({ isActive }) {
  return isActive ? 'vip-active' : undefined
}

// Extra destinations only appear once BottomNav becomes the desktop sidebar
// (see .vip-nav-extra in vipsar-theme.css) — on a phone they stay reachable
// via Home's tiles instead, same as before.
function extraTabClass({ isActive }) {
  return isActive ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
}

function BottomNav() {
  const { employee } = useAuth()

  return (
    <nav className="vip-bottom-nav">
      <div className="vip-sidebar-brand">
        <div className="vip-sidebar-mark">V</div>
        <div className="vip-sidebar-word">VIPSAR</div>
      </div>

      <NavLink to="/" end className={tabClass} title="Home">
        <IconHome />
        <span className="vip-nav-label">Home</span>
      </NavLink>
      <NavLink to="/leads/new" className={extraTabClass} title="New Lead">
        <IconPlus />
        <span className="vip-nav-label">New Lead</span>
      </NavLink>
      {employee?.role !== 'owner' && (
        <NavLink to="/activity" className={extraTabClass} title="Activity Log">
          <IconActivity />
          <span className="vip-nav-label">Activity Log</span>
        </NavLink>
      )}
      <NavLink to="/dashboard" end className={extraTabClass} title="Dashboard">
        <IconGrid />
        <span className="vip-nav-label">Dashboard</span>
      </NavLink>
      {/* Reports/All leads used to be an in-page tab row on the Dashboard
          itself — moved here so it's reachable without it (see
          Dashboard.jsx's activeTab, now driven purely by ?tab= instead of
          buttons). Parties used to have its own tab/link here too — folded
          into Search instead, see Search.jsx. */}
      <NavLink to="/dashboard?tab=leads" className={extraTabClass} title="All Leads">
        <IconList />
        <span className="vip-nav-label">All Leads</span>
      </NavLink>
      {employee?.role === 'owner' && (
        <NavLink to="/team" className={extraTabClass} title="My Team">
          <IconTeam />
          <span className="vip-nav-label">My Team</span>
        </NavLink>
      )}
      <NavLink to="/search" className={tabClass} title="Search">
        <IconSearch />
        <span className="vip-nav-label">Search</span>
      </NavLink>

      <Link to="/profile" className="vip-sidebar-foot" aria-label="Profile">
        <div className="vip-avatar">{getInitials(employee?.name)}</div>
        <div className="vip-sidebar-foot-text">
          <div className="vip-sidebar-foot-name">{employee?.name}</div>
          <div className="vip-sidebar-foot-role">{employee?.role?.replace('_', ' ')}</div>
        </div>
      </Link>
    </nav>
  )
}

export default BottomNav
