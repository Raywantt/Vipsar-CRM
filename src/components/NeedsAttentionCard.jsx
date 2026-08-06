import { buildAgeingPanel } from '../lib/attention'

// The 5 attention buckets from src/lib/attention.js, rendered as clickable
// rows — each opens the same `ageing` drill-down the KPI row's "Stale leads"
// tile reuses for its own bucket (see buildAgeingPanel). `wide` switches the
// row list to a tile grid at desktop widths — used when Dashboard renders
// this card alone at full width (15D/Custom, no Targets vs. actuals card to
// pair it with) so the row text doesn't stretch across a mostly-empty row.
function NeedsAttentionCard({ buckets, onOpenPanel, wide = false }) {
  const total = buckets.reduce((s, b) => s + b.count, 0)

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Needs attention</div>
        <div className="vip-dd-attn-total">{total}</div>
      </div>

      {total === 0 ? (
        <p className="vip-empty">Nothing needs attention right now.</p>
      ) : (
        <div className={wide ? 'vip-dd-attn-list vip-dd-attn-grid' : 'vip-dd-attn-list'}>
          {buckets.map((bucket) => (
            <button
              key={bucket.key}
              type="button"
              className="vip-dd-attn-row"
              onClick={() => onOpenPanel(buildAgeingPanel(bucket))}
            >
              <span className="vip-dd-attn-bar" style={{ background: bucket.color }} />
              <span className="vip-dd-attn-main">
                <span className="vip-dd-attn-title">{bucket.title}</span>
                <span className="vip-dd-attn-sub">{bucket.sub}</span>
              </span>
              <span className="vip-dd-attn-count">{bucket.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default NeedsAttentionCard
