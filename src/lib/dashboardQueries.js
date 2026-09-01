import { supabase } from './supabaseClient'
import { sanitizeForIlike } from './sanitizeForIlike'
import { MIN_QUERY_LENGTH } from './searchQueries'

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

// Page size for fetchLeadsList's server-side pagination — 262 leads today,
// ~1,186 projected in 12 months (see ROW-COUNTS.md): 50 keeps a page's
// payload/render trivial (~9KB at today's ~175B/row) while keeping the page
// count sane at either volume (6 pages today, ~24 projected).
export const LEADS_PAGE_SIZE = 50

// Per-lookup cap on resolveLeadsSearchFilter below. Measured live against
// production data before picking this number: a single common letter
// ("a") resolves to 520 ids (288 parties + 225 sites + 7 employees) with no
// cap — a 2,121-char .or() string, ~3,474-char request URL. Even at the
// enforced MIN_QUERY_LENGTH of 2, a real common substring ("an") still
// resolves to 292 ids — and at ROW-COUNTS.md's 12-month projection
// (~1,603 parties, ~1,195 sites), the same match RATE projects to roughly
// 1,380 ids and an ~8.7KB URL, right at the edge of what typical proxy/
// server infra accepts by default. 50 per table (parties/sites/employees
// independently) keeps the worst case small (≤150 ids total, a few hundred
// characters) regardless of how the underlying tables grow.
const LEADS_SEARCH_LOOKUP_CAP = 50

// Resolves a free-text search term into a `.or()` filter string scoped to
// leads' own columns (party_id/site_id/owner_employee_id), by first finding
// which parties/sites/employees match the term — the same multi-step
// pattern searchQueries.js's searchAll() already uses, not embedded-relation
// ILIKE filtering (see that file's own comment: "no precedent anywhere else
// in this codebase"). Returns null for a too-short term, meaning "don't
// filter by search at all" — the caller should skip calling .or() entirely
// in that case, not pass an all-matching or all-rejecting string.
//
// Each lookup is capped at LEADS_SEARCH_LOOKUP_CAP and requests an exact
// count in the same request, so a term that matches more than the cap is
// detected (`capped: true`) without a second round trip — the caller is
// expected to tell the user results may be incomplete rather than silently
// showing a partial list as if it were the whole answer (the same "don't
// silently truncate" principle the 100-row leads cap fix above was for).
export async function resolveLeadsSearchFilter(term) {
  const clean = sanitizeForIlike((term ?? '').trim())
  if (clean.length < MIN_QUERY_LENGTH) return null

  const [partiesRes, sitesRes, employeesRes] = await Promise.all([
    supabase.from('parties').select('id', { count: 'exact' }).ilike('name', `%${clean}%`).limit(LEADS_SEARCH_LOOKUP_CAP),
    supabase
      .from('sites')
      .select('id', { count: 'exact' })
      .or(`nickname.ilike.%${clean}%,locality.ilike.%${clean}%`)
      .limit(LEADS_SEARCH_LOOKUP_CAP),
    supabase.from('employees').select('id', { count: 'exact' }).ilike('name', `%${clean}%`).limit(LEADS_SEARCH_LOOKUP_CAP),
  ])

  const partyIds = (partiesRes.data ?? []).map((p) => p.id)
  const siteIds = (sitesRes.data ?? []).map((s) => s.id)
  const employeeIds = (employeesRes.data ?? []).map((e) => e.id)

  const capped =
    (partiesRes.count ?? 0) > LEADS_SEARCH_LOOKUP_CAP ||
    (sitesRes.count ?? 0) > LEADS_SEARCH_LOOKUP_CAP ||
    (employeesRes.count ?? 0) > LEADS_SEARCH_LOOKUP_CAP

  const orParts = []
  if (partyIds.length) orParts.push(`party_id.in.(${partyIds.join(',')})`)
  if (siteIds.length) orParts.push(`site_id.in.(${siteIds.join(',')})`)
  if (employeeIds.length) orParts.push(`owner_employee_id.in.(${employeeIds.join(',')})`)

  // Term matched nothing anywhere — force zero rows rather than sending an
  // empty .or(), which PostgREST rejects outright.
  return { or: orParts.length ? orParts.join(',') : 'id.eq.-1', capped }
}

// Not scoped to a date range — a browsable list for the Leads tab, not an
// aggregate report. RLS already narrows this to "own leads" for a sales
// exec; the owner passes filters to narrow further, or omits them for
// everyone. All five facets plus `searchOr` (from resolveLeadsSearchFilter
// above) are applied server-side, before both `count` and `.range()` are
// computed — filters and search narrow the whole table first, pagination
// only ever slices what's left, never the reverse. `count: 'exact'` returns
// the true total matching everything except the range, in the same request
// (no second COUNT query). Sort is `created_at desc, id desc` — the `id`
// tiebreaker makes it fully deterministic, since two leads can share a
// `created_at` down to the second and a non-deterministic sort would
// silently duplicate or drop rows across pages.
export function fetchLeadsList(filters = {}) {
  const { employeeId, stage, source, status, minValue, maxValue, searchOr, page = 0 } = filters

  let query = supabase
    .from('leads')
    .select(
      'id, current_stage, source_type, order_value, quote_value, created_at, owner_employee_id, parties!party_id(name), sites(nickname, locality), employees!owner_employee_id(name)',
      { count: 'exact' }
    )

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
  if (searchOr) query = query.or(searchOr)

  return query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * LEADS_PAGE_SIZE, page * LEADS_PAGE_SIZE + LEADS_PAGE_SIZE - 1)
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
      'id, notes, created_at, leads_generated, start_time, end_time, accompanied_by, leads(current_stage, parties!party_id(name)), parties!party_id(name), employees!accompanied_by(name)'
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

// stage_history SELECT is scoped to "own leads or owner role" as of
// Schema/migration_scope_stage_history.sql, so a sales exec's rows come back
// pre-filtered. The embedded `leads(owner_employee_id)` null-check below is
// kept anyway — belt-and-braces if that migration hasn't been run against a
// given environment yet, same trick fetchWonStageHistory (targetQueries.js)
// relies on — drop those
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
      // current_stage is embedded so the caller can drop rows whose lead has
      // since been REOPENED — see Dashboard.jsx's filter and DECISIONS.md's
      // Phase 9 ruling. loss_reasons is append-only, so the row survives the
      // reopening and the table alone cannot tell you whether the lead is
      // still lost.
      'id, lead_id, reason, competitor_name, lost_at, leads(current_stage, order_value, quote_value, owner_employee_id, parties!party_id(name), employees!owner_employee_id(name))'
    )
}
