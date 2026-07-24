import { supabase } from './supabaseClient'

// parties SELECT is open to everyone (needed for search-before-create
// across reps), so this returns the full directory regardless of role.
export function fetchAllParties() {
  return supabase.from('parties').select('id, name, party_type, mobile, city, firm_name').order('name')
}

// Derives "which sales exec(s) has this party worked with" from leads that
// reference the party as party_id, other_party_id, or referred_by_party_id.
// RLS scopes leads to "own data or owner role" — a sales exec's query only
// ever returns their own leads, so they'll only ever see themselves in the
// resulting association, even if another rep has also worked with that
// party. Full multi-employee associations are only visible to the owner.
export function fetchPartyEmployeeLinks() {
  return supabase
    .from('leads')
    .select('party_id, other_party_id, referred_by_party_id, owner_employee_id, employees!owner_employee_id(name)')
}
