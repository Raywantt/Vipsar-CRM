import { formatCurrencyCompact } from '../lib/format'

// The "Right now" strip — point-in-time pipeline metrics with no date range
// to filter by, sitting above Dashboard's date range selector (below the
// sales manager's My-numbers/My-team toggle). See
// dashboard-time-independent-metrics-prompt.md and
// TIME-INDEPENDENT-METRICS-LOG.md (both repo root) for the full design
// history — this is Milestone 4's static UI pass, wired to placeholder
// numbers from Dashboard.jsx; Milestone 5 replaces those with a real
// dashboard_snapshot_metrics() fetch without needing to change this file's
// own shape.
//
// Stale leads moved in here from KpiSparkRow — it's the same kind of
// point-in-time snapshot as every other tile in this strip (not scoped to
// the selected date range), so it no longer belongs below the date-range
// selector KpiSparkRow sits under. It still uses the exact same
// `staleBucket`/`buildAgeingPanel` computation Needs Attention's matching
// row already relies on — this is a placement change, not a new metric or
// a new query.
//
// `showWorkload` hides the Workload tile entirely in single-person scope (a
// sales exec, or a manager viewing "My numbers") — comparing one person's
// workload to itself is meaningless. Dashboard.jsx passes its own
// `seesOthersData` for this, which already means exactly "more than one
// person's data is in view" for every role.
function RightNowStrip({
  showWorkload,
  activeValue,
  activeLeadCount,
  onHoldValue,
  onHoldCount,
  onHoldAvgDays,
  staleCount,
  completenessPct,
  gapCount,
  gapPct,
  workloadBusiestName,
  workloadBusiestCount,
  workloadLightestName,
  workloadLightestCount,
  concentrationPct,
  onOpenActive,
  onOpenOnHold,
  onOpenStale,
  onOpenCompleteness,
  onOpenGap,
  onOpenWorkload,
  onOpenConcentration,
}) {
  const tiles = [
    {
      key: 'active',
      label: 'Active Pipeline',
      value: formatCurrencyCompact(activeValue),
      sub: activeLeadCount != null ? `${activeLeadCount} lead${activeLeadCount === 1 ? '' : 's'}` : null,
      onOpen: onOpenActive,
    },
    {
      key: 'on_hold',
      label: 'On-Hold Pipeline',
      value: formatCurrencyCompact(onHoldValue),
      sub:
        onHoldCount != null
          ? `${onHoldCount} lead${onHoldCount === 1 ? '' : 's'}${
              onHoldAvgDays != null ? ` · avg ${Math.round(onHoldAvgDays)}d parked` : ''
            }`
          : null,
      onOpen: onOpenOnHold,
    },
    {
      key: 'stale',
      label: 'Stale Leads',
      value: staleCount != null ? String(staleCount) : '—',
      sub: 'no activity 14+ days',
      onOpen: onOpenStale,
    },
    {
      key: 'completeness',
      label: 'Data Completeness',
      value: completenessPct != null ? `${Math.round(completenessPct)}%` : '—',
      sub: null,
      onOpen: onOpenCompleteness,
    },
    {
      key: 'gap',
      label: 'Follow-up Gap',
      value: gapCount != null ? String(gapCount) : '—',
      sub: gapPct != null ? `${Math.round(gapPct)}% of open leads` : null,
      onOpen: onOpenGap,
    },
    showWorkload && {
      key: 'workload',
      label: 'Workload',
      // The headline stays a plain number (busiest exec's own open-lead
      // count) so this tile still reads as a "value" like its neighbours —
      // the actual busiest/lightest comparison the brief asks for lives in
      // the sub-line, and in full on the drill-down panel itself.
      value: workloadBusiestCount != null ? String(workloadBusiestCount) : '—',
      sub:
        workloadBusiestName && workloadLightestName
          ? `${workloadBusiestName} busiest · ${workloadLightestName} lightest (${workloadLightestCount})`
          : null,
      onOpen: onOpenWorkload,
    },
    {
      key: 'concentration',
      label: 'Concentration',
      value: concentrationPct != null ? `${Math.round(concentrationPct)}%` : '—',
      sub: 'in top 10% of deals',
      onOpen: onOpenConcentration,
    },
  ].filter(Boolean)

  return (
    <div className="vip-rightnow">
      <div className="vip-dd-eyebrow">Right now</div>

      {/* Mobile: word-only chips, no numbers at all — the real figures only
          ever appear once a chip's own drill-down panel is opened. Wraps
          rather than scrolls, since word-length labels fit several per row.
          Zero query cost pre-tap: nothing here depends on the placeholder/
          real values above at all. */}
      <div className="vip-only-mobile vip-rightnow-chips">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="vip-rightnow-chip" onClick={t.onOpen}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Desktop: the fuller stat-chip treatment — reuses KpiSparkRow's own
          .vip-dd-kpi-tile per-tile vocabulary directly rather than
          inventing a second one. The outer grid is .vip-rightnow-grid, NOT
          .vip-dd-kpi-grid — that class hardcodes a 6-column desktop width,
          correct for KpiSparkRow (always exactly 6 tiles) but wrong here,
          since the Workload tile drops out entirely in single-person scope
          and a fixed-6 grid then leaves a visible empty cell (caught live
          in the browser as a sales-exec session). --vip-rightnow-cols is
          set from the real tile count below, same "column count comes from
          the component, not a number typed in CSS" fix DashboardHeatmap
          already uses for its own column count. No sparkline on any tile
          here — every one of these is a point-in-time snapshot, same
          "value-only" rule KpiSparkRow already established for its own
          snapshot tile (Weighted forecast). */}
      <div className="vip-only-desktop">
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
    </div>
  )
}

export default RightNowStrip
