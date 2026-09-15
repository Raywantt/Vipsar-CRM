import { useAuth } from '../contexts/AuthContext'
import { isBdm } from '../lib/roles'
import LeadQuickCapture from './LeadQuickCapture'
import BdmNew from './BdmNew'

// `/leads/new` — the business development manager's "+ New" (a lead OR an
// architect) or everyone else's New Lead form, unchanged. Same wrapper shape
// as DashboardRoute.jsx.
function NewRoute() {
  const { employee } = useAuth()
  return isBdm(employee?.role) ? <BdmNew /> : <LeadQuickCapture />
}

export default NewRoute
