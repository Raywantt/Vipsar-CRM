import { supabase } from './supabaseClient'

// parties SELECT is open to everyone (needed for search-before-create
// across reps), so this returns the full directory regardless of role.
export function fetchAllParties() {
  return supabase.from('parties').select('id, name, party_type, mobile, city, firm_name').order('name')
}

// Powers both of Search's party-directory derivations off one leads scan
// instead of two that only differed in selected columns: "which sales
// exec(s) has this party worked with" (party_id/other_party_id/
// referred_by_party_id + owner_employee_id/employees(name), see
// buildEmployeeMap in Search.jsx) and "which lead is this party's most
// recent" (id/party_id/created_at, pre-sorted, see mostRecentLeadByParty
// below). RLS scopes leads to "own data or owner role" — a sales exec's
// query only ever returns their own leads, so they'll only ever see
// themselves in the resulting employee association, even if another rep has
// also worked with that party. Full multi-employee associations are only
// visible to the owner.
export function fetchLeadsForPartyDirectory() {
  return supabase
    .from('leads')
    .select('id, party_id, other_party_id, referred_by_party_id, owner_employee_id, created_at, employees!owner_employee_id(name)')
    .order('created_at', { ascending: false })
}

// leads.party_id only — a party appears elsewhere on a lead as a referrer
// (referred_by_party_id) or the quick-capture "other" contact
// (other_party_id), but neither of those makes them "the lead", so only
// party_id counts here. Reduces a pre-sorted leads list to one row per party
// (its most recent lead) — same shape as fetchLastActivityPerLead's
// reduction. Sole consumer is Search's party directory, fed by
// fetchLeadsForPartyDirectory above. (It had a dedicated `fetchLeadsByParty`
// fetch of its own for FollowUpForm's old silent party-to-lead resolution;
// that form asks for a lead outright now, so the query went with it.)
export function mostRecentLeadByParty(leadsByPartyRows) {
  const map = new Map()
  leadsByPartyRows.forEach((row) => {
    if (!row.party_id) return
    if (!map.has(row.party_id)) map.set(row.party_id, row.id)
  })
  return map
}

// Columns every party picker needs. firm_party_id is the link; firm_name is
// the read-only legacy fallback for rows the backfill in
// Schema/migration_architect_firm_link.sql couldn't match to a real firm.
//
// The firm itself is resolved by attachFirms below rather than a PostgREST
// embed, deliberately. firm_party_id is a SELF-reference, which makes an embed
// ambiguous — the same FK describes both "the firm I point at" and "the
// architects pointing at me" — and both hint forms were tried and measured
// against the live API: `parties!firm_party_id` silently resolved the REVERSE
// direction (returning "firm": [] for an architect whose link was really set),
// and `parties!parties_firm_party_id_fkey` failed outright with PGRST200. Same
// reasoning searchQueries.js already documents for not filtering on embedded
// relations: two plain queries beat one fragile piece of PostgREST syntax.
export const PARTY_COLUMNS = 'id, name, mobile, party_type, firm_name, firm_party_id'

// Fills in .firm on each party from its firm_party_id, in one extra bounded
// query (callers pass at most a page of rows). A firm the caller can't SELECT
// under parties' own RLS just comes back absent, so .firm stays null and
// display falls back to firm_name — no error, no empty-looking row.
export async function attachFirms(parties) {
  const ids = [...new Set(parties.map((p) => p.firm_party_id).filter(Boolean))]
  if (ids.length === 0) return parties.map((p) => ({ ...p, firm: null }))

  const { data } = await supabase.from('parties').select('id, name, party_type').in('id', ids)
  const byId = new Map((data ?? []).map((f) => [f.id, f]))
  return parties.map((p) => ({ ...p, firm: p.firm_party_id ? byId.get(p.firm_party_id) ?? null : null }))
}

// Points an architect at the 'firm' party they work under — the one writer of
// parties.firm_party_id, shared by Log Activity, New Lead and Lead Detail's
// contacts so the three can't drift into different rules or different warning
// wording. Returns a warning string to surface, or null when all is well.
//
// Two things this deliberately handles rather than leaving to each caller:
//   - A no-op when the link already points where it should, so logging a
//     meeting with a known architect fires no write at all.
//   - The silent-RLS-rejection trap. parties UPDATE is "own data (created_by)
//     or owner role", so an architect another rep added matches ZERO rows —
//     and without .select() an RLS-rejected UPDATE returns no error, just a
//     quiet no-op. This file's own deleteParty comment and ActivityLog's
//     site-stage bug are the other two places that bit us.
export async function setPartyFirm({ partyId, partyName, firmId, currentFirmId }) {
  if ((firmId ?? null) === (currentFirmId ?? null)) return null

  const { data, error } = await supabase
    .from('parties')
    .update({ firm_party_id: firmId ?? null })
    .eq('id', partyId)
    .select('id')

  if (error) return `the firm wasn't saved: ${error.message}`
  if (!data?.length) {
    return `the firm wasn't saved — ${partyName} was added by someone else, so you can't edit that record.`
  }
  return null
}

// Turns a PartySearchOrCreate draft (deferCreate mode — see that component's
// header comment) into a real parties row. Call this once, right at a
// screen's own final commit action (Save lead, Log it, Add contact) — never
// as a side effect of picking or typing — so a party the user typed and then
// abandoned never ends up permanently in the database. A party that's
// already real (selected via search, or deferCreate was never on) passes
// through unchanged, no write at all.
export async function materializePartyDraft(party, createdByEmployeeId) {
  if (!party?._isNewPartyDraft) return { data: party }

  const { data, error } = await supabase
    .from('parties')
    .insert({
      name: party.name,
      mobile: party.mobile,
      party_type: party.party_type,
      created_by: createdByEmployeeId ?? null,
    })
    .select(PARTY_COLUMNS)
    .single()

  if (error) return { error }
  return { data: { ...data, firm: null } }
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
