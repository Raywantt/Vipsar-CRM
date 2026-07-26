import { useAuth } from '../contexts/AuthContext'
import './AppNav.css'

function AppNav() {
  const { signOut } = useAuth()

  return (
    <nav className="app-nav">
      <span className="app-nav-brand">VIPSAR CRM</span>
      <button type="button" className="app-nav-logout" onClick={signOut}>
        Log out
      </button>
    </nav>
  )
}

export default AppNav
