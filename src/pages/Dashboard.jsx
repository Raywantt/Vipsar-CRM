import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import { useCachedQuery } from '../hooks/useCachedQuery'
import DateRangeSelector from '../components/DateRangeSelector'
import ActivityCountsCard from '../components/ActivityCountsCard'
import LeadsBySourceCard, { SALES_EXEC_SOURCES } from '../components/LeadsBySourceCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import PipelineByStageCard from '../components/PipelineByStageCard'
import TargetsVsActualsCard, { computeOrderValueActuals, mergeTargetRow } from '../components/TargetsVsActualsCard'
import LeadsListCard from '../components/LeadsListCard'
import FollowUpsCard from '../components/FollowUpsCard'
import LeadsByCategoryCard from '../components/LeadsByCategoryCard'
import SalesFunnelCard from '../components/SalesFunnelCard'
import LossReasonsCard from '../components/LossReasonsCard'
import NeedsAttentionCard from '../components/NeedsAttentionCard'
import KpiSparkRow from '../components/KpiSparkRow'
import RightNowStrip from '../components/RightNowStrip'
import DrilldownPanel from '../components/DrilldownPanel'
import DayReviewCard from '../components/DayReviewCard'
import { DayDateBar, DayKpiStrip } from '../components/DayReviewHeader'
import { fetchDayReview, fetchChangeLogStart } from '../lib/dayReviewQueries'
import { rescheduleFollowUp } from '../lib/followUpQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { formatClockTime } from '../lib/dbTime'
import { RANGE_LABELS, rangeForPreset, previousRangeFor } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import { formatCurrencyCompact } from '../lib/format'
import {
  computeAttentionBuckets,
  computeAttentionBucketsFromRpc,
  computeStale7Bucket,
  computeStale7BucketFromRpc,
  buildAgeingPanel,
  buildLastStageChangeByLead,
} from '../lib/attention'
import {
  countOpenPipelineLeads,
  dealValueFor,
  stageRowsFromLeads,
  sumOpenPipelineValue,
  sumOnHoldValue,
} from '../lib/pipelineValue'
import {
  buildBookedPanel,
  buildActivitiesPanel,
  shapeActivityEntry,
  shapeLeadNames,
  buildPipelinePanel,
  buildWinRatePanel,
  buildForecastPanel,
  buildMixPanel,
  buildCategoryMixPanel,
  buildLossPanel,
  buildLogPanel,
  buildFollowupGapPanel,
  buildOnHoldInsightsPanel,
  buildWorkloadPanel,
  buildCompletenessPanel,
} from '../lib/drilldownBuilders'
import {
  fetchActivityCounts,
  fetchActivityEntries,
  fetchLeadNamesByIds,
  fetchClosureForecast,
  fetchLeadsForBreakdown,
  fetchCategoryBreakdown,
  fetchLeadsNeedingAttention,
  fetchDashboardSnapshotMetrics,
  fetchFollowupGapDetail,
  fetchOnHoldDetail,
  fetchWorkloadByOwner,
  fetchCompletenessDetail,
  fetchStageHistoryForFunnel,
  fetchLossReasons,
  fetchLastActivityPerLead,
  fetchActivityLogForExec,
  fetchDecidedStageHistory,
  fetchActivitiesTrendWindow,
} from '../lib/dashboardQueries'
import { fetchDashboardPeriod } from '../lib/screenQueries'
import { fetchTargetsForPeriod, fetchWonStageHistory, deleteTarget } from '../lib/targetQueries'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { todayISO } from '../lib/followupDates'
import {
  canSeeArchitectNetwork as canSeeArchitectNetworkFor,
  canSeeTeamDirectory as canSeeTeamDirectoryFor,
} from '../lib/roles'
import { errorMessage } from '../lib/errorMessage'

// One shared empty array for "not loaded yet", so the scoped useMemos below
// don't see a fresh [] (and recompute) on every render. Never mutated.
const EMPTY = []

function siteStageCategory(lead) {
  if (!lead.site_id) return 'No site'
  return lead.sites?.site_stage || 'Not set'
}

function areaCategory(lead) {
  if (!lead.site_id) return 'No site'
  return lead.sites?.areas?.area_name ?? 'No area set'
}

function productCategory(lead) {
  return lead.products?.name ?? 'Not specified'
}

// dashboard_snapshot_metrics()'s numeric/bigint columns come back over
// PostgREST as strings (avoiding JS float precision loss, same reasoning
// fetchCategoryBreakdown's own Number(row.lead_count) coercion already
// documents) — and several of them are genuinely NULL (on_hold_avg_days
// with zero on-hold leads, workload_busiest_* with zero employees in
// scope), so this stays null rather than coercing to 0 or NaN, matching
// RightNowStrip's own "null renders as —" fallback.
function numOrNull(v) {
  return v == null ? null : Number(v)
}

function Dashboard() {
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const isOwner = employee?.role === 'owner'
  // Every drill-down builder below defaults its eyebrow to 'Company' —
  // correct for the owner (whose queries really are company-wide), but a
  // sales exec's own queries are RLS-scoped to just their own leads/
  // activities, so labeling them 'Company' implied broader visibility than
  // actually exists. See CLAUDE.md's data-isolation audit.
  // A coordinator supervises several execs but owns nothing themselves, so
  // every `isOwner ? company-wide : personal` branch on this page was wrong
  // for them in one direction or the other — labelling their team's figures
  // with their own name, or filtering the page down as if they were a rep.
  const isCoordinator = employee?.role === 'sales_coordinator'
  // A manager is BOTH a rep and a supervisor, so no single answer to
  // "do they see others' data?" is right for the whole page — it depends on
  // the My/Team switch below. seesOthersData therefore reads the switch
  // rather than the role, which is what keeps per-exec breakdowns off the
  // page while they are looking at their own numbers.
  const isManager = employee?.role === 'sales_manager'
  // Same function BottomNav's sidebar link and App.jsx's /team route read.
  const canSeeTeamDirectory = canSeeTeamDirectoryFor(employee?.role)
  // Architect Network's only mobile path — BottomNav's sidebar link reads the
  // same function (BDM.md Step 6).
  const canSeeArchitectNetwork = canSeeArchitectNetworkFor(employee?.role)
  const [searchParams] = useSearchParams()

  // No more in-page tab buttons — Reports/All leads is chosen purely by
  // ?tab=, either from Home's "All leads" tile or the sidebar's All Leads
  // link (BottomNav.jsx). Re-read on every searchParams change, not just
  // mount, since switching sidebar links while already on /dashboard
  // doesn't remount this component.
  const [activeTab, setActiveTab] = useState('reports')
  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTab(tab === 'leads' ? 'leads' : tab === 'followups' ? 'followups' : 'reports')
  }, [searchParams])

  // Reports-only data is fetched the first time Reports is actually shown, then
  // kept. ?tab=followups and ?tab=leads used to fire every Reports query too,
  // which crowded out the one query those tabs need — the manager's Follow-ups
  // tab hit a statement timeout that way. Latched rather than tied to the tab,
  // so switching back and forth doesn't refetch. Read off searchParams, not
  // activeTab, which is still 'reports' on the first render.
  const tabParam = searchParams.get('tab')
  const onReportsTab = tabParam !== 'leads' && tabParam !== 'followups'
  const [wantsReports, setWantsReports] = useState(onReportsTab)
  // The Leads tab's header sub also reads breakdownLeads.
  const [wantsBreakdown, setWantsBreakdown] = useState(tabParam !== 'followups')
  useEffect(() => {
    if (onReportsTab) setWantsReports(true)
    if (tabParam !== 'followups') setWantsBreakdown(true)
  }, [onReportsTab, tabParam])
  // Persisted across a "click into a lead/exec, then Back" round trip, reset
  // on a fresh nav-link visit — see usePersistedFilterState's own header
  // comment.
  const [preset, setPreset] = usePersistedFilterState('vip-filters:dashboard', 'preset', 'week')
  const [customStart, setCustomStart] = usePersistedFilterState('vip-filters:dashboard', 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState('vip-filters:dashboard', 'customEnd', todayISO())

  // ---- Day Review (the `today` period) ----
  // Its own date, independent of the report cards' date range: this pane
  // accepts any past day, and changing it reloads every number including
  // Tomorrow (= chosen date + 1).
  const isDayReview = preset === 'today'
  const [dayDate, setDayDate] = useState(todayISO())
  const [selectedExecId, setSelectedExecId] = useState(null)

  const range = rangeForPreset(preset, customStart, customEnd)
  // targets are keyed by week/month/quarter — 15D/Custom have no period to
  // look one up against, so Targets vs. actuals doesn't render at all for
  // them (see the featured-row layout below and CLAUDE.md's Dashboard
  // section). Reuses periodForPreset instead of re-deriving the same
  // week/month/quarter check a second way.
  //
  // ONE source for "which period is on screen", read by all three things
  // that need it: the fetch below, the render gate, and the merge of a
  // newly-saved target. These used to be three separate periodForPreset()
  // calls, which is the shape this repo has been bitten by before (a
  // capability computed twice drifting into two answers) — here the merge
  // had no notion of the displayed period at all, and silently showed next
  // week's target under the current week.
  const targetPeriod = useMemo(() => periodForPreset(preset), [preset])
  const isTargetPeriod = targetPeriod != null

  // ---- Raw fetched rows, before the manager's My/Team scope is applied ----
  // Named all* so the scoped values below can keep the plain names every card
  // and drill-down already reads.
  //
  // INSTANT OPEN (src/lib/queryClient.js, 2026-09-21): every read below is a
  // remembered query, so a repeat visit paints the last numbers this device
  // saw at once and refreshes them in the background. Each key encodes every
  // argument that changes its answer; the signed-in user is added
  // automatically. The fetch functions and their RLS scoping are unchanged —
  // each used to run from its own useEffect.

  // Activity counts + new leads for the selected range. The Day Review runs
  // its own day-scoped queries and renders none of the report cards these
  // two feed, so it skips them.
  const rangeKey = range ? `${range.start.toISOString()}~${range.end.toISOString()}` : 'none'
  const periodQuery = useCachedQuery(['dash', 'period', rangeKey], () => fetchDashboardPeriod(range), {
    enabled: wantsReports && Boolean(range) && preset !== 'today',
  })
  const allActivities = periodQuery.result?.data?.activities ?? EMPTY
  const allLeads = periodQuery.result?.data?.leads ?? EMPTY
  // "Nothing for this range yet" — remembered data counts as something.
  const loading = periodQuery.result === undefined
  const error = useMemo(
    () => (periodQuery.result?.error ? errorMessage(periodQuery.result.error) : null),
    [periodQuery.result]
  )

  const forecastQuery = useCachedQuery(['dash', 'closure-forecast'], () => fetchClosureForecast(), { enabled: wantsReports })
  const allForecast = forecastQuery.result?.data ?? EMPTY

  // Scoped once, here, rather than at each of the ~8 places `employees` is
  // consumed downstream (the Day Review table, per-exec breakdowns, every
  // attainment drill-down, the All Leads owner filter). RLS on `employees` is
  // deliberately open to any active employee, so this query returns every rep
  // in the company no matter who asks — a coordinator seeing another team's
  // reps listed as all-zero rows would be both wrong and confusing.
  //
  // Only the coordinator case is narrowed. An owner keeps the full roster, and
  // a sales exec's own consumers are already gated off per-person breakdowns
  // entirely, so neither changes behaviour here.
  const rosterQuery = useCachedQuery(['dash', 'active-execs'], fetchActiveSalesExecs)
  const allEmployees = useMemo(() => {
    const res = rosterQuery.result
    if (!res || res.error) return EMPTY
    const all = res.data ?? []
    // A manager's roster is their own reports PLUS themselves — they carry
    // a quota and work deals, so their own row has to be available for the
    // 'my' side of the switch. Which of the two the page actually shows is
    // decided by the `employees` memo below, not here.
    return employee?.role === 'sales_coordinator'
      ? all.filter((e) => e.coordinator_id === employee.id)
      : employee?.role === 'sales_manager'
      ? all.filter((e) => e.manager_id === employee.id || e.id === employee.id)
      : all
  }, [rosterQuery.result, employee?.role, employee?.id])

  // Needs Attention's five buckets, filtered server-side — see
  // Schema/migration_needs_attention_rpc.sql. Same key as the Today screens'
  // useAttentionBuckets, so the two share one remembered answer. null means
  // "not available" (not answered yet, failed, or a manager — see
  // fastAttentionRows below), in which case the original client-side
  // computeAttentionBuckets over breakdownLeads runs exactly as before.
  const attentionQuery = useCachedQuery(['attention', todayISO()], fetchLeadsNeedingAttention, { enabled: wantsReports })
  const attentionRows = attentionQuery.result && !attentionQuery.result.error ? attentionQuery.result.data : null
  // Set only when the RPC actually failed (not merely "hasn't answered
  // yet"). It gates the fetchLastActivityPerLead() query, whose sole
  // consumer is the client-side fallback — so on the normal path that
  // activities scan is never issued at all.
  const attentionRpcFailed = Boolean(attentionQuery.result?.error)

  // Fast path for the 3 category-breakdown cards + Pipeline by stage — see
  // Schema/migration_leads_category_breakdown_rpc.sql and
  // fetchCategoryBreakdown()'s own header comment. null means "not
  // available" (not answered yet, or failed) — every consumer below falls
  // back to computing the same numbers from breakdownLeads exactly as before,
  // so this is additive only and never blocks rendering. Independent of the
  // manager scope switch — the manager case doesn't use it (see
  // fastCategoryBreakdown below).
  const categoryQuery = useCachedQuery(['dash', 'category-breakdown'], () => fetchCategoryBreakdown(), { enabled: wantsReports })
  const categoryBreakdown = useMemo(() => {
    const res = categoryQuery.result
    if (!res || res.error || !res.data) return null
    const grouped = { area: [], site_stage: [], product: [], stage: [] }
    res.data.forEach((row) => {
      const bucket = grouped[row.category_group]
      // lead_count/deal_value come back over PostgREST as strings (bigint/
      // numeric, to avoid JS float precision loss) — coerce once, here,
      // rather than at every consumer.
      if (bucket) bucket.push({ category: row.category, count: Number(row.lead_count), value: Number(row.deal_value) })
    })
    return grouped
  }, [categoryQuery.result])

  const wonQuery = useCachedQuery(['dash', 'won-history'], fetchWonStageHistory, { enabled: wantsReports })
  const allWonStageHistory = wonQuery.result?.data ?? EMPTY

  // Targets live in state seeded from their query, because saving or
  // cancelling a target edits this list in place (mergeTargetRow) before the
  // refetch that follows the write re-seeds it.
  const targetsQuery = useCachedQuery(
    ['dash', 'targets', targetPeriod?.periodType ?? '-', targetPeriod?.periodValue ?? '-'],
    () => fetchTargetsForPeriod(targetPeriod),
    { enabled: wantsReports && Boolean(targetPeriod) }
  )
  const [allTargets, setTargets] = useState([])
  useEffect(() => {
    if (!targetPeriod) {
      setTargets([])
      return
    }
    const res = targetsQuery.result
    if (res && !res.error) setTargets(res.data ?? [])
  }, [targetPeriod, targetsQuery.result])

  const breakdownQuery = useCachedQuery(['dash', 'breakdown-leads'], () => fetchLeadsForBreakdown(), { enabled: wantsBreakdown })
  const allBreakdownLeads =
    breakdownQuery.result && !breakdownQuery.result.error ? breakdownQuery.result.data ?? EMPTY : EMPTY
  // fetchLeadsForBreakdown has no other "done" signal — an empty array reads the
  // same whether it is loading, failed or genuinely empty.
  const breakdownSettled = breakdownQuery.result !== undefined

  // Powers Needs Attention (src/lib/attention.js) — "no activity in N days"
  // needs each lead's most recent activity, reduced client-side from every
  // activities row rather than a second per-lead round trip.
  //
  // ONLY FETCHED WHEN THE FALLBACK WILL ACTUALLY RUN. Its one consumer is
  // computeAttentionBuckets(), which the RPC path replaces — so on the
  // normal path this whole activities scan (measured 885-3,024ms) is never
  // issued. A manager always needs it (the RPC can't honour their My/Team
  // toggle), and so does anyone whose RPC call failed. Now one row per lead
  // from last_activity_per_lead(), small enough to remember like the rest.
  const lastActivityQuery = useCachedQuery(['dash', 'last-activity-per-lead'], fetchLastActivityPerLead, {
    enabled: wantsReports && (isManager || attentionRpcFailed),
  })
  const lastActivityByLead = useMemo(() => {
    const map = new Map()
    const res = lastActivityQuery.result
    if (!res || res.error) return map
    ;(res.data ?? []).forEach((row) => {
      const existing = map.get(row.lead_id)
      if (!existing || new Date(row.created_at) > new Date(existing)) {
        map.set(row.lead_id, row.created_at)
      }
    })
    return map
  }, [lastActivityQuery.result])

  // Powers the win-rate KPI/drill-down and the `loss` kind's lost-leads list.
  const decidedQuery = useCachedQuery(['dash', 'decided-history'], () => fetchDecidedStageHistory(), { enabled: wantsReports })
  const allDecidedStageHistory = decidedQuery.result?.data ?? EMPTY

  // One 8-week-back window, sliced into weekly buckets for the KPI row's
  // sparklines (src/components/KpiSparkRow.jsx) — unbounded from the
  // selected preset on purpose, see fetchActivitiesTrendWindow's own comment.
  const trendQuery = useCachedQuery(['dash', 'activities-trend-8w', todayISO()], fetchActivitiesTrendWindow, {
    enabled: wantsReports,
  })
  const activitiesTrendWindow = trendQuery.result?.data ?? EMPTY

  const funnelQuery = useCachedQuery(['dash', 'funnel-history'], () => fetchStageHistoryForFunnel(), { enabled: wantsReports })
  const allFunnelStageHistory = funnelQuery.result?.data ?? EMPTY

  // The owner, and now a sales manager for their own team's lost deals
  // (owner's ruling, 2026-09-03). loss_reasons SELECT is genuinely
  // owner-only in RLS — the card is invisible to a coordinator, not merely
  // hidden — so this widening required a real policy,
  // manager_team_select on loss_reasons (migration_sales_manager.sql
  // STEP 6). A sales exec still fetches nothing rather than firing a
  // request the database would answer with an empty set.
  const seesLossReasons = isOwner || isManager
  const lossQuery = useCachedQuery(['dash', 'loss-reasons'], () => fetchLossReasons(), {
    enabled: wantsReports && seesLossReasons,
  })
  // COUNT ONLY CURRENTLY-LOST LEADS (owner's ruling, 2026-08-13 — Q-P1-3).
  //
  // loss_reasons is append-only: there is no DELETE grant or policy for
  // anyone, including the owner. So a lead marked lost and later reopened
  // keeps its loss reason forever, and "Why we lose" used to keep counting
  // it — which is why the card totalled higher than the `lost` count on
  // Pipeline by stage (29 rows against 26 lost leads in the Phase 9 audit
  // data). The two readings were "count every loss EVENT" and "count
  // currently-lost LEADS"; the owner chose the latter, so a recovered deal
  // stops being reported as a loss.
  //
  // Filtered HERE, once, rather than inside the card — the same array feeds
  // LossReasonsCard and buildLossPanel, so filtering at the source is what
  // guarantees the compact card and its drill-down can never disagree.
  const allLossReasons = useMemo(() => {
    const res = lossQuery.result
    if (!seesLossReasons || !res || res.error) return EMPTY
    return (res.data ?? []).filter((row) => row.leads?.current_stage === 'lost')
  }, [lossQuery.result, seesLossReasons])

  // ---- Day Review data ----
  // Everything on the Day Review reloads when the date changes — each day is
  // its own remembered answer (the same key the Today screens use for today).
  const dayQuery = useCachedQuery(['today', 'day-review', dayDate], () => fetchDayReview(dayDate), {
    enabled: wantsReports && isDayReview,
  })
  const dayData = dayQuery.result ?? null
  const dayLoading = dayQuery.isLoading
  const dayError = useMemo(
    () => (dayQuery.result?.error ? errorMessage(dayQuery.result.error) : null),
    [dayQuery.result]
  )
  const updatedAt = dayQuery.updatedAt ? formatClockTime(new Date(dayQuery.updatedAt).toISOString()) : null
  // A different day (or leaving and re-entering the Day Review) starts with
  // nobody's day sheet selected, as it always has.
  useEffect(() => {
    setSelectedExecId(null)
  }, [isDayReview, dayDate])

  // When the trail actually begins, for the day sheet's honest empty state on
  // any date before the audit trail shipped. Fetched once, not per day.
  const changeLogQuery = useCachedQuery(['dash', 'change-log-start'], () => fetchChangeLogStart(), {
    enabled: wantsReports && isDayReview,
  })
  const changeLogStart = useMemo(() => {
    const res = changeLogQuery.result
    if (!res) return null
    return res.data?.changed_at
      ? new Date(res.data.changed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : ''
  }, [changeLogQuery.result])

  const [panel, setPanel] = useState(null)
  // The Orders booked popup is held as a REQUEST, not a built panel like the
  // others: it joins the won history to the leads fetch, the slowest read on the
  // page, so a panel built at click time would freeze whatever had arrived by
  // then — no client names, no Source or Product filters, execs shown as
  // "Unassigned". Derived below from live data instead, so it fills in when the
  // leads land. undefined = closed · null = everyone · an id = opened on one
  // exec (the heatmap cell).
  const [bookedFor, setBookedFor] = useState(undefined)

  // ---- The sales manager's My / Team switch ----
  //
  // A manager is the only role whose RLS returns TWO different populations in
  // one query: their own leads (own_data_or_owner_role_*) and their team's
  // (manager_team_*). Every card on this page would otherwise silently blend
  // the two into a single figure that answers neither "how am I doing?" nor
  // "how is my team doing?". The owner chose one page-level switch over
  // per-card controls, so it is applied once, here, to the fetched rows —
  // not repeated inside twelve cards that would each have to be taught it.
  //
  // Defaults to 'my' (the owner's choice): a manager opens their Dashboard on
  // their own numbers. Deliberately NOT persisted, for the same reason the
  // Today tabs aren't — the answer was a fixed default, not "remember".
  //
  // Every filter below is an EXACT no-op for owner, coordinator and exec:
  // inScope() returns true immediately unless the viewer is a manager. That
  // is what keeps this change invisible to the three roles already in
  // production.
  const [managerScope, setManagerScope] = useState('my')

  // Who counts as "my team" — read off allEmployees, which for a manager is
  // fetched as their own reports plus themselves (see the roster effect).
  const managedIds = useMemo(
    () => new Set(allEmployees.filter((e) => e.manager_id === employee?.id).map((e) => e.id)),
    [allEmployees, employee?.id]
  )

  // The one predicate. `ownerId` is whichever column identifies whose row
  // this is — employee_id on activities/targets, owner_employee_id on leads,
  // leads.owner_employee_id on the three stage-history feeds and on
  // loss_reasons.
  const inScope = useCallback(
    (ownerId) => {
      if (!isManager) return true
      return managerScope === 'my' ? ownerId === employee?.id : managedIds.has(ownerId)
    },
    [isManager, managerScope, employee?.id, managedIds]
  )

  const employees = useMemo(
    () =>
      !isManager
        ? allEmployees
        : managerScope === 'my'
        ? allEmployees.filter((e) => e.id === employee?.id)
        : allEmployees.filter((e) => managedIds.has(e.id)),
    [allEmployees, isManager, managerScope, employee?.id, managedIds]
  )

  // All Leads' own owner scoping for a manager — RLS alone can't express
  // "my leads only" vs "my team's leads only" (a manager's `leads` SELECT is
  // legitimately own-OR-team, same reason `inScope`/`snapshotOwnerIds` exist
  // above), so LeadsListCard needs an explicit set of owner ids to restrict
  // its server-side query to. Memoized so its reference is stable across
  // renders that don't actually change the scope — LeadsListCard's fetch
  // effect depends on it, and a fresh array every render would refetch on
  // every keystroke elsewhere on the page. `null` for every non-manager
  // role, same as snapshotOwnerIds, since RLS already scopes those correctly
  // with nothing further to say. An empty array (a manager with zero
  // reports, on "Team leads") is deliberately kept as `[]`, not coalesced to
  // null — see fetchLeadsList's own handling of employeeIds.
  const leadsOwnerScopeIds = useMemo(
    () =>
      !isManager
        ? null
        : managerScope === 'my'
        ? employee?.id != null
          ? [employee.id]
          : []
        : [...managedIds],
    [isManager, managerScope, employee?.id, managedIds]
  )

  // For dashboard_snapshot_metrics()'s p_owner_ids — same rule
  // fetchCategoryBreakdown's own docstring states: a real array ONLY for a
  // sales_manager (whose My/Team toggle RLS alone can't express), null for
  // every other role, since RLS already scopes those correctly. An empty
  // array (a manager with zero reports, on "My team") is deliberately kept
  // as `[]`, not coalesced to null — it means "match nobody", a real and
  // different answer from "don't narrow at all".
  const snapshotOwnerIds = !isManager
    ? null
    : managerScope === 'my'
    ? employee?.id != null
      ? [employee.id]
      : []
    : [...managedIds]

  // The "Right now" strip's snapshot — unlike fetchCategoryBreakdown above,
  // THIS one is wired to the manager's own My/Team toggle (via
  // snapshotOwnerIds), because dashboard_snapshot_metrics() was built with a
  // real p_owner_ids parameter for exactly that purpose (see its migration's
  // own header). Keyed by that scope, so My and Team are two remembered
  // answers. null while loading/unavailable, in which case RightNowStrip's own
  // `?? '—'` fallbacks render.
  const snapshotQuery = useCachedQuery(
    ['dash', 'snapshot', snapshotOwnerIds === null ? 'all' : snapshotOwnerIds.join(',') || 'none'],
    () => fetchDashboardSnapshotMetrics(snapshotOwnerIds),
    { enabled: wantsReports }
  )
  const snapshotMetrics =
    snapshotQuery.result && !snapshotQuery.result.error ? snapshotQuery.result.data?.[0] ?? null : null

  const activities = useMemo(() => allActivities.filter((r) => inScope(r.employee_id)), [allActivities, inScope])
  const targets = useMemo(() => allTargets.filter((r) => inScope(r.employee_id)), [allTargets, inScope])
  const leads = useMemo(() => allLeads.filter((r) => inScope(r.owner_employee_id)), [allLeads, inScope])
  const forecast = useMemo(() => allForecast.filter((r) => inScope(r.owner_employee_id)), [allForecast, inScope])
  const breakdownLeads = useMemo(
    () => allBreakdownLeads.filter((r) => inScope(r.owner_employee_id)),
    [allBreakdownLeads, inScope]
  )
  // categoryBreakdown comes straight from RLS (see fetchCategoryBreakdown's
  // p_owner_ids param, unused here) — it does NOT know about a manager's
  // own My/Team toggle the way the inScope filter above does. Rather than
  // guess, the fast RPC-backed path is simply not used for a manager at
  // all; they keep the exact client-side computation from breakdownLeads
  // (already correctly scoped by inScope) that every role used before this
  // change. Every other role has no such toggle, so RLS alone is already
  // the right answer and the fast path applies normally.
  const fastCategoryBreakdown = isManager ? null : categoryBreakdown
  // Same manager caveat as fastCategoryBreakdown above: the RPC is scoped by
  // RLS alone and cannot know about a manager's own My/Team toggle, so that
  // role keeps the client-side computation (which inScope has already
  // filtered correctly). Every other role has no such toggle.
  const fastAttentionRows = isManager ? null : attentionRows
  // The three stage-history feeds and loss_reasons all carry their owner one
  // level down, on the embedded lead. A row whose embed came back null is
  // dropped — that already happens today for RLS-invisible rows (see
  // SalesFunnelCard's note), so `?.` here preserves that behaviour rather
  // than inventing a new one.
  const wonStageHistory = useMemo(
    () => allWonStageHistory.filter((r) => inScope(r.leads?.owner_employee_id)),
    [allWonStageHistory, inScope]
  )
  const decidedStageHistory = useMemo(
    () => allDecidedStageHistory.filter((r) => inScope(r.leads?.owner_employee_id)),
    [allDecidedStageHistory, inScope]
  )
  const funnelStageHistory = useMemo(
    () => allFunnelStageHistory.filter((r) => inScope(r.leads?.owner_employee_id)),
    [allFunnelStageHistory, inScope]
  )
  // Reused for the client-side attention-buckets fallback below — a stage
  // change is a touch for staleness purposes (see attention.js), and this
  // page already fetches every stage_history row for the Sales funnel card,
  // so this is a plain reduction of data already on the page, not a new
  // query.
  const lastStageChangeByLead = useMemo(
    () => buildLastStageChangeByLead(funnelStageHistory),
    [funnelStageHistory]
  )
  const lossReasons = useMemo(
    () => allLossReasons.filter((r) => inScope(r.leads?.owner_employee_id)),
    [allLossReasons, inScope]
  )

  // Declared here, below the switch, because all three now depend on it —
  // putting them up with isOwner/isCoordinator (where they used to live) read
  // managerScope before its own `const`, which is a temporal-dead-zone crash
  // rather than a wrong label.
  //
  // seesOthersData gates every per-exec breakdown on the page. For a manager
  // it follows the SWITCH, not the role: looking at their own numbers they
  // are a rep and there is nobody to break down by; looking at their team
  // they are a supervisor and the breakdowns are the point.
  const seesOthersData = isOwner || isCoordinator || (isManager && managerScope === 'team')
  // The drill-down eyebrow. 'Company' would overstate a manager's visibility
  // in either mode — they see their own leads and their own team's, never
  // the company's.
  const scopeLabel = isOwner
    ? 'Company'
    : isCoordinator
    ? 'My team'
    : isManager
    ? managerScope === 'team'
      ? 'My team'
      : employee?.name ?? 'You'
    : employee?.name ?? 'You'
  // One source for what the All Leads view is called — the page header and the
  // card's own title both read this, so they can't drift into disagreeing
  // about whose leads are on screen.
  const leadsTitle = isOwner
    ? 'All leads'
    : isCoordinator || (isManager && managerScope === 'team')
    ? 'Team leads'
    : 'My leads'


  // The Leads tab gets its own title ("My leads"/"All leads") + a live open
  // count/value sub, mirroring the mobile "Leads" screen's header — computed
  // from breakdownLeads (already fetched unbounded for the category-breakdown
  // cards below) rather than a second query.
  useEffect(() => {
    if (activeTab === 'followups') {
      setOverride({
        title: seesOthersData ? 'Team follow-ups' : 'My follow-ups',
        sub: `Reminders · ${RANGE_LABELS[preset]}`,
      })
    } else if (activeTab === 'leads') {
      const openLeads = breakdownLeads.filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'calling'))
      const value = openLeads.reduce((s, l) => s + dealValueFor(l), 0)
      setOverride({
        title: leadsTitle,
        sub: `${openLeads.length} open · ${formatCurrencyCompact(value)}`,
      })
    } else {
      setOverride({ sub: `${seesOthersData ? 'Team performance' : 'Your performance'} · ${RANGE_LABELS[preset]}` })
    }
    return () => setOverride(null)
  }, [activeTab, leadsTitle, seesOthersData, preset, breakdownLeads, setOverride])


  // A sales exec sees only their own row. Their queries are already RLS-scoped
  // to their own data, so listing the whole team would render every colleague
  // as an all-zero row — worse than not showing them at all.
  // `employees` is already narrowed to a coordinator's own team above, so this
  // gives them the same one-row-per-exec table the owner gets. A sales exec
  // still sees only themselves: their queries are RLS-scoped, so listing
  // colleagues would render every one of them as an all-zero row.
  const dayEmployees = seesOthersData ? employees : employee ? [employee] : []
  const dayIsPast = dayDate < todayISO()
  const dayRows = dayData ? buildDayRows(dayEmployees, dayData, dayIsPast) : []
  const dayTotals = buildDayTotals(dayRows)
  const dayKpis = dayData ? buildDayKpis(dayData, dayRows, dayIsPast) : []

  function openDaySheet(employeeId) {
    const target = dayEmployees.find((e) => e.id === employeeId)
    if (!target || !dayData) return
    setSelectedExecId(employeeId)
    setPanel(
      buildDaySheetPanel({
        employee: target,
        data: dayData,
        dateISO: dayDate,
        isPast: dayIsPast,
        changesUnavailable: dayData.changesUnavailable,
        changeLogStart: changeLogStart || null,
        onReschedule: rescheduleFollowUp,
      })
    )
  }

  const openPipelineValue = sumOpenPipelineValue(breakdownLeads)
  const onHoldValue = sumOnHoldValue(breakdownLeads)
  const onHoldLeadCount = breakdownLeads.filter((l) => (l.current_stage ?? 'calling') === 'on_hold').length
  const wonThisRange = range ? computeOrderValueActuals(wonStageHistory, range, false) : 0

  // Fast path (fastCategoryBreakdown's 'stage' grouping) when available;
  // falls back to the original client-side reduction over breakdownLeads
  // otherwise (migration not yet run, or a manager — see
  // fastCategoryBreakdown's own comment above). Zero-fills every
  // LEAD_STAGE_OPTIONS value either way, since the RPC only returns stages
  // that actually have at least one lead.
  const stageRows = fastCategoryBreakdown
    ? LEAD_STAGE_OPTIONS.map((stage) => {
        const entry = fastCategoryBreakdown.stage.find((r) => r.category === stage)
        return { stage, count: entry?.count ?? 0, value: entry?.value ?? 0 }
      })
    : stageRowsFromLeads(breakdownLeads)
  // Excludes on_hold too, not just won/lost — this count sits beside
  // openPipelineValue in the KPI tile, and that figure now excludes on-hold
  // leads (see sumOpenPipelineValue), so the count must match what it's
  // describing rather than tallying a broader set than the value it labels.
  const openLeadCount = countOpenPipelineLeads(breakdownLeads)

  const rangeLabel = RANGE_LABELS[preset]

  // Rebuilt whenever the data it reads changes (see bookedFor). Keyed on the
  // range's timestamps, not the object — `range` is a fresh one every render.
  const rangeStartMs = range?.start.getTime()
  const rangeEndMs = range?.end.getTime()
  const bookedPanel = useMemo(
    () =>
      bookedFor === undefined || !range
        ? null
        : buildBookedPanel({
            employees,
            targets,
            wonStageHistory,
            breakdownLeads,
            range,
            rangeLabel,
            previous: previousRangeFor(preset, range),
            scopeLabel,
            employeeId: bookedFor,
            canCancelTarget: bookedFor != null && isOwner,
            compareExecs: seesOthersData,
            leadsReady: breakdownSettled,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `range` is rebuilt every render; its two timestamps stand for it
    [bookedFor, employees, targets, wonStageHistory, breakdownLeads, breakdownSettled, rangeStartMs, rangeEndMs, rangeLabel, preset, scopeLabel, isOwner, seesOthersData]
  )
  function closePanel() {
    setPanel(null)
    setBookedFor(undefined)
  }

  // Fast path when the RPC answered; otherwise the original client-side
  // reduction over every lead, unchanged.
  const attentionBuckets = fastAttentionRows
    ? computeAttentionBucketsFromRpc(fastAttentionRows)
    : computeAttentionBuckets(breakdownLeads, lastActivityByLead, lastStageChangeByLead)
  // RightNowStrip's "Stale Leads" tile, gated on STALE_DAYS (7) — a
  // deliberately DIFFERENT, earlier number than Needs Attention's own
  // 'stale' entry inside attentionBuckets above (gated on ATTENTION_DAYS/14,
  // the Needs Attention queue threshold). Computed the same fast-vs-fallback
  // way as attentionBuckets, from the exact same underlying data — see
  // src/lib/attention.js's own header comment on computeStale7Bucket for why
  // these two used to (wrongly) show the same number.
  const stale7Bucket = fastAttentionRows
    ? computeStale7BucketFromRpc(fastAttentionRows)
    : computeStale7Bucket(breakdownLeads, lastActivityByLead, lastStageChangeByLead)
  const weightedForecastValue = forecast.reduce(
    (s, l) => s + (Number(l.quote_value ?? 0) * (l.closure_probability ?? 0)) / 100,
    0
  )
  const decidedInRange = range
    ? decidedStageHistory.filter(
        (row) => row.leads && new Date(row.changed_at) >= range.start && new Date(row.changed_at) <= range.end
      )
    : []
  const winRatePct = decidedInRange.length
    ? Math.round((decidedInRange.filter((r) => r.stage === 'won').length / decidedInRange.length) * 100)
    : null
  // SALES_EXEC_SOURCES trims this to Scanning/Walk-in for a rep, because Lixil
  // and referral leads are distributed by the owner rather than self-sourced,
  // so those rows are all zeros on a rep's own dashboard. That reasoning does
  // not extend to a coordinator: their team genuinely holds Lixil and referral
  // leads, so the trimmed list hid real data from the person supervising it.
  const sourceOptionsForRole = seesOthersData
    ? SOURCE_TYPE_OPTIONS
    : SOURCE_TYPE_OPTIONS.filter((t) => SALES_EXEC_SOURCES.includes(t.value))

  async function handleOpenLog(employeeId, activityType) {
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee || !range) return
    const { data, error: logError } = await fetchActivityLogForExec(employeeId, activityType, range.start)
    if (logError) return
    setPanel(buildLogPanel({ employee, activityType, targets, range, rangeLabel, logRows: data ?? [], canCancelTarget: isOwner }))
  }

  // The Activities logged popup — opened from the KPI tile AND from Activity
  // counts' Details, so both go through here rather than each building its own.
  // It opens at once from the rows already held; the previous period, the
  // latest entries for whichever filter is on, and the names of the
  // most-worked leads are fetched by the popup itself when it needs them (the
  // loaders), so opening it costs nothing extra. Every loader is scoped the way
  // `activities` is — the previous period through `inScope` (a manager's
  // My/Team switch), the entries through `snapshotOwnerIds` for the same
  // reason; every other role is already scoped by RLS.
  function handleOpenActivities() {
    if (!range) return
    const previousWindow = previousRangeFor(preset, range)
    setPanel(
      buildActivitiesPanel({
        activities,
        targets,
        employees,
        range,
        rangeLabel,
        scopeLabel,
        previousLabel: previousWindow.label,
        loaders: {
          loadPrevious: async () => {
            const { data, error: previousError } = await fetchActivityCounts(previousWindow.range)
            if (previousError) throw previousError
            return (data ?? []).filter((r) => inScope(r.employee_id))
          },
          loadEntries: async ({ ownerId, type }) => {
            const { data, error: entriesError } = await fetchActivityEntries(range, {
              employeeId: ownerId,
              employeeIds: snapshotOwnerIds,
              activityType: type,
            })
            if (entriesError) throw entriesError
            return (data ?? []).map(shapeActivityEntry)
          },
          loadLeadNames: async (ids) => {
            const { data, error: namesError } = await fetchLeadNamesByIds(ids)
            if (namesError) throw namesError
            return shapeLeadNames(data)
          },
        },
      })
    )
  }

  // "Cancel this target" from a heatmap cell's drill-down — `targets` DELETE
  // is owner-only in RLS (see deleteTarget's own comment), which is why the
  // option is only ever attached to a panel (buildLogPanel/
  // buildOrderValueAttainPanel/buildScanningLeadsAttainPanel) when
  // canCancelTarget/isOwner is true. Closes the panel on success so the
  // heatmap cell underneath is immediately visible reading "no target set" —
  // simpler than trying to recompute the open panel's own fields in place.
  async function handleCancelTarget(cancelTarget) {
    const { error } = await deleteTarget(cancelTarget.id)
    if (error) return { error }
    setTargets((prev) => prev.filter((t) => t.id !== cancelTarget.id))
    closePanel()
    return { error: null }
  }

  // Follow-up coverage gap's own drill-down — row-level detail, fetched
  // only when this panel actually opens (unlike the eager snapshot count
  // already shown on the chip). Milestone 6 panel 3.
  async function handleOpenFollowupGap() {
    const { data, error: gapError } = await fetchFollowupGapDetail(snapshotOwnerIds)
    if (gapError) return
    setPanel(buildFollowupGapPanel(data ?? [], scopeLabel, !seesOthersData))
  }

  // On-hold pipeline insights — Milestone 6 panel 4. Repoints the On-Hold
  // Pipeline chip here, replacing panel 1's interim connection (the generic
  // pipeline panel's "On hold" toggle position) — exactly the plan recorded
  // in that panel's own log entry, done as part of building this one
  // rather than as a separate follow-up.
  async function handleOpenOnHoldInsights() {
    const { data, error: onHoldError } = await fetchOnHoldDetail(snapshotOwnerIds)
    if (onHoldError) return
    setPanel(buildOnHoldInsightsPanel(data ?? [], scopeLabel, !seesOthersData))
  }

  // Team workload balance — Milestone 6 panel 5. No isSinglePersonScope arg,
  // unlike every sibling handler above: RightNowStrip's own `showWorkload`
  // prop already hides this chip entirely in single-person scope, so this
  // handler is simply never reachable there — nothing left for the builder
  // to gate on.
  async function handleOpenWorkload() {
    const { data, error: workloadError } = await fetchWorkloadByOwner(snapshotOwnerIds)
    if (workloadError) return
    setPanel(buildWorkloadPanel(data ?? [], scopeLabel))
  }

  // Lead data completeness — Milestone 6 panel 6, the final panel of this
  // feature. Same isSinglePersonScope arg as panels 3/4 (the owner-breakdown
  // section is meaningless for one person's own leads).
  async function handleOpenCompleteness() {
    const { data, error: completenessError } = await fetchCompletenessDetail(snapshotOwnerIds)
    if (completenessError) return
    setPanel(buildCompletenessPanel(data ?? [], scopeLabel, !seesOthersData))
  }

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <DrilldownPanel panel={bookedPanel ?? panel} onClose={closePanel} onCancelTarget={handleCancelTarget} />

      {activeTab === 'reports' && (
        <>
          {/* My Team has no mobile tab of its own (only 4 fit the FAB layout,
              see BottomNav.jsx) and Home's old tile grid — its only other
              mobile entry point — is gone (see Home.jsx's Today redesign),
              so this is now the one mobile path to it, matching the mobile
              handoff's "My Team › row in this screen's header area" note.
              Desktop keeps the sidebar link it already had, unaffected.
              Reports-only — it used to render outside this branch entirely,
              so it also showed on ?tab=leads above the lead list. */}
          {/* Follow-ups' only mobile path — the 4-tab bar is full (a fifth tab
              doesn't fit around the FAB), so this tile is to ?tab=followups
              what the My Team tile below is to /team. Every role, unlike My
              Team, since everyone has their own reminders. */}
          <Link to="/dashboard?tab=followups" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
            <div>
              <div className="vip-tile-label">{seesOthersData ? 'Team follow-ups' : 'My follow-ups'}</div>
              <div className="vip-tile-desc">Overdue, today and upcoming reminders</div>
            </div>
            <div className="vip-tile-chevron" aria-hidden="true">›</div>
          </Link>

          {/* The manager's page-level My / Team switch. Above the date range
              deliberately: it decides WHOSE numbers the whole page is about,
              which is a bigger question than which period they cover. Every
              card below reads the scoped arrays, so nothing else needs to
              know this control exists. */}
          {isManager && (
            <div className="vip-seg vip-seg-outline" role="tablist" aria-label="Whose numbers to show">
              <button
                type="button"
                role="tab"
                aria-selected={managerScope === 'my'}
                className={managerScope === 'my' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => setManagerScope('my')}
              >
                My numbers
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={managerScope === 'team'}
                className={managerScope === 'team' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                onClick={() => setManagerScope('team')}
              >
                My team
              </button>
            </div>
          )}

          {/* Same capability as BottomNav's sidebar link, not a second
              role test — this tile IS the mobile path to /team, and the two
              must open for exactly the same people or one breakpoint loses
              the screen. */}
          {canSeeTeamDirectory && (
            <Link to="/team" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
              <div>
                <div className="vip-tile-label">My Team</div>
                <div className="vip-tile-desc">{isManager ? 'Browse your reporting execs' : 'Browse your sales team'}</div>
              </div>
              <div className="vip-tile-chevron" aria-hidden="true">›</div>
            </Link>
          )}
          {canSeeArchitectNetwork && (
            <Link to="/network" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
              <div>
                <div className="vip-tile-label">Architect Network</div>
                <div className="vip-tile-desc">BDM targets and every architect</div>
              </div>
              <div className="vip-tile-chevron" aria-hidden="true">›</div>
            </Link>
          )}

          {/* "Right now" strip — point-in-time pipeline metrics with no date
              range to filter by, so they sit above the range selector rather
              than among the range-scoped cards below. Built across
              dashboard-time-independent-metrics-prompt.md's 7 milestones
              (see TIME-INDEPENDENT-METRICS-LOG.md for the full build log).
              Active/On-hold pipeline reuse REAL, already-fetched values
              (sumOpenPipelineValue/sumOnHoldValue over breakdownLeads — zero
              new query); Stale leads uses `stale7Bucket` (STALE_DAYS/7 —
              deliberately a DIFFERENT, earlier number than Needs Attention's
              own 'stale' entry inside attentionBuckets, gated on
              ATTENTION_DAYS/14 — see src/lib/attention.js's
              computeStale7Bucket). Completeness/gap/workload/concentration
              are backed by `dashboard_snapshot_metrics()`. */}
          <RightNowStrip
            showWorkload={seesOthersData}
            activeValue={openPipelineValue}
            activeLeadCount={openLeadCount}
            onHoldValue={onHoldValue}
            onHoldCount={onHoldLeadCount}
            onHoldAvgDays={numOrNull(snapshotMetrics?.on_hold_avg_days)}
            staleCount={stale7Bucket.count}
            completenessPct={numOrNull(snapshotMetrics?.completeness_pct)}
            gapCount={numOrNull(snapshotMetrics?.followup_gap_count)}
            gapPct={numOrNull(snapshotMetrics?.followup_gap_pct)}
            workloadBusiestName={snapshotMetrics?.workload_busiest_name ?? null}
            workloadBusiestCount={numOrNull(snapshotMetrics?.workload_busiest_count)}
            workloadLightestName={snapshotMetrics?.workload_lightest_name ?? null}
            workloadLightestCount={numOrNull(snapshotMetrics?.workload_lightest_count)}
            concentrationPct={numOrNull(snapshotMetrics?.concentration_pct)}
            onOpenActive={() =>
              setPanel(buildPipelinePanel({ breakdownLeads, funnelStageHistory, scopeLabel, showListFilters: seesOthersData }))
            }
            // Repointed at the real On-hold pipeline insights panel
            // (Milestone 6 panel 4) — this used to open the generic
            // pipeline panel's "On hold" toggle position as an interim
            // stand-in (panel 1's own note); that toggle position still
            // exists inside buildPipelinePanel for anyone who reaches it
            // via the Active Pipeline chip's own toggle, but this chip now
            // goes straight to the richer, purpose-built view.
            onOpenOnHold={handleOpenOnHoldInsights}
            // Opens the STALE_DAYS(7) bucket, not Needs Attention's
            // ATTENTION_DAYS(14) 'stale' entry — the count and its
            // drill-down must show the same set of leads, so this has to
            // read `stale7Bucket` too, not just the tile's own count above.
            onOpenStale={() => setPanel(buildAgeingPanel(stale7Bucket, scopeLabel, null, false, undefined, seesOthersData))}
            // Same pipeline panel again, defaulted to "Active" (the set
            // concentration is defined over) with concentrationMode on —
            // Milestone 6 panel 2. isSinglePersonScope reuses the exact
            // boolean that already means "more than one person's data is
            // in view" for every role (seesOthersData), per the role-matrix
            // rule confirmed in Milestone 1: drop the top-10% cutoff and
            // list every one of this scope's own active leads when it's
            // just one person's.
            onOpenConcentration={() =>
              setPanel(
                buildPipelinePanel({
                  breakdownLeads,
                  funnelStageHistory,
                  scopeLabel,
                  initialScope: 'active',
                  concentrationMode: true,
                  isSinglePersonScope: !seesOthersData,
                })
              )
            }
            onOpenGap={handleOpenFollowupGap}
            onOpenWorkload={handleOpenWorkload}
            onOpenCompleteness={handleOpenCompleteness}
          />

          <DateRangeSelector
            preset={preset}
            onPresetChange={setPreset}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />

          {/* The Day Review replaces the report cards entirely for this
              period — a pipeline total or a month's attainment says nothing
              about eight hours, so re-filtering the standing cards would be
              worse than not showing them (§4.2 of the handoff). */}
          {isDayReview ? (
            <>
              <DayDateBar dateISO={dayDate} onDateChange={setDayDate} updatedAt={updatedAt} />
              {dayError && <p className="vip-error" role="alert">{dayError}</p>}
              {dayLoading || !dayData ? (
                <p className="vip-empty">Loading…</p>
              ) : (
                <>
                  <DayKpiStrip kpis={dayKpis} />
                  <DayReviewCard
                    rows={dayRows}
                    totals={dayTotals}
                    isPast={dayIsPast}
                    onOpenExec={openDaySheet}
                    selectedExecId={selectedExecId}
                  />
                </>
              )}
            </>
          ) : (
            <>
          {error && <p className="vip-error" role="alert">{error}</p>}
          {!range && <p className="vip-empty">Pick both a start and end date.</p>}

          {/* KpiSparkRow now renders at every width — its own vip-dd-kpi-grid
              is 2 columns on mobile, widening to 4 at ≥1024px via the
              vip-dd-kpi-grid-4 modifier (Open pipeline and Stale leads moved
              out to RightNowStrip, see that component's own header comment
              and KpiSparkRow's — this band is 4 tiles now, not 6). */}
          {!loading && range && (
            <>
              <KpiSparkRow
                orderValueActual={wonThisRange}
                activitiesCount={activities.length}
                winRatePct={winRatePct}
                weightedForecast={weightedForecastValue}
                wonStageHistory={wonStageHistory}
                activitiesTrendWindow={activitiesTrendWindow}
                decidedStageHistory={decidedStageHistory}
                onOpenOrderValue={() => setBookedFor(null)}
                onOpenActivities={handleOpenActivities}
                onOpenWinRate={() => setPanel(buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel, scopeLabel }))}
                onOpenForecast={() => setPanel(buildForecastPanel({ forecast, scopeLabel }))}
              />
            </>
          )}

          <div className="vip-report-grid">
            {isTargetPeriod ? (
              <div className="vip-span-2">
                <div className="vip-featured-row">
                  <TargetsVsActualsCard
                    activities={activities}
                    wonStageHistory={wonStageHistory}
                    breakdownLeads={breakdownLeads}
                    targets={targets}
                    range={range}
                    rangeLabel={rangeLabel}
                    employees={employees}
                    showByEmployee={seesOthersData}
                    displayPeriod={targetPeriod}
                    // mergeTargetRow owns both halves of this: it drops a row
                    // saved for a period other than the one on screen, and it
                    // REPLACES rather than appends a row for the period that
                    // IS on screen (insertTarget is an upsert, so a
                    // correction updates the same database row and the stale
                    // local copy has to go). See its own comment in
                    // TargetsVsActualsCard.jsx for the two bugs the previous
                    // inline version shipped.
                    onTargetCreated={(row) => setTargets((prev) => mergeTargetRow(prev, row, targetPeriod))}
                    onOpenLog={handleOpenLog}
                    onOpenPanel={setPanel}
                    onOpenBooked={setBookedFor}
                    canCancelTarget={isOwner}
                  />
                  {!loading && <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} scopeLabel={scopeLabel} showListFilters={seesOthersData} />}
                </div>
              </div>
            ) : (
              !loading && (
                <div className="vip-span-2">
                  <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} wide scopeLabel={scopeLabel} showListFilters={seesOthersData} />
                </div>
              )
            )}

            <h2 className="vip-span-2 vip-report-section">Activity &amp; sourcing</h2>

            {loading ? (
              <p className="vip-empty">Loading…</p>
            ) : (
              <>
                <ActivityCountsCard
                  activities={activities}
                  rangeLabel={rangeLabel}
                  onOpenPanel={range ? handleOpenActivities : undefined}
                />
                <LeadsBySourceCard
                  leads={leads}
                  showByEmployee={seesOthersData}
                  onOpenPanel={() =>
                    setPanel(buildMixPanel({ periodLeads: leads, breakdownLeads, sourceOptions: sourceOptionsForRole, rangeLabel, scopeLabel }))
                  }
                />
              </>
            )}

            <h2 className="vip-span-2 vip-report-section">Deal pipeline</h2>

            <div className="vip-span-2">
              <ClosureForecastCard leads={forecast} onOpenPanel={() => setPanel(buildForecastPanel({ forecast, scopeLabel }))} />
            </div>

            {/* Independent of breakdownLeads on purpose — stageRows is
                already sourced from whichever path is faster (see its own
                comment above), so gating the empty-check on the slower fetch
                would defeat that. */}
            <PipelineByStageCard
              rows={stageRows}
              onOpenPanel={() =>
                setPanel(buildPipelinePanel({ breakdownLeads, funnelStageHistory, scopeLabel, showListFilters: seesOthersData }))
              }
            />

            {/* No "Details" here — its drill-down used to open the exact
                same content as Pipeline by stage's own Details (same
                stageRows/convRows/topLeads, only the header text differed),
                so it was removed rather than kept as a duplicate. This card
                already shows everything funnel-specific (reach + avg-days
                per stage) inline. */}
            <SalesFunnelCard stageHistory={funnelStageHistory} leads={breakdownLeads} />

            <h2 className="vip-span-2 vip-report-section">Sites &amp; product</h2>

            <LeadsByCategoryCard
              title="Leads by area"
              leads={breakdownLeads}
              getCategory={areaCategory}
              aggregated={fastCategoryBreakdown?.area}
              maxRows={6}
              onOpenPanel={() =>
                setPanel(
                  buildCategoryMixPanel({
                    breakdownLeads,
                    getCategory: areaCategory,
                    eyebrow: `${scopeLabel} · leads by area`,
                    title: 'Where leads are located',
                    unit: 'area',
                  })
                )
              }
            />

            <LeadsByCategoryCard
              title="Leads by site stage"
              leads={breakdownLeads}
              getCategory={siteStageCategory}
              aggregated={fastCategoryBreakdown?.site_stage}
              categoryOrder={[...SITE_STAGE_OPTIONS, 'Not set', 'No site']}
              onOpenPanel={() =>
                setPanel(
                  buildCategoryMixPanel({
                    breakdownLeads,
                    getCategory: siteStageCategory,
                    eyebrow: `${scopeLabel} · leads by site stage`,
                    title: 'How far along each site is',
                    unit: 'site stage',
                  })
                )
              }
            />

            {/* Odd one out now that "Leads by stage (detail)" is gone — the
                other four half-width report cards below pair up (Pipeline +
                Funnel, Area + Site stage), so this one goes full-width
                instead of leaving CSS grid a visible gap (see the Desktop
                layout note in CLAUDE.md about getting this pairing wrong). */}
            <div className="vip-span-2">
              <LeadsByCategoryCard
                title="Leads by product"
                leads={breakdownLeads}
                getCategory={productCategory}
                aggregated={fastCategoryBreakdown?.product}
                maxRows={6}
                onOpenPanel={() =>
                  setPanel(
                    buildCategoryMixPanel({
                      breakdownLeads,
                      getCategory: productCategory,
                      eyebrow: `${scopeLabel} · leads by product`,
                      title: 'What leads are asking for',
                      unit: 'product',
                    })
                  )
                }
              />
            </div>

            {/* A manager sees why THEIR TEAM loses, on the team side of the
                switch only — on "My numbers" the card would be about their
                own handful of lost deals, which is not what this card is
                for. The RLS policy is scoped to their team plus their own
                leads either way. */}
            {(isOwner || (isManager && managerScope === 'team')) && (
              <>
                <h2 className="vip-span-2 vip-report-section">Why we lose</h2>
                <div className="vip-span-2">
                  <LossReasonsCard lossReasons={lossReasons} onOpenPanel={() => setPanel(buildLossPanel({ lossReasons }))} />
                </div>
              </>
            )}
          </div>
            </>
          )}
        </>
      )}

      {activeTab === 'leads' && (
        <LeadsListCard
          showOwnerFilter={seesOthersData}
          employees={employees}
          title={leadsTitle}
          ownerScopeIds={leadsOwnerScopeIds}
          // A manager's leads are legitimately own-OR-team under RLS (see
          // the switch's own comment on the Reports tab above), so All
          // Leads needs its own My/Team say-so too — rendered by the card
          // itself, in the filter rail alongside Owner/Stage/Source/etc.,
          // rather than as a second control floating above the card.
          // Shares the same `managerScope` state as the Reports switch
          // deliberately, not a second flag — see that switch's comment.
          managerScope={isManager ? managerScope : null}
          onManagerScopeChange={isManager ? setManagerScope : null}
        />
      )}

      {/* FOLLOWUPS.md Rule 5 / Rule 8 — the app's first view of every reminder
          rather than only the handful due today. Scoping is RLS's job, so the
          same component serves all three roles; `showTeam` only decides
          whether the per-exec counts table renders above the list. */}
      {activeTab === 'followups' && (
        <FollowUpsCard
          range={range}
          rangeLabel={rangeLabel}
          viewer={employee}
          showTeam={seesOthersData}
          employees={employees}
        />
      )}
    </div>
  )
}

export default Dashboard
