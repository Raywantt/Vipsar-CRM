import { formatCurrencyCompact } from '../lib/format'
import { ARCHITECT_MEETING_DAYS } from '../lib/architectStats'

// The business development manager's "Right now" tiles (BDM.md Step 5) —
// point-in-time figures, untouched by the date range below them. Owner's
// ruling: the same shape as the owner's own Dashboard strip, four tiles each
// opening its own detail list, with the numbers shown on a phone too (2×2),
// unlike RightNowStrip's word-only mobile chips.
//
// Reuses RightNowStrip's grid and tile vocabulary (.vip-rightnow-grid,
// .vip-dd-kpi-tile) rather than a second tile style; the column count comes
// from the tile count, same as there.
//
// A value of null renders "—" (still loading, or the source failed).
function BdmRightNow({
  openValue,
  openCount,
  toMeetCount,
  completenessPct,
  gapCount,
  gapPct,
  onOpenPipeline,
  onOpenArchitects,
  onOpenCompleteness,
  onOpenGap,
}) {
  const tiles = [
    {
      key: 'pipeline',
      label: 'Open pipeline',
      value: openValue != null ? formatCurrencyCompact(openValue) : '—',
      sub: openCount != null ? `${openCount} lead${openCount === 1 ? '' : 's'}` : null,
      onOpen: onOpenPipeline,
    },
    {
      key: 'architects',
      label: 'Architects to meet',
      value: toMeetCount != null ? String(toMeetCount) : '—',
      sub: `no meeting ${ARCHITECT_MEETING_DAYS}+ days`,
      onOpen: onOpenArchitects,
    },
    {
      key: 'completeness',
      label: 'Data completeness',
      value: completenessPct != null ? `${Math.round(completenessPct)}%` : '—',
      sub: 'of your open leads',
      onOpen: onOpenCompleteness,
    },
    {
      key: 'gap',
      label: 'Follow-up gap',
      value: gapCount != null ? String(gapCount) : '—',
      sub: gapPct != null ? `${Math.round(gapPct)}% of open leads` : null,
      onOpen: onOpenGap,
    },
  ]

  return (
    <div className="vip-rightnow">
      <div className="vip-dd-eyebrow">Right now</div>
      <div className="vip-rightnow-grid" style={{ '--vip-rightnow-cols': tiles.length }}>
        {tiles.map((t) => (
          <button key={t.key} type="button" className="vip-dd-kpi-tile" onClick={t.onOpen}>
            <div className="vip-dd-kpi-label">{t.label}</div>
            <div className="vip-dd-kpi-value-row">
              <span className="vip-dd-kpi-value">{t.value}</span>
            </div>
            {t.sub && <div className="vip-dd-kpi-sub">{t.sub}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

export default BdmRightNow
