import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import DateRangeSelector from '../components/DateRangeSelector'
import DrilldownPanel from '../components/DrilldownPanel'
import BdmNetworkCard from '../components/BdmNetworkCard'
import BdmTopArchitectsCard from '../components/BdmTopArchitectsCard'
import ArchitectDirectory from '../components/ArchitectDirectory'
import { RANGE_LABELS, rangeForPreset } from '../lib/dateRanges'
import { periodForPreset } from '../lib/targetPeriods'
import { todayISO } from '../lib/followupDates'
import { errorMessage } from '../lib/errorMessage'
import {
  fetchActiveBdms,
  fetchAllBdmLeads,
  fetchBdmsArchitectMeetings,
  fetchClosedRows,
  fetchHandedOverRows,
} from '../lib/bdmQueries'
import {
  fetchAllArchitectLeads,
  fetchAllArchitectMeetings,
  fetchAllArchitects,
  fetchAllPortfolioArchitects,
  fetchArchitectMeetings,
} from '../lib/architectQueries'
import { fetchTargetsForPeriod } from '../lib/targetQueries'
import { buildDirectoryRows, summariseBdm } from '../lib/architectNetwork'
import { topArchitects } from '../lib/bdmDashboard'
import { buildArchitectsToMeetPanel } from '../lib/drilldownBuilders'

// Architect Network (/network) — the owner's view of every business
// development manager and every architect (BDM.md Step 6). Owner only
// (canSeeArchitectNetwork); desktop sidebar link + a tile on the owner's
// Dashboard for a phone.
//
// Owner's rulings: two tabs, chosen by ?tab= (synced in an effect, not a
// useState initializer, like Dashboard — and in the URL at all so Back from an
// architect's profile lands on the tab it was opened from):
//   BDMs (default) — the Dashboard's date range → one card per BDM (targets vs
//                    actuals, "+ Set targets", pipeline figures) → Top 5
//                    architects across every BDM for the period.
//   ?tab=architects — every architect in the company, all-time, no date range.
//
// Nothing here computes a BDM figure its own way: summariseBdm and topArchitects
// run the BDM Dashboard's own rules, so the owner and the BDM agree.
function ArchitectNetwork() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState('bdms')
  useEffect(() => {
    setTab(searchParams.get('tab') === 'architects' ? 'architects' : 'bdms')
  }, [searchParams])
  function chooseTab(next) {
    setSearchParams(next === 'architects' ? { tab: 'architects' } : {}, { replace: true })
  }
  // Read off the URL, not `tab`: that state is 'bdms' for one render even on
  // ?tab=architects, which would start the BDMs fetches on the wrong tab.
  const onBdmsTab = searchParams.get('tab') !== 'architects'

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
  const [bdms, setBdms] = useState(null)
  const [bdmsError, setBdmsError] = useState(null)
  useEffect(() => {
    let active = true
    fetchActiveBdms().then(({ data, error }) => {
      if (!active) return
      setBdmsError(error ? errorMessage(error) : null)
      setBdms(data ?? [])
    })
    return () => {
      active = false
    }
  }, [])
  const bdmIds = useMemo(() => (bdms ?? []).map((b) => b.id), [bdms])
  const bdmIdsKey = bdmIds.join(',')

  // ---- BDMs tab: snapshot data ----
  const [leads, setLeads] = useState(null)
  const [architects, setArchitects] = useState(null)
  const [portfolioMeetings, setPortfolioMeetings] = useState(null)
  const [snapshotError, setSnapshotError] = useState(null)
  useEffect(() => {
    if (!onBdmsTab) return
    let active = true
    fetchAllBdmLeads().then(({ data, error }) => {
      if (!active) return
      if (error) setSnapshotError(errorMessage(error))
      setLeads(data ?? [])
    })
    fetchAllPortfolioArchitects().then(async ({ data, error }) => {
      if (!active) return
      if (error) setSnapshotError(errorMessage(error))
      const meetings = await fetchArchitectMeetings((data ?? []).map((a) => a.id))
      if (!active) return
      if (meetings.error) setSnapshotError(errorMessage(meetings.error))
      setPortfolioMeetings(meetings.data ?? [])
      setArchitects(data ?? [])
    })
    return () => {
      active = false
    }
  }, [onBdmsTab])

  // ---- BDMs tab: period data ----
  const [period, setPeriod] = useState({ meetings: null, closed: null, handedOver: null, error: null })
  useEffect(() => {
    if (!onBdmsTab || !rangeKey || bdms == null) return
    let active = true
    setPeriod({ meetings: null, closed: null, handedOver: null, error: null })
    Promise.all([
      fetchBdmsArchitectMeetings(bdmIds, range),
      fetchClosedRows(range, { taggedOnly: true }),
      fetchHandedOverRows(range),
    ]).then(([meetingsRes, closedRes, handedRes]) => {
      if (!active) return
      const firstError = meetingsRes.error ?? closedRes.error ?? handedRes.error
      setPeriod({
        meetings: meetingsRes.data ?? [],
        closed: closedRes.data ?? { stageRows: [], lossRows: [] },
        handedOver: handedRes.data ?? [],
        error: firstError ? errorMessage(firstError) : null,
      })
    })
    return () => {
      active = false
    }
    // range is represented by rangeKey, the roster by bdmIdsKey.
  }, [onBdmsTab, rangeKey, bdmIdsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [targets, setTargets] = useState(null)
  const [targetsKey, setTargetsKey] = useState(0)
  useEffect(() => {
    if (!onBdmsTab || !targetPeriod) return
    let active = true
    setTargets(null)
    fetchTargetsForPeriod(targetPeriod).then(({ data, error }) => {
      if (active) setTargets(error ? [] : data ?? [])
    })
    return () => {
      active = false
    }
  }, [onBdmsTab, targetPeriod, targetsKey])

  // ---- Architects tab: fetched the first time it's opened, then kept ----
  const [directory, setDirectory] = useState({ rows: null, error: null })
  const [directoryRequested, setDirectoryRequested] = useState(false)
  useEffect(() => {
    if (!onBdmsTab) setDirectoryRequested(true)
  }, [onBdmsTab])
  useEffect(() => {
    if (!directoryRequested) return
    let active = true
    Promise.all([fetchAllArchitects(), fetchAllArchitectMeetings(), fetchAllArchitectLeads()]).then(
      ([architectsRes, meetingsRes, leadsRes]) => {
        if (!active) return
        const firstError = architectsRes.error ?? meetingsRes.error ?? leadsRes.error
        setDirectory({
          rows: buildDirectoryRows({
            architects: architectsRes.data,
            meetings: meetingsRes.data,
            leads: leadsRes.data,
          }),
          error: firstError ? errorMessage(firstError) : null,
        })
      }
    )
    return () => {
      active = false
    }
  }, [directoryRequested])

  const top =
    range && leads && period.meetings ? topArchitects({ leads, meetings: period.meetings, range, bdmIds }) : null

  return (
    <div className="vip-wide vip-stack">
      <DrilldownPanel panel={panel} onClose={() => setPanel(null)} />

      <div className="vip-seg vip-net-tabs" role="tablist" aria-label="BDMs or architects">
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
                    onTargetsSaved={() => setTargetsKey((k) => k + 1)}
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
    </div>
  )
}

export default ArchitectNetwork
