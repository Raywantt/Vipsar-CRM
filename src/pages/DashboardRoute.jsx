import { useAuth } from '../contexts/AuthContext'
import { isBdm } from '../lib/roles'
import Dashboard from './Dashboard'
import BdmDashboard from './BdmDashboard'

// `/dashboard` for every role — the same wrapper-not-early-return shape as
// Today.jsx, for the same reason: Dashboard.jsx fires a large set of fetches
// and carries ~36 owner/coordinator/manager branches, and a business
// development manager would otherwise fall through all of them as "a rep"
// (BDM.md §4). The BDM gets their own page instead; every other role is
// unchanged.
function DashboardRoute() {
  const { employee } = useAuth()
  return isBdm(employee?.role) ? <BdmDashboard /> : <Dashboard />
}

export default DashboardRoute
