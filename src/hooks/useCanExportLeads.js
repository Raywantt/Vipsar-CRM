import { useAuth } from '../contexts/AuthContext'
import { useCachedQuery } from './useCachedQuery'
import { fetchMyExportGrant } from '../lib/employeeQueries'
import { canExportLeads, ROLES } from '../lib/roles'

// Can the signed-in person download All Leads as Excel? One answer for both the
// phone and desktop renderings of the button — roles.js's canExportLeads is the
// single rule, this just supplies its second argument.
//
// The owner has it by role and asks the database nothing. Everyone else needs
// the per-person switch the owner sets in Manage employees, read through its
// own request (employeeQueries.js's fetchMyExportGrant), kept in memory only:
// a permission that was taken away must not linger on a device for a day, so
// `persist: false`. Until the answer arrives — and if it never does, or the
// column isn't there yet — the answer is "no".
export function useCanExportLeads() {
  const { employee } = useAuth()
  const isOwner = employee?.role === ROLES.OWNER
  const grant = useCachedQuery(['me', 'can-export-leads', employee?.id ?? null], () => fetchMyExportGrant(employee?.id), {
    enabled: employee?.id != null && !isOwner,
    persist: false,
  })
  return canExportLeads(employee?.role, grant.result?.data === true)
}
