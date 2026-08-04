// Role-keyed Home screen shortcuts. Adding a new role later is a new key
// here, not a rewrite of Home.jsx — see CLAUDE.md's Home screen section.
export const HOME_TILES = {
  sales_executive: [
    { to: '/leads/new', label: 'New Lead', desc: 'Capture a new prospect' },
    { to: '/activity', label: 'Activity Log', desc: 'Log a site visit, call, RFQ, or update' },
    { to: '/dashboard', label: 'Dashboard', desc: 'Reports, leads, and parties' },
    { to: '/dashboard?tab=leads', label: 'All Leads', desc: 'Browse, search, filter' },
  ],
  owner: [
    { to: '/leads/new', label: 'New Lead', desc: 'Capture a new prospect' },
    { to: '/dashboard', label: 'Dashboard', desc: 'Reports, leads, and parties' },
    { to: '/dashboard?tab=leads', label: 'All Leads', desc: 'Browse, search, filter' },
  ],
}
