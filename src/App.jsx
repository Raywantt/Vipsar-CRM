import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { HeaderProvider } from './contexts/HeaderContext'
import ProtectedRoute from './components/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
import OfflineIndicator from './components/OfflineIndicator'
import InstallPrompt from './components/InstallPrompt'
import NotificationPrompt from './components/NotificationPrompt'
import Login from './pages/Login'
import Home from './pages/Home'
import Profile from './pages/Profile'
import Search from './pages/Search'
import Dashboard from './pages/Dashboard'
import LeadQuickCapture from './pages/LeadQuickCapture'
import LeadDetail from './pages/LeadDetail'
import EmployeeProfile from './pages/EmployeeProfile'
import MyTeam from './pages/MyTeam'
import ActivityLog from './pages/ActivityLog'
import NotFound from './pages/NotFound'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <HeaderProvider>
        <OfflineIndicator />
        <InstallPrompt />
        <NotificationPrompt />
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
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
              //
              // sales_coordinator now included too (Phase 4's entry-on-behalf
              // flow): the form itself asks "Who is this for?" and assigns the
              // new lead to the picked exec (owner_employee_id), not the
              // coordinator, so the RLS insert policy's is_my_team_member()
              // check passes. See CLAUDE.md's Sales Coordinator section.
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
                <LeadQuickCapture />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads/:id"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
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
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
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
              // sales_coordinator included: the entry-on-behalf flow — a
              // mandatory "Who is this for?" picker credits the activity to
              // the picked exec (employee_id), not the coordinator.
              <ProtectedRoute allowedRoles={['sales_executive', 'sales_coordinator']}>
                <ActivityLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute allowedRoles={['owner', 'sales_executive', 'sales_coordinator']}>
                <Search />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
        </HeaderProvider>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
