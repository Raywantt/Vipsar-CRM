import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import OwnerDashboard from './pages/OwnerDashboard'
import LeadQuickCapture from './pages/LeadQuickCapture'
import './App.css'

const roleHome = {
  owner: '/dashboard',
  sales_executive: '/activity',
}

function RoleRedirect() {
  const { session, employee, loading } = useAuth()

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>
  if (!session || !employee) return <Navigate to="/login" replace />
  return <Navigate to={roleHome[employee.role] ?? '/login'} replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['owner']}>
                <OwnerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              // TEMPORARY: 'owner' included so the only existing test account
              // can verify this screen. Remove 'owner' once a sales_executive
              // test account exists — this screen is sales-exec-only by design.
              <ProtectedRoute allowedRoles={['sales_executive', 'owner']}>
                <LeadQuickCapture />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<RoleRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
