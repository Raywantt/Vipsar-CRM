import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import './AppNav.css'

function navLinkClass({ isActive }) {
  return isActive ? 'app-nav-link app-nav-link-active' : 'app-nav-link'
}

function AppNav() {
  const { employee, signOut } = useAuth()

  return (
    <nav className="app-nav">
      <div className="app-nav-top">
        <span className="app-nav-brand">Tostem CRM</span>
        <button type="button" className="app-nav-logout" onClick={signOut}>
          Log out
        </button>
      </div>
      <div className="app-nav-links">
        <NavLink to="/leads/new" className={navLinkClass}>
          New Lead
        </NavLink>
        <NavLink to="/activity" className={navLinkClass}>
          Activity Log
        </NavLink>
        <NavLink to="/dashboard" className={navLinkClass}>
          Dashboard
        </NavLink>
        {employee?.role === 'owner' && (
          <NavLink to="/settings" className={navLinkClass}>
            Settings
          </NavLink>
        )}
      </div>
    </nav>
  )
}

export default AppNav
