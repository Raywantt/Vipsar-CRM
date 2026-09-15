import { useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getInitials } from '../lib/initials'
import {
  canCreateLead as canCreateLeadFor,
  canLogActivity as canLogActivityFor,
  canSeeTeamDirectory as canSeeTeamDirectoryFor,
  canSeeMyArchitects as canSeeMyArchitectsFor,
  canSeeArchitectNetwork as canSeeArchitectNetworkFor,
  createActionLabel,
  isBdm,
  roleLabel,
} from '../lib/roles'
import { IconActivity, IconArchitect, IconBell, IconGrid, IconHome, IconList, IconPlus, IconSearch, IconTeam } from './NavIcons'
import FabSheet from './FabSheet'

function tabClass({ isActive }) {
  return isActive ? 'vip-active' : undefined
}

// Extra destinations only appear once BottomNav becomes the desktop sidebar
// (see .vip-nav-extra in vipsar-theme.css). Each needs its own mobile path,
// since a phone never renders these: New Lead and Activity Log come off the
// FAB below, Dashboard and All Leads off the 4-tab bar, My Team off a tile on
// Dashboard itself. (Home's tile grid used to serve that purpose for all of
// them — it was deleted in the Mobile redesign; don't cite it here again.)
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
  // Activity row, both of which route to /activity — at the time a
  // sales_executive-only route that bounced them straight back to Home.
  //
  // These are ONE flag per capability, deliberately — the FAB (mobile) and
  // the .vip-nav-extra sidebar links (desktop) are two renderings of the same
  // permission and must read the same boolean. They didn't, once: the FAB
  // OR'd sales_coordinator in at its own call site while the sidebar links
  // kept the older exec/owner-only flags, so a coordinator got both actions on
  // a phone and NEITHER on desktop, where the FAB is display:none (section 20)
  // and those links are the only path to /leads/new and /activity at all.
  // Don't reintroduce a per-breakpoint role check here — gate the link, not
  // the viewport.
  //
  // A coordinator qualifies for both because neither screen assumes "you own
  // what you're about to create" anymore: each carries a mandatory "Who is
  // this for?" exec picker and credits the picked exec (entry-on-behalf, see
  // CLAUDE.md's Sales Coordinator section). Both routes admit the role in
  // App.jsx to match.
  // sales_manager is on both: they do their own field work, so they need the
  // same two actions an exec has, for themselves. They do NOT get an entry-on-
  // behalf picker the way a coordinator does — a manager logs only their own
  // work (owner's ruling, 2026-09-03), so these open the ordinary self-scoped
  // forms. See CLAUDE.md's Sales Manager section.
  //
  // The rules themselves now live in src/lib/roles.js (canCreateLead,
  // canLogActivity, canSeeTeamDirectory), which App.jsx's allowedRoles also
  // derive from — so a link and the route it opens can't disagree. A business
  // development manager gets both actions (BDM.md).
  const canLogActivity = canLogActivityFor(employee?.role)
  const canCreateLead = canCreateLeadFor(employee?.role)
  const showFab = canLogActivity || canCreateLead
  // The team directory: the owner's whole roster, or a manager's own reports.
  // Declared here beside the other capability flags so the sidebar link and
  // Dashboard's mobile tile can read ONE value — the split that cost a
  // coordinator two core actions on an entire breakpoint started as exactly
  // this kind of second, separately-computed opinion.
  const canSeeTeamDirectory = canSeeTeamDirectoryFor(employee?.role)
  // My Architects (BDM only). Its mobile path is the tile at the top of the
  // BDM's Dashboard, which reads the same function.
  const canSeeMyArchitects = canSeeMyArchitectsFor(employee?.role)
  // Architect Network (owner only). Its mobile path is a tile on the owner's
  // Dashboard, which reads the same function.
  const canSeeArchitectNetwork = canSeeArchitectNetworkFor(employee?.role)
  // A BDM's list is only ever the leads they brought in, so the desktop link
  // says so. The mobile tab stays "Leads" for everyone (a four-tab bar has no
  // room for a longer label).
  const leadsNavLabel = isBdm(employee?.role) ? 'My Leads' : 'All Leads'
  // "New" for a BDM (a lead or an architect), "New Lead" for everyone else —
  // the FAB sheet reads the same value.
  const createLabel = createActionLabel(employee?.role)

  const dashTab = location.pathname === '/dashboard' ? new URLSearchParams(location.search).get('tab') : null
  const onLeadsTab = dashTab === 'leads'
  const onFollowupsTab = dashTab === 'followups'
  const onReportsTab = location.pathname === '/dashboard' && !onLeadsTab && !onFollowupsTab
  const dashboardClass = onReportsTab ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
  const leadsClass = onLeadsTab ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
  const followupsClass = onFollowupsTab ? 'vip-nav-extra vip-active' : 'vip-nav-extra'
  const leadsMobileClass = onLeadsTab ? 'vip-mobile-tab vip-active' : 'vip-mobile-tab'
  const dashboardMobileClass = onReportsTab ? 'vip-mobile-tab vip-active' : 'vip-mobile-tab'

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

        {canCreateLead && (
          <NavLink to="/leads/new" className={extraTabClass} title={createLabel}>
            <IconPlus />
            <span className="vip-nav-label">{createLabel}</span>
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
        <Link to="/dashboard?tab=leads" className={leadsClass} title={leadsNavLabel}>
          <IconList />
          <span className="vip-nav-label">{leadsNavLabel}</span>
        </Link>
        {/* Follow-ups is a Dashboard category (?tab=followups), same shape as
            All Leads. Its mobile path is the tile at the top of Dashboard —
            only four tabs fit the FAB layout, so a fifth tab isn't available.
            Every role gets it: RLS decides whose reminders come back. */}
        <Link to="/dashboard?tab=followups" className={followupsClass} title="Follow-ups">
          <IconBell />
          <span className="vip-nav-label">Follow-ups</span>
        </Link>
        {/* One capability flag read by this link, matching the route's own
            allowedRoles — not `role === 'owner'` plus a second opinion
            somewhere else. A manager sees the same directory narrowed to
            their own reports (MyTeam.jsx). Its mobile path is the tile at
            the top of Dashboard, which reads the same flag. */}
        {canSeeMyArchitects && (
          <NavLink to="/architects" end className={extraTabClass} title="My Architects">
            <IconArchitect />
            <span className="vip-nav-label">My Architects</span>
          </NavLink>
        )}
        {canSeeTeamDirectory && (
          <NavLink to="/team" className={extraTabClass} title="My Team">
            <IconTeam />
            <span className="vip-nav-label">My Team</span>
          </NavLink>
        )}
        {canSeeArchitectNetwork && (
          <NavLink to="/network" className={extraTabClass} title="Architect Network">
            <IconArchitect />
            <span className="vip-nav-label">Architect Network</span>
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
        <FabSheet
          canCreateLead={canCreateLead}
          createLabel={createLabel}
          createsArchitects={isBdm(employee?.role)}
          canLogActivity={canLogActivity}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  )
}

export default BottomNav
