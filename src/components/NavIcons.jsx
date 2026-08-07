// Hand-authored line icons for BottomNav — not a library dependency (no
// lucide/feather import), just plain inline SVG, matching this project's
// "no icon library" convention while still giving each nav destination a
// glyph (see CLAUDE.md's Design system section).
function baseProps(className) {
  return {
    className,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
}

export function IconHome({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8.5v8a1 1 0 0 0 1 1h3v-4.5h2V17.5h3a1 1 0 0 0 1-1v-8" />
    </svg>
  )
}

export function IconPlus({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 6.5v7M6.5 10h7" />
    </svg>
  )
}

export function IconActivity({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <path d="M7.5 3.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v.5" />
      <rect x="4.5" y="3.5" width="11" height="14" rx="1.5" />
      <path d="M7 8h6M7 11h6M7 14h3.5" />
    </svg>
  )
}

export function IconGrid({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="3.5" width="6" height="6" rx="1.2" />
      <rect x="3.5" y="10.5" width="6" height="6" rx="1.2" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.2" />
    </svg>
  )
}

export function IconSearch({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5l-3.8-3.8" />
    </svg>
  )
}

export function IconList({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <path d="M7.5 6h9M7.5 10h9M7.5 14h9" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconUsers({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.8 16c.8-2.9 3-4.4 4.7-4.4s3.9 1.5 4.7 4.4" />
      <circle cx="14" cy="7.5" r="2.1" />
      <path d="M13 11.2c1.5.2 3 1.5 3.6 3.8" />
    </svg>
  )
}

// Three-person roster glyph for My Team — deliberately distinct from
// IconUsers (two people, already used for Parties) so the two destinations
// don't read as the same icon in the sidebar.
export function IconTeam({ className = 'vip-nav-icon', ...rest }) {
  return (
    <svg {...baseProps(className)} {...rest}>
      <circle cx="10" cy="6.2" r="2.6" />
      <path d="M5.3 15.5c.7-2.7 2.4-4.2 4.7-4.2s4 1.5 4.7 4.2" />
      <circle cx="3.6" cy="8.3" r="1.7" />
      <path d="M1.3 14.8c.5-1.7 1.5-2.7 2.5-2.9" />
      <circle cx="16.4" cy="8.3" r="1.7" />
      <path d="M18.7 14.8c-.5-1.7-1.5-2.7-2.5-2.9" />
    </svg>
  )
}
