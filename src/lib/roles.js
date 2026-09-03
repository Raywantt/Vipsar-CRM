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
}

// Order is deliberate: it's the order these appear in every dropdown, running
// from the most common assignment to the least. Sales Manager sits next to
// Sales Executive rather than next to Sales Coordinator because that's what
// it is — a rep who also supervises. See CARRIES_OWN_LEADS below.
export const ROLE_OPTIONS = [
  { value: ROLES.SALES_EXECUTIVE, label: 'Sales Executive' },
  { value: ROLES.SALES_MANAGER, label: 'Sales Manager' },
  { value: ROLES.SALES_COORDINATOR, label: 'Sales Coordinator' },
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

// Only a sales_executive may carry a coordinator_id — enforced by the
// validate_employee_role_assignment() trigger, mirrored here so the UI doesn't
// offer a control whose save is guaranteed to fail.
export function canHaveCoordinator(role) {
  return role === ROLES.SALES_EXECUTIVE
}

// Same rule, second reporting line: only a sales_executive may carry a
// manager_id (migration_sales_manager.sql STEP 3). Deliberately its own
// function rather than an alias of canHaveCoordinator — the two lines are
// independent, and an exec may have either, both, or neither. If one rule
// ever changes, the other shouldn't silently follow it.
export function canHaveManager(role) {
  return role === ROLES.SALES_EXECUTIVE
}
