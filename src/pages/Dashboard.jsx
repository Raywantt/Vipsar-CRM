import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import DateRangeSelector from '../components/DateRangeSelector'
import ActivityCountsCard from '../components/ActivityCountsCard'
import LeadsBySourceCard from '../components/LeadsBySourceCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import TargetsVsActualsCard, { computeOrderValueActuals } from '../components/TargetsVsActualsCard'
import LeadsListCard from '../components/LeadsListCard'
import LeadsByCategoryCard from '../components/LeadsByCategoryCard'
import LeadStageBoard from '../components/LeadStageBoard'
import SalesFunnelCard from '../components/SalesFunnelCard'
import LossReasonsCard from '../components/LossReasonsCard'
import PartiesCard from '../components/PartiesCard'
import { rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { LEAD_STAGE_OPTIONS } from '../lib/leadStageOptions'
import { SITE_STAGE_OPTIONS } from '../lib/siteStageOptions'
import { stageChipClass } from '../lib/statusColors'
import { formatCurrencyCompact } from '../lib/format'
import {
  fetchActivityCounts,
  fetchNewLeadsBySource,
  fetchClosureForecast,
  fetchLeadsForBreakdown,
  fetchStageHistoryForFunnel,
  fetchLossReasons,
} from '../lib/dashboardQueries'
import { fetchEmployees, fetchTargetsForPeriod, fetchWonStageHistory } from '../lib/targetQueries'
import { fetchAllParties, fetchPartyEmployeeLinks } from '../lib/partyQueries'

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

const TABS = [
  { value: 'reports', label: 'Reports' },
  { value: 'leads', label: null }, // label resolved per-role below
  { value: 'parties', label: 'Parties' },
]

const RANGE_LABELS = { week: 'this week', month: 'this month', custom: 'this range' }

function Dashboard() {
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const isOwner = employee?.role === 'owner'
  const [searchParams] = useSearchParams()

  // Home's "All leads" tile links here with ?tab=leads so it can jump
  // straight to the leads list rather than always landing on Reports.
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'leads' ? 'leads' : 'reports')
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const range = rangeForPreset(preset, customStart, customEnd)

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

  const openPipelineValue = breakdownLeads
    .filter((l) => !['won', 'lost'].includes(l.current_stage ?? 'new'))
    .reduce((s, l) => s + Number(l.order_value ?? 0), 0)
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

  return (
    <div className={activeTab === 'reports' ? 'vip-wide' : 'vip-narrow'}>
      <div className="vip-seg">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={activeTab === tab.value ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.value === 'leads' ? (isOwner ? 'All leads' : 'My leads') : tab.label}
          </button>
        ))}
      </div>

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
            <div className="vip-kpi-grid">
              <div className="vip-kpi">
                <div className="vip-kpi-label">Activities</div>
                <div className="vip-kpi-value">{activities.length}</div>
                <div className="vip-kpi-note">{RANGE_LABELS[preset]}</div>
              </div>
              <div className="vip-kpi">
                <div className="vip-kpi-label">New leads</div>
                <div className="vip-kpi-value">{leads.length}</div>
                <div className="vip-kpi-note">{RANGE_LABELS[preset]}</div>
              </div>
              <div className="vip-kpi">
                <div className="vip-kpi-label">Pipeline</div>
                <div className="vip-kpi-value">{formatCurrencyCompact(openPipelineValue)}</div>
                <div className="vip-kpi-note">open, not won/lost</div>
              </div>
              <div className="vip-kpi">
                <div className="vip-kpi-label">Won</div>
                <div className="vip-kpi-value">{formatCurrencyCompact(wonThisRange)}</div>
                <div className="vip-kpi-note">{RANGE_LABELS[preset]}</div>
              </div>
            </div>
          )}

          <div className="vip-report-grid">
            {loading ? (
              <p className="vip-empty">Loading…</p>
            ) : (
              <>
                <ActivityCountsCard activities={activities} showByEmployee={isOwner} rangeLabel={RANGE_LABELS[preset]} />
                <LeadsBySourceCard leads={leads} showByEmployee={isOwner} />
              </>
            )}

            <div className="vip-span-2">
              <ClosureForecastCard leads={forecast} />
            </div>

            <div className="vip-span-2">
              <TargetsVsActualsCard
                preset={preset}
                activities={activities}
                wonStageHistory={wonStageHistory}
                targets={targets}
                range={range}
                employees={employees}
                showByEmployee={isOwner}
                onTargetCreated={(row) => setTargets((prev) => [...prev, row])}
              />
            </div>

            <div className="vip-card vip-span-2">
              <div className="vip-card-head">
                <div className="vip-card-title">Pipeline by stage</div>
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

            <LeadsByCategoryCard
              title="Leads by stage (detail)"
              leads={breakdownLeads}
              getCategory={stageCategory}
              categoryOrder={LEAD_STAGE_OPTIONS}
              colorStages
            />

            <LeadsByCategoryCard title="Leads by area" leads={breakdownLeads} getCategory={areaCategory} />

            <LeadsByCategoryCard
              title="Leads by site stage"
              leads={breakdownLeads}
              getCategory={siteStageCategory}
              categoryOrder={[...SITE_STAGE_OPTIONS, 'Not set', 'No site']}
            />

            <LeadsByCategoryCard title="Leads by product" leads={breakdownLeads} getCategory={productCategory} />

            <div className="vip-span-2">
              <SalesFunnelCard stageHistory={funnelStageHistory} leads={breakdownLeads} />
            </div>

            {isOwner && (
              <div className="vip-span-2">
                <LossReasonsCard lossReasons={lossReasons} />
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'leads' && <LeadsListCard isOwner={isOwner} employees={employees} />}

      {activeTab === 'parties' && <PartiesCard parties={parties} employeeLinks={partyEmployeeLinks} />}
    </div>
  )
}

export default Dashboard
