import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { getInitials } from '../lib/initials'
import { TAB_ROUTES } from '../lib/tabRoutes'
import { createActionLabel } from '../lib/roles'
import { useSyncState } from '../hooks/useCachedQuery'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// Static per-route title/sub, matched by exact path first, then by prefix
// for dynamic routes (/leads/:id). Two routes (Lead Detail, Dashboard) need
// a sub AppNav can't compute itself — those pages push it in via
// HeaderContext's override instead (see useHeaderOverride).
const ROUTE_HEADERS = {
  '/search': { title: 'Search', sub: 'Leads, parties, sites' },
  '/profile': { title: 'Profile' },
  '/dashboard': { title: 'Dashboard' },
  // Not "Fill any one field" — that stopped being true once source, office
  // territory, and (per source) site stage and referral-from became required.
  // Which fields those are changes with the chosen source, so the sub states
  // the rule for reading the form rather than listing fields that move.
  '/leads/new': { title: 'New lead', sub: 'Required fields are marked *' },
  '/activity': { title: 'Log activity' },
  '/team': { title: 'My Team', sub: 'Your sales team' },
  '/architects': { title: 'My Architects', sub: 'Your architect portfolio' },
  '/network': { title: 'Architect Network', sub: 'BDMs and every architect' },
}

function routeHeader(pathname) {
  if (ROUTE_HEADERS[pathname]) return ROUTE_HEADERS[pathname]
  if (pathname.startsWith('/leads/')) return { title: 'Lead' }
  if (pathname.startsWith('/employees/')) return { title: 'Sales Exec' }
  if (pathname.startsWith('/architects/')) return { title: 'Architect' }
  return { title: 'VIPSAR CRM' }
}

// The same refresh state Today's greeting pill shows (owner's choice,
// 2026-09-21: every screen that opens with remembered numbers says so while
// it refreshes them). Nothing at all once the screen is up to date, and
// nothing while offline — OfflineIndicator's banner already says that.
function syncLabelFor(isOnline, sync) {
  if (!isOnline) return null
  if (sync === 'updating') return { className: 'vip-header-sync', text: 'Updating…' }
  if (sync === 'stale') return { className: 'vip-header-sync vip-header-sync-stale', text: 'Not updated' }
  return null
}

function AppNav() {
  const { employee } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { override } = useHeaderOverride()
  const syncLabel = syncLabelFor(useOnlineStatus(), useSyncState())

  if (location.pathname === '/') return null

  const { title: staticTitle, sub: staticSub } = routeHeader(location.pathname)
  const title = override?.title ?? staticTitle
  const sub = override?.sub ?? staticSub
  const showBack = !TAB_ROUTES.has(location.pathname)

  return (
    <header className="vip-header">
      <div className="vip-header-left">
        {showBack && (
          <button type="button" className="vip-iconbtn" onClick={() => navigate(-1)} aria-label="Back">
            ‹
          </button>
        )}
        <div>
          <h1 className="vip-header-title">{title}</h1>
          {sub && <div className="vip-header-sub">{sub}</div>}
        </div>
      </div>
      <div className="vip-header-right">
        {/* The live region is always present so a screen reader hears the
            label arrive; only the pill inside it comes and goes. */}
        <span role="status" aria-live="polite">
          {syncLabel && (
            <span className={syncLabel.className}>
              <span className="vip-sync-dot" />
              {syncLabel.text}
            </span>
          )}
        </span>
        <div className="vip-header-actions">
          <button type="button" className="vip-header-search" onClick={() => navigate('/search')}>
            Search leads, parties, sites
          </button>
          <Link to="/leads/new" className="vip-header-add">
            + {createActionLabel(employee?.role)}
          </Link>
          {employee && (
            <Link to="/profile" className="vip-avatar" aria-label="Profile">
              {getInitials(employee.name)}
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

export default AppNav
