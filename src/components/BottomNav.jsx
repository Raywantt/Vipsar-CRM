import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function tabClass({ isActive }) {
  return isActive ? 'vip-active' : undefined
}

function BottomNav() {
  const { employee } = useAuth()

  return (
    <nav className="vip-bottom-nav">
      <NavLink to="/" end className={tabClass}>
        Home
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
    </nav>
  )
}

export default BottomNav
