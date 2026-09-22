import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import DateRangeSelector from '../components/DateRangeSelector'
import DrilldownPanel from '../components/DrilldownPanel'
import BdmNetworkCard from '../components/BdmNetworkCard'
import BdmTopArchitectsCard from '../components/BdmTopArchitectsCard'
import ArchitectDirectory from '../components/ArchitectDirectory'
import FirmDirectory from '../components/FirmDirectory'
import { RANGE_LABELS, rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'
import { fetchActiveBdms, fetchAllBdmLeads } from '../lib/bdmQueries'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchNetworkPortfolio, fetchNetworkPeriod, fetchArchitectDirectoryData } from '../lib/screenQueries'
import { fetchTargetsForPeriod } from '../lib/targetQueries'
import { buildDirectoryRows, buildFirmRows, summariseBdm } from '../lib/architectNetwork'
import { topArchitects } from '../lib/bdmDashboard'
import { buildArchitectsToMeetPanel } from '../lib/drilldownBuilders'

// Architect Network (/network) — the owner's view of every business
// development manager and every architect (BDM.md Step 6). Owner only
// (canSeeArchitectNetwork); desktop sidebar link + a tile on the owner's
// Dashboard for a phone.
//
// Owner's rulings: three tabs, chosen by ?tab= (synced in an effect, not a
// useState initializer, like Dashboard — and in the URL at all so Back from an
// architect's profile lands on the tab it was opened from):
//   BDMs (default) — the Dashboard's date range → one card per BDM (targets vs
//                    actuals, "+ Set targets", pipeline figures) → Top 5
//                    architects across every BDM for the period.
//   ?tab=architects — every architect in the company, all-time, no date range.
//   ?tab=firms — every FIRM in the company, all-time, rolled up from the same
//                architects/meetings/leads the Architects tab already fetched
//                (buildFirmRows in architectNetwork.js) — no separate query.
//
// Nothing here computes a BDM figure its own way: summariseBdm and topArchitects
// run the BDM Dashboard's own rules, so the owner and the BDM agree.
function ArchitectNetwork() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState('bdms')
  useEffect(() => {
    const t = searchParams.get('tab')
    setTab(t === 'architects' || t === 'firms' ? t : 'bdms')
  }, [searchParams])
  function chooseTab(next) {
    setSearchParams(next === 'bdms' ? {} : { tab: next }, { replace: true })
  }
  // Read off the URL, not `tab`: that state is 'bdms' for one render even on
  // ?tab=architects/?tab=firms, which would start the BDMs fetches on the
  // wrong tab.
  const onBdmsTab = searchParams.get('tab') !== 'architects' && searchParams.get('tab') !== 'firms'

  // Same persisted keys as both Dashboards, so the period reads the same here.
  const [preset, setPreset] = usePersistedFilterState('vip-filters:dashboard', 'preset', 'week')
  const [customStart, setCustomStart] = usePersistedFilterState('vip-filters:dashboard', 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState('vip-filters:dashboard', 'customEnd', todayISO())
  const range = rangeForPreset(preset, customStart, customEnd)
  const rangeLabel = RANGE_LABELS[preset]
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null
  const targetPeriod = useMemo(() => periodForPreset(preset), [preset])

  const [panel, setPanel] = useState(null)

  // ---- Both tabs: who the BDMs are (cards, and the directory's filter) ----
  // INSTANT OPEN — every read here is remembered on the device. Targets
  // share the shared Dashboard's key; saving new BDM targets is a write, and
  // every write refreshes what's on screen (supabaseFetch.js).
  const bdmsQuery = useCachedQuery(['bdm', 'active-bdms'], fetchActiveBdms)
  const bdms = useMemo(() => (bdmsQuery.result ? bdmsQuery.result.data ?? [] : null), [bdmsQuery.result])
  const bdmsError = bdmsQuery.result?.error ? errorMessage(bdmsQuery.result.error) : null
  const bdmIds = useMemo(() => (bdms ?? []).map((b) => b.id), [bdms])
  const bdmIdsKey = bdmIds.join(',')

  const leadsQuery = useCachedQuery(['network', 'bdm-leads'], fetchAllBdmLeads, { enabled: onBdmsTab })
  const leads = leadsQuery.result ? leadsQuery.result.data ?? [] : null
  const portfolioQuery = useCachedQuery(['network', 'portfolio'], fetchNetworkPortfolio, { enabled: onBdmsTab })
  const architects = portfolioQuery.result ? portfolioQuery.result.data.architects : null
  const portfolioMeetings = portfolioQuery.result ? portfolioQuery.result.data.meetings : null
  const snapshotFailure = leadsQuery.result?.error ?? portfolioQuery.result?.data?.partialError ?? null
  const snapshotError = snapshotFailure ? errorMessage(snapshotFailure) : null

  const periodQuery = useCachedQuery(
    ['network', 'period', rangeKey, bdmIdsKey],
    () => fetchNetworkPeriod(bdmIds, range),
    { enabled: onBdmsTab && Boolean(rangeKey) && bdms != null }
  )
  const period = useMemo(() => {
    const d = periodQuery.result?.data
    if (!d) return { meetings: null, closed: null, handedOver: null, error: null }
    return {
      meetings: d.meetings,
      closed: d.closed,
      handedOver: d.handedOver,
      error: d.partialError ? errorMessage(d.partialError) : null,
    }
  }, [periodQuery.result])

  const targetsQuery = useCachedQuery(
    ['dash', 'targets', targetPeriod?.periodType ?? '-', targetPeriod?.periodValue ?? '-'],
    () => fetchTargetsForPeriod(targetPeriod),
    { enabled: onBdmsTab && Boolean(targetPeriod) }
  )
  const targets = targetsQuery.result ? (targetsQuery.result.error ? [] : targetsQuery.result.data ?? []) : null

  // Architects and Firms load the first time one of those tabs is shown, then
  // stay. One read of architects/meetings/leads feeds both rollups.
  const [directoryRequested, setDirectoryRequested] = useState(false)
  useEffect(() => {
    if (!onBdmsTab) setDirectoryRequested(true)
  }, [onBdmsTab])
  const directoryQuery = useCachedQuery(['network', 'directory'], fetchArchitectDirectoryData, {
    enabled: directoryRequested,
  })
  const directory = useMemo(() => {
    const d = directoryQuery.result?.data
    if (!d) return { rows: null, error: null }
    return { rows: buildDirectoryRows(d), error: d.partialError ? errorMessage(d.partialError) : null }
  }, [directoryQuery.result])
  const firms = useMemo(() => {
    const d = directoryQuery.result?.data
    if (!d) return { rows: null, error: null }
    return { rows: buildFirmRows(d), error: d.partialError ? errorMessage(d.partialError) : null }
  }, [directoryQuery.result])

  const top =
    range && leads && period.meetings ? topArchitects({ leads, meetings: period.meetings, range, bdmIds }) : null

  return (
    <div className="vip-wide vip-stack">
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />

      <div className="vip-seg vip-net-tabs" role="tablist" aria-label="BDMs, architects or firms">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bdms'}
          className={tab === 'bdms' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => chooseTab('bdms')}
        >
          BDMs{bdms?.length ? ` (${bdms.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'architects'}
          className={tab === 'architects' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => chooseTab('architects')}
        >
          Architects
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'firms'}
          className={tab === 'firms' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
          onClick={() => chooseTab('firms')}
        >
          Firms
        </button>
      </div>

      {bdmsError && (
        <p className="vip-error" role="alert">
          {bdmsError}
        </p>
      )}

      {tab === 'bdms' && (
        <>
          <DateRangeSelector
            preset={preset}
            onPresetChange={setPreset}
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
          />

          {(snapshotError || period.error) && (
            <p className="vip-error" role="alert">
              {snapshotError ?? period.error}
            </p>
          )}

          {bdms == null ? (
            <p className="vip-empty">Loading…</p>
          ) : bdms.length === 0 ? (
            <div className="vip-card">
              <p className="vip-empty">
                No business development managers yet. Add one in Profile → Manage employees, with the role Business
                Development Manager.
              </p>
            </div>
          ) : !range ? (
            <p className="vip-empty">Pick both dates to see this range.</p>
          ) : (
            <>
              {bdms.map((b) => {
                const summary = summariseBdm({
                  bdmId: b.id,
                  leads,
                  periodMeetings: period.meetings,
                  architects,
                  portfolioMeetings,
                  closedData: period.closed,
                  handedOverData: period.handedOver,
                  range,
                })
                return (
                  <BdmNetworkCard
                    key={b.id}
                    bdm={b}
                    summary={summary}
                    targets={targetPeriod ? targets : null}
                    targetPeriod={targetPeriod}
                    rangeLabel={rangeLabel}
                    onOpenArchitects={() => setPanel(buildArchitectsToMeetPanel(summary.toMeet ?? [], b.name))}
                    // A save is a write, and every write refreshes what's on
                    // screen (supabaseFetch.js) — targets included.
                    onTargetsSaved={() => {}}
                  />
                )
              })}

              <BdmTopArchitectsCard
                rows={top ?? []}
                rangeLabel={rangeLabel}
                loading={top == null}
                error={null}
                emptyText={`No architect sent a BDM a joinery or met a BDM ${rangeLabel}.`}
              />
            </>
          )}
        </>
      )}

      {tab === 'architects' && (
        <ArchitectDirectory rows={directory.rows} bdms={bdms ?? []} loading={directory.rows == null} error={directory.error} />
      )}

      {tab === 'firms' && <FirmDirectory rows={firms.rows} loading={firms.rows == null} error={firms.error} />}
    </div>
  )
}

export default ArchitectNetwork
