import { supabase } from './supabaseClient'

// RLS scopes both tables to "own data or owner role" already, so these same
// queries serve both the owner (sees everyone) and a sales exec (sees only
// their own rows) — no role branching needed here.

export function fetchActivityCounts(range) {
  return supabase
    .from('activities')
    .select('activity_type, employee_id, employees!employee_id(name)')
    .gte('created_at', range.start.toISOString())
    .lte('created_at', range.end.toISOString())
}

export function fetchNewLeadsBySource(range) {
  return supabase
    .from('leads')
    .select('source_type, owner_employee_id, employees!owner_employee_id(name)')
    .gte('created_at', range.start.toISOString())
    .lte('created_at', range.end.toISOString())
}

// Not scoped to a date range — a browsable list for the Leads tab, not an
// aggregate report. RLS already narrows this to "own leads" for a sales
// exec; the owner passes employeeId to filter further, or omits it for
// everyone.
export function fetchLeadsList(employeeId) {
  let query = supabase
    .from('leads')
    .select(
      'id, current_stage, source_type, order_value, created_at, owner_employee_id, parties!party_id(name), sites(nickname, locality), employees!owner_employee_id(name)'
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (employeeId) {
    query = query.eq('owner_employee_id', employeeId)
  }

  return query
}

// Not scoped to a date range — this is a snapshot of the current pipeline,
// not tied to when leads were created.
export function fetchClosureForecast() {
  return supabase
    .from('leads')
    .select(
      'id, quote_value, closure_probability, estimated_close_date, parties!party_id(name), employees!owner_employee_id(name)'
    )
    .not('current_stage', 'in', '(won,lost)')
    .or('quote_sent.eq.true,closure_probability.not.is.null')
    .order('estimated_close_date', { ascending: true, nullsFirst: false })
}

// Owner-only in the UI (Settings) — RLS's owner_only_delete policy on leads
// is the actual enforcement; this just fires the DELETE.
export function deleteLead(id) {
  return supabase.from('leads').delete().eq('id', id)
}

// Unbounded (all leads, not date-scoped) — feeds the Stage/Area/Site Stage
// breakdown tabs, which are pipeline snapshots ("how many leads are in each
// category right now"), not "how many arrived in a period" like the Reports
// tab's cards. One query serves all three tabs since they're just different
// groupings of the same rows.
export function fetchLeadsForBreakdown() {
  return supabase
    .from('leads')
    .select(
      'id, current_stage, order_value, site_id, owner_employee_id, parties!party_id(name), sites(nickname, locality, site_stage, area_id, areas(area_name)), employees!owner_employee_id(name), products!product_id(name, category)'
    )
}

// stage_history SELECT is open to everyone (see Schema/rls_policies.sql) —
// unlike leads/activities, RLS itself doesn't scope this per employee. The
// embedded `leads(owner_employee_id)` comes back null for a sales exec's
// rows on leads they don't own (RLS on the embed), same trick
// fetchWonStageHistory (targetQueries.js) already relies on — drop those
// rows client-side to get the same "own data or owner role" scoping every
// other Dashboard query gets for free.
export function fetchStageHistoryForFunnel() {
  return supabase
    .from('stage_history')
    .select('lead_id, stage, changed_at, leads(owner_employee_id)')
    .order('changed_at', { ascending: true })
}

// loss_reasons SELECT is owner-only (see Schema/rls_policies.sql) — a sales
// exec's query returns zero rows, full stop, so this is only ever called
// for the owner (see LossReasonsCard's isOwner gate in Dashboard.jsx).
export function fetchLossReasons() {
  return supabase.from('loss_reasons').select('id, reason, competitor_name, lost_at')
}
