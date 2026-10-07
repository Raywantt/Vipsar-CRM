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
  // The two back-office roles that sit after a sales exec's RFQ — see
  // RFQ-DESK.md (repo root). The Production Executive checks an RFQ against
  // Lixil's technical limits; the Estimation Executive raises it with Lixil
  // and records the quote. Neither owns leads, so neither is in
  // CARRIES_OWN_LEADS. Their queues aren't built yet (RFQ-DESK.md Steps 4–5):
  // until they are, both get a "being set up" Today, Search, a read-only Lead
  // Detail and Profile, nothing else (isRfqDeskRole).
  PRODUCTION_EXECUTIVE: 'production_executive',
  ESTIMATION_EXECUTIVE: 'estimation_executive',
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
  { value: ROLES.PRODUCTION_EXECUTIVE, label: 'Production Executive' },
  { value: ROLES.ESTIMATION_EXECUTIVE, label: 'Estimation Executive' },
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

// Either of the two RFQ-desk roles (RFQ-DESK.md).
export function isRfqDeskRole(role) {
  return role === ROLES.PRODUCTION_EXECUTIVE || role === ROLES.ESTIMATION_EXECUTIVE
}

// The sales screens. They used to be open to EVERY role, which was only true
// while every role was a sales role. The Dashboard stays sales-only by design:
// it would list every exec at zero to the RFQ desk. Lead Detail opened to the
// desk at RFQ-DESK.md Step 2 and is read-only for them (LeadDetail.jsx). Their
// RLS (desk_select → desk_lead_ids()) reaches only the leads IN THEIR OWN
// PROCESS (owner's ruling, 2026-10-06 — migration_rfq_desk_in_process.sql):
// the Production Executive, RFQs waiting at the technical check; the
// Estimation Executive, RFQs waiting for estimation or with Lixil plus open
// leads whose latest desk RFQ is a quote. Search was taken away from them the
// same day — every lead they may open is already listed on their Today.
//   canSeeSalesDashboard — /dashboard: Reports, All Leads, Follow-ups (one
//                          route), and every nav link into it
//   canSearch            — /search and its nav tab
//   canOpenLeads         — /leads/:id
const SALES_ROLES = [ROLES.OWNER, ROLES.SALES_EXECUTIVE, ROLES.SALES_COORDINATOR, ROLES.SALES_MANAGER, ROLES.BDM]
const RFQ_DESK_ROLES = [ROLES.PRODUCTION_EXECUTIVE, ROLES.ESTIMATION_EXECUTIVE]

export function canSeeSalesDashboard(role) {
  return SALES_ROLES.includes(role)
}

export function canSearch(role) {
  return SALES_ROLES.includes(role)
}

export function canOpenLeads(role) {
  return SALES_ROLES.includes(role) || RFQ_DESK_ROLES.includes(role)
}

// The RFQ desk's actions (RFQ-DESK.md §3 "The loop"). Each mirrors the role
// test inside its SQL action function (Schema/migration_rfq_desk.sql STEP 8),
// which is the real boundary — these only decide which controls are offered.
// The owner is in every one: they cover either queue when someone is on leave.
//   canReviewRfqs   — Approve / Send back at the technical check
//                     (rfq_approve, rfq_send_back from with_technical)
//   canEstimateRfqs — Send back / Raised with Lixil / Quote received / Price
//                     revision (rfq_send_back from with_estimation,
//                     rfq_raise_with_lixil, rfq_record_quote,
//                     rfq_start_price_revision)
//   canSeeRfqDesk   — the owner's RFQ Desk screen (Step 7) and its nav link
export function canReviewRfqs(role) {
  return role === ROLES.PRODUCTION_EXECUTIVE || role === ROLES.OWNER
}

export function canEstimateRfqs(role) {
  return role === ROLES.ESTIMATION_EXECUTIVE || role === ROLES.OWNER
}

export function canSeeRfqDesk(role) {
  return role === ROLES.OWNER
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

// A manager's own work can be recorded against a TEAM member's lead (owner's
// ruling, 2026-10-07): they step in on a visit or meeting when a rep needs
// help. It is still the manager's activity — employee_id is theirs, it counts
// toward their numbers — so this is NOT entry on behalf. ONE flag: Lead
// Detail's "Log activity" link and Log Activity's lead picker both read it.
export function logsActivityOnTeamLeads(role) {
  return role === ROLES.SALES_MANAGER
}

// Who reads a manager's activity on a lead that is not theirs: the lead's own
// exec, and that exec's coordinator. RLS on `activities` hides it from both (an
// exec reads only their own rows, a coordinator only their team's), so it comes
// through manager_activity_on_team_leads() instead — shown on the lead's
// timeline and counted as a touch, never counted toward their own numbers.
// The manager and the owner already read these rows through ordinary RLS.
export function seesManagerActivityOnLeads(role) {
  return role === ROLES.SALES_EXECUTIVE || role === ROLES.SALES_COORDINATOR
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

// The Follow-ups page's per-person table also lists every active BDM — owner
// only, for the same reason /network is: the owner's RLS is the only one that
// can read a BDM's reminders (nobody reports to a BDM, so no coordinator or
// manager reaches them). A coordinator's table with a BDM row would say "no
// reminders" about work they simply cannot see.
export function canSeeBdmFollowUps(role) {
  return role === ROLES.OWNER
}

// All Leads' "Download Excel". The file carries every client's and architect's
// phone number, and once it is downloaded the CRM can't take it back — so the
// owner has it by role and anyone else only when the owner has switched it on
// for that one person (employees.can_export_leads, set in Profile -> Manage
// employees; first granted to Aanchal Tripathi, 2026-10-05). No ROLE gets it
// by role alone: `granted` is that per-person switch, passed in by
// useCanExportLeads(). The same flag drives the button at both widths — the
// earlier desktop-only rule was lifted in the same ruling.
export function canExportLeads(role, granted = false) {
  return role === ROLES.OWNER || granted === true
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
