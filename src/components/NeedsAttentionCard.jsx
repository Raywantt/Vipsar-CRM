import { useState } from 'react'
import { buildAgeingPanel } from '../lib/attention'

function AttnRow({ bucket, onOpenPanel }) {
  return (
    <button type="button" className="vip-dd-attn-row" onClick={() => onOpenPanel(buildAgeingPanel(bucket))}>
      <span className="vip-dd-attn-bar" style={{ background: bucket.color }} />
      <span className="vip-dd-attn-main">
        <span className="vip-dd-attn-title">{bucket.title}</span>
        <span className="vip-dd-attn-sub">{bucket.sub}</span>
      </span>
      <span className="vip-dd-attn-count">{bucket.count}</span>
    </button>
  )
}

// The 5 attention buckets from src/lib/attention.js, rendered as clickable
// rows — each opens the same `ageing` drill-down the KPI row's "Stale leads"
// tile reuses for its own bucket (see buildAgeingPanel). `wide` switches the
// desktop row list to a tile grid (used when Dashboard renders this card
// alone at full width, e.g. 15D/Custom, with no Targets vs. actuals card to
// pair it with). Mobile ignores `wide` entirely — regardless of it, below
// 1024px this always caps to the first 3 buckets + a "+N more buckets"
// expand link (design_handoff_vipsar_mobile's Dashboard screen), since a
// phone-width tile grid was never an option here in the first place.
function NeedsAttentionCard({ buckets, onOpenPanel, wide = false }) {
  const [expanded, setExpanded] = useState(false)
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const hiddenCount = Math.max(0, buckets.length - 3)
  const mobileVisible = expanded ? buckets : buckets.slice(0, 3)

  return (
    <div className="vip-card">
      <div className="vip-card-head">
        <div className="vip-card-title">Needs attention</div>
        <div className="vip-dd-attn-total">{total}</div>
      </div>

      {total === 0 ? (
        <p className="vip-empty">Nothing needs attention right now.</p>
      ) : (
        <>
          <div className="vip-only-mobile vip-dd-attn-list">
            {mobileVisible.map((bucket) => (
              <AttnRow key={bucket.key} bucket={bucket} onOpenPanel={onOpenPanel} />
            ))}
            {!expanded && hiddenCount > 0 && (
              <button type="button" className="vip-dd-more-row" onClick={() => setExpanded(true)}>
                +{hiddenCount} more bucket{hiddenCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <div className={wide ? 'vip-only-desktop vip-dd-attn-list vip-dd-attn-grid' : 'vip-only-desktop vip-dd-attn-list'}>
            {buckets.map((bucket) => (
              <AttnRow key={bucket.key} bucket={bucket} onOpenPanel={onOpenPanel} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default NeedsAttentionCard
