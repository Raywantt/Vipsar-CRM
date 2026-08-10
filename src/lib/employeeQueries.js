import { supabase } from './supabaseClient'

export function fetchAllEmployees() {
  return supabase.from('employees').select('id, name, mobile, role, is_active').order('name')
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
    .select('id, name, mobile, role, office_location, is_active, created_at')
    .neq('role', 'owner')
    .order('name')
}

// Every active sales exec, for the profile page's ranking (blended
// attainment among peers) and for the "Reassign owner" action's option list.
export function fetchActiveSalesExecs() {
  return supabase
    .from('employees')
    .select('id, name, role, office_location, created_at')
    .eq('role', 'sales_executive')
    .eq('is_active', true)
    .order('name')
}

// Last ~N activities for one exec across every activity type, newest first
// — powers the Sales Exec Profile's own "Activity log" section (distinct
// from fetchActivityLogForExec in dashboardQueries.js, which is scoped to
// one activity type at a time for the heatmap's per-cell drill-down).
// Capped at 60 days back, same window fetchActivityLogForExec uses.
export function fetchActivityLogForEmployee(employeeId, limit = 20) {
  const since = new Date()
  since.setDate(since.getDate() - 60)
  return supabase
    .from('activities')
    .select(
      'id, activity_type, notes, created_at, lead_id, leads(parties!party_id(name), sites(nickname, locality))'
    )
    .eq('employee_id', employeeId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
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
    .select('id, name, mobile, role, is_active')
    .single()
}

export function updateEmployeeRole(id, role) {
  return supabase
    .from('employees')
    .update({ role })
    .eq('id', id)
    .select('id, name, mobile, role, is_active')
    .single()
}

export function updateEmployeeActive(id, isActive) {
  return supabase
    .from('employees')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id, name, mobile, role, is_active')
    .single()
}

export function updateEmployeeMobile(id, mobile) {
  return supabase
    .from('employees')
    .update({ mobile: mobile || null })
    .eq('id', id)
    .select('id, name, mobile, role, is_active')
    .single()
}
