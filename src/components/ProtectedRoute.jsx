import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AppNav from './AppNav'

const roleHome = {
  owner: '/dashboard',
  sales_executive: '/leads/new',
}

function ProtectedRoute({ allowedRoles, children }) {
  const { session, employee, employeeError, loading } = useAuth()

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
    return <Navigate to={roleHome[employee.role] ?? '/login'} replace />
  }

  return (
    <>
      <AppNav />
      {children}
    </>
  )
}

export default ProtectedRoute
