import { supabase } from './supabaseClient'

// The columns every write below reads back. Shared so adding a field doesn't
// mean remembering four separate .select() strings — coordinator_id was
// exactly that kind of addition, and a row returned without it would silently
// blank the "Reports to" dropdown after a save.
const EMPLOYEE_ROW = 'id, name, mobile, role, coordinator_id, is_active'

export function fetchAllEmployees() {
  return supabase.from('employees').select(EMPLOYEE_ROW).order('name')
}

// Active sales coordinators, for the "Reports to" dropdown in Manage
// employees. Deactivated ones are excluded: assigning a team to someone whose
// database access is revoked would leave those execs effectively unsupervised
// while looking assigned.
export function fetchCoordinators() {
  return supabase
    .from('employees')
    .select('id, name')
    .eq('role', 'sales_coordinator')
    .eq('is_active', true)
    .order('name')
}

// How much data an employee is still holding — used only to warn an owner
// before changing a sales executive's role (a coordinator owns no leads or
// activities of their own, so a demotion leaves that data attributed to
// someone who is no longer a rep). head:true means these are count-only
// requests, no rows transferred.
export async function fetchEmployeeDataCounts(employeeId) {
  const [leads, activities] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('owner_employee_id', employeeId),
    supabase.from('activities').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId),
  ])
  return {
    leads: leads.count ?? 0,
    activities: activities.count ?? 0,
    error: leads.error ?? activities.error ?? null,
  }
}

// Single employee's full identity fields for EmployeeProfile — office_location
// stands in for "territory" and created_at for "with VIPSAR since" (this app
// doesn't track a real hire date; both are noted as approximations on the
// page itself, not presented as exact).
export function fetchEmployeeProfile(id) {
  return supabase
    .from('employees')
    .select('id, name, role, office_location, is_active, created_at')
    .eq('id', id)
    .single()
}

// Every non-owner employee — "my team" from the owner's perspective — for
// the My Team screen. Excludes owner rows entirely (an owner isn't part of
// their own team roster); office_location/created_at included for the same
// territory/tenure display EmployeeProfile already uses, is_active so a
// deactivated rep still shows (deactivate, never hide, matches Settings).
export function fetchTeamMembers() {
  return supabase
    .from('employees')
    .select('id, name, mobile, role, coordinator_id, office_location, is_active, created_at')
    .neq('role', 'owner')
    .order('name')
}

// Every active sales exec, for the profile page's ranking (blended
// attainment among peers) and for the "Reassign owner" action's option list.
// coordinator_id is selected so Dashboard can narrow this to one coordinator's
// own team. It has to be filtered client-side rather than in the query: RLS on
// `employees` is open to every active employee (needed for name lookups and the
// "Accompanied by" dropdown), so the database will happily return every rep
// regardless of who is asking.
export function fetchActiveSalesExecs() {
  return supabase
    .from('employees')
    .select('id, name, role, coordinator_id, office_location, created_at')
    .eq('role', 'sales_executive')
    .eq('is_active', true)
    .order('name')
}

// Last ~N activities for one exec across every activity type, newest first
// — powers the Sales Exec Profile's own "Activity log" section (distinct
// from fetchActivityLogForExec in dashboardQueries.js, which is scoped to
// one activity type at a time for the heatmap's per-cell drill-down).
// Capped at 60 days back, same window fetchActivityLogForExec uses.
// logged_by_employee_id is selected (aliased so it doesn't collide with the
// row's own employee_id embed) so the card can show "Logged by {name}
// (Sales Coordinator)" whenever a coordinator entered it on this exec's
// behalf — see migration_coordinator_entry.sql.
export function fetchActivityLogForEmployee(employeeId, limit = 20) {
  const since = new Date()
  since.setDate(since.getDate() - 60)
  return supabase
    .from('activities')
    .select(
      'id, activity_type, notes, created_at, lead_id, logged_by_employee_id, logged_by:employees!logged_by_employee_id(name, role), leads(parties!party_id(name), sites(nickname, locality))'
    )
    .eq('employee_id', employeeId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
}

// A sales_coordinator's own assigned team, for the "Who is this for?" picker
// on New Lead / Log Activity (see BottomNav's FAB — a coordinator owns no
// leads or activities of their own, so both forms need an explicit exec to
// act on behalf of). Wraps fetchActiveSalesExecs rather than a fresh query:
// employees SELECT is open to every active employee (needed for name
// lookups elsewhere), so the database can't narrow this server-side — same
// client-side coordinator_id filter Dashboard already applies, centralized
// here so a third call site doesn't reinvent it. See the Sales Coordinator
// section's "isOwner ? … : …" bug note in CLAUDE.md for why this scoping
// belongs at the fetch, not repeated per consumer.
export async function fetchMyTeamExecs(coordinatorId) {
  const { data, error } = await fetchActiveSalesExecs()
  return { data: (data ?? []).filter((e) => e.coordinator_id === coordinatorId), error }
}

// Only handles the employees-row half of "add an employee" — the Supabase
// Auth user (login credentials) still has to be created manually in the
// Supabase dashboard first, and its UUID pasted in here as authUserId.
// Creating an Auth user from the browser would need either the service_role
// key (must never be exposed client-side) or a server-side Edge Function,
// neither of which this project has — see Settings.jsx for the explanation
// shown to the owner.
export function insertEmployee({ name, mobile, role, authUserId }) {
  return supabase
    .from('employees')
    .insert({ name, mobile: mobile || null, role, auth_user_id: authUserId || null })
    .select(EMPLOYEE_ROW)
    .single()
}

// Promoting an exec MUST clear coordinator_id in the same statement.
// validate_employee_role_assignment() rejects any non-exec that still carries
// one, so `update({ role })` alone fails with "Only a sales executive can be
// assigned to a coordinator" — a confusing error for what looks like a plain
// role change. Clearing it here is correct on its own terms too: a coordinator
// or owner has nobody to report to.
export function updateEmployeeRole(id, role) {
  const patch = role === 'sales_executive' ? { role } : { role, coordinator_id: null }
  return supabase.from('employees').update(patch).eq('id', id).select(EMPLOYEE_ROW).single()
}

// coordinatorId of null unassigns. The database still has the final say on
// whether the target is really a coordinator and whether this employee is
// allowed one — see validate_employee_role_assignment().
export function updateEmployeeCoordinator(id, coordinatorId) {
  return supabase
    .from('employees')
    .update({ coordinator_id: coordinatorId || null })
    .eq('id', id)
    .select(EMPLOYEE_ROW)
    .single()
}

export function updateEmployeeActive(id, isActive) {
  return supabase.from('employees').update({ is_active: isActive }).eq('id', id).select(EMPLOYEE_ROW).single()
}

export function updateEmployeeMobile(id, mobile) {
  return supabase.from('employees').update({ mobile: mobile || null }).eq('id', id).select(EMPLOYEE_ROW).single()
}
