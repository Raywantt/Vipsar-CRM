import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { PARTY_COLUMNS, attachFirms } from './partyQueries'
import { applyPoolExclusion } from './poolLeads'

// Reads behind the architect screens (BDM.md Step 4): My Architects, the
// architect profile and the BDM's Today. Shaping lives in architectStats.js.
//
// Everything here is RLS-scoped, and that is the design rather than a caveat:
// architects/firms are readable by every active employee
// (architect_firm_universal_select), but the leads and meetings around them
// come back only as far as the viewer's own access reaches — a BDM gets the
// leads they brought in and their own meetings, an owner everything.

const ARCHITECT_COLUMNS = `${PARTY_COLUMNS}, address, bdm_employee_id, bdm_since, bdm:employees!bdm_employee_id(name)`

// The BDM's portfolio: architects tagged to them.
export async function fetchPortfolioArchitects(bdmId) {
  if (!bdmId) return { data: [], error: null }
  const { data, error } = await fetchAllRows(() =>
    supabase
      .from('parties')
      .select(ARCHITECT_COLUMNS, { count: 'exact' })
      .eq('party_type', 'architect')
      .eq('bdm_employee_id', bdmId)
      .order('name')
  )
  if (error) return { data: [], error }
  return { data: await attachFirms(data ?? []), error: null }
}

// Every architect in any BDM's portfolio — Architect Network's per-BDM
// "architects to meet" counts (Step 6), split per BDM client-side.
export async function fetchAllPortfolioArchitects() {
  const { data, error } = await fetchAllRows(() =>
    supabase
      .from('parties')
      .select(ARCHITECT_COLUMNS, { count: 'exact' })
      .eq('party_type', 'architect')
      .not('bdm_employee_id', 'is', null)
      .order('name')
  )
  if (error) return { data: [], error }
  return { data: await attachFirms(data ?? []), error: null }
}

// Every architect in the company — Architect Network's directory (Step 6).
// architect_firm_universal_select makes this company-wide for every role; only
// the owner's screen asks for all of them.
export async function fetchAllArchitects() {
  const { data, error } = await fetchAllRows(() =>
    supabase.from('parties').select(ARCHITECT_COLUMNS, { count: 'exact' }).eq('party_type', 'architect').order('name')
  )
  if (error) return { data: [], error }
  return { data: await attachFirms(data ?? []), error: null }
}

// Every logged Architect Meeting that names a party, all-time. The directory
// reduces it to "last meeting" per architect; filtering on party ids instead
// would put every architect's id into the request URL, which grows with the
// directory (fetchLeadsForArchitects' `.in()` is fine for one portfolio, not
// for the whole company).
export function fetchAllArchitectMeetings() {
  return fetchAllRows(
    () =>
      supabase
        .from('activities')
        .select('id, party_id, employee_id, created_at', { count: 'exact' })
        .eq('activity_type', 'architect_meeting')
        .not('party_id', 'is', null)
        .order('created_at', { ascending: false }),
    { ascending: false }
  )
}

// Every lead with a referrer or an "other" party — the only leads an architect
// can be credited for (architectIdForLead) — for the directory's lead figures.
// Same columns as fetchLeadsForArchitects, so a directory row and that
// architect's profile reduce identical lead rows. Pool leads follow the
// app-wide rule: out of an owner's figures until assigned.
export function fetchAllArchitectLeads() {
  return fetchAllRows(
    () =>
      applyPoolExclusion(
        supabase
          .from('leads')
          .select(
            'id, created_at, current_stage, quote_value, order_value, owner_employee_id, bdm_employee_id, referred_by_party_id, other_party_id, referrer:parties!referred_by_party_id(id, party_type), other:parties!other_party_id(id, party_type)',
            { count: 'exact' }
          )
          .or('referred_by_party_id.not.is.null,other_party_id.not.is.null')
          .order('created_at', { ascending: false }),
        false
      ),
    { ascending: false }
  )
}

// Moves an architect into a BDM's portfolio, between portfolios, or out of
// them (bdmId null) — the owner only (Architect Network, Step 6). The database
// enforces all of it: bdm_parties_before_write() reverts anyone else's change,
// requires the target to be a BDM, and resets bdm_since to now() on a move, so
// the 14-day meeting clock restarts. `.select()` is load-bearing: an UPDATE
// RLS refuses matches 0 rows and would otherwise report success.
export async function updateArchitectPortfolio(architectId, bdmId) {
  const { data, error } = await supabase
    .from('parties')
    .update({ bdm_employee_id: bdmId ?? null })
    .eq('id', architectId)
    .eq('party_type', 'architect')
    .select(ARCHITECT_COLUMNS)
  if (error) return { data: null, error }
  const row = data?.[0]
  if (!row) return { data: null, error: new Error("The architect wasn't updated — only the owner can move an architect.") }
  if ((row.bdm_employee_id ?? null) !== (bdmId ?? null)) {
    return { data: null, error: new Error("The move didn't save — only the owner can change an architect's portfolio.") }
  }
  const [withFirm] = await attachFirms([row])
  return { data: withFirm, error: null }
}

// One architect (or whatever party that id turns out to be — the page says so
// rather than pretending a client is an architect).
export async function fetchArchitect(id) {
  const { data, error } = await supabase.from('parties').select(ARCHITECT_COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) return { data: null, error }
  const [withFirm] = await attachFirms([data])
  return { data: withFirm, error: null }
}

// Logged Architect Meetings with these architects, newest first. An
// Architect Meeting anchors on the architect's party (activities.party_id),
// never a lead — see ActivityLog.
export function fetchArchitectMeetings(architectIds) {
  const ids = [...new Set(architectIds ?? [])]
  if (!ids.length) return Promise.resolve({ data: [], error: null })
  return fetchAllRows(
    () =>
      supabase
        .from('activities')
        .select('id, party_id, employee_id, notes, created_at, employees!employee_id(name)', { count: 'exact' })
        .eq('activity_type', 'architect_meeting')
        .in('party_id', ids)
        .order('created_at', { ascending: false }),
    { ascending: false }
  )
}

// Leads that came through these architects — the referrer or the "other"
// party slot, whichever architectIdForLead() attributes (the same answer as
// Lead Detail's "via Architect"). Pool leads follow the app-wide rule
// (poolLeads.js): only a BDM's own screens pass includePool.
export function fetchLeadsForArchitects(architectIds, includePool = false) {
  const ids = [...new Set(architectIds ?? [])]
  if (!ids.length) return Promise.resolve({ data: [], error: null })
  const list = ids.join(',')
  return fetchAllRows(
    () =>
      applyPoolExclusion(
        supabase
          .from('leads')
          .select(
            'id, created_at, current_stage, quote_value, order_value, owner_employee_id, bdm_employee_id, referred_by_party_id, other_party_id, parties!party_id(name), sites(nickname, locality, house_no), employees!owner_employee_id(name), referrer:parties!referred_by_party_id(id, party_type), other:parties!other_party_id(id, party_type)',
            { count: 'exact' }
          )
          .or(`referred_by_party_id.in.(${list}),other_party_id.in.(${list})`)
          .order('created_at', { ascending: false }),
        includePool
      ),
    { ascending: false }
  )
}
