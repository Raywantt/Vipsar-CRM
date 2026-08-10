import { useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import { roleLabel } from '../lib/roles'
import { IconActivity, IconGrid, IconHome, IconList, IconPlus, IconSearch, IconTeam } from './NavIcons'
import FabSheet from './FabSheet'

function tabClass({ isActive }) {
  return isActive ? 'vip-active' : undefined
}

// Extra destinations only appear once BottomNav becomes the desktop sidebar
// (see .vip-nav-extra in vipsar-theme.css) — on a phone they stay reachable
// via Home's tiles instead, same as before.
function extraTabClass({ isActive }) {
  return isActive ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
}

function BottomNav() {
  const { employee } = useAuth()
  const location = useLocation()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Dashboard and All Leads both resolve to pathname "/dashboard" — plain
  // NavLink matching ignores the query string entirely, so both used to
  // light up together regardless of ?tab=. Compare the tab param directly
  // instead so only one is ever active.
  // Capability flags, not `role !== 'owner'`. That older shorthand meant
  // "everyone who isn't an owner is a rep", which Phase 8's sales_coordinator
  // broke: a coordinator was shown the Activity Log link and the FAB's Log
  // Activity row, both of which route to /activity — a sales_executive-only
  // route that bounces them straight back to Home. A coordinator owns no
  // leads or activities of their own, so neither entry point applies.
  // Creating records on a team member's behalf is a Phase 4 flow with its own
  // exec picker; until that exists the coordinator gets no FAB at all rather
  // than one opening a sheet with nothing usable in it.
  const canLogActivity = employee?.role === 'sales_executive'
  const canCreateOwnLead = employee?.role === 'sales_executive' || employee?.role === 'owner'
  const showFab = canLogActivity || canCreateOwnLead

  const onLeadsTab = location.pathname === '/dashboard' && new URLSearchParams(location.search).get('tab') === 'leads'
  const dashboardClass = !onLeadsTab && location.pathname === '/dashboard' ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
  const leadsClass = onLeadsTab ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
  const leadsMobileClass = onLeadsTab ? 'vip-mobile-tab vip-active' : 'vip-mobile-tab'
  const dashboardMobileClass = !onLeadsTab && location.pathname === '/dashboard' ? 'vip-mobile-tab vip-active' : 'vip-mobile-tab'

  return (
    <>
      <nav className="vip-bottom-nav">
        <div className="vip-sidebar-brand">
          <div className="vip-sidebar-mark">V</div>
          <div className="vip-sidebar-word">VIPSAR</div>
        </div>

        <NavLink to="/" end className={tabClass} title="Today">
          <IconHome />
          <span className="vip-nav-label">Today</span>
        </NavLink>

        {/* Mobile-only primary tabs (4 tabs + FAB — design_handoff_vipsar_mobile
            README's Navigation section) placed right after Home so they sit
            before the desktop-only extras below in DOM order — since both are
            hidden at the opposite breakpoint (.vip-mobile-tab hidden ≥1024px,
            .vip-nav-extra hidden below it), neither disturbs the other's flex
            layout, so the desktop sidebar's existing link order (unchanged
            below) needed no reshuffling to make room for these. */}
        <Link to="/dashboard?tab=leads" className={leadsMobileClass} title="Leads">
          <IconList />
          <span className="vip-nav-label">Leads</span>
        </Link>
        {/* The slot itself stays even when the button doesn't — it's the
            reserved 76px gap the four tabs are laid out around, so removing it
            would reflow the whole bar for a coordinator. */}
        <div className="vip-fab-slot">
          {showFab && (
            <button type="button" className="vip-fab" onClick={() => setSheetOpen(true)} aria-label="Add">
              <IconPlus className="vip-fab-icon" />
            </button>
          )}
        </div>
        <Link to="/dashboard" className={dashboardMobileClass} title="Dashboard">
          <IconGrid />
          <span className="vip-nav-label">Dashboard</span>
        </Link>

        {canCreateOwnLead && (
          <NavLink to="/leads/new" className={extraTabClass} title="New Lead">
            <IconPlus />
            <span className="vip-nav-label">New Lead</span>
          </NavLink>
        )}
        {canLogActivity && (
          <NavLink to="/activity" className={extraTabClass} title="Activity Log">
            <IconActivity />
            <span className="vip-nav-label">Activity Log</span>
          </NavLink>
        )}
        <Link to="/dashboard" className={dashboardClass} title="Dashboard">
          <IconGrid />
          <span className="vip-nav-label">Dashboard</span>
        </Link>
        {/* Reports/All leads used to be an in-page tab row on the Dashboard
            itself — moved here so it's reachable without it (see
            Dashboard.jsx's activeTab, now driven purely by ?tab= instead of
            buttons). Parties used to have its own tab/link here too — folded
            into Search instead, see Search.jsx. Both use a manually computed
            active class (above), not NavLink's own matching, since NavLink
            ignores the query string and would light up both links at once. */}
        <Link to="/dashboard?tab=leads" className={leadsClass} title="All Leads">
          <IconList />
          <span className="vip-nav-label">All Leads</span>
        </Link>
        {employee?.role === 'owner' && (
          <NavLink to="/team" className={extraTabClass} title="My Team">
            <IconTeam />
            <span className="vip-nav-label">My Team</span>
          </NavLink>
        )}
        <NavLink to="/search" className={tabClass} title="Search">
          <IconSearch />
          <span className="vip-nav-label">Search</span>
        </NavLink>

        <Link to="/profile" className="vip-sidebar-foot" aria-label="Profile">
          <div className="vip-avatar">{getInitials(employee?.name)}</div>
          <div className="vip-sidebar-foot-text">
            <div className="vip-sidebar-foot-name">{employee?.name}</div>
            <div className="vip-sidebar-foot-role">{roleLabel(employee?.role)}</div>
          </div>
        </Link>
      </nav>
      {sheetOpen && (
        <FabSheet canCreateLead={canCreateOwnLead} canLogActivity={canLogActivity} onClose={() => setSheetOpen(false)} />
      )}
    </>
  )
}

export default BottomNav
