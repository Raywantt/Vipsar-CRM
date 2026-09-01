import { supabase } from './supabaseClient'
import { sanitizeForIlike } from './sanitizeForIlike'

// parties SELECT is open to everyone (needed for search-before-create
// across reps), so this returns the full directory regardless of role.
// Kept only for DeletePartySection.jsx's owner-only "Delete a party" tool,
// which still downloads the whole table on mount — a smaller, rarer,
// desktop-only, owner-only admin screen than Search.jsx, and out of scope
// for this pass, but it has the exact same "full table on every mount"
// shape and is worth the same fix later. Search.jsx no longer uses this —
// see fetchRecentParties/searchParties below instead.
export function fetchAllParties() {
  return supabase.from('parties').select('id, name, party_type, mobile, city, firm_name').order('name')
}

// Columns Search.jsx's party rows need — both fetchRecentParties and
// searchParties below select exactly this, so a row from either path
// renders identically.
const SEARCH_PARTY_COLUMNS = 'id, name, party_type, mobile, city, firm_name, created_at'

// Search.jsx's default view, before any search term is typed — the
// most-recently-added parties, not the whole directory. Bounded regardless
// of how large `parties` grows. typeFilter (optional) narrows this the same
// server-side way searchParties does, so switching the Type filter with no
// search term active still shows the right slice instead of client-filtering
// an already-tiny 20-row window down to near-nothing.
export function fetchRecentParties(typeFilter, limit = 20) {
  let query = supabase.from('parties').select(SEARCH_PARTY_COLUMNS).order('created_at', { ascending: false }).limit(limit)
  if (typeFilter) query = query.eq('party_type', typeFilter)
  return query
}

// Per-search cap — same reasoning and same number as
// dashboardQueries.js's LEADS_SEARCH_LOOKUP_CAP (see that file's comment for
// the measured URL-length numbers this is sized against). A term matching
// more than this many parties is common (see RECOMMENDATIONS.md #1 — a
// common surname alone can exceed it), so the caller must check `capped`
// and tell the user rather than let a partial list look complete.
export const PARTY_SEARCH_CAP = 50

// Server-side replacement for the old "download all 300+ parties, filter
// client-side" approach — name or mobile, optionally narrowed by type, both
// applied before the cap (never after — a type filter over an
// already-truncated set would silently miss matches, the same mistake
// LeadsListCard's fix avoided). Caller is expected to gate the minimum
// query length itself (same MIN_QUERY_LENGTH convention searchQueries.js's
// searchAll and dashboardQueries.js's resolveLeadsSearchFilter both use) —
// this function assumes it's already been called with a real term.
export async function searchParties(term, typeFilter) {
  const clean = sanitizeForIlike(term.trim())
  let query = supabase
    .from('parties')
    .select(SEARCH_PARTY_COLUMNS, { count: 'exact' })
    .or(`name.ilike.%${clean}%,mobile.ilike.%${clean}%`)
    .order('name')
    .limit(PARTY_SEARCH_CAP)
  if (typeFilter) query = query.eq('party_type', typeFilter)

  const { data, error, count } = await query
  return { data: data ?? [], error, capped: (count ?? 0) > PARTY_SEARCH_CAP }
}

// Powers both of Search's party-directory derivations off one leads scan:
// "which sales exec(s) has this party worked with" (party_id/other_party_id/
// referred_by_party_id + owner_employee_id/employees(name), see
// buildEmployeeMap in Search.jsx) and "which lead is this party's most
// recent" (id/party_id/created_at, pre-sorted, see mostRecentLeadByParty
// below). Replaces fetchLeadsForPartyDirectory, which scanned the entire
// `leads` table on every mount regardless of what was actually on screen —
// this is scoped to whichever party ids are currently displayed (≤20 recent,
// ≤PARTY_SEARCH_CAP search results), so its cost tracks what's rendered
// instead of the whole company's lead history. RLS scopes leads to "own data
// or owner role" — a sales exec's query only ever returns their own leads,
// so they'll only ever see themselves in the resulting employee association,
// even if another rep has also worked with that party. Full multi-employee
// associations are only visible to the owner.
export function fetchLeadsForParties(partyIds) {
  if (!partyIds.length) return Promise.resolve({ data: [], error: null })
  const ids = partyIds.join(',')
  return supabase
    .from('leads')
    .select('id, party_id, other_party_id, referred_by_party_id, owner_employee_id, created_at, employees!owner_employee_id(name)')
    .or(`party_id.in.(${ids}),other_party_id.in.(${ids}),referred_by_party_id.in.(${ids})`)
    .order('created_at', { ascending: false })
}

// leads.party_id only — a party appears elsewhere on a lead as a referrer
// (referred_by_party_id) or the quick-capture "other" contact
// (other_party_id), but neither of those makes them "the lead", so only
// party_id counts here. Reduces a pre-sorted leads list to one row per party
// (its most recent lead) — same shape as fetchLastActivityPerLead's
// reduction. Sole consumer is Search's party directory, fed by
// fetchLeadsForParties above. (It had a dedicated `fetchLeadsByParty`
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

// A party captured on the New Lead form — the "Other's name" contact, or the
// referrer — is by definition someone connected to this lead, so it gets
// linked as a site contact outright instead of being offered as a "want to add
// them?" prompt on Lead Detail. The rep already answered that question by
// typing the person in and picking their type; asking again on the lead page
// is the same question twice. That's the exact duplication
// AdditionalContactsSection already removed from its own "+ Add contact" form
// (see ROLE_TO_PARTY_TYPE there, which runs this mapping in the other
// direction) — the intake path just kept asking until now.
//
// site_contacts.role is a CHECK list of six values, narrower than party_type,
// so this mapping is lossy on purpose: 'other' is the honest landing place for
// a type that names no particular role at a site. A firm is an organisation
// rather than a person on site, and a 'client' arriving here is never the
// lead's own client (that party is leads.party_id, shown in its own card) —
// both land there rather than being invented into something more specific.
const PARTY_TYPE_TO_CONTACT_ROLE = {
  architect: 'architect',
  builder: 'builder',
  pmc: 'project_manager',
  firm: 'other',
  client: 'other',
  other: 'other',
}

export function contactRoleForPartyType(partyType) {
  return PARTY_TYPE_TO_CONTACT_ROLE[partyType] ?? 'other'
}

// Links intake parties to a site as contacts, skipping any already linked.
// Safe to call repeatedly — Lead Detail runs it on load to heal leads captured
// before this was automatic, so it must never duplicate or overwrite.
//
// Skipping is by party_id alone, NOT (party_id, role): once someone is on the
// site the rep owns their role, and a role they corrected by hand must not be
// re-added under the derived one. (site_contacts is UNIQUE on
// (site_id, party_id, role), so re-adding would land a second row rather than
// fail — a silent duplicate, which is worse than a rejected write.)
//
// Unlike parties UPDATE, site_contacts INSERT has no "own data" narrowing —
// its policy is `current_employee_role() IS NOT NULL` — so there's no
// silent-RLS-rejection trap here and a real failure comes back as a real
// error. Returns { data, error }; data carries the embedded party so callers
// can merge straight into their own contact list without refetching.
export async function linkPartiesAsSiteContacts({ siteId, parties, alreadyLinkedPartyIds }) {
  const linked = alreadyLinkedPartyIds ?? new Set()
  const seen = new Set()
  const rows = []

  parties.forEach((party) => {
    // _isEmployee: a referrer picked as one of our own staff is not a party
    // at all (see LeadQuickCapture's isEmployeeReferrer) and has no place in
    // a table of site contacts.
    if (!party?.id || party._isEmployee || linked.has(party.id) || seen.has(party.id)) return
    seen.add(party.id)
    rows.push({ site_id: siteId, party_id: party.id, role: contactRoleForPartyType(party.party_type) })
  })

  if (rows.length === 0) return { data: [], error: null }

  return supabase.from('site_contacts').insert(rows).select('id, role, party_id, parties(name, party_type)')
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
