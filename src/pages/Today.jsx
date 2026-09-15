import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../lib/roles'
import Home from './Home'
import CoordinatorToday from './CoordinatorToday'
import OwnerToday from './OwnerToday'
import ManagerToday from './ManagerToday'
import BdmToday from './BdmToday'

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
//   business_development_manager — BdmToday (BDM.md). Architect-shaped, not
//                       rep-shaped.
//   sales_executive   — Home itself, unchanged.
//
// EVERY ROLE IS NAMED. This used to end in a bare `return <Home />`, which
// silently handed any role nobody had thought about an exec's screen and an
// exec's fetches. An unrecognised role now gets a plain message instead.
function Today() {
  const { employee } = useAuth()
  switch (employee?.role) {
    case ROLES.SALES_EXECUTIVE:
      return <Home />
    case ROLES.SALES_COORDINATOR:
      return <CoordinatorToday />
    case ROLES.OWNER:
      return <OwnerToday />
    case ROLES.SALES_MANAGER:
      return <ManagerToday />
    case ROLES.BDM:
      return <BdmToday />
    default:
      return (
        <div className="vip-narrow">
          <div className="vip-card">
            <h2 className="vip-card-title">No Today screen for this account</h2>
            <p className="vip-form-note" style={{ marginTop: 0 }}>
              Your role isn't set up in the app yet. Ask the owner to check your role in Profile → Manage employees.
            </p>
          </div>
        </div>
      )
  }
}

export default Today
