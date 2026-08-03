import { Link } from 'react-router-dom'
import { formatCurrencyCompact } from '../lib/format'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function ClosureForecastCard({ leads }) {
  return (
    <div className="vip-card">
      <div className="vip-card-title">Closure forecast</div>

      {leads.length === 0 ? (
        <p className="vip-empty">No leads currently in the closure pipeline.</p>
      ) : (
        <div className="vip-stack-s">
          {leads.map((lead) => (
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
        </div>
      )}
    </div>
  )
}

export default ClosureForecastCard
