import { supabase } from './supabaseClient'

export function fetchAllEmployees() {
  return supabase.from('employees').select('id, name, mobile, role, is_active').order('name')
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
