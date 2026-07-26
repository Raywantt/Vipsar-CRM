import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import DateRangeSelector from '../components/DateRangeSelector'
import ActivityCountsCard from '../components/ActivityCountsCard'
import LeadsBySourceCard from '../components/LeadsBySourceCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import TargetsVsActualsCard from '../components/TargetsVsActualsCard'
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
import './Dashboard.css'

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

function Dashboard() {
  const { employee } = useAuth()
  const isOwner = employee?.role === 'owner'

  const [activeTab, setActiveTab] = useState('reports')
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

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p>
          Welcome, {employee?.name}. {isOwner ? 'Team performance overview.' : 'Your performance overview.'}
        </p>
      </div>

      <div className="dashboard-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={activeTab === tab.value ? 'dashboard-tab-btn dashboard-tab-btn-active' : 'dashboard-tab-btn'}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.value === 'leads' ? (isOwner ? 'All Leads' : 'My Leads') : tab.label}
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

          {error && <p className="dashboard-error">{error}</p>}
          {!range && <p className="dashboard-empty">Pick both a start and end date.</p>}

          {loading ? (
            <p className="dashboard-empty">Loading…</p>
          ) : (
            <>
              <ActivityCountsCard activities={activities} showByEmployee={isOwner} />
              <LeadsBySourceCard leads={leads} showByEmployee={isOwner} />
            </>
          )}

          <ClosureForecastCard leads={forecast} />

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

          <div className="dashboard-board-toggle">
            <button
              type="button"
              className={stageView === 'table' ? 'dashboard-range-btn dashboard-range-btn-active' : 'dashboard-range-btn'}
              onClick={() => setStageView('table')}
            >
              Table
            </button>
            <button
              type="button"
              className={stageView === 'board' ? 'dashboard-range-btn dashboard-range-btn-active' : 'dashboard-range-btn'}
              onClick={() => setStageView('board')}
            >
              Board
            </button>
          </div>

          {stageView === 'table' ? (
            <LeadsByCategoryCard
              title="Leads by stage"
              categoryHeading="Stage"
              leads={breakdownLeads}
              getCategory={stageCategory}
              categoryOrder={LEAD_STAGE_OPTIONS}
            />
          ) : (
            <section className="dashboard-card">
              <h2>Leads by stage</h2>
              <LeadStageBoard leads={breakdownLeads} isOwner={isOwner} />
            </section>
          )}

          <LeadsByCategoryCard
            title="Leads by area"
            categoryHeading="Area"
            leads={breakdownLeads}
            getCategory={areaCategory}
          />

          <LeadsByCategoryCard
            title="Leads by site stage"
            categoryHeading="Site stage"
            leads={breakdownLeads}
            getCategory={siteStageCategory}
            categoryOrder={[...SITE_STAGE_OPTIONS, 'Not set', 'No site']}
          />

          <LeadsByCategoryCard
            title="Leads by product"
            categoryHeading="Product"
            leads={breakdownLeads}
            getCategory={productCategory}
          />

          <SalesFunnelCard stageHistory={funnelStageHistory} leads={breakdownLeads} />

          {isOwner && <LossReasonsCard lossReasons={lossReasons} />}
        </>
      )}

      {activeTab === 'leads' && <LeadsListCard isOwner={isOwner} employees={employees} />}

      {activeTab === 'parties' && <PartiesCard parties={parties} employeeLinks={partyEmployeeLinks} />}
    </main>
  )
}

export default Dashboard
