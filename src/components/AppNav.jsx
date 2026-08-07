import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { getInitials } from '../lib/initials'
import { TAB_ROUTES } from '../lib/tabRoutes'

// Static per-route title/sub, matched by exact path first, then by prefix
// for dynamic routes (/leads/:id). Two routes (Lead Detail, Dashboard) need
// a sub AppNav can't compute itself — those pages push it in via
// HeaderContext's override instead (see useHeaderOverride).
const ROUTE_HEADERS = {
  '/search': { title: 'Search', sub: 'Leads, parties, sites' },
  '/profile': { title: 'Profile' },
  '/dashboard': { title: 'Dashboard' },
  '/leads/new': { title: 'New lead', sub: 'Fill any one field' },
  '/activity': { title: 'Log activity' },
  '/team': { title: 'My Team', sub: 'Your sales team' },
}

function routeHeader(pathname) {
  if (ROUTE_HEADERS[pathname]) return ROUTE_HEADERS[pathname]
  if (pathname.startsWith('/leads/')) return { title: 'Lead' }
  if (pathname.startsWith('/employees/')) return { title: 'Sales Exec' }
  return { title: 'VIPSAR CRM' }
}

function AppNav() {
  const { employee } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { override } = useHeaderOverride()

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
          <div className="vip-header-title">{title}</div>
          {sub && <div className="vip-header-sub">{sub}</div>}
        </div>
      </div>
      <div className="vip-header-actions">
        <button type="button" className="vip-header-search" onClick={() => navigate('/search')}>
          Search leads, parties, sites
        </button>
        <Link to="/leads/new" className="vip-header-add">
          + New Lead
        </Link>
        {employee && (
          <Link to="/profile" className="vip-avatar" aria-label="Profile">
            {getInitials(employee.name)}
          </Link>
        )}
      </div>
    </header>
  )
}

export default AppNav
