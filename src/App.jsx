import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClient, persistOptions } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import { HeaderProvider } from './contexts/HeaderContext'
import ProtectedRoute from './components/ProtectedRoute'
import ErrorBoundary from './components/ErrorBoundary'
import OfflineIndicator from './components/OfflineIndicator'
import InstallPrompt from './components/InstallPrompt'
import NotificationPrompt from './components/NotificationPrompt'
import UpdateBanner from './components/UpdateBanner'
import Login from './pages/Login'
import Today from './pages/Today'
import Profile from './pages/Profile'
import Search from './pages/Search'
import DashboardRoute from './pages/DashboardRoute'
import NewRoute from './pages/NewRoute'
import LeadDetail from './pages/LeadDetail'
import EmployeeProfile from './pages/EmployeeProfile'
import MyTeam from './pages/MyTeam'
import ActivityLog from './pages/ActivityLog'
import NotFound from './pages/NotFound'
import MyArchitects from './pages/MyArchitects'
import ArchitectProfile from './pages/ArchitectProfile'
import ArchitectNetwork from './pages/ArchitectNetwork'
import RfqDesk from './pages/RfqDesk'
import {
  canCreateLead,
  canLogActivity,
  canOpenArchitectProfiles,
  canOpenEmployeeProfiles,
  canSeeArchitectNetwork,
  canSeeRfqDesk,
  canOpenLeads,
  canSearch,
  canSeeMyArchitects,
  canSeeSalesDashboard,
  canSeeTeamDirectory,
  rolesWith,
} from './lib/roles'
import './App.css'

// Every route that any signed-in employee may open — now only Today and
// Profile. Listed explicitly rather than "all roles", so a future role is
// admitted route by route on purpose. The RFQ-desk roles (RFQ-DESK.md) are in
// it for those two only; Dashboard, Lead Detail and Search read capabilities.
const EVERY_ROLE = [
  'owner',
  'sales_executive',
  'sales_coordinator',
  'sales_manager',
  'business_development_manager',
  'production_executive',
  'estimation_executive',
]

function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
    <AuthProvider>
      <BrowserRouter>
        <HeaderProvider>
        <OfflineIndicator />
        <InstallPrompt />
        <NotificationPrompt />
        <UpdateBanner />
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              // DashboardRoute picks the business development manager's own
              // dashboard or the shared one — see that file. Sales roles only
              // (canSeeSalesDashboard): the RFQ-desk roles get none of it.
              <ProtectedRoute allowedRoles={rolesWith(canSeeSalesDashboard)}>
                <DashboardRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads/new"
            element={
              // Derived from canCreateLead (src/lib/roles.js), the same function
              // BottomNav's New Lead link and FAB row read. That includes
              // 'owner' deliberately (an owner can personally log leads — see
              // CLAUDE.md's LeadQuickCapture section), sales_coordinator (the
              // entry-on-behalf "Who is this for?" flow) and the business
              // development manager (BDM.md), whose NewRoute is "+ New" — a
              // lead or an architect.
              <ProtectedRoute allowedRoles={rolesWith(canCreateLead)}>
                <NewRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leads/:id"
            element={
              <ProtectedRoute allowedRoles={rolesWith(canOpenLeads)}>
                <LeadDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/employees/:id"
            element={
              // Every role but the BDM (canOpenEmployeeProfiles — the page is
              // exec-shaped). EmployeeProfile itself enforces whose page each
              // allowed role may see (owner: any employee, sales exec: self
              // only, else redirect to /dashboard) — see FLOW.md §4.
              <ProtectedRoute allowedRoles={rolesWith(canOpenEmployeeProfiles)}>
                <EmployeeProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={rolesWith(canSeeTeamDirectory)}>
                <MyTeam />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              // Derived from canLogActivity: owner-excluded deliberately
              // (owners don't log field activity themselves — see CLAUDE.md's
              // ActivityLog section). sales_coordinator included: the
              // entry-on-behalf flow — a mandatory "Who is this for?" picker
              // credits the activity to the picked exec (employee_id), not the
              // coordinator. A BDM logs their own architect meetings.
              <ProtectedRoute allowedRoles={rolesWith(canLogActivity)}>
                <ActivityLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute allowedRoles={EVERY_ROLE}>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={EVERY_ROLE}>
                <Today />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute allowedRoles={rolesWith(canSearch)}>
                <Search />
              </ProtectedRoute>
            }
          />
          <Route
            path="/architects"
            element={
              // My Architects — the BDM's own portfolio (canSeeMyArchitects).
              <ProtectedRoute allowedRoles={rolesWith(canSeeMyArchitects)}>
                <MyArchitects />
              </ProtectedRoute>
            }
          />
          <Route
            path="/architects/:id"
            element={
              // Every role (owner's ruling, BDM.md Step 4) — each sees only the
              // leads and meetings their own RLS returns.
              <ProtectedRoute allowedRoles={rolesWith(canOpenArchitectProfiles)}>
                <ArchitectProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/network"
            element={
              // Architect Network — owner only (canSeeArchitectNetwork, BDM.md Step 6).
              <ProtectedRoute allowedRoles={rolesWith(canSeeArchitectNetwork)}>
                <ArchitectNetwork />
              </ProtectedRoute>
            }
          />
          <Route
            path="/rfq-desk"
            element={
              // The owner's RFQ Desk — owner only (canSeeRfqDesk, RFQ-DESK.md Step 7).
              <ProtectedRoute allowedRoles={rolesWith(canSeeRfqDesk)}>
                <RfqDesk />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
        </HeaderProvider>
      </BrowserRouter>
    </AuthProvider>
    </PersistQueryClientProvider>
  )
}

export default App
