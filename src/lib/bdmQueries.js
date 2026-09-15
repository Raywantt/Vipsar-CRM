import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { cachedQuery } from './queryCache'
import { BREAKDOWN_LEAD_COLUMNS } from './dashboardQueries'
import { findPossibleDuplicates, normaliseMobile } from './poolLeads'

// Reads for the business development manager handoff loop (BDM.md Step 3):
// the owner's pool card, and the BDM's own "Handed over" / "Closed" cards.
// RLS does the scoping throughout — an owner sees every pool lead; a BDM's
// lead_owner_history / stage_history / loss_reasons reads only ever return
// rows on leads they brought in (Schema/migration_bdm_role.sql STEP 9).

// Every lead waiting in the pool, oldest first (the one waiting longest is
// the one to assign first). Uncached on purpose: this card exists to be acted
// on, and a 90-second-old copy would show a lead another owner just assigned.
//
// referrer/other ride along for "via Architect {name}" (sourcingArchitect —
// the architect can sit in either slot, since a BDM may use any source).
export function fetchPoolLeads() {
  return fetchAllRows(() =>
    supabase
      .from('leads')
      .select(
        'id, created_at, current_stage, source_type, joinery_received, owner_employee_id, bdm_employee_id, party_id, bdm:employees!bdm_employee_id(name), parties!party_id(id, name, mobile, party_type), referrer:parties!referred_by_party_id(name, party_type), other:parties!other_party_id(name, party_type), sites(nickname, locality, house_no)',
        { count: 'exact' }
      )
      .is('owner_employee_id', null)
      .not('bdm_employee_id', 'is', null)
      .order('created_at', { ascending: true })
  )
}

// How many of this BDM's leads are still waiting in the pool — the one-line
// "N of your leads are waiting for the owner to assign" on the BDM's Today.
export function countWaitingPoolLeads(bdmId) {
  return supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .is('owner_employee_id', null)
    .eq('bdm_employee_id', bdmId)
}

// The possible-duplicate hint, in two bounded queries (no embedded-relation
// filtering — same reasoning searchQueries.js documents): find client parties
// sharing a pool lead's mobile, then the leads pointing at them. Bounded by
// the pool's own size, which is small by construction.
//
// ILIKE '%<last 10 digits>' rather than equality so a legacy number stored
// as "+91 98765…" or "91…" still matches; findPossibleDuplicates then
// re-compares the normalised digits exactly, so the looser SQL match can
// never produce a false hint on its own. Resolves to a Map (see there).
export async function fetchPossibleDuplicates(poolLeads) {
  const mobiles = [
    ...new Set(
      (poolLeads ?? [])
        .filter((l) => l.parties?.party_type === 'client')
        .map((l) => normaliseMobile(l.parties.mobile))
        .filter(Boolean)
    ),
  ]
  if (!mobiles.length) return { data: new Map(), error: null }

  const { data: clients, error: clientsError } = await fetchAllRows(() =>
    supabase
      .from('parties')
      .select('id', { count: 'exact' })
      .eq('party_type', 'client')
      .or(mobiles.map((m) => `mobile.ilike.%${m}`).join(','))
  )
  if (clientsError) return { data: new Map(), error: clientsError }
  const clientIds = (clients ?? []).map((c) => c.id)
  if (!clientIds.length) return { data: new Map(), error: null }

  const { data: candidates, error } = await fetchAllRows(
    () =>
      supabase
        .from('leads')
        .select(
          'id, created_at, owner_employee_id, bdm_employee_id, parties!party_id(id, name, mobile, party_type), sites(nickname, locality, house_no), employees!owner_employee_id(name)',
          { count: 'exact' }
        )
        .in('party_id', clientIds)
        .order('created_at', { ascending: false }),
    { ascending: false }
  )
  if (error) return { data: new Map(), error }
  return { data: findPossibleDuplicates(poolLeads, candidates), error: null }
}

// "Handed over" — the first assignment of each of this BDM's pool leads
// inside the period (old_owner_id IS NULL is exactly "came out of the pool";
// a later exec-to-exec reassignment is not a handover). `range` is the
// Dashboard's own {start, end}, compared the same way every other
// period-scoped query in this app compares a naive timestamp.
//
// The embedded lead's bdm_employee_id is re-checked by the builder: RLS
// already limits a BDM to their own leads, but an owner opening a BDM screen
// in a later step must not see every BDM's rows as this one's.
export function fetchHandedOverRows(range) {
  return fetchAllRows(
    () =>
      supabase
        .from('lead_owner_history')
        .select(
          'id, lead_id, changed_at, new_owner_id, new:employees!new_owner_id(name), leads(id, bdm_employee_id, current_stage, parties!party_id(name), sites(nickname, locality, house_no))',
          { count: 'exact' }
        )
        .is('old_owner_id', null)
        .gte('changed_at', range.start.toISOString())
        .lte('changed_at', range.end.toISOString())
        .order('changed_at', { ascending: false }),
    { ascending: false }
  )
}

// Every lead this BDM brought in — in the pool, handed to an exec, or worked
// themselves — for the BDM Dashboard (Step 5): the Open pipeline tile, Pipeline
// by stage and its drill-down, the Joineries/Leads generated targets and Top 5
// architects all reduce this one array (src/lib/bdmDashboard.js).
//
// The Dashboard's own breakdown shape (so buildPipelinePanel reads it as-is)
// plus the joinery answer and both architect slots WITH names, for Top 5.
// Filtered on the tag as well as by RLS, so a later owner-side view of one BDM
// (Architect Network, Step 6) gets that BDM's leads rather than the company's.
const BDM_LEAD_COLUMNS = `${BREAKDOWN_LEAD_COLUMNS}, joinery_received, referrer:parties!referred_by_party_id(id, name, party_type), other:parties!other_party_id(id, name, party_type)`

export function fetchBdmDashboardLeads(bdmId) {
  if (!bdmId) return Promise.resolve({ data: [], error: null })
  return cachedQuery(`leads:bdm-dashboard:${bdmId}`, () =>
    fetchAllRows(() => supabase.from('leads').select(BDM_LEAD_COLUMNS, { count: 'exact' }).eq('bdm_employee_id', bdmId))
  )
}

// Every BDM-tagged lead, any BDM — the owner's Architect Network (Step 6),
// split per BDM client-side (summariseBdm). Same columns as the BDM's own
// Dashboard read, so both reduce identical rows. Pool leads included on
// purpose: "waiting in the pool" is one of the card's figures.
export function fetchAllBdmLeads() {
  return cachedQuery('leads:bdm-network', () =>
    fetchAllRows(() =>
      supabase.from('leads').select(BDM_LEAD_COLUMNS, { count: 'exact' }).not('bdm_employee_id', 'is', null)
    )
  )
}

// Every active business development manager, for Architect Network's cards,
// its portfolio filter and the profile's "move to" dropdown. A deactivated
// BDM can't still hold architects (validate_employee_role_assignment() blocks
// it), so active-only never hides a portfolio.
export function fetchActiveBdms() {
  return fetchAllRows(() =>
    supabase
      .from('employees')
      .select('id, name', { count: 'exact' })
      .eq('role', 'business_development_manager')
      .eq('is_active', true)
      .order('name')
  )
}

// These BDMs' Architect Meetings inside the period, with the party met (Top 5
// names the architect; the target counts every meeting). One BDM on their own
// Dashboard, every BDM on Architect Network.
export function fetchBdmsArchitectMeetings(bdmIds, range) {
  const ids = [...new Set(bdmIds ?? [])].filter(Boolean)
  if (!ids.length || !range) return Promise.resolve({ data: [], error: null })
  return fetchAllRows(() =>
    supabase
      .from('activities')
      .select('id, activity_type, employee_id, party_id, created_at, parties!party_id(id, name, party_type)', {
        count: 'exact',
      })
      .eq('activity_type', 'architect_meeting')
      .in('employee_id', ids)
      .gte('created_at', range.start.toISOString())
      .lte('created_at', range.end.toISOString())
  )
}

export function fetchBdmArchitectMeetings(bdmId, range) {
  return fetchBdmsArchitectMeetings([bdmId], range)
}

// "Closed" — won/lost stage changes inside the period on this BDM's leads,
// plus each lost lead's reason (a BDM may read those for their own leads —
// owner's ruling). Two queries; the builder reduces to one row per lead.
//
// `taggedOnly` (the owner's Architect Network) pushes "BDM leads only" into
// Postgres through an !inner embed — an owner's RLS returns every won/lost in
// the company, and downloading those just to drop them in the browser is what
// PERFORMANCE.md forbids. A BDM's own call leaves it off: their RLS already
// returns only their leads, and that path is verified as it stands.
export async function fetchClosedRows(range, { taggedOnly = false } = {}) {
  const leadsEmbed = taggedOnly ? 'leads!inner' : 'leads'
  const { data: stageRows, error } = await fetchAllRows(
    () => {
      let q = supabase
        .from('stage_history')
        .select(
          `id, lead_id, stage, changed_at, ${leadsEmbed}(id, bdm_employee_id, owner_employee_id, current_stage, order_value, quote_value, parties!party_id(name), sites(nickname, locality, house_no), employees!owner_employee_id(name))`,
          { count: 'exact' }
        )
        .in('stage', ['won', 'lost'])
        .gte('changed_at', range.start.toISOString())
        .lte('changed_at', range.end.toISOString())
      if (taggedOnly) q = q.not('leads.bdm_employee_id', 'is', null)
      return q.order('changed_at', { ascending: false })
    },
    { ascending: false }
  )
  if (error) return { error }

  const lostLeadIds = [...new Set((stageRows ?? []).filter((r) => r.stage === 'lost').map((r) => r.lead_id))]
  if (!lostLeadIds.length) return { data: { stageRows: stageRows ?? [], lossRows: [] }, error: null }

  const { data: lossRows, error: lossError } = await fetchAllRows(
    () =>
      supabase
        .from('loss_reasons')
        .select('id, lead_id, reason, competitor_name, lost_at', { count: 'exact' })
        .in('lead_id', lostLeadIds)
        .order('lost_at', { ascending: false }),
    { ascending: false }
  )
  // A missing reason is not worth failing the card over — the row still says
  // "Lost", just without the why.
  return { data: { stageRows: stageRows ?? [], lossRows: lossError ? [] : lossRows ?? [] }, error: null }
}
