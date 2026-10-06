import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePersistedFilterState } from '../hooks/usePersistedFilterState'
import { usePeriodOffset } from '../hooks/usePeriodOffset'
import { useCachedQuery } from '../hooks/useCachedQuery'
import DateRangeSelector from '../components/DateRangeSelector'
import RfqQueueRow from '../components/RfqQueueRow'
import ShowMoreRows from '../components/ShowMoreRows'
import { DayKpiStrip } from '../components/DayReviewHeader'
import { fetchRfqDeskLive, fetchRfqDeskPeriod } from '../lib/rfqQueries'
import {
  RFQ_LANES,
  bouncedAfterApproval,
  buildRfqLanes,
  priceRevisionSummary,
  rfqVolume,
  sendBacksByExec,
  shareLabel,
  turnaroundByStep,
  turnaroundLabel,
  waitingOnExec,
} from '../lib/rfqDeskReport'
import { RFQ_WAIT_LIMITS, revisionLabel, rfqLeadName } from '../lib/rfqDesk'
import { rangeForPreset, rangeLabelFor } from '../lib/dateRanges'
import { todayISO } from '../lib/followupDates'
import { parseTimestamp } from '../lib/dbTime'
import { errorMessage } from '../lib/errorMessage'

// The owner's RFQ Desk (/rfq-desk, RFQ-DESK.md Step 7) — owner only
// (canSeeRfqDesk); a sidebar link and a tile on the owner's Dashboard.
//
// Owner's rulings, 2026-10-06 (§3 "Step 7 rulings"): ONE page — the live lanes
// (technical check | estimation | With Lixil, side by side from 1024px,
// stacked on a phone) and "Sent back, waiting on the exec" on top, then the
// Dashboard's date range (its own memory here, Month by default) and the
// period figures. VIEW ONLY: rows open the lead; acting stays on Lead Detail's
// RFQs card and the desk's own Today. Every figure is rfqDeskReport.js's.

const STORAGE_KEY = 'vip-filters:rfq-desk'
const LANE_ROWS = 5
const MORE_STEP = 10

function firstName(embed) {
  return embed?.name?.trim().split(/\s+/)[0] ?? null
}

// "6 Oct" — the day of a send-back.
function shortDay(value) {
  const d = parseTimestamp(value)
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null
}

// What each lane's colours mean, under its title — the owner reads three
// different clocks side by side.
function laneHint(status) {
  const limits = RFQ_WAIT_LIMITS[status]
  return limits ? `amber ${limits.warn} · red ${limits.late} working days` : null
}

function Lane({ lane, rows, loading }) {
  const [shown, setShown] = useState(LANE_ROWS)
  return (
    <section className="vip-card vip-rfqdesk-lane" aria-labelledby={`vip-rfqdesk-lane-${lane.key}`}>
      <div className="vip-card-head">
        <h2 id={`vip-rfqdesk-lane-${lane.key}`} className="vip-card-title">
          {lane.title}
        </h2>
        {!loading && <span className="vip-rfq-count">{rows.length}</span>}
      </div>
      <p className="vip-rfqdesk-hint">{laneHint(lane.key)}</p>
      {loading ? (
        <p className="vip-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="vip-empty">Nothing waiting.</p>
      ) : (
        <div className="vip-rfq-rows">
          {rows.slice(0, shown).map((rfq) => (
            <RfqQueueRow key={rfq.id} rfq={rfq} />
          ))}
          <ShowMoreRows shown={shown} total={rows.length} noun="RFQs" onShowMore={() => setShown((n) => n + MORE_STEP)} />
        </div>
      )}
    </section>
  )
}

function sentBackNote(rfq) {
  const by = firstName(rfq.sender)
  const step = rfq.sent_back_from === 'estimation' ? 'estimation' : 'the technical check'
  const who = by ? `Sent back by ${by} (${step})` : `Sent back by ${step}`
  return rfq.send_back_note?.trim() ? `${who}: “${rfq.send_back_note.trim()}”` : `${who} — no note`
}

// "Sent back, waiting on the exec: N ›" — a line under the lanes that opens
// in place into the RFQs themselves.
function WaitingOnExec({ rows, loading }) {
  const [open, setOpen] = useState(false)
  const count = rows.length
  return (
    <section className="vip-card vip-rfqdesk-sentback">
      <button
        type="button"
        className="vip-rfqdesk-sentback-btn"
        aria-expanded={open}
        disabled={loading || count === 0}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Sent back, waiting on the exec</span>
        <span className="vip-rfqdesk-sentback-count">
          {loading ? '…' : count}
          {count > 0 && <span aria-hidden="true">{open ? ' ▾' : ' ›'}</span>}
        </span>
      </button>
      {open && count > 0 && (
        <div className="vip-rfq-rows">
          {rows.map((rfq) => (
            <RfqQueueRow key={rfq.id} rfq={rfq} note={sentBackNote(rfq)} />
          ))}
        </div>
      )}
    </section>
  )
}

function TurnaroundCard({ steps, rangeLabel }) {
  return (
    <section className="vip-card" aria-labelledby="vip-rfqdesk-turn">
      <div className="vip-card-head">
        <h2 id="vip-rfqdesk-turn" className="vip-card-title">
          Turnaround
        </h2>
      </div>
      <p className="vip-rfqdesk-hint">
        Steps finished {rangeLabel}. Working time — Sundays don't count; under a day reads in hours.
      </p>
      <div className="vip-rfqdesk-table-wrap">
        <table className="vip-rfqdesk-table">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Typical</th>
              <th scope="col">Slowest 1 in 10</th>
              <th scope="col">RFQs</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.key} className={s.key === 'endToEnd' ? 'vip-rfqdesk-total' : undefined}>
                <th scope="row">
                  {s.label}
                  <span className="vip-rfqdesk-sub">{s.span}</span>
                </th>
                <td>{turnaroundLabel(s.medianMs)}</td>
                <td>{turnaroundLabel(s.slowMs)}</td>
                <td>{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SendBacksCard({ rows, rangeLabel }) {
  return (
    <section className="vip-card" aria-labelledby="vip-rfqdesk-sb">
      <div className="vip-card-head">
        <h2 id="vip-rfqdesk-sb" className="vip-card-title">
          Send-backs by exec
        </h2>
      </div>
      <p className="vip-rfqdesk-hint">
        Of the RFQs each exec raised {rangeLabel}. One still with the desk may yet be sent back.
      </p>
      {rows.length === 0 ? (
        <p className="vip-empty">No RFQs raised {rangeLabel}.</p>
      ) : (
        <div className="vip-rfqdesk-table-wrap">
          <table className="vip-rfqdesk-table">
            <thead>
              <tr>
                <th scope="col">Exec</th>
                <th scope="col">Raised</th>
                <th scope="col" title="Sent back by the technical check">
                  Technical
                </th>
                <th scope="col" title="Sent back by estimation">
                  Estimation
                </th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id ?? 'unknown'} className={r.sentBack === 0 ? 'vip-rfqdesk-muted' : undefined}>
                  <th scope="row">{r.id != null ? <Link to={`/employees/${r.id}`}>{r.name}</Link> : r.name}</th>
                  <td>{r.raised}</td>
                  <td>{r.technical || '—'}</td>
                  <td>{r.estimation || '—'}</td>
                  <td>{shareLabel(r.sentBack, r.raised)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// The technical check's misses: approved, then sent back by estimation.
function BouncedCard({ bounced, rangeLabel }) {
  const [shown, setShown] = useState(5)
  const { list, approved } = bounced
  return (
    <section className="vip-card" aria-labelledby="vip-rfqdesk-bounce">
      <div className="vip-card-head">
        <h2 id="vip-rfqdesk-bounce" className="vip-card-title">
          Sent back after approval
        </h2>
        <span className={list.length ? 'vip-rfq-count vip-rfqdesk-count-warn' : 'vip-rfq-count'}>
          {list.length}
        </span>
      </div>
      <p className="vip-rfqdesk-hint">
        Approved at the technical check, then sent back by estimation — {list.length} of {approved} approved{' '}
        {rangeLabel}.
      </p>
      {list.length === 0 ? (
        <p className="vip-empty">None {rangeLabel}.</p>
      ) : (
        <div className="vip-rfq-rows">
          {list.slice(0, shown).map((r) => (
            <div key={r.id} className="vip-rfq-row vip-rfq-qrow">
              <div className="vip-rfq-qrow-head">
                <Link to={`/leads/${r.lead_id}`} className="vip-rfq-qrow-lead">
                  {rfqLeadName(r)}
                </Link>
                <span className="vip-rfq-facts">{shortDay(r.sent_back_at)}</span>
              </div>
              <div className="vip-rfq-qrow-meta">
                <span className="vip-rfq-rev">{revisionLabel(r)}</span>
                <span className="vip-rfq-facts">
                  {[r.raised_by?.name, firstName(r.approver) && `approved by ${firstName(r.approver)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="vip-rfq-facts">{sentBackNote(r)}</div>
            </div>
          ))}
          <ShowMoreRows shown={shown} total={list.length} noun="RFQs" onShowMore={() => setShown((n) => n + MORE_STEP)} />
        </div>
      )}
    </section>
  )
}

function PriceRevisionsCard({ summary, rangeLabel }) {
  const rows = [
    ['Started', summary.started],
    ['Quoted', summary.quoted],
    ['Still with the desk or Lixil', summary.open],
    ['Withdrawn', summary.withdrawn],
  ]
  return (
    <section className="vip-card" aria-labelledby="vip-rfqdesk-pr">
      <div className="vip-card-head">
        <h2 id="vip-rfqdesk-pr" className="vip-card-title">
          Price revisions
        </h2>
      </div>
      <p className="vip-rfqdesk-hint">Re-quotes started when Lixil changed its prices, {rangeLabel}, and where each is now.</p>
      <div className="vip-rfqdesk-kv">
        {rows.map(([label, value]) => (
          <div key={label} className="vip-rfqdesk-kv-row">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function RfqDesk() {
  // ---- Right now ----
  const liveQuery = useCachedQuery(['rfq-desk', 'live'], fetchRfqDeskLive)
  const live = liveQuery.result
  const liveLoading = live === undefined
  const liveError = live?.error ? errorMessage(live.error) : null
  const liveRows = useMemo(() => (live && !live.error ? live.data.rows : []), [live])
  const lanes = useMemo(() => buildRfqLanes(liveRows), [liveRows])
  const waiting = useMemo(
    () => (live && !live.error ? waitingOnExec(live.data.rows, live.data.later) : []),
    [live]
  )

  // ---- The period ----
  const [preset, setPreset] = usePersistedFilterState(STORAGE_KEY, 'preset', 'month')
  const [customStart, setCustomStart] = usePersistedFilterState(STORAGE_KEY, 'customStart', todayISO())
  const [customEnd, setCustomEnd] = usePersistedFilterState(STORAGE_KEY, 'customEnd', todayISO())
  const { offset, setOffset, onPresetChange } = usePeriodOffset(preset, setPreset, STORAGE_KEY)
  const range = rangeForPreset(preset, customStart, customEnd, offset)
  const rangeLabel = rangeLabelFor(preset, offset, range)
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : null

  const periodQuery = useCachedQuery(['rfq-desk', 'period', rangeKey], () => fetchRfqDeskPeriod(range), {
    enabled: Boolean(rangeKey),
  })
  const period = periodQuery.result
  const periodError = period?.error ? errorMessage(period.error) : null
  const figures = useMemo(() => {
    if (!period || period.error || !range) return null
    const rows = period.data ?? []
    const sendBacks = sendBacksByExec(rows, range)
    return {
      volume: rfqVolume(rows, range),
      steps: turnaroundByStep(rows, range),
      sendBacks,
      sentBackTotal: sendBacks.reduce((s, r) => s + r.sentBack, 0),
      bounced: bouncedAfterApproval(rows, range),
      priceRevisions: priceRevisionSummary(rows, range),
    }
    // rangeKey stands for range — a new object every render.
  }, [period, rangeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpis = figures
    ? [
        {
          key: 'raised',
          label: 'RFQs raised',
          value: figures.volume.raised,
          sub: `${figures.volume.fresh} fresh · ${figures.volume.revised} ${figures.volume.revised === 1 ? 'revision' : 'revisions'}`,
        },
        { key: 'quotes', label: 'Quotes received', value: figures.volume.quotes, sub: 'from Lixil' },
        {
          key: 'sentBack',
          label: 'Sent back',
          value: figures.sentBackTotal,
          sub: figures.volume.raised ? `${shareLabel(figures.sentBackTotal, figures.volume.raised)} of RFQs raised` : 'of RFQs raised',
        },
        {
          key: 'price',
          label: 'Price revisions',
          value: figures.volume.priceRevisions,
          sub: 'Lixil price changes',
        },
      ]
    : null

  return (
    <div className="vip-wide vip-stack">
      <div className="vip-report-section">Right now</div>
      {liveError && (
        <p className="vip-error" role="alert">
          Couldn't load the queues: {liveError}
        </p>
      )}
      <div className="vip-rfqdesk-lanes">
        {RFQ_LANES.map((lane) => (
          <Lane key={lane.key} lane={lane} rows={lanes[lane.key] ?? []} loading={liveLoading} />
        ))}
      </div>
      <WaitingOnExec rows={waiting} loading={liveLoading} />

      <div className="vip-report-section">Over the period</div>
      <DateRangeSelector
        preset={preset}
        onPresetChange={onPresetChange}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        offset={offset}
        onOffsetChange={setOffset}
      />

      {!range ? (
        <p className="vip-empty">Pick both dates to see this range.</p>
      ) : periodError ? (
        <p className="vip-error" role="alert">
          Couldn't load the figures: {periodError}
        </p>
      ) : !figures ? (
        <p className="vip-empty">Loading…</p>
      ) : (
        <>
          <DayKpiStrip kpis={kpis} />
          <div className="vip-report-grid">
            <TurnaroundCard steps={figures.steps} rangeLabel={rangeLabel} />
            <SendBacksCard rows={figures.sendBacks} rangeLabel={rangeLabel} />
            <BouncedCard bounced={figures.bounced} rangeLabel={rangeLabel} />
            <PriceRevisionsCard summary={figures.priceRevisions} rangeLabel={rangeLabel} />
          </div>
        </>
      )}
    </div>
  )
}

export default RfqDesk
