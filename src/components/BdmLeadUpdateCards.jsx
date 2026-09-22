import { Link } from 'react-router-dom'
import { fetchHandedOverRows } from '../lib/bdmQueries'
import { buildHandedOverRows } from '../lib/bdmLeadUpdates'
import { summariseClosedRows } from '../lib/bdmDashboard'
import { useBdmPeriodRows } from '../hooks/useBdmPeriodRows'
import { leadDisplayName } from '../lib/leadName'
import { formatCurrencyCompact, formatDateShort } from '../lib/format'
import { lossReasonLabel } from '../lib/lossReasonOptions'

// The business development manager's lead-update cards (BDM.md Step 3 —
// owner's ruling: two cards, period lists, nothing to dismiss) and Step 5's
// Pipeline closed figure. Separate components, because the owner ruled that
// BDM Dashboard cards are never merged.
//
// Closed and Pipeline closed are handed ONE fetch by the page
// (useClosedRows, src/hooks/useBdmPeriodRows.js): the figure is a reduction of
// the very rows the list shows, so the two can't disagree about which leads
// closed.
//
// Names of the execs are plain text, never links: a BDM can't open
// /employees/:id (canOpenEmployeeProfiles — owner's ruling at Step 2).

function CardBody({ rows, error, empty, children }) {
  if (error) {
    return (
      <p className="vip-error" role="alert">
        {error}
      </p>
    )
  }
  if (!rows) return <p className="vip-empty">Loading…</p>
  if (!rows.length) return <p className="vip-empty">{empty}</p>
  return <div className="vip-bdm-list">{children}</div>
}

export function BdmHandedOverCard({ range, rangeLabel, bdmId }) {
  const { rows, error } = useBdmPeriodRows(
    'handed-over',
    fetchHandedOverRows,
    (data, id) => buildHandedOverRows(data, id),
    range,
    bdmId
  )

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h2 className="vip-card-title">Handed over · {rangeLabel}</h2>
        {rows?.length > 0 && <span className="vip-bdm-list-count">{rows.length}</span>}
      </div>
      <CardBody rows={rows} error={error} empty={`None of your leads were assigned ${rangeLabel}.`}>
        {rows?.map((r) => (
          <div key={r.key} className="vip-bdm-list-row">
            <div className="vip-bdm-list-main">
              <Link to={`/leads/${r.leadId}`} className="vip-bdm-list-lead">
                {leadDisplayName(r.lead)}
              </Link>
              <span className="vip-bdm-list-meta">{r.execName ? `Assigned to ${r.execName}` : 'Assigned'}</span>
            </div>
            <span className="vip-bdm-list-date">{formatDateShort(r.at)}</span>
          </div>
        ))}
      </CardBody>
    </div>
  )
}

// `closed` is useClosedRows(...)'s result (src/hooks/useBdmPeriodRows.js).
export function BdmClosedCard({ closed, rangeLabel }) {
  const { rows, error } = closed

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <h2 className="vip-card-title">Closed · {rangeLabel}</h2>
        {rows?.length > 0 && <span className="vip-bdm-list-count">{rows.length}</span>}
      </div>
      <CardBody rows={rows} error={error} empty={`None of your leads were won or lost ${rangeLabel}.`}>
        {rows?.map((r) => (
          <div key={r.key} className="vip-bdm-list-row">
            <div className="vip-bdm-list-main">
              <Link to={`/leads/${r.leadId}`} className="vip-bdm-list-lead">
                {leadDisplayName(r.lead)}
              </Link>
              <span className="vip-bdm-list-meta">
                <span className={r.outcome === 'won' ? 'vip-bdm-outcome-won' : 'vip-bdm-outcome-lost'}>
                  {r.outcome === 'won'
                    ? r.value != null
                      ? `Won · ${formatCurrencyCompact(r.value)}`
                      : 'Won'
                    : r.reason
                      ? `Lost — ${lossReasonLabel(r.reason)}${r.competitor ? ` (${r.competitor})` : ''}`
                      : 'Lost'}
                </span>
                {r.ownerName ? ` · ${r.ownerName}` : ''}
              </span>
            </div>
            <span className="vip-bdm-list-date">{formatDateShort(r.at)}</span>
          </div>
        ))}
      </CardBody>
    </div>
  )
}

// "Pipeline closed" (BDM.md Step 5). Owner's ruling: the won value and how many
// leads as the headline, then how many were lost and the win rate. `closed`
// is the same useClosedRows(...) result the Closed card lists.
export function BdmPipelineClosedCard({ closed, rangeLabel, className = null }) {
  const { rows, error } = closed
  const s = rows ? summariseClosedRows(rows) : null

  return (
    <div className={className ? `vip-card ${className}` : 'vip-card'}>
      <h2 className="vip-card-title">Pipeline closed · {rangeLabel}</h2>
      {error ? (
        <p className="vip-error" role="alert">
          {error}
        </p>
      ) : !s ? (
        <p className="vip-empty">Loading…</p>
      ) : s.wonCount + s.lostCount === 0 ? (
        <p className="vip-empty">None of your leads were won or lost {rangeLabel}.</p>
      ) : (
        <div className="vip-bdm-closed">
          <div className="vip-bdm-closed-head">
            <span className="vip-bdm-closed-value">{formatCurrencyCompact(s.wonValue)}</span>
            <span className="vip-bdm-closed-unit">
              won · {s.wonCount} lead{s.wonCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="vip-bdm-closed-line">
            {s.lostCount} lost · {s.winRate}% win rate
          </div>
        </div>
      )}
    </div>
  )
}
