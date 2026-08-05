import { Link } from 'react-router-dom'
import { formatCurrencyCompact } from '../lib/format'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// This list is a pipeline snapshot with no natural cap (every lead with a
// quote sent or a probability set) — 40+ rows on a real dataset, which is
// exactly the "too much space" this bird's-eye card shouldn't take. Shows
// the soonest `maxRows` (already sorted that way by fetchClosureForecast)
// and pushes the rest into the same `forecast` drill-down the header link
// opens.
const DEFAULT_MAX_ROWS = 6

function ClosureForecastCard({ leads, onOpenPanel, maxRows = DEFAULT_MAX_ROWS }) {
  const visible = leads.slice(0, maxRows)
  const remaining = leads.length - visible.length

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Closure forecast</div>
        {onOpenPanel && (
          <button type="button" className="vip-dd-open-link" onClick={onOpenPanel}>
            Details ›
          </button>
        )}
      </div>

      {leads.length === 0 ? (
        <p className="vip-empty">No leads currently in the closure pipeline.</p>
      ) : (
        <div className="vip-stack-s">
          {visible.map((lead) => (
            <Link
              key={lead.id}
              to={`/leads/${lead.id}`}
              className="vip-clickable"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                paddingBottom: 9,
                borderBottom: '1px solid var(--vip-line-soft)',
                textDecoration: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div className="vip-row-title">{lead.parties?.name ?? '(no party)'}</div>
                <div className="vip-row-value">{formatCurrencyCompact(lead.quote_value)}</div>
              </div>
              <div className="vip-bar-row">
                <div style={{ flex: '0 0 56px', fontSize: 11, color: 'var(--vip-muted)' }}>
                  {lead.employees?.name ?? '—'}
                </div>
                <div className="vip-bar-track">
                  <div className="vip-bar-fill" style={{ width: `${lead.closure_probability ?? 0}%` }} />
                </div>
                <div className="vip-bar-value" style={{ flex: '0 0 34px' }}>
                  {lead.closure_probability != null ? `${lead.closure_probability}%` : '—'}
                </div>
                <div className="vip-bar-value" style={{ flex: '0 0 42px', color: 'var(--vip-muted)' }}>
                  {formatDate(lead.estimated_close_date)}
                </div>
              </div>
            </Link>
          ))}
          {remaining > 0 && (
            <button type="button" className="vip-dd-more-row" onClick={onOpenPanel}>
              +{remaining} more · View all
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default ClosureForecastCard
