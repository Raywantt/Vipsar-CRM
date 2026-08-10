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
}

// Order is deliberate: it's the order these appear in every dropdown, running
// from the most common assignment to the least.
export const ROLE_OPTIONS = [
  { value: ROLES.SALES_EXECUTIVE, label: 'Sales Executive' },
  { value: ROLES.SALES_COORDINATOR, label: 'Sales Coordinator' },
  { value: ROLES.OWNER, label: 'Owner' },
]

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
