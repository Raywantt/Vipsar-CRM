import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import {
  IconActivity,
  IconGrid,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconUser,
} from './NavIcons'

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
      <NavLink to="/activity" className={extraTabClass} title="Activity Log">
        <IconActivity />
        <span className="vip-nav-label">Activity Log</span>
      </NavLink>
      <NavLink to="/dashboard" className={extraTabClass} title="Dashboard">
        <IconGrid />
        <span className="vip-nav-label">Dashboard</span>
      </NavLink>
      <NavLink to="/search" className={tabClass} title="Search">
        <IconSearch />
        <span className="vip-nav-label">Search</span>
      </NavLink>
      <NavLink to="/account" className={tabClass} title="Account">
        <IconUser />
        <span className="vip-nav-label">Account</span>
      </NavLink>
      {employee?.role === 'owner' && (
        <NavLink to="/settings" className={tabClass} title="Settings">
          <IconSettings />
          <span className="vip-nav-label">Settings</span>
        </NavLink>
      )}

      <div className="vip-sidebar-foot">
        <div className="vip-avatar">{getInitials(employee?.name)}</div>
        <div className="vip-sidebar-foot-text">
          <div className="vip-sidebar-foot-name">{employee?.name}</div>
          <div className="vip-sidebar-foot-role">{employee?.role?.replace('_', ' ')}</div>
        </div>
      </div>
    </nav>
  )
}

export default BottomNav
