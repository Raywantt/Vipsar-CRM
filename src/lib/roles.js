// Canonical employee-role list, kept in sync with the employees.role CHECK
// constraint (Schema/migration_sales_coordinator.sql STEP 1). Same pattern as
// activityTypes.js / leadStageOptions.js / lossReasonOptions.js: one place
// that owns the values and their human labels, so a screen can't drift into
// its own private copy.
//
// This module exists because adding the third role found the same label table
// hand-rolled in four separate files — Profile.jsx, MyTeam.jsx,
// AddEmployeeForm.jsx and ManageEmployeesSection.jsx — two of which offered
// only owner/sales_executive and would have silently kept a coordinator
// invisible or unselectable.

export const ROLES = {
  OWNER: 'owner',
  SALES_EXECUTIVE: 'sales_executive',
  SALES_COORDINATOR: 'sales_coordinator',
  SALES_MANAGER: 'sales_manager',
  // The architect-relationship role — see BDM.md (repo root). Brings leads in
  // from architects and pushes them to the owner's pool; works few leads
  // personally, so deliberately NOT in CARRIES_OWN_LEADS below.
  BDM: 'business_development_manager',
}

// Order is deliberate: it's the order these appear in every dropdown, running
// from the most common assignment to the least. Sales Manager sits next to
// Sales Executive rather than next to Sales Coordinator because that's what
// it is — a rep who also supervises. See CARRIES_OWN_LEADS below.
export const ROLE_OPTIONS = [
  { value: ROLES.SALES_EXECUTIVE, label: 'Sales Executive' },
  { value: ROLES.SALES_MANAGER, label: 'Sales Manager' },
  { value: ROLES.SALES_COORDINATOR, label: 'Sales Coordinator' },
  { value: ROLES.BDM, label: 'Business Development Manager' },
  { value: ROLES.OWNER, label: 'Owner' },
]

// The roles that personally own leads, log their own activities and carry
// personal targets. This is the distinction that actually matters in the UI —
// NOT `role === 'sales_executive'`, and NOT `role !== 'owner'`.
//
// That second shorthand ("anyone who isn't an owner is a rep") is the exact
// bug shape that cost a coordinator their desktop nav and their own dashboard
// scoping — see CLAUDE.md's Sales Coordinator section. A manager breaks the
// first shorthand the same way: they are a rep, and every screen that tested
// for the literal 'sales_executive' would leave them without the rep half of
// their job.
export const CARRIES_OWN_LEADS = [ROLES.SALES_EXECUTIVE, ROLES.SALES_MANAGER]

export function carriesOwnLeads(role) {
  return CARRIES_OWN_LEADS.includes(role)
}

export const ROLE_LABELS = ROLE_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label
  return acc
}, {})

// Falls back to the raw stored value rather than rendering nothing, matching
// how stageLabel() handles an unrecognized current_stage.
export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role ?? '—'
}

// ---- Capabilities ----
//
// ONE function per capability, read by every surface that offers it — the
// mobile FAB and the desktop sidebar, a route's allowedRoles and the link that
// leads to it. The bug this exists to prevent shipped once: BottomNav computed
// "can create a lead" twice, the two copies drifted, and a coordinator had no
// New Lead anywhere on desktop (CLAUDE.md, "every change is a role ×
// breakpoint matrix"). Every list here is explicit: a role nobody has thought
// about yet gets nothing, rather than being treated as a rep by default.

export function isBdm(role) {
  return role === ROLES.BDM
}

export function canCreateLead(role) {
  return [ROLES.SALES_EXECUTIVE, ROLES.OWNER, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER, ROLES.BDM].includes(role)
}

// What the create action is called, wherever it's offered (sidebar link, FAB
// sheet, header button). A BDM's "+ New" makes a lead OR an architect (BDM.md
// §3 Screens); everyone else's makes a lead. One function so the three
// surfaces can't name the same screen three different ways.
export function createActionLabel(role) {
  return isBdm(role) ? 'New' : 'New Lead'
}

// Owner-excluded deliberately: owners don't log field activity (CLAUDE.md's
// ActivityLog section). A BDM logs their own architect meetings.
export function canLogActivity(role) {
  return [ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER, ROLES.BDM].includes(role)
}

// Log Activity's "Who is this for?" picker — the one role that logs work in
// someone else's name. A manager logs only their own work.
export function logsActivityOnBehalf(role) {
  return role === ROLES.SALES_COORDINATOR
}

// /team — the owner's whole roster, or a manager's own reports.
export function canSeeTeamDirectory(role) {
  return role === ROLES.OWNER || role === ROLES.SALES_MANAGER
}

// /employees/:id (the Sales Exec Profile). Everyone but a BDM: the page is
// exec-shaped (targets, rank, site visits), none of which applies to them —
// the owner's ruling, 2026-09-15. EmployeeProfile itself still decides whose
// page each allowed role may open.
export function canOpenEmployeeProfiles(role) {
  return [ROLES.OWNER, ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER].includes(role)
}

// /architects — "My Architects", the BDM's own portfolio (BDM.md §7). The
// owner's company-wide view of architects is the separate Architect Network
// (Step 6), so this stays BDM-only.
export function canSeeMyArchitects(role) {
  return role === ROLES.BDM
}

// /network — Architect Network (BDM.md Step 6): every BDM's numbers and
// targets, the company-wide architect directory, and moving an architect
// between portfolios. Owner only; its mobile path is a tile on the owner's
// Dashboard, which reads this same function.
export function canSeeArchitectNetwork(role) {
  return role === ROLES.OWNER
}

// All Leads' "Download Excel" — owner only (the owner's ruling, 2026-09-22).
// The file carries every client's and architect's phone number, and once it
// is downloaded the CRM can't take it back. Desktop only, too, by the same
// ruling — LeadsListCard renders the button inside the desktop half only.
export function canExportLeads(role) {
  return role === ROLES.OWNER
}

// /architects/:id — every role (owner's ruling at Step 4: architects are
// visible company-wide, so the page is too; each role sees only the leads and
// meetings its own RLS returns). Listed explicitly, like every list here.
export function canOpenArchitectProfiles(role) {
  return [ROLES.OWNER, ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER, ROLES.BDM].includes(role)
}

// A route's allowedRoles, derived from the same capability function the nav
// link reads — so the link and the route can't disagree about who gets in.
export function rolesWith(capability) {
  return ROLE_OPTIONS.map((o) => o.value).filter(capability)
}

// A sales_executive OR a sales_manager may carry a coordinator_id —
// enforced by the validate_employee_role_assignment() trigger, mirrored here
// so the UI doesn't offer a control whose save is guaranteed to fail.
// Widened 2026-09-10 (the owner's request) to let a coordinator also
// supervise a manager, not just execs — the two roles were already
// independent peers in the hierarchy by default; this is a per-employee,
// opt-in admin choice, not a structural change to how managers work.
// coordinator_id being the SAME column, and is_my_team_member() never
// filtering by the target's role, is what makes this "just like sales
// exec": every coordinator_team_* RLS policy (leads/activities/targets/
// follow_ups/stage_history/site_contacts/parties/sites) and every UI
// consumer of fetchMyTeamExecs() (TeamTodayPanel, Dashboard's coordinator
// scoping) picks up an assigned manager automatically, with no separate
// code path. See Schema/migration_coordinator_can_manage_manager.sql.
export function canHaveCoordinator(role) {
  return role === ROLES.SALES_EXECUTIVE || role === ROLES.SALES_MANAGER
}

// Same rule, second reporting line: only a sales_executive may carry a
// manager_id (migration_sales_manager.sql STEP 3). Deliberately its own
// function rather than an alias of canHaveCoordinator — the two lines are
// independent, and an exec may have either, both, or neither. If one rule
// ever changes, the other shouldn't silently follow it.
export function canHaveManager(role) {
  return role === ROLES.SALES_EXECUTIVE
}
