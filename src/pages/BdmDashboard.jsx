import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useHeaderOverride } from '../contexts/HeaderContext'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchPortfolioWithMeetings } from '../lib/screenQueries'
import LeadsListCard from '../components/LeadsListCard'
import FollowUpsCard from '../components/FollowUpsCard'
import DateRangeSelector from '../components/DateRangeSelector'
import DrilldownPanel from '../components/DrilldownPanel'
import BdmRightNow from '../components/BdmRightNow'
import BdmTargetsCard from '../components/BdmTargetsCard'
import BdmTopArchitectsCard from '../components/BdmTopArchitectsCard'
import ClosureForecastCard from '../components/ClosureForecastCard'
import PipelineByStageCard from '../components/PipelineByStageCard'
import { BdmHandedOverCard, BdmClosedCard, BdmPipelineClosedCard } from '../components/BdmLeadUpdateCards'
import { useClosedRows } from '../hooks/useBdmPeriodRows'
import { markBdmUpdatesSeen } from '../lib/notificationQueries'
import { canSeeMyArchitects } from '../lib/roles'
import { RANGE_LABELS, rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'
import { fetchBdmDashboardLeads, fetchBdmArchitectMeetings } from '../lib/bdmQueries'
import {
  fetchClosureForecast,
  fetchCompletenessDetail,
  fetchDashboardSnapshotMetrics,
  fetchFollowupGapDetail,
  fetchStageHistoryForFunnel,
} from '../lib/dashboardQueries'
import { fetchTargetsForPeriod } from '../lib/targetQueries'
import { architectsToMeet, lastMeetingByArchitect } from '../lib/architectStats'
import { computeBdmTargetActuals, topArchitects } from '../lib/bdmDashboard'
import { countOpenPipelineLeads, stageRowsFromLeads, sumOpenPipelineValue } from '../lib/pipelineValue'
import {
  buildArchitectsToMeetPanel,
  buildCompletenessPanel,
  buildFollowupGapPanel,
  buildForecastPanel,
  buildPipelinePanel,
} from '../lib/drilldownBuilders'

// dashboard_snapshot_metrics() numbers arrive as strings, and may be NULL —
// same coercion Dashboard.jsx applies.
function numOrNull(v) {
  return v == null ? null : Number(v)
}

// The only ownerless leads a BDM can see are their own pool leads, which read
// "Awaiting assignment" everywhere else they appear (My Leads, Lead Detail) —
// not the shared drill-downs' generic "Unassigned". Display only: applied to
// the rows a panel is built from, never to anything written back.
const AWAITING = 'Awaiting assignment'

// "Nothing yet", shared so props keep one identity across renders. Never mutated.
const NO_ROWS = []
function labelPoolOwnerRows(rows) {
  return (rows ?? []).map((r) => (r.owner_id == null ? { ...r, owner_name: AWAITING } : r))
}
function labelPoolOwnerLeads(leads) {
  return (leads ?? []).map((l) => (l.owner_employee_id == null ? { ...l, employees: { name: AWAITING } } : l))
}

// The business development manager's `/dashboard` (picked by DashboardRoute).
//
// Same three views as the shared Dashboard, chosen purely by ?tab= (synced in
// an effect, not a useState initializer — switching sidebar links while
// already on /dashboard changes the query string without remounting):
//   ?tab=leads     — My leads. LeadsListCard is RLS-scoped, and a BDM's leads
//                    policy returns exactly the leads they brought in plus any
//                    they work themselves, so no client-side filter is needed.
//   ?tab=followups — their own reminders (FollowUpsCard, no team table).
//   anything else  — Reports (BDM.md Step 5).
//
// Reports, in the order the owner picked at Step 5 (the shape of their own
// Dashboard): two mobile-only tiles (My follow-ups, My architects — the
// four-tab bar has no room for either) → "Right now" tiles, untouched by the
// date range → the range picker → Targets vs. actuals | Pipeline closed →
// Top 5 architects → Handed over | Closed → Closure forecast → Pipeline by
// stage. Every card is its own card (owner: never merged).
//
// Every figure is this BDM's leads — tagged to them, pool and their own
// included — so RLS plus the tag decide the scope and nothing here needs a
// role check.
function BdmDashboard() {
  const { employee } = useAuth()
  const { setOverride } = useHeaderOverride()
  const [searchParams] = useSearchParams()
  const bdmId = employee?.id ?? null
  // The drill-down eyebrow: never "Company" for someone who sees only their own
  // leads (CLAUDE.md's data-isolation audit).
  const scopeLabel = employee?.name ?? 'You'

  const [activeTab, setActiveTab] = useState('reports')
  useEffect(() => {
    const tab = searchParams.get('tab')
    setActiveTab(tab === 'leads' ? 'leads' : tab === 'followups' ? 'followups' : 'reports')
  }, [searchParams])

  // Same persisted keys as Dashboard.jsx, so the period a follow-ups view is
  // scoped to reads the same on either page.
  const [preset, setPreset] = usePersistedFilterState('vip-filters:dashboard', 'preset', 'week')
  const [customStart, setCustomStart] = usePersistedFilterState('vip-filters:dashboard', 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState('vip-filters:dashboard', 'customEnd', todayISO())
  const range = rangeForPreset(preset, customStart, customEnd)
  const rangeLabel = RANGE_LABELS[preset]
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null
  // Targets are period-keyed: Week/Month/Quarter only, the shared Dashboard's
  // own rule (periodForPreset is null for Today/15D/Custom).
  const targetPeriod = useMemo(() => periodForPreset(preset), [preset])

  // Opening the Dashboard is how a BDM "sees" their lead updates — the two
  // cards below list them — so Today's "N updates" line clears here.
  // Read off the URL, not activeTab: that state starts as 'reports' for one
  // render even on ?tab=leads, which would clear the line on the wrong page —
  // and would start every Reports fetch below there too.
  const tabParam = searchParams.get('tab')
  const isReports = tabParam !== 'leads' && tabParam !== 'followups'
  useEffect(() => {
    if (isReports) markBdmUpdatesSeen()
  }, [isReports])

  useEffect(() => {
    if (activeTab === 'followups') {
      setOverride({ title: 'My follow-ups', sub: `Reminders · ${rangeLabel}` })
    } else if (activeTab === 'leads') {
      setOverride({ title: 'My leads', sub: 'Leads you brought in' })
    } else {
      setOverride({ sub: 'Your leads and architects' })
    }
    return () => setOverride(null)
  }, [activeTab, rangeLabel, setOverride])

  const [panel, setPanel] = useState(null)
  const [panelError, setPanelError] = useState(null)

  // ---- Snapshot data (not range-scoped) ----
  // INSTANT OPEN — every read here is remembered on the device. The portfolio
  // shares BDM Today's key (same list as its "Architects to meet" card), and
  // the snapshot and targets share the shared Dashboard's.
  const leadsQuery = useCachedQuery(['bdm', 'dash-leads', bdmId], () => fetchBdmDashboardLeads(bdmId), {
    enabled: isReports && Boolean(bdmId),
  })
  const leads = leadsQuery.result ? leadsQuery.result.data ?? [] : null
  const leadsError = leadsQuery.result?.error ? errorMessage(leadsQuery.result.error) : null
  // RLS scopes both to this BDM's leads; the pool rule lets their own pool
  // leads through (the SQL predicate is role-aware — migration_bdm_handoff.sql).
  const forecastQuery = useCachedQuery(['bdm', 'forecast'], () => fetchClosureForecast(true), {
    enabled: isReports && Boolean(bdmId),
  })
  const forecast = forecastQuery.result && !forecastQuery.result.error ? forecastQuery.result.data ?? [] : NO_ROWS
  const snapshotQuery = useCachedQuery(['dash', 'snapshot', 'all'], () => fetchDashboardSnapshotMetrics(null), {
    enabled: isReports && Boolean(bdmId),
  })
  const snapshot = useMemo(() => {
    const res = snapshotQuery.result
    if (!res || res.error) return null
    return Array.isArray(res.data) ? res.data[0] ?? null : res.data
  }, [snapshotQuery.result])
  // The same list Today's "Architects to meet" card shows.
  const portfolioQuery = useCachedQuery(['today', 'bdm-architects', bdmId], () => fetchPortfolioWithMeetings(bdmId), {
    enabled: isReports && Boolean(bdmId),
  })
  const architects = portfolioQuery.result && !portfolioQuery.result.error ? portfolioQuery.result.data.architects : null
  const lastMetById = useMemo(
    () => lastMeetingByArchitect(portfolioQuery.result?.data?.meetings ?? []),
    [portfolioQuery.result]
  )

  // ---- Period data ----
  const meetingsQuery = useCachedQuery(
    ['bdm', 'architect-meetings', bdmId, rangeKey],
    () => fetchBdmArchitectMeetings(bdmId, range),
    { enabled: isReports && Boolean(bdmId) && Boolean(rangeKey) }
  )
  const meetings = meetingsQuery.result ? meetingsQuery.result.data ?? [] : null
  const meetingsError = meetingsQuery.result?.error ? errorMessage(meetingsQuery.result.error) : null

  const targetsQuery = useCachedQuery(
    ['dash', 'targets', targetPeriod?.periodType ?? '-', targetPeriod?.periodValue ?? '-'],
    () => fetchTargetsForPeriod(targetPeriod),
    { enabled: isReports && Boolean(targetPeriod) }
  )
  // RLS returns only this BDM's own rows; the filter keeps it that way for
  // anyone else who ever renders this.
  const targets = useMemo(() => {
    const res = targetsQuery.result
    if (!res) return null
    return res.error ? [] : (res.data ?? []).filter((t) => t.employee_id === bdmId)
  }, [targetsQuery.result, bdmId])

  // One fetch for both Closed and Pipeline closed (see BdmLeadUpdateCards.jsx).
  const closed = useClosedRows(isReports ? range : null, bdmId)

  const toMeet = architects ? architectsToMeet(architects, lastMetById) : null
  const actuals = range ? computeBdmTargetActuals({ leads: leads ?? [], meetings: meetings ?? [], range, bdmId }) : {}
  const top = range && leads && meetings ? topArchitects({ leads, meetings, range, bdmId }) : []

  async function openPipeline() {
    setPanelError(null)
    const { data, error } = await fetchStageHistoryForFunnel(true)
    if (error) return setPanelError(errorMessage(error))
    setPanel(
      buildPipelinePanel({
        breakdownLeads: labelPoolOwnerLeads(leads),
        funnelStageHistory: data ?? [],
        scopeLabel,
        showListFilters: true,
      })
    )
  }

  async function openCompleteness() {
    setPanelError(null)
    const { data, error } = await fetchCompletenessDetail(null)
    if (error) return setPanelError(errorMessage(error))
    setPanel(buildCompletenessPanel(labelPoolOwnerRows(data), scopeLabel, false))
  }

  // The gap's swipe actions are switched off for a BDM: "Set date" creates a
  // reminder assigned to the lead's owner — an exec, once the lead is handed
  // over — which a BDM may not do, and they don't work their handed-over leads.
  // The rows stay, as plain links to each lead.
  async function openGap() {
    setPanelError(null)
    const { data, error } = await fetchFollowupGapDetail(null)
    if (error) return setPanelError(errorMessage(error))
    setPanel({ ...buildFollowupGapPanel(labelPoolOwnerRows(data), scopeLabel, false), queueActions: false })
  }

  return (
    <div className="vip-wide vip-pad-fab-overhang">
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />

      {activeTab === 'reports' && (
        <>
          {/* Follow-ups' only mobile path — same tile, same reason as on the
              shared Dashboard (the 4-tab bar has no room for a fifth). */}
          <Link to="/dashboard?tab=followups" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
            <div>
              <div className="vip-tile-label">My follow-ups</div>
              <div className="vip-tile-desc">Overdue, today and upcoming reminders</div>
            </div>
            <div className="vip-tile-chevron" aria-hidden="true">›</div>
          </Link>
          {/* My Architects' only mobile path (owner's ruling at Step 2) — the
              desktop sidebar link reads the same canSeeMyArchitects. */}
          {canSeeMyArchitects(employee?.role) && (
            <Link to="/architects" className="vip-tile vip-only-mobile" style={{ textDecoration: 'none' }}>
              <div>
                <div className="vip-tile-label">My architects</div>
                <div className="vip-tile-desc">Your portfolio, by firm</div>
              </div>
              <div className="vip-tile-chevron" aria-hidden="true">›</div>
            </Link>
          )}

          {leadsError && (
            <p className="vip-error" role="alert">
              {leadsError}
            </p>
          )}
          {panelError && (
            <p className="vip-error" role="alert">
              {panelError}
            </p>
          )}

          <BdmRightNow
            openValue={leads ? sumOpenPipelineValue(leads) : null}
            openCount={leads ? countOpenPipelineLeads(leads) : null}
            toMeetCount={toMeet ? toMeet.length : null}
            completenessPct={numOrNull(snapshot?.completeness_pct)}
            gapCount={numOrNull(snapshot?.followup_gap_count)}
            gapPct={numOrNull(snapshot?.followup_gap_pct)}
            onOpenPipeline={openPipeline}
            onOpenArchitects={() => setPanel(buildArchitectsToMeetPanel(toMeet ?? [], scopeLabel))}
            onOpenCompleteness={openCompleteness}
            onOpenGap={openGap}
          />

          <DateRangeSelector
            preset={preset}
            onPresetChange={setPreset}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />

          <div className="vip-report-grid">
            {range ? (
              <>
                {/* Targets only exist for Week/Month/Quarter; without them
                    Pipeline closed takes the whole row rather than leaving
                    half of it empty. */}
                {targetPeriod && (
                  <BdmTargetsCard targets={targets ?? []} actuals={actuals} rangeLabel={rangeLabel} loading={!targets || !leads || !meetings} />
                )}
                {/* The card itself is the grid item (no wrapper), so it
                    stretches to its partner's height when paired. */}
                <BdmPipelineClosedCard closed={closed} rangeLabel={rangeLabel} className={targetPeriod ? null : 'vip-span-2'} />

                <div className="vip-span-2">
                  <BdmTopArchitectsCard rows={top} rangeLabel={rangeLabel} loading={!leads || !meetings} error={meetingsError} />
                </div>

                {/* Two cards, never merged (owner's ruling). An even pair. */}
                <BdmHandedOverCard range={range} rangeLabel={rangeLabel} bdmId={bdmId} />
                <BdmClosedCard closed={closed} rangeLabel={rangeLabel} />
              </>
            ) : (
              <p className="vip-span-2 vip-empty">Pick both dates to see this range.</p>
            )}

            {/* Point-in-time again, like the tiles — the heading says so, the
                same way the shared Dashboard labels its own pipeline block. */}
            <h2 className="vip-span-2 vip-report-section">Deal pipeline</h2>

            <div className="vip-span-2">
              <ClosureForecastCard
                leads={labelPoolOwnerLeads(forecast)}
                onOpenPanel={() => setPanel(buildForecastPanel({ forecast: labelPoolOwnerLeads(forecast), scopeLabel }))}
              />
            </div>

            <div className="vip-span-2">
              <PipelineByStageCard rows={stageRowsFromLeads(leads ?? [])} onOpenPanel={openPipeline} />
            </div>
          </div>
        </>
      )}

      {activeTab === 'leads' && (
        <LeadsListCard
          showOwnerFilter={false}
          employees={[]}
          title="My leads"
          ownerScopeIds={null}
          managerScope={null}
          onManagerScopeChange={null}
          includePoolLeads
        />
      )}

      {activeTab === 'followups' && (
        <FollowUpsCard range={range} rangeLabel={rangeLabel} viewer={employee} showTeam={false} employees={[]} />
      )}
    </div>
  )
}

export default BdmDashboard
