import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import OfflineIndicator from './components/OfflineIndicator'
import InstallPrompt from './components/InstallPrompt'
import Login from './pages/Login'
import Home from './pages/Home'
import Account from './pages/Account'
import Search from './pages/Search'
import Dashboard from './pages/Dashboard'
import LeadQuickCapture from './pages/LeadQuickCapture'
import LeadDetail from './pages/LeadDetail'
import ActivityLog from './pages/ActivityLog'
import Settings from './pages/Settings'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <OfflineIndicator />
        <InstallPrompt />
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
              // workaround — see CLAUDE.md's Current state section.
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
            path="/activity"
            element={
              <ProtectedRoute allowedRoles={['sales_executive', 'owner']}>
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
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
