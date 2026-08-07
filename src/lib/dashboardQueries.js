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
// exec; the owner passes filters to narrow further, or omits them for
// everyone. All five facets are plain top-level `leads` columns, so they're
// applied server-side (before the 100-row cap) rather than client-side —
// unlike the free-text party/site search in LeadsListCard.jsx, which stays
// client-side over the fetched page, same precedent as Search.jsx's own
// "no embedded-relation ILIKE filtering" rule.
export function fetchLeadsList(filters = {}) {
  const { employeeId, stage, source, status, minValue, maxValue } = filters

  let query = supabase
    .from('leads')
    .select(
      'id, current_stage, source_type, order_value, quote_value, created_at, owner_employee_id, parties!party_id(name), sites(nickname, locality), employees!owner_employee_id(name)'
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (employeeId) query = query.eq('owner_employee_id', employeeId)
  if (stage) query = query.eq('current_stage', stage)
  if (source) query = query.eq('source_type', source)
  // "Active" mirrors fetchClosureForecast's own not-won-not-lost filter;
  // "Inactive" is literally the complement (won or lost) — a lead has no
  // third state.
  if (status === 'active') query = query.not('current_stage', 'in', '(won,lost)')
  if (status === 'inactive') query = query.in('current_stage', ['won', 'lost'])
  if (minValue != null) query = query.gte('quote_value', minValue)
  if (maxValue != null) query = query.lte('quote_value', maxValue)

  return query
}

// Not scoped to a date range — this is a snapshot of the current pipeline,
// not tied to when leads were created.
export function fetchClosureForecast() {
  return supabase
    .from('leads')
    .select(
      'id, current_stage, quote_value, closure_probability, estimated_close_date, owner_employee_id, parties!party_id(name), employees!owner_employee_id(name)'
    )
    .not('current_stage', 'in', '(won,lost)')
    .or('quote_sent.eq.true,closure_probability.not.is.null')
    .order('estimated_close_date', { ascending: true, nullsFirst: false })
}

// Unbounded (all leads, not date-scoped) — feeds the Stage/Area/Site Stage
// breakdown tabs, which are pipeline snapshots ("how many leads are in each
// category right now"), not "how many arrived in a period" like the Reports
// tab's cards. One query serves all three tabs since they're just different
// groupings of the same rows. Also the source for Needs Attention (see
// src/lib/attention.js) — the extra columns below are the ones that query
// needs (quote/RFQ timestamps, forecast/follow-up dates) and were the only
// reason this select didn't already carry them.
export function fetchLeadsForBreakdown() {
  return supabase
    .from('leads')
    .select(
      'id, current_stage, order_value, site_id, owner_employee_id, source_type, quote_sent, quote_sent_at, rfq_raised, rfq_raised_at, quote_value, closure_probability, estimated_close_date, next_followup_date, created_at, parties!party_id(name), sites(nickname, locality, site_stage, area_id, areas(area_name)), employees!owner_employee_id(name), products!product_id(name, category)'
    )
}

// Reduced client-side to one row per lead (its most recent activity) —
// powers "stale" (no activity in N days) and "silent quote" (nothing logged
// since quote_sent_at) in src/lib/attention.js. RLS on `activities` already
// scopes this to "own data or owner role", same as every other activities
// query on this page.
export function fetchLastActivityPerLead() {
  return supabase.from('activities').select('lead_id, created_at').not('lead_id', 'is', null)
}

// One exec + one activity type's real logged entries, most recent first —
// powers the drill-down `log` kind (rhythm bars + the entry list itself are
// both derived from these same rows client-side, no second query). Capped at
// 60 days back, which comfortably covers the "last 20 working days" rhythm
// window plus room to spare. `employees!accompanied_by(name)` mirrors the
// embed LeadActivityTimeline already uses for the same column.
export function fetchActivityLogForExec(employeeId, activityType) {
  const since = new Date()
  since.setDate(since.getDate() - 60)
  return supabase
    .from('activities')
    .select(
      'id, notes, created_at, leads_generated, accompanied_by, leads(current_stage, parties!party_id(name)), parties!party_id(name), employees!accompanied_by(name)'
    )
    .eq('employee_id', employeeId)
    .eq('activity_type', activityType)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
}

// stage_history rows for leads that were ultimately decided (won or lost),
// embedding owner + order_value the same way fetchWonStageHistory does —
// powers the win-rate KPI and the `loss` kind's "lost this month" list.
// Same RLS caveat/trick as fetchStageHistoryForFunnel: a sales exec's rows on
// leads they don't own come back with `leads: null` and must be filtered out
// client-side to get "own data or owner role" scoping.
export function fetchDecidedStageHistory() {
  return supabase
    .from('stage_history')
    .select('lead_id, stage, changed_at, leads(owner_employee_id, order_value)')
    .in('stage', ['won', 'lost'])
    .order('changed_at', { ascending: false })
}

// One 8-week-back window of activities, used only to slice into 8 weekly
// buckets for the KPI row's sparklines (src/components/KpiSparkRow.jsx) —
// a single wider fetch instead of one query per KPI per bucket. Order-value
// and win-rate sparklines reuse fetchWonStageHistory/fetchDecidedStageHistory
// directly (both already unbounded), so only activities needs a dedicated
// bounded fetch here.
export function fetchActivitiesTrendWindow() {
  const since = new Date()
  since.setDate(since.getDate() - 56)
  return supabase
    .from('activities')
    .select('activity_type, employee_id, created_at')
    .gte('created_at', since.toISOString())
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
// for the owner (see LossReasonsCard's isOwner gate in Dashboard.jsx). The
// embedded `leads` fields are only needed for the `loss` drill-down's
// "lost this month" list (party/owner/value) — LossReasonsCard's compact
// view still only reads reason/competitor_name.
export function fetchLossReasons() {
  return supabase
    .from('loss_reasons')
    .select(
      'id, lead_id, reason, competitor_name, lost_at, leads(order_value, quote_value, parties!party_id(name), employees!owner_employee_id(name))'
    )
}
