import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

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

      <NavLink to="/" end className={tabClass}>
        Home
      </NavLink>
      <NavLink to="/leads/new" className={extraTabClass}>
        New Lead
      </NavLink>
      <NavLink to="/activity" className={extraTabClass}>
        Activity Log
      </NavLink>
      <NavLink to="/dashboard" className={extraTabClass}>
        Dashboard
      </NavLink>
      <NavLink to="/search" className={tabClass}>
        Search
      </NavLink>
      <NavLink to="/account" className={tabClass}>
        Account
      </NavLink>
      {employee?.role === 'owner' && (
        <NavLink to="/settings" className={tabClass}>
          Settings
        </NavLink>
      )}

      <div className="vip-sidebar-foot">
        <div className="vip-sidebar-foot-name">{employee?.name}</div>
        <div className="vip-sidebar-foot-role">{employee?.role?.replace('_', ' ')}</div>
      </div>
    </nav>
  )
}

export default BottomNav
