import { useAuth } from '../contexts/AuthContext'
import Home from './Home'
import CoordinatorToday from './CoordinatorToday'
import OwnerToday from './OwnerToday'
import ManagerToday from './ManagerToday'

// `/` is one route serving a different screen per role.
//
// THE SWITCH IS A WRAPPER, NOT AN EARLY RETURN INSIDE Home. Home runs a
// dozen hooks and fires several fetches before it renders anything, and none
// of those queries are scoped to data a coordinator or owner owns — an early
// return would still pay for every one of them.
//
// This wrapper LIVED IN Home.jsx until 2026-09-03 and moved here when the
// sales manager arrived. ManagerToday's "My day" tab renders the real Home
// (embedded), so leaving the switch in Home.jsx would have made Home.jsx and
// ManagerToday.jsx import each other — a cycle that happens to work under
// ESM but only because the binding is read at render time. A separate file
// removes it outright instead of relying on that.
//
// Who gets what, and why:
//   sales_coordinator — CoordinatorToday. Owns no leads; a rep-shaped
//                       personal screen would be all zeros.
//   owner             — OwnerToday. Same reasoning: they don't log
//                       activities or work leads personally (2026-09-01).
//   sales_manager     — ManagerToday. The only role that needs BOTH shapes,
//                       so it gets both as tabs rather than a compromise
//                       between them.
//   sales_executive   — Home itself, unchanged.
function Today() {
  const { employee } = useAuth()
  if (employee?.role === 'sales_coordinator') return <CoordinatorToday />
  if (employee?.role === 'owner') return <OwnerToday />
  if (employee?.role === 'sales_manager') return <ManagerToday />
  return <Home />
}

export default Today
