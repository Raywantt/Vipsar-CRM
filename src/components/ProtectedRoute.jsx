import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { TAB_ROUTES } from '../lib/tabRoutes'
import AppNav from './AppNav'
import BottomNav from './BottomNav'

function ProtectedRoute({ allowedRoles, children }) {
  const { session, employee, employeeError, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <p style={{ padding: 24 }}>Loading…</p>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!employee) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Account not linked</h1>
        <p>
          Your login isn't linked to an employee record yet. Contact your
          admin to get your account connected.
        </p>
        {employeeError && <p style={{ color: 'crimson' }}>{employeeError}</p>}
      </main>
    )
  }

  if (allowedRoles && !allowedRoles.includes(employee.role)) {
    return <Navigate to="/" replace />
  }

  const isHome = location.pathname === '/'
  // Every route reached by "drilling in" from a tab (New Lead, Log Activity,
  // Lead Detail, Profile, My Team, Sales Exec Profile — anything not in
  // TAB_ROUTES) hides the mobile tab bar entirely below 1024px, replaced by
  // each page's own sticky action bar or nothing (see vipsar-theme.css's
  // .vip-drilled rules) — the ≥1024px sidebar is unaffected either way.
  const isDrilled = !TAB_ROUTES.has(location.pathname)

  return (
    <div className={isHome ? 'vip-app vip-home' : isDrilled ? 'vip-app vip-drilled' : 'vip-app'}>
      <AppNav />
      <div className="vip-body">{children}</div>
      <BottomNav />
    </div>
  )
}

export default ProtectedRoute
