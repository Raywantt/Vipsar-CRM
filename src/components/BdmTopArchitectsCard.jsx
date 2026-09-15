import { Link } from 'react-router-dom'
import { formatCurrencyCompact } from '../lib/format'

// "Top 5 architects" on the business development manager's Dashboard (BDM.md
// Step 5). `rows` is topArchitects(...) (src/lib/bdmDashboard.js): ranked by
// joineries in the period, with Meetings for the period (owner's ruling: that
// label, following the period picker) and open pipeline as a snapshot.
//
// One DOM for both widths. At ≥1024px it is a four-column table with a header
// row; below that the header goes and each figure carries its own unit word
// ("2 joineries") on a second line under the name — four columns of numbers
// don't fit a phone track beside an architect's name.
// `emptyText` lets the owner's Architect Network (every BDM) say who it's
// about; the default is the BDM's own wording.
function BdmTopArchitectsCard({ rows, rangeLabel, loading, error, emptyText = null }) {
  return (
    <div className="vip-card">
      <h2 className="vip-card-title">Top 5 architects · {rangeLabel}</h2>
      {error ? (
        <p className="vip-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="vip-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="vip-empty">{emptyText ?? `No architect sent you a joinery or met you ${rangeLabel}.`}</p>
      ) : (
        <div className="vip-bdm-top" role="table" aria-label={`Top architects ${rangeLabel}`}>
          <div className="vip-bdm-top-row vip-bdm-top-headrow" role="row">
            <span role="columnheader">Architect</span>
            <span role="columnheader" className="vip-bdm-top-num">Joineries</span>
            <span role="columnheader" className="vip-bdm-top-num">Meetings</span>
            <span role="columnheader" className="vip-bdm-top-num">Open pipeline</span>
          </div>
          {rows.map((r, i) => (
            <Link key={r.architectId} to={`/architects/${r.architectId}`} className="vip-bdm-top-row" role="row">
              <span className="vip-bdm-top-name" role="cell">
                <span className="vip-bdm-top-rank">{i + 1}</span>
                {r.name ?? 'Architect'}
              </span>
              <span className="vip-bdm-top-num" role="cell">
                <b>{r.joineries}</b>
                <span className="vip-bdm-top-unit"> {r.joineries === 1 ? 'joinery' : 'joineries'}</span>
              </span>
              <span className="vip-bdm-top-num" role="cell">
                <b>{r.meetings}</b>
                <span className="vip-bdm-top-unit"> {r.meetings === 1 ? 'meeting' : 'meetings'}</span>
              </span>
              <span className="vip-bdm-top-num" role="cell">
                <b>{r.openValue ? formatCurrencyCompact(r.openValue) : '—'}</b>
                <span className="vip-bdm-top-unit"> open</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default BdmTopArchitectsCard
