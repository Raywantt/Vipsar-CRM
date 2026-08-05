// Reusable SVG donut — segments in (`{ color, count }`), stroke-dasharray
// math done once here instead of duplicated at each call site. Used by both
// LeadsBySourceCard's compact view and DrilldownPanel's `mix` kind.
function DonutChart({ segments, size = 104, centerValue, centerLabel }) {
  const total = segments.reduce((s, seg) => s + seg.count, 0)
  const C = 2 * Math.PI * 44
  let acc = 0
  const arcs = segments
    .filter((seg) => seg.count > 0)
    .map((seg) => {
      const len = total ? (seg.count / total) * C : 0
      const arc = { color: seg.color, dash: `${len.toFixed(2)} ${(C - len).toFixed(2)}`, offset: `${(-acc).toFixed(2)}` }
      acc += len
      return arc
    })

  return (
    <div className="vip-dd-donut" style={{ width: size, height: size, flex: `0 0 ${size}px` }}>
      <svg viewBox="0 0 120 120" className="vip-dd-donut-svg">
        {arcs.length === 0 ? (
          <circle cx="60" cy="60" r="44" fill="none" stroke="var(--vip-line-soft)" strokeWidth="18" />
        ) : (
          arcs.map((a, i) => (
            <circle
              key={i}
              cx="60"
              cy="60"
              r="44"
              fill="none"
              stroke={a.color}
              strokeWidth="18"
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
              transform="rotate(-90 60 60)"
            />
          ))
        )}
      </svg>
      <div className="vip-dd-donut-center">
        <div className="vip-dd-donut-total">{centerValue ?? total}</div>
        {centerLabel && <div className="vip-dd-donut-unit">{centerLabel}</div>}
      </div>
    </div>
  )
}

export default DonutChart
