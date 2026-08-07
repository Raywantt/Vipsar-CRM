import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { HeaderProvider } from './contexts/HeaderContext'
import ProtectedRoute from './components/ProtectedRoute'
import OfflineIndicator from './components/OfflineIndicator'
import InstallPrompt from './components/InstallPrompt'
import NotificationPrompt from './components/NotificationPrompt'
import Login from './pages/Login'
import Home from './pages/Home'
import Account from './pages/Account'
import Search from './pages/Search'
import Dashboard from './pages/Dashboard'
import LeadQuickCapture from './pages/LeadQuickCapture'
import LeadDetail from './pages/LeadDetail'
import EmployeeProfile from './pages/EmployeeProfile'
import MyTeam from './pages/MyTeam'
import ActivityLog from './pages/ActivityLog'
import Settings from './pages/Settings'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <HeaderProvider>
        <OfflineIndicator />
        <InstallPrompt />
        <NotificationPrompt />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive']}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads/new"
            element={
              // 'owner' included deliberately: an owner can also personally log
              // leads via quick-capture, not just sales execs. Not a testing
              // workaround — see CLAUDE.md's LeadQuickCapture section.
              <ProtectedRoute allowedRoles={['sales_executive', 'owner']}>
                <LeadQuickCapture />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads/:id"
            element={
              <ProtectedRoute allowedRoles={['sales_executive', 'owner']}>
                <LeadDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/employees/:id"
            element={
              // Both roles can hit the route; EmployeeProfile itself enforces
              // who can see what (owner: any employee, sales exec: self
              // only, else redirect to /dashboard) — see FLOW.md §4.
              <ProtectedRoute allowedRoles={['sales_executive', 'owner']}>
                <EmployeeProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['owner']}>
                <MyTeam />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              // owner-excluded deliberately: owners don't log field activity
              // themselves, only sales execs do — see CLAUDE.md's ActivityLog section.
              <ProtectedRoute allowedRoles={['sales_executive']}>
                <ActivityLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute allowedRoles={['owner']}>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive']}>
                <Account />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive']}>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive']}>
                <Search />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </HeaderProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
