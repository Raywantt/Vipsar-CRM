import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import DateRangeSelector from '../components/DateRangeSelector'
import ActivityCountsCard from '../components/ActivityCountsCard'
import LeadsBySourceCard, { SALES_EXEC_SOURCES } from '../components/LeadsBySourceCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import TargetsVsActualsCard, { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import LeadsListCard from '../components/LeadsListCard'
import FollowUpsCard from '../components/FollowUpsCard'
import LeadsByCategoryCard from '../components/LeadsByCategoryCard'
import SalesFunnelCard from '../components/SalesFunnelCard'
import LossReasonsCard from '../components/LossReasonsCard'
import NeedsAttentionCard from '../components/NeedsAttentionCard'
import KpiSparkRow from '../components/KpiSparkRow'
import DrilldownPanel from '../components/DrilldownPanel'
import DayReviewCard from '../components/DayReviewCard'
import { DayDateBar, DayKpiStrip } from '../components/DayReviewHeader'
import { fetchDayReview, fetchChangeLogStart } from '../lib/dayReviewQueries'
import { rescheduleFollowUp } from '../lib/followUpQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { formatClockTime } from '../lib/dbTime'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import { computeAttentionBuckets, computeAttentionBucketsFromRpc, buildAgeingPanel } from '../lib/attention'
import { dealValueFor, sumOpenPipelineValue, sumOnHoldValue } from '../lib/pipelineValue'
import {
  buildOrderValueAttainPanel,
  buildActivitiesAttainPanel,
  buildPipelinePanel,
  buildWinRatePanel,
  buildForecastPanel,
  buildMixPanel,
  buildCategoryMixPanel,
  buildLossPanel,
  buildLogPanel,
} from '../lib/drilldownBuilders'
import {
  fetchActivityCounts,
  fetchNewLeadsBySource,
  fetchClosureForecast,
  fetchLeadsForBreakdown,
  fetchCategoryBreakdown,
  fetchLeadsNeedingAttention,
  fetchStageHistoryForFunnel,
  fetchLossReasons,
  fetchLastActivityPerLead,
  fetchActivityLogForExec,
  fetchDecidedStageHistory,
  fetchActivitiesTrendWindow,
} from '../lib/dashboardQueries'
import { fetchTargetsForPeriod, fetchWonStageHistory } from '../lib/targetQueries'
import { fetchActiveSalesExecs } from '../lib/employeeQueries'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'

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

const RANGE_LABELS = { today: 'today', '15d': 'last 15 days', week: 'this week', month: 'this month', quarter: 'this quarter', custom: 'this range' }

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
  const canSeeTeamDirectory = isOwner || isManager
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
  // Persisted across a "click into a lead/exec, then Back" round trip, reset
  // on a fresh nav-link visit — see usePersistedFilterState's own header
  // comment.
  const [preset, setPreset] = usePersistedFilterState('vip-filters:dashboard', 'preset', 'week')
  const [customStart, setCustomStart] = usePersistedFilterState('vip-filters:dashboard', 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState('vip-filters:dashboard', 'customEnd', todayISO())

  // ---- Raw fetched rows, before the manager's My/Team scope is applied ----
  // Named all* so the scoped values below can keep the plain names every card
  // and drill-down already reads. The setters are untouched, so every fetch
  // effect further down is unchanged.
  const [allActivities, setActivities] = useState([])
  const [allLeads, setLeads] = useState([])
  const [allForecast, setForecast] = useState([])
  const [allEmployees, setEmployees] = useState([])
  const [allTargets, setTargets] = useState([])
  const [allWonStageHistory, setWonStageHistory] = useState([])
  const [allBreakdownLeads, setBreakdownLeads] = useState([])
  // Fast path for the 3 category-breakdown cards + Pipeline by stage — see
  // Schema/migration_leads_category_breakdown_rpc.sql and
  // fetchCategoryBreakdown()'s own header comment. null means "not
  // available" (migration not yet run, or the fetch hasn't resolved yet) —
  // every consumer below falls back to computing the same numbers from
  // allBreakdownLeads/breakdownLeads exactly as before, so this is additive
  // only and never blocks rendering.
  const [categoryBreakdown, setCategoryBreakdown] = useState(null)
  // Needs Attention's five buckets, filtered server-side — see
  // Schema/migration_needs_attention_rpc.sql. null means "not available"
  // (migration not run, fetch not resolved, or a manager — see
  // fastAttentionRows below), in which case the original client-side
  // computeAttentionBuckets over breakdownLeads runs exactly as before.
  const [attentionRows, setAttentionRows] = useState(null)
  // Set only when the RPC actually failed (not merely "hasn't answered
  // yet"). It gates the fetchLastActivityPerLead() query, whose sole
  // consumer is the client-side fallback — so on the normal path that
  // activities scan is never issued at all.
  const [attentionRpcFailed, setAttentionRpcFailed] = useState(false)
  const [allFunnelStageHistory, setFunnelStageHistory] = useState([])
  const [allLossReasons, setLossReasons] = useState([])
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  const [allDecidedStageHistory, setDecidedStageHistory] = useState([])
  const [activitiesTrendWindow, setActivitiesTrendWindow] = useState([])
  const [panel, setPanel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  // ---- Day Review (the `today` period) ----
  // Its own date, independent of the report cards' date range: this pane
  // accepts any past day, and changing it reloads every number including
  // Tomorrow (= chosen date + 1).
  const isDayReview = preset === 'today'
  const [dayDate, setDayDate] = useState(todayISO())
  const [dayData, setDayData] = useState(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [dayError, setDayError] = useState(null)
  const [changeLogStart, setChangeLogStart] = useState(null)
  const [selectedExecId, setSelectedExecId] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const range = rangeForPreset(preset, customStart, customEnd)
  // targets are keyed by week/month/quarter — 15D/Custom have no period to
  // look one up against, so Targets vs. actuals doesn't render at all for
  // them (see the featured-row layout below and CLAUDE.md's Dashboard
  // section). Reuses periodForPreset instead of re-deriving the same
  // week/month/quarter check a second way.
  const isTargetPeriod = periodForPreset(preset) != null

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

  useEffect(() => {
    const range = rangeForPreset(preset, customStart, customEnd)
    // The Day Review runs its own day-scoped queries and renders none of the
    // report cards these two feed — skip the round trip entirely.
    if (!range || preset === 'today') return
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([fetchActivityCounts(range), fetchNewLeadsBySource(range)]).then(
      ([activitiesRes, leadsRes]) => {
        if (!active) return
        if (activitiesRes.error || leadsRes.error) {
          setError(errorMessage(activitiesRes.error ?? leadsRes.error))
        } else {
          setActivities(activitiesRes.data ?? [])
          setLeads(leadsRes.data ?? [])
        }
        setLoading(false)
      }
    )

    return () => {
      active = false
    }
  }, [preset, customStart, customEnd])

  useEffect(() => {
    let active = true
    fetchClosureForecast().then(({ data, error }) => {
      if (!active) return
      if (!error) setForecast(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

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
  useEffect(() => {
    let active = true
    fetchActiveSalesExecs().then(({ data, error }) => {
      if (!active) return
      if (error) return
      const all = data ?? []
      // A manager's roster is their own reports PLUS themselves — they carry
      // a quota and work deals, so their own row has to be available for the
      // 'my' side of the switch. Which of the two the page actually shows is
      // decided by the `employees` memo above, not here.
      setEmployees(
        employee?.role === 'sales_coordinator'
          ? all.filter((e) => e.coordinator_id === employee.id)
          : employee?.role === 'sales_manager'
          ? all.filter((e) => e.manager_id === employee.id || e.id === employee.id)
          : all
      )
    })
    return () => {
      active = false
    }
  }, [employee])

  // Fires once on mount, independent of the manager scope switch — the
  // manager case simply doesn't use this data (see fastCategoryBreakdown
  // above), so there's nothing to refetch when managerScope changes.
  // Fails soft: an error (including "function does not exist" if the
  // migration hasn't been run yet) just leaves categoryBreakdown null,
  // which every consumer below already treats as "use the slow path".
  useEffect(() => {
    let active = true
    fetchLeadsNeedingAttention().then(({ data, error }) => {
      if (!active) return
      if (error || !data) {
        // Distinct from "still loading": this is what releases the
        // fetchLastActivityPerLead() query below, which the fallback needs
        // and the fast path does not.
        setAttentionRpcFailed(true)
        return
      }
      setAttentionRows(data)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchCategoryBreakdown().then(({ data, error }) => {
      if (!active) return
      if (error || !data) return
      const grouped = { area: [], site_stage: [], product: [], stage: [] }
      data.forEach((row) => {
        const bucket = grouped[row.category_group]
        // lead_count/deal_value come back over PostgREST as strings (bigint/
        // numeric, to avoid JS float precision loss) — coerce once, here,
        // rather than at every consumer.
        if (bucket) bucket.push({ category: row.category, count: Number(row.lead_count), value: Number(row.deal_value) })
      })
      setCategoryBreakdown(grouped)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchWonStageHistory().then(({ data, error }) => {
      if (!active) return
      if (!error) setWonStageHistory(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const period = periodForPreset(preset)
    if (!period) {
      setTargets([])
      return
    }
    let active = true
    fetchTargetsForPeriod(period).then(({ data, error }) => {
      if (!active) return
      if (!error) setTargets(data ?? [])
    })
    return () => {
      active = false
    }
  }, [preset])

  useEffect(() => {
    let active = true
    fetchLeadsForBreakdown().then(({ data, error }) => {
      if (!active) return
      if (!error) setBreakdownLeads(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  // Powers Needs Attention (src/lib/attention.js) — "no activity in N days"
  // needs each lead's most recent activity, reduced client-side from every
  // activities row rather than a second per-lead round trip.
  //
  // ONLY FETCHED WHEN THE FALLBACK WILL ACTUALLY RUN. Its one consumer is
  // computeAttentionBuckets(), which the RPC path replaces — so on the
  // normal path this whole activities scan (measured 885-3,024ms) is never
  // issued. A manager always needs it (the RPC can't honour their My/Team
  // toggle), and so does anyone whose RPC call failed.
  useEffect(() => {
    if (!isManager && !attentionRpcFailed) return
    let active = true
    fetchLastActivityPerLead().then(({ data, error }) => {
      if (!active) return
      if (!error) {
        const map = new Map()
        ;(data ?? []).forEach((row) => {
          const existing = map.get(row.lead_id)
          if (!existing || new Date(row.created_at) > new Date(existing)) {
            map.set(row.lead_id, row.created_at)
          }
        })
        setLastActivityByLead(map)
      }
    })
    return () => {
      active = false
    }
  }, [isManager, attentionRpcFailed])

  // Powers the win-rate KPI/drill-down and the `loss` kind's lost-leads list.
  useEffect(() => {
    let active = true
    fetchDecidedStageHistory().then(({ data, error }) => {
      if (!active) return
      if (!error) setDecidedStageHistory(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  // One 8-week-back window, sliced into weekly buckets for the KPI row's
  // sparklines (src/components/KpiSparkRow.jsx) — unbounded from the
  // selected preset on purpose, see fetchActivitiesTrendWindow's own comment.
  useEffect(() => {
    let active = true
    fetchActivitiesTrendWindow().then(({ data, error }) => {
      if (!active) return
      if (!error) setActivitiesTrendWindow(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchStageHistoryForFunnel().then(({ data, error }) => {
      if (!active) return
      if (!error) setFunnelStageHistory(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    // The owner, and now a sales manager for their own team's lost deals
    // (owner's ruling, 2026-09-03). loss_reasons SELECT is genuinely
    // owner-only in RLS — the card is invisible to a coordinator, not merely
    // hidden — so this widening required a real policy,
    // manager_team_select on loss_reasons (migration_sales_manager.sql
    // STEP 6). A sales exec still fetches nothing rather than firing a
    // request the database would answer with an empty set.
    if (!isOwner && !isManager) {
      setLossReasons([])
      return
    }
    let active = true
    fetchLossReasons().then(({ data, error }) => {
      if (!active) return
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
      const stillLost = (data ?? []).filter((row) => row.leads?.current_stage === 'lost')
      if (!error) setLossReasons(stillLost)
    })
    return () => {
      active = false
    }
  }, [isOwner, isManager])

  // Everything on the Day Review reloads when the date changes — nothing here
  // is cached across days, since every figure is bounded to the one day.
  useEffect(() => {
    if (!isDayReview) return
    let active = true
    setDayLoading(true)
    setDayError(null)
    setSelectedExecId(null)
    fetchDayReview(dayDate).then((res) => {
      if (!active) return
      setDayData(res)
      setDayError(res.error ? errorMessage(res.error) : null)
      setUpdatedAt(formatClockTime(new Date()))
      setDayLoading(false)
    })
    return () => {
      active = false
    }
  }, [isDayReview, dayDate])

  // When the trail actually begins, for the day sheet's honest empty state on
  // any date before the audit trail shipped. Fetched once, not per day.
  useEffect(() => {
    if (!isDayReview || changeLogStart !== null) return
    let active = true
    fetchChangeLogStart().then(({ data }) => {
      if (!active) return
      setChangeLogStart(
        data?.changed_at ? new Date(data.changed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
      )
    })
    return () => {
      active = false
    }
  }, [isDayReview, changeLogStart])

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
  const stageRows = LEAD_STAGE_OPTIONS.map((stage) => {
    if (fastCategoryBreakdown) {
      const entry = fastCategoryBreakdown.stage.find((r) => r.category === stage)
      return { stage, count: entry?.count ?? 0, value: entry?.value ?? 0 }
    }
    const stageLeads = breakdownLeads.filter((l) => (l.current_stage ?? 'calling') === stage)
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((s, l) => s + dealValueFor(l), 0),
    }
  })
  const maxStageCount = Math.max(1, ...stageRows.map((r) => r.count))
  // Excludes on_hold too, not just won/lost — this count sits beside
  // openPipelineValue in the KPI tile, and that figure now excludes on-hold
  // leads (see sumOpenPipelineValue), so the count must match what it's
  // describing rather than tallying a broader set than the value it labels.
  const openLeadCount = breakdownLeads.filter((l) => !['won', 'lost', 'on_hold'].includes(l.current_stage ?? 'calling')).length

  const rangeLabel = RANGE_LABELS[preset]
  // Fast path when the RPC answered; otherwise the original client-side
  // reduction over every lead, unchanged.
  const attentionBuckets = fastAttentionRows
    ? computeAttentionBucketsFromRpc(fastAttentionRows)
    : computeAttentionBuckets(breakdownLeads, lastActivityByLead)
  const staleBucket = attentionBuckets.find((b) => b.key === 'stale')
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
    const { data, error: logError } = await fetchActivityLogForExec(employeeId, activityType)
    if (logError) return
    setPanel(buildLogPanel({ employee, activityType, targets, range, rangeLabel, logRows: data ?? [] }))
  }

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />

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
            <div className="vip-tile-chevron">›</div>
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
              <div className="vip-tile-chevron">›</div>
            </Link>
          )}

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
              is 2 columns on mobile, widening to 6 at ≥1024px (section 16's
              override) — replacing the plainer 4-tile vip-kpi-grid mobile
              used to fall back to. */}
          {!loading && range && (
            <>
              <KpiSparkRow
                orderValueActual={wonThisRange}
                activitiesCount={activities.length}
                openPipelineValue={openPipelineValue}
                openLeadCount={openLeadCount}
                onHoldValue={onHoldValue}
                onHoldLeadCount={onHoldLeadCount}
                winRatePct={winRatePct}
                staleCount={staleBucket.count}
                weightedForecast={weightedForecastValue}
                wonStageHistory={wonStageHistory}
                activitiesTrendWindow={activitiesTrendWindow}
                decidedStageHistory={decidedStageHistory}
                onOpenOrderValue={() =>
                  setPanel(buildOrderValueAttainPanel({ employees, targets, wonStageHistory, range, employeeId: null, rangeLabel, scopeLabel }))
                }
                onOpenActivities={() => setPanel(buildActivitiesAttainPanel({ activities, targets, employees, range, rangeLabel, scopeLabel }))}
                onOpenPipeline={() => setPanel(buildPipelinePanel({ breakdownLeads, funnelStageHistory, scopeLabel }))}
                onOpenWinRate={() => setPanel(buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel, scopeLabel }))}
                onOpenStale={() => setPanel(buildAgeingPanel(staleBucket, scopeLabel, null, false))}
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
                    // A REPLACE, not a blind append — insertTarget() is now an
                    // upsert (see targetQueries.js), so re-setting a target
                    // for a period/metric that already had one updates that
                    // SAME row in the database. Appending here regardless
                    // would leave the stale copy sitting in local state next
                    // to the corrected one, silently reintroducing the exact
                    // "which one does the UI believe" ambiguity the upsert
                    // was meant to end — TargetsVsActualsCard's own render
                    // would still show whichever `targetFor()`'s first match
                    // happened to be.
                    onTargetCreated={(row) =>
                      setTargets((prev) => {
                        const isSameTarget = (t) =>
                          t.employee_id === row.employee_id &&
                          t.period_type === row.period_type &&
                          t.period_value === row.period_value &&
                          t.metric_name === row.metric_name
                        const replaced = prev.some(isSameTarget)
                        return replaced ? prev.map((t) => (isSameTarget(t) ? row : t)) : [...prev, row]
                      })
                    }
                    onOpenLog={handleOpenLog}
                    onOpenPanel={setPanel}
                  />
                  {!loading && <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} scopeLabel={scopeLabel} />}
                </div>
              </div>
            ) : (
              !loading && (
                <div className="vip-span-2">
                  <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} wide scopeLabel={scopeLabel} />
                </div>
              )
            )}

            <div className="vip-span-2 vip-report-section">Activity &amp; sourcing</div>

            {loading ? (
              <p className="vip-empty">Loading…</p>
            ) : (
              <>
                <ActivityCountsCard
                  activities={activities}
                  rangeLabel={rangeLabel}
                  onOpenPanel={range ? () => setPanel(buildActivitiesAttainPanel({ activities, targets, employees, range, rangeLabel, scopeLabel })) : undefined}
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

            <div className="vip-span-2 vip-report-section">Deal pipeline</div>

            <div className="vip-span-2">
              <ClosureForecastCard leads={forecast} onOpenPanel={() => setPanel(buildForecastPanel({ forecast, scopeLabel }))} />
            </div>

            <div className="vip-card">
              <div className="vip-card-head">
                <div className="vip-card-title">Pipeline by stage</div>
                <button
                  type="button"
                  className="vip-dd-open-link"
                  onClick={() => setPanel(buildPipelinePanel({ breakdownLeads, funnelStageHistory, scopeLabel }))}
                >
                  Details ›
                </button>
              </div>
              {/* Independent of breakdownLeads on purpose — stageRows is
                  already sourced from whichever path is faster (see its own
                  comment above), so gating the empty-check on the slower
                  fetch would defeat that. */}
              {stageRows.every((r) => r.count === 0) ? (
                <p className="vip-empty">No leads found.</p>
              ) : (
                stageRows.map(({ stage, count, value }) => (
                  <div key={stage} className="vip-bar-row">
                    <div style={{ flex: '0 0 92px' }}>
                      <span className={stageChipClass(stage)}>{stageLabel(stage)}</span>
                    </div>
                    <div className="vip-bar-count" style={{ flex: '0 0 20px' }}>
                      {count}
                    </div>
                    <div className="vip-bar-track vip-thick">
                      <div className="vip-bar-fill" style={{ width: `${(count / maxStageCount) * 100}%` }} />
                    </div>
                    <div className="vip-bar-value">{formatCurrencyCompact(value)}</div>
                  </div>
                ))
              )}
            </div>

            {/* No "Details" here — its drill-down used to open the exact
                same content as Pipeline by stage's own Details (same
                stageRows/convRows/topLeads, only the header text differed),
                so it was removed rather than kept as a duplicate. This card
                already shows everything funnel-specific (reach + avg-days
                per stage) inline. */}
            <SalesFunnelCard stageHistory={funnelStageHistory} leads={breakdownLeads} />

            <div className="vip-span-2 vip-report-section">Sites &amp; product</div>

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
                <div className="vip-span-2 vip-report-section">Why we lose</div>
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

      {activeTab === 'leads' && <LeadsListCard showOwnerFilter={seesOthersData} employees={employees} title={leadsTitle} />}

      {/* FOLLOWUPS.md Rule 5 / Rule 8 — the app's first view of every reminder
          rather than only the handful due today. Scoping is RLS's job, so the
          same component serves all three roles; `showTeam` only decides
          whether the per-exec counts table renders above the list. */}
      {activeTab === 'followups' && (
        <FollowUpsCard range={range} rangeLabel={rangeLabel} viewer={employee} showTeam={seesOthersData} />
      )}
    </div>
  )
}

export default Dashboard
