import { useEffect, useState } from 'react'
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
import LeadsByCategoryCard from '../components/LeadsByCategoryCard'
import SalesFunnelCard from '../components/SalesFunnelCard'
import LossReasonsCard from '../components/LossReasonsCard'
import NeedsAttentionCard from '../components/NeedsAttentionCard'
import KpiSparkRow from '../components/KpiSparkRow'
import DrilldownPanel from '../components/DrilldownPanel'
import DayReviewCard from '../components/DayReviewCard'
import { DayDateBar, DayKpiStrip } from '../components/DayReviewHeader'
import { fetchDayReview, fetchChangeLogStart, rescheduleFollowUp } from '../lib/dayReviewQueries'
import { buildDayRows, buildDayTotals, buildDayKpis, buildDaySheetPanel } from '../lib/dayReview'
import { formatClockTime } from '../lib/dbTime'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { LEAD_STAGE_OPTIONS, stageLabel } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
import { dealValueFor, sumOpenPipelineValue } from '../lib/pipelineValue'
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
  const seesOthersData = isOwner || isCoordinator
  const scopeLabel = isOwner ? 'Company' : isCoordinator ? 'My team' : employee?.name ?? 'You'
  // One source for what the All Leads view is called — the page header and the
  // card's own title both read this, so they can't drift into disagreeing
  // about whose leads are on screen.
  const leadsTitle = isOwner ? 'All leads' : isCoordinator ? 'Team leads' : 'My leads'
  const [searchParams] = useSearchParams()

  // No more in-page tab buttons — Reports/All leads is chosen purely by
  // ?tab=, either from Home's "All leads" tile or the sidebar's All Leads
  // link (BottomNav.jsx). Re-read on every searchParams change, not just
  // mount, since switching sidebar links while already on /dashboard
  // doesn't remount this component.
  const [activeTab, setActiveTab] = useState('reports')
  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTab(tab === 'leads' ? 'leads' : 'reports')
  }, [searchParams])
  // Persisted across a "click into a lead/exec, then Back" round trip, reset
  // on a fresh nav-link visit — see usePersistedFilterState's own header
  // comment.
  const [preset, setPreset] = usePersistedFilterState('vip-filters:dashboard', 'preset', 'week')
  const [customStart, setCustomStart] = usePersistedFilterState('vip-filters:dashboard', 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState('vip-filters:dashboard', 'customEnd', todayISO())

  const [activities, setActivities] = useState([])
  const [leads, setLeads] = useState([])
  const [forecast, setForecast] = useState([])
  const [employees, setEmployees] = useState([])
  const [targets, setTargets] = useState([])
  const [wonStageHistory, setWonStageHistory] = useState([])
  const [breakdownLeads, setBreakdownLeads] = useState([])
  const [funnelStageHistory, setFunnelStageHistory] = useState([])
  const [lossReasons, setLossReasons] = useState([])
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  const [decidedStageHistory, setDecidedStageHistory] = useState([])
  const [activitiesTrendWindow, setActivitiesTrendWindow] = useState([])
  const [panel, setPanel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
    if (activeTab === 'leads') {
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
      setEmployees(
        employee?.role === 'sales_coordinator'
          ? all.filter((e) => e.coordinator_id === employee.id)
          : all
      )
    })
    return () => {
      active = false
    }
  }, [employee])

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
  useEffect(() => {
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
  }, [])

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
    if (!isOwner) {
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
  }, [isOwner])

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
  const wonThisRange = range ? computeOrderValueActuals(wonStageHistory, range, false) : 0

  const stageRows = LEAD_STAGE_OPTIONS.map((stage) => {
    const stageLeads = breakdownLeads.filter((l) => (l.current_stage ?? 'calling') === stage)
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((s, l) => s + dealValueFor(l), 0),
    }
  })
  const maxStageCount = Math.max(1, ...stageRows.map((r) => r.count))
  const openLeadCount = breakdownLeads.filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'calling')).length

  const rangeLabel = RANGE_LABELS[preset]
  const attentionBuckets = computeAttentionBuckets(breakdownLeads, lastActivityByLead)
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
          {isOwner && (
            <Link to="/team" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
              <div>
                <div className="vip-tile-label">My Team</div>
                <div className="vip-tile-desc">Browse your sales team</div>
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
                    onTargetCreated={(row) => setTargets((prev) => [...prev, row])}
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
              {breakdownLeads.length === 0 ? (
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

            <LeadsByCategoryCard
              title="Leads by area"
              leads={breakdownLeads}
              getCategory={areaCategory}
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

            {isOwner && (
              <div className="vip-span-2">
                <LossReasonsCard lossReasons={lossReasons} onOpenPanel={() => setPanel(buildLossPanel({ lossReasons }))} />
              </div>
            )}
          </div>
            </>
          )}
        </>
      )}

      {activeTab === 'leads' && <LeadsListCard showOwnerFilter={seesOthersData} employees={employees} title={leadsTitle} />}
    </div>
  )
}

export default Dashboard
