import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import DateRangeSelector from '../components/DateRangeSelector'
import ActivityCountsCard from '../components/ActivityCountsCard'
import LeadsBySourceCard, { SALES_EXEC_SOURCES } from '../components/LeadsBySourceCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import TargetsVsActualsCard, { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import LeadsListCard from '../components/LeadsListCard'
import LeadsByCategoryCard from '../components/LeadsByCategoryCard'
import LeadStageBoard from '../components/LeadStageBoard'
import SalesFunnelCard from '../components/SalesFunnelCard'
import LossReasonsCard from '../components/LossReasonsCard'
import PartiesCard from '../components/PartiesCard'
import NeedsAttentionCard from '../components/NeedsAttentionCard'
import KpiSparkRow from '../components/KpiSparkRow'
import DrilldownPanel from '../components/DrilldownPanel'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { SOURCE_TYPE_OPTIONS } from '../lib/sourceTypeOptions'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import { computeAttentionBuckets, buildAgeingPanel } from '../lib/attention'
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
import { fetchEmployees, fetchTargetsForPeriod, fetchWonStageHistory } from '../lib/targetQueries'
import { fetchAllParties, fetchLeadsByParty, fetchPartyEmployeeLinks, mostRecentLeadByParty } from '../lib/partyQueries'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function stageCategory(lead) {
  return lead.current_stage
}

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

const RANGE_LABELS = { '15d': 'last 15 days', week: 'this week', month: 'this month', quarter: 'this quarter', custom: 'this range' }

function Dashboard() {
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const isOwner = employee?.role === 'owner'
  const [searchParams] = useSearchParams()

  // No more in-page tab buttons — Reports/All leads/Parties is chosen purely
  // by ?tab=, either from Home's "All leads" tile or the sidebar's All
  // Leads/Parties links (BottomNav.jsx). Re-read on every searchParams
  // change, not just mount, since switching sidebar links while already on
  // /dashboard doesn't remount this component.
  const [activeTab, setActiveTab] = useState('reports')
  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTab(tab === 'leads' ? 'leads' : tab === 'parties' ? 'parties' : 'reports')
  }, [searchParams])
  const [stageView, setStageView] = useState('table')

  const [preset, setPreset] = useState('week')
  const [customStart, setCustomStart] = useState(todayISO())
  const [customEnd, setCustomEnd] = useState(todayISO())

  const [activities, setActivities] = useState([])
  const [leads, setLeads] = useState([])
  const [forecast, setForecast] = useState([])
  const [employees, setEmployees] = useState([])
  const [targets, setTargets] = useState([])
  const [wonStageHistory, setWonStageHistory] = useState([])
  const [breakdownLeads, setBreakdownLeads] = useState([])
  const [funnelStageHistory, setFunnelStageHistory] = useState([])
  const [lossReasons, setLossReasons] = useState([])
  const [parties, setParties] = useState([])
  const [partyEmployeeLinks, setPartyEmployeeLinks] = useState([])
  const [leadsByParty, setLeadsByParty] = useState([])
  const [lastActivityByLead, setLastActivityByLead] = useState(new Map())
  const [decidedStageHistory, setDecidedStageHistory] = useState([])
  const [activitiesTrendWindow, setActivitiesTrendWindow] = useState([])
  const [panel, setPanel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const range = rangeForPreset(preset, customStart, customEnd)
  // targets are keyed by week/month/quarter — 15D/Custom have no period to
  // look one up against, so Targets vs. actuals doesn't render at all for
  // them (see the featured-row layout below and CLAUDE.md's Dashboard
  // section). Reuses periodForPreset instead of re-deriving the same
  // week/month/quarter check a second way.
  const isTargetPeriod = periodForPreset(preset) != null

  useEffect(() => {
    setOverride({ sub: `${isOwner ? 'Team performance' : 'Your performance'} · ${RANGE_LABELS[preset]}` })
    return () => setOverride(null)
  }, [isOwner, preset, setOverride])

  useEffect(() => {
    const range = rangeForPreset(preset, customStart, customEnd)
    if (!range) return
    let active = true
    setLoading(true)
    setError(null)

    Promise.all([fetchActivityCounts(range), fetchNewLeadsBySource(range)]).then(
      ([activitiesRes, leadsRes]) => {
        if (!active) return
        if (activitiesRes.error || leadsRes.error) {
          setError(activitiesRes.error?.message ?? leadsRes.error?.message)
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

  useEffect(() => {
    let active = true
    fetchEmployees().then(({ data, error }) => {
      if (!active) return
      if (!error) setEmployees(data ?? [])
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
      if (!error) setLossReasons(data ?? [])
    })
    return () => {
      active = false
    }
  }, [isOwner])

  useEffect(() => {
    let active = true
    fetchAllParties().then(({ data, error }) => {
      if (!active) return
      if (!error) setParties(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchPartyEmployeeLinks().then(({ data, error }) => {
      if (!active) return
      if (!error) setPartyEmployeeLinks(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchLeadsByParty().then(({ data, error }) => {
      if (!active) return
      if (!error) setLeadsByParty(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])

  const openPipelineValue = breakdownLeads
    .filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
    .reduce((s, l) => s + Number(l.order_value ?? l.quote_value ?? 0), 0)
  const wonThisRange = range ? computeOrderValueActuals(wonStageHistory, range, false) : 0

  const stageRows = LEAD_STAGE_OPTIONS.map((stage) => {
    const stageLeads = breakdownLeads.filter((l) => (l.current_stage ?? 'new') === stage)
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((s, l) => s + Number(l.order_value ?? 0), 0),
    }
  })
  const maxStageCount = Math.max(1, ...stageRows.map((r) => r.count))

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
  const sourceOptionsForRole = isOwner
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
    <div className={activeTab === 'reports' ? 'vip-wide' : 'vip-narrow'}>
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />

      {activeTab === 'reports' && (
        <>
          <DateRangeSelector
            preset={preset}
            onPresetChange={setPreset}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />

          {error && <p className="vip-error">{error}</p>}
          {!range && <p className="vip-empty">Pick both a start and end date.</p>}

          {!loading && (
            <div className="vip-only-mobile">
              <div className="vip-kpi-grid">
                <div className="vip-kpi">
                  <div className="vip-kpi-label">Activities</div>
                  <div className="vip-kpi-value">{activities.length}</div>
                  <div className="vip-kpi-note">{rangeLabel}</div>
                </div>
                <div className="vip-kpi">
                  <div className="vip-kpi-label">New leads</div>
                  <div className="vip-kpi-value">{leads.length}</div>
                  <div className="vip-kpi-note">{rangeLabel}</div>
                </div>
                <div className="vip-kpi">
                  <div className="vip-kpi-label">Pipeline</div>
                  <div className="vip-kpi-value">{formatCurrencyCompact(openPipelineValue)}</div>
                  <div className="vip-kpi-note">open, not won/lost</div>
                </div>
                <div className="vip-kpi">
                  <div className="vip-kpi-label">Won</div>
                  <div className="vip-kpi-value">{formatCurrencyCompact(wonThisRange)}</div>
                  <div className="vip-kpi-note">{rangeLabel}</div>
                </div>
              </div>
            </div>
          )}

          {!loading && range && (
            <div className="vip-only-desktop">
              <KpiSparkRow
                orderValueActual={wonThisRange}
                activitiesCount={activities.length}
                openPipelineValue={openPipelineValue}
                winRatePct={winRatePct}
                staleCount={staleBucket.count}
                weightedForecast={weightedForecastValue}
                wonStageHistory={wonStageHistory}
                activitiesTrendWindow={activitiesTrendWindow}
                decidedStageHistory={decidedStageHistory}
                onOpenOrderValue={() =>
                  setPanel(buildOrderValueAttainPanel({ employees, targets, wonStageHistory, range, employeeId: null, rangeLabel }))
                }
                onOpenActivities={() => setPanel(buildActivitiesAttainPanel({ activities, targets, employees, range, rangeLabel }))}
                onOpenPipeline={() => setPanel(buildPipelinePanel({ mode: 'stage', breakdownLeads, funnelStageHistory }))}
                onOpenWinRate={() => setPanel(buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel }))}
                onOpenStale={() => setPanel(buildAgeingPanel(staleBucket))}
                onOpenForecast={() => setPanel(buildForecastPanel({ forecast }))}
              />
            </div>
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
                    showByEmployee={isOwner}
                    onTargetCreated={(row) => setTargets((prev) => [...prev, row])}
                    onOpenLog={handleOpenLog}
                    onOpenPanel={setPanel}
                  />
                  {!loading && <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} />}
                </div>
              </div>
            ) : (
              !loading && (
                <div className="vip-span-2">
                  <NeedsAttentionCard buckets={attentionBuckets} onOpenPanel={setPanel} wide />
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
                  onOpenPanel={range ? () => setPanel(buildActivitiesAttainPanel({ activities, targets, employees, range, rangeLabel })) : undefined}
                />
                <LeadsBySourceCard
                  leads={leads}
                  showByEmployee={isOwner}
                  onOpenPanel={() =>
                    setPanel(buildMixPanel({ periodLeads: leads, breakdownLeads, sourceOptions: sourceOptionsForRole, rangeLabel }))
                  }
                />
              </>
            )}

            <div className="vip-span-2">
              <ClosureForecastCard leads={forecast} onOpenPanel={() => setPanel(buildForecastPanel({ forecast }))} />
            </div>

            <div className="vip-card">
              <div className="vip-card-head">
                <div className="vip-card-title">Pipeline by stage</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="vip-dd-open-link"
                    onClick={() => setPanel(buildPipelinePanel({ mode: 'stage', breakdownLeads, funnelStageHistory }))}
                  >
                    Details ›
                  </button>
                  <div className="vip-seg-mini">
                    <button
                      type="button"
                      className={stageView === 'table' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                      onClick={() => setStageView('table')}
                    >
                      Table
                    </button>
                    <button
                      type="button"
                      className={stageView === 'board' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                      onClick={() => setStageView('board')}
                    >
                      Board
                    </button>
                  </div>
                </div>
              </div>
              {stageView === 'table' ? (
                breakdownLeads.length === 0 ? (
                  <p className="vip-empty">No leads found.</p>
                ) : (
                  stageRows.map(({ stage, count, value }) => (
                    <div key={stage} className="vip-bar-row">
                      <div style={{ flex: '0 0 92px' }}>
                        <span className={stageChipClass(stage)}>{stage}</span>
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
                )
              ) : (
                <LeadStageBoard leads={breakdownLeads} isOwner={isOwner} />
              )}
            </div>

            <SalesFunnelCard
              stageHistory={funnelStageHistory}
              leads={breakdownLeads}
              onOpenPanel={() => setPanel(buildPipelinePanel({ mode: 'funnel', breakdownLeads, funnelStageHistory }))}
            />

            <LeadsByCategoryCard
              title="Leads by stage (detail)"
              leads={breakdownLeads}
              getCategory={stageCategory}
              categoryOrder={LEAD_STAGE_OPTIONS}
              colorStages
              onOpenPanel={() => setPanel(buildPipelinePanel({ mode: 'stage', breakdownLeads, funnelStageHistory }))}
            />

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
                    eyebrow: 'Company · leads by area',
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
                    eyebrow: 'Company · leads by site stage',
                    title: 'How far along each site is',
                    unit: 'site stage',
                  })
                )
              }
            />

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
                    eyebrow: 'Company · leads by product',
                    title: 'What leads are asking for',
                    unit: 'product',
                  })
                )
              }
            />

            {isOwner && (
              <div className="vip-span-2">
                <LossReasonsCard lossReasons={lossReasons} onOpenPanel={() => setPanel(buildLossPanel({ lossReasons }))} />
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'leads' && <LeadsListCard isOwner={isOwner} employees={employees} />}

      {activeTab === 'parties' && (
        <PartiesCard parties={parties} employeeLinks={partyEmployeeLinks} mostRecentLeadByParty={mostRecentLeadByParty(leadsByParty)} />
      )}
    </div>
  )
}

export default Dashboard
