import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'

// Static per-route title/sub, matched by exact path first, then by prefix
// for dynamic routes (/leads/:id). Two routes (Lead Detail, Dashboard) need
// a sub AppNav can't compute itself — those pages push it in via
// HeaderContext's override instead (see useHeaderOverride).
const ROUTE_HEADERS = {
  '/search': { title: 'Search', sub: 'Leads, parties, sites' },
  '/account': { title: 'Account' },
  '/settings': { title: 'Settings' },
  '/dashboard': { title: 'Dashboard' },
  '/leads/new': { title: 'New lead', sub: 'Fill any one field' },
  '/activity': { title: 'Log activity' },
}

// BottomNav's own destinations — the only routes that don't get a back
// button, since they're reached by tapping a tab, not by drilling in.
const TAB_ROUTES = new Set(['/', '/search', '/account', '/settings'])

function todayLabel() {
  const d = new Date()
  const weekday = d.toLocaleDateString('en-IN', { weekday: 'short' })
  const month = d.toLocaleDateString('en-IN', { month: 'short' })
  return `${weekday} ${d.getDate()} ${month}`
}

function routeHeader(pathname) {
  if (ROUTE_HEADERS[pathname]) return ROUTE_HEADERS[pathname]
  if (pathname.startsWith('/leads/')) return { title: 'Lead' }
  return { title: 'VIPSAR CRM' }
}

function getInitials(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  return initials.toUpperCase()
}

function AppNav() {
  const { employee } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { override } = useHeaderOverride()

  const isHome = location.pathname === '/'
  const { title, sub: staticSub } = isHome
    ? { title: 'Today', sub: `${todayLabel()} · ${employee?.name ?? ''}` }
    : routeHeader(location.pathname)
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
      {employee && <div className="vip-avatar">{getInitials(employee.name)}</div>}
    </header>
  )
}

export default AppNav
