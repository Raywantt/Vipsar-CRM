import { supabase } from './supabaseClient'
import { sanitizeForIlike } from './sanitizeForIlike'
import { MIN_QUERY_LENGTH } from './searchQueries'
import { fetchAllRows } from './fetchAllRows'
import { cachedQuery } from './queryCache'
import { todayISO } from './followupDates'

// The heavy, company-wide reads below go through cachedQuery (see
// src/lib/queryCache.js for the measurements that motivated it). Two effects:
// identical requests fired at the same moment collapse into one, and moving
// between the screens that share them (Dashboard / Today / My Team / Sales
// Exec Profile all call fetchLeadsForBreakdown) no longer re-downloads the
// same rows each time.
//
// A KEY MUST ENCODE EVERY ARGUMENT THAT CHANGES THE RESULT. The date-scoped
// and owner-scoped queries below build their key from their arguments for
// exactly this reason — sharing one key between two different questions
// would serve one's answer to the other. Anything unparameterised gets a
// constant key.

// RLS scopes both tables to "own data or owner role" already, so these same
// queries serve both the owner (sees everyone) and a sales exec (sees only
// their own rows) — no role branching needed here.

export function fetchActivityCounts(range) {
  return cachedQuery(`activities:counts:${range.start.toISOString()}:${range.end.toISOString()}`, () =>
    fetchAllRows(() =>
      supabase
        .from('activities')
        .select('activity_type, employee_id, employees!employee_id(name)', { count: 'exact' })
        .gte('created_at', range.start.toISOString())
        .lte('created_at', range.end.toISOString())
    )
  )
}

export function fetchNewLeadsBySource(range) {
  return cachedQuery(`leads:by-source:${range.start.toISOString()}:${range.end.toISOString()}`, () =>
    fetchAllRows(() =>
      supabase
        .from('leads')
        .select('source_type, owner_employee_id, employees!owner_employee_id(name)', { count: 'exact' })
        .gte('created_at', range.start.toISOString())
        .lte('created_at', range.end.toISOString())
    )
  )
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
      'id, external_reference_id, current_stage, source_type, order_value, quote_value, created_at, owner_employee_id, parties!party_id(name), sites(nickname, locality), employees!owner_employee_id(name)',
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
  return cachedQuery('leads:closure-forecast', () =>
    fetchAllRows(() =>
      supabase
        .from('leads')
        .select(
          'id, current_stage, quote_value, closure_probability, estimated_close_date, owner_employee_id, parties!party_id(name), employees!owner_employee_id(name)',
          { count: 'exact' }
        )
        .not('current_stage', 'in', '(won,lost)')
        .or('quote_sent.eq.true,closure_probability.not.is.null')
        .order('estimated_close_date', { ascending: true, nullsFirst: false })
    )
  )
}

// Unbounded (all leads, not date-scoped) — feeds the Stage/Area/Site Stage
// breakdown tabs, which are pipeline snapshots ("how many leads are in each
// category right now"), not "how many arrived in a period" like the Reports
// tab's cards. One query serves all three tabs since they're just different
// groupings of the same rows. Also the source for Needs Attention (see
// src/lib/attention.js) — the extra columns below are the ones that query
// needs (quote/RFQ timestamps, forecast/follow-up dates) and were the only
// reason this select didn't already carry them.
// THE single most-shared query in the app — Dashboard, Today (all four role
// variants), My Team and the Sales Exec Profile all call it on mount, which
// is why caching it is worth more than caching anything else here.
export function fetchLeadsForBreakdown() {
  return cachedQuery('leads:breakdown', () =>
    fetchAllRows(() =>
      supabase
        .from('leads')
        .select(
          'id, external_reference_id, current_stage, order_value, site_id, owner_employee_id, source_type, quote_sent, quote_sent_at, rfq_raised, rfq_raised_at, quote_value, closure_probability, estimated_close_date, next_followup_date, created_at, parties!party_id(name), sites(nickname, locality, site_stage, area_id, areas(area_name)), employees!owner_employee_id(name), products!product_id(name, category)',
          { count: 'exact' }
        ),
      // speculativePages is DELIBERATELY NOT USED HERE — see the row-count
      // note in fetchAllRows.js. The premise ("this table is known to
      // exceed one page") is only ever true for the OWNER: under RLS a
      // sales executive sees ~86 leads and a coordinator their team's, so
      // for every other role the extra page is a request that cannot
      // possibly return a row. Measured live on a real exec session
      // (2026-09-07): it is not the free wasted request the option assumed
      // — the exact count is ~1s of this query's ~2.4s, and the duplicate
      // ran the full 8s to Supabase's statement_timeout inside a 19-request
      // burst, alongside the real page 0, which then timed out too. The
      // owner's measured saving was ~150-300ms; the cost to everyone else
      // was a blank Dashboard.
    )
  )
}

// Reduced client-side to one row per lead (its most recent activity) —
// powers "stale" (no activity in N days) and "silent quote" (nothing logged
// since quote_sent_at) in src/lib/attention.js. RLS on `activities` already
// scopes this to "own data or owner role", same as every other activities
// query on this page.
export function fetchLastActivityPerLead() {
  return cachedQuery('activities:last-per-lead', () =>
    fetchAllRows(() =>
      supabase.from('activities').select('lead_id, created_at', { count: 'exact' }).not('lead_id', 'is', null)
    )
  )
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
  return fetchAllRows(() =>
    supabase
      .from('activities')
      .select(
        'id, notes, created_at, leads_generated, start_time, end_time, accompanied_by, leads(current_stage, parties!party_id(name)), parties!party_id(name), employees!accompanied_by(name)',
        { count: 'exact' }
      )
      .eq('employee_id', employeeId)
      .eq('activity_type', activityType)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
  )
}

// stage_history rows for leads that were ultimately decided (won or lost),
// embedding owner + order_value the same way fetchWonStageHistory does —
// powers the win-rate KPI and the `loss` kind's "lost this month" list.
// Same RLS caveat/trick as fetchStageHistoryForFunnel: a sales exec's rows on
// leads they don't own come back with `leads: null` and must be filtered out
// client-side to get "own data or owner role" scoping.
export function fetchDecidedStageHistory() {
  return cachedQuery('stage_history:decided', () =>
    fetchAllRows(
      () =>
        supabase
          .from('stage_history')
          .select('lead_id, stage, changed_at, leads(owner_employee_id, order_value)', { count: 'exact' })
          .in('stage', ['won', 'lost'])
          .order('changed_at', { ascending: false }),
      // Tie-break in the SAME direction as the sort above — consumers here
      // take the first row per key and mean the most recent one.
      { ascending: false }
    )
  )
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
  // Keyed by the DAY, not the exact timestamp — `since` moves by a few
  // milliseconds on every call, and keying on that would produce a fresh
  // cache entry every time and never hit.
  return cachedQuery(`activities:trend-8w:${since.toISOString().slice(0, 10)}`, () =>
    fetchAllRows(() =>
      supabase
        .from('activities')
        .select('activity_type, employee_id, created_at', { count: 'exact' })
        .gte('created_at', since.toISOString())
    )
  )
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
  return cachedQuery('stage_history:funnel', () =>
    fetchAllRows(
      () =>
        supabase
          .from('stage_history')
          .select('lead_id, stage, changed_at, leads(owner_employee_id)', { count: 'exact' })
          .order('changed_at', { ascending: true }),
      // speculativePages is DELIBERATELY NOT USED HERE — see the row-count
      // note in fetchAllRows.js. The premise ("this table is known to
      // exceed one page") is only ever true for the OWNER: under RLS a
      // sales executive sees ~86 leads and a coordinator their team's, so
      // for every other role the extra page is a request that cannot
      // possibly return a row. Measured live on a real exec session
      // (2026-09-07): it is not the free wasted request the option assumed
      // — the exact count is ~1s of this query's ~2.4s, and the duplicate
      // ran the full 8s to Supabase's statement_timeout inside a 19-request
      // burst, alongside the real page 0, which then timed out too. The
      // owner's measured saving was ~150-300ms; the cost to everyone else
      // was a blank Dashboard.
    )
  )
}

// Fast path for the three category-breakdown cards (area/site stage/
// product) + Pipeline by stage, added alongside
// Schema/migration_leads_category_breakdown_rpc.sql — see that file's header
// for the full reasoning and the security note on why the RPC MUST stay
// SECURITY INVOKER. Returns grouped counts/sums (~30-40 rows) instead of
// every lead in the company, so those four cards no longer have to wait on
// (or pay the transfer cost of) fetchLeadsForBreakdown() to render.
//
// `ownerIds` (optional): passed only for a sales_manager viewing their
// "Team" scope — see Dashboard.jsx's managerScope/inScope. Every other role
// passes nothing; RLS alone already scopes the underlying query correctly.
//
// FAILS SOFT, on purpose: until the migration above is actually run, calling
// this returns a PGRST202/PGRST301-shaped "function not found" error (not a
// crash) — Dashboard.jsx checks for `error` and falls back to the existing
// client-side computation over breakdownLeads, exactly as if this function
// didn't exist yet. Same shape as AuthContext's PGRST205 handling for
// employee_preferences before that migration ran.
// Needs Attention's five buckets, filtered in Postgres instead of by
// downloading every lead — see Schema/migration_needs_attention_rpc.sql.
// Returns only the leads that actually land in a bucket (~66 of 1,209 on
// live data today).
//
// `now`/`today`/the timezone offset come from the BROWSER, deliberately.
// attention.js's thresholds are decided by the viewer's own clock
// (todayISO(), Date.now()), and the database runs in UTC while the reps are
// in IST — a server-side CURRENT_DATE would disagree with the client for
// five and a half hours every night. Passing them in makes both paths agree
// by construction. See the migration's header for the full reasoning,
// including why JS parses naive timestamps and date-only strings
// differently and how the SQL reproduces that.
//
// Cache key is the DATE, not the instant: `now` moves every millisecond and
// keying on it would never hit the cache, while every threshold here is
// measured in whole days, so reusing a result computed seconds ago is exact
// for the purposes of these buckets.
//
// FAILS SOFT, same as fetchCategoryBreakdown: until the migration runs this
// returns a "function not found" error and Dashboard falls back to the
// existing client-side computeAttentionBuckets().
//
// No p_attention_days/p_stale_days/etc. passed here — every threshold param
// relies on the SQL function's own default matching this app's JS constant
// (attention.js's ATTENTION_DAYS/STALE_DAYS). That's an accepted, existing
// drift risk (see Schema/migration_needs_attention_rpc.sql), not a new one:
// retuning either constant needs the matching SQL DEFAULT changed too, in
// whichever migration most recently redefined this function
// (Schema/migration_stale_7day_tile.sql as of the p_stale_days/is_stale_7d
// addition).
export function fetchLeadsNeedingAttention() {
  const now = new Date()
  const today = todayISO()
  return cachedQuery(`leads:needs-attention:${today}`, () =>
    supabase.rpc('leads_needing_attention', {
      p_now: now.toISOString(),
      p_today: today,
      // getTimezoneOffset() returns MINUTES BEHIND UTC (-330 for IST), so
      // negate it to get the offset the SQL adds/subtracts (+330).
      p_tz_offset_minutes: -now.getTimezoneOffset(),
    })
  )
}

export function fetchCategoryBreakdown(ownerIds = null) {
  return cachedQuery(`leads:category-breakdown:${ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'}`, () =>
    supabase.rpc('leads_category_breakdown', { p_owner_ids: ownerIds })
  )
}

// The "Right now" strip's one combined headline RPC — see
// Schema/migration_time_independent_dashboard_metrics.sql and
// TIME-INDEPENDENT-METRICS-LOG.md for the design history. Returns exactly
// one row: on-hold count/value/avg-days, completeness %s, follow-up
// coverage gap, workload spread, and pipeline concentration — one round
// trip for the whole strip, per PERFORMANCE.md Rule 3.
//
// `ownerIds` (optional): same purpose and same rule as fetchCategoryBreakdown's
// own parameter above — pass a real array ONLY for a sales_manager viewing
// their My/Team scope (Dashboard.jsx's managerScope/inScope); every other
// role passes nothing, since RLS alone already scopes the underlying leads
// correctly. An empty array (a manager with zero reports, viewing "My
// team") is a real, different value from null — it means "match nobody",
// not "don't narrow" — so don't coalesce it away.
//
// p_tz_offset_minutes MUST be negated, matching fetchLeadsNeedingAttention's
// own comment on this exact point: getTimezoneOffset() returns minutes
// BEHIND UTC (-330 for IST), and the SQL side wants the offset it should
// ADD to a naive timestamp to read it as UTC (+330 for IST) — passing the
// raw value silently computes every on-hold lead's day-count 11 hours off
// (backwards, not just imprecise), which is where this file's own Milestone
// 5 log entry caught it: an earlier ad-hoc verification call in Milestone 3
// used the un-negated form by mistake. Only on_hold_avg_days is affected —
// the RPC's other fields don't depend on wall-clock time of day.
//
// Cache key buckets by day (today) since the underlying figures — the
// on-hold day-counts especially — genuinely change daily, same reasoning
// fetchLeadsNeedingAttention's own cache key already uses.
export function fetchDashboardSnapshotMetrics(ownerIds = null) {
  const now = new Date()
  const today = todayISO()
  const ownerKey = ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'
  return cachedQuery(`dashboard:snapshot:${today}:${ownerKey}`, () =>
    supabase.rpc('dashboard_snapshot_metrics', {
      p_owner_ids: ownerIds,
      p_now: now.toISOString(),
      p_tz_offset_minutes: -now.getTimezoneOffset(),
      p_top_fraction: 0.1,
    })
  )
}

// The Follow-up coverage gap chip's own drill-down (Milestone 6 panel 3) —
// row-level detail, fetched lazily only when that panel opens (per
// PERFORMANCE.md Rule 1/Rule 3), unlike dashboard_snapshot_metrics()'s own
// eager headline count. Same `ownerIds` rule as every other function here:
// a real array only for a sales_manager's own My/Team toggle, null for
// every other role.
export function fetchFollowupGapDetail(ownerIds = null) {
  const ownerKey = ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'
  return cachedQuery(`leads:followup-gap-detail:${ownerKey}`, () =>
    supabase.rpc('leads_followup_gap_detail', { p_owner_ids: ownerIds })
  )
}

// The On-Hold Pipeline chip's own drill-down (Milestone 6 panel 4) —
// row-level detail, fetched lazily only when that panel opens. Needs
// p_now/p_tz_offset_minutes for its own days_on_hold calculation, same
// negated-offset convention as fetchDashboardSnapshotMetrics/
// fetchLeadsNeedingAttention above (getTimezoneOffset() returns minutes
// BEHIND UTC; the SQL side wants the offset it should ADD to a naive
// timestamp to read it as UTC) — cache key buckets by day since that
// figure genuinely changes daily.
export function fetchOnHoldDetail(ownerIds = null) {
  const now = new Date()
  const today = todayISO()
  const ownerKey = ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'
  return cachedQuery(`leads:on-hold-detail:${today}:${ownerKey}`, () =>
    supabase.rpc('leads_on_hold_detail', {
      p_owner_ids: ownerIds,
      p_now: now.toISOString(),
      p_tz_offset_minutes: -now.getTimezoneOffset(),
    })
  )
}

// The Team Workload Balance chip's own drill-down (Milestone 6 panel 5) —
// per-employee rollup, already grouped server-side, so no row-level lead
// list and no naive-timestamp handling at all (open_lead_count/
// open_pipeline_value don't depend on wall-clock time of day). Same
// `ownerIds` rule as every other function here — always null in practice,
// since RightNowStrip's `showWorkload` prop hides this chip entirely in
// single-person scope (a manager on "My" never sees it to click), but
// threaded through anyway for consistency with every sibling fetch.
export function fetchWorkloadByOwner(ownerIds = null) {
  const ownerKey = ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'
  return cachedQuery(`leads:workload-by-owner:${ownerKey}`, () =>
    supabase.rpc('leads_workload_by_owner', { p_owner_ids: ownerIds })
  )
}

// The Lead Data Completeness chip's own drill-down (Milestone 6 panel 6,
// the last one) — per-lead field-completeness detail, fetched lazily only
// when the panel opens. No naive-timestamp handling needed, same as
// fetchWorkloadByOwner — completeness_pct/has_* are computed from present-
// vs-absent column values, not from any date.
export function fetchCompletenessDetail(ownerIds = null) {
  const ownerKey = ownerIds ? [...ownerIds].sort((a, b) => a - b).join(',') : 'all'
  return cachedQuery(`leads:completeness-detail:${ownerKey}`, () =>
    supabase.rpc('leads_completeness_detail', { p_owner_ids: ownerIds })
  )
}

// loss_reasons SELECT is owner-only (see Schema/rls_policies.sql) — a sales
// exec's query returns zero rows, full stop, so this is only ever called
// for the owner (see LossReasonsCard's isOwner gate in Dashboard.jsx). The
// embedded `leads` fields are only needed for the `loss` drill-down's
// "lost this month" list (party/owner/value) — LossReasonsCard's compact
// view still only reads reason/competitor_name.
export function fetchLossReasons() {
  return cachedQuery('loss_reasons:all', () =>
    fetchAllRows(() =>
      supabase
        .from('loss_reasons')
        .select(
          // current_stage is embedded so the caller can drop rows whose lead
          // has since been REOPENED — see Dashboard.jsx's filter and
          // DECISIONS.md's Phase 9 ruling. loss_reasons is append-only, so the
          // row survives the reopening and the table alone cannot tell you
          // whether the lead is still lost.
          'id, lead_id, reason, competitor_name, lost_at, leads(current_stage, order_value, quote_value, owner_employee_id, parties!party_id(name), employees!owner_employee_id(name))',
          { count: 'exact' }
        )
    )
  )
}
