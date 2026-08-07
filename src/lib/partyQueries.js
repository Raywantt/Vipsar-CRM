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

// leads.party_id only — a party appears elsewhere on a lead as a referrer
// (referred_by_party_id) or the quick-capture "other" contact
// (other_party_id), but neither of those makes them "the lead", so only
// party_id counts here. Fetched unbounded and pre-sorted, reduced client-side
// to one row per party (its most recent lead) — same shape as
// fetchLastActivityPerLead's reduction. Powers the "lead and client are the
// same record" click-through rule for Parties/Search rows that have no
// single lead already in view.
export function fetchLeadsByParty() {
  return supabase.from('leads').select('id, party_id, created_at').order('created_at', { ascending: false })
}

export function mostRecentLeadByParty(leadsByPartyRows) {
  const map = new Map()
  leadsByPartyRows.forEach((row) => {
    if (!row.party_id) return
    if (!map.has(row.party_id)) map.set(row.party_id, row.id)
  })
  return map
}

// Owner-only in the UI (Profile's Settings section) — RLS's owner_only_delete
// policy on parties is the actual enforcement. leads.party_id/activities.party_id/
// site_contacts.party_id have no ON DELETE clause (RESTRICT), so deleting a
// party that's still linked as someone's lead/activity/site-contact fails with
// a Postgres FK-violation error — surfaced as-is, same as every other delete
// flow in this app (see DeletePartySection.jsx). Only referred_by_party_id/
// other_party_id are ON DELETE SET NULL, so a party that was only ever a
// referrer or "other" contact deletes cleanly.
export function deleteParty(id) {
  return supabase.from('parties').delete().eq('id', id)
}
