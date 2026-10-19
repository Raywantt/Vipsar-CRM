import { ROLES, roleLabel } from '../lib/roles'
import { Link } from 'react-router-dom'
import { METRIC_OPTIONS, METRIC_GROUPS } from '../lib/targetMetrics'
import { getInitials } from '../lib/initials'
import { computeTargetActuals, actualFor, blendedAttainmentFor, targetFor } from './TargetsVsActualsCard'
import { buildOverallAttainPanel, buildLeadCountAttainPanel, isLeadCountMetric } from '../lib/drilldownBuilders'
import { attainmentHeatClass } from '../lib/statusColors'

// One column per target for the period on screen (`metrics`, from
// metricsForPeriod — a week has no Order value column), grouped under
// Results / Activity / Leads (owner's choice, 2026-10-19: every column,
// always, grouped), plus a blended Overall. The grid is wider than a 1024px
// screen, so it scrolls sideways inside the card with the name column pinned
// (theme section 51).
function columnsFor(metrics) {
  const cols = [...metrics, { value: 'overall', short: 'Overall', group: 'overall' }]
  // The first column of each group after the first carries a gutter, on every
  // row alike, so the groups read apart without breaking the shared grid. (The
  // first group needs none — the name column already stands apart — and its
  // first column, Order value, holds the widest figure.)
  const starts = new Set(cols.filter((c, i) => i > 0 && cols[i - 1].group !== c.group).map((c) => c.value))
  return { cols, gs: (c) => (starts.has(c.value) ? ' vip-dd-heatmap-groupstart' : '') }
}

// An order value cell's "actual/target", in lakh — or crore once either passes
// ₹1 Cr, since a quarter's "₹120.5/200L" would not fit the column.
function moneySub(actual, target) {
  return Math.max(actual, target) >= 1e7
    ? `₹${(actual / 1e7).toFixed(1)}/${(target / 1e7).toFixed(1)}Cr`
    : `₹${(actual / 1e5).toFixed(1)}/${(target / 1e5).toFixed(0)}L`
}

// Exec x metric attainment grid (mockup's VipHeatmap). Cell click opens the
// matching drill-down: an activity cell fetches that exec's real log entries
// on demand (`onOpenLog`, async — see Dashboard.jsx); order value opens the
// Orders booked popup on that exec; the lead counts (scanning,
// architect / client referral leads, quotes sent) and overall are built
// synchronously from state already on the page.
function DashboardHeatmap({ employees, targets, activities, rfqCounting, wonStageHistory, breakdownLeads, range, rangeLabel, onOpenLog, onOpenPanel, onOpenBooked, canCancelTarget = false, metrics = METRIC_OPTIONS }) {
  const { cols: COLS, gs } = columnsFor(metrics)
  // The one call every target surface makes (TargetsVsActualsCard.jsx), so a
  // cell can't count a metric differently from the list, the Overall popup or
  // the Sales Exec Profile.
  const actuals = computeTargetActuals({ activities, rfqCounting, wonStageHistory, breakdownLeads, range }, true)

  // The grid's column count is published to CSS rather than duplicated in the
  // stylesheet, so the two cannot diverge (Phase 9 finding F-P3-2).
  return (
    <>
      <div className="vip-dd-heatmap-scroll">
        <div className="vip-dd-heatmap" style={{ '--vip-heatmap-cols': COLS.length }}>
          <div className="vip-dd-heatmap-row vip-dd-heatmap-groups" aria-hidden="true">
            <div className="vip-dd-heatmap-pin" />
            {METRIC_GROUPS.map((g, i) => {
              const span = COLS.filter((c) => c.group === g.key).length
              if (!span) return null
              return (
                <div key={g.key} className={`vip-dd-heatmap-group${i > 0 ? ' vip-dd-heatmap-groupstart' : ''}`} style={{ gridColumn: `span ${span}` }}>
                  {g.label}
                </div>
              )
            })}
            <div className="vip-dd-heatmap-groupstart" />
          </div>
          <div className="vip-dd-heatmap-row vip-dd-heatmap-head">
            <div className="vip-dd-heatmap-rowlabel vip-dd-heatmap-pin">Sales exec</div>
            {COLS.map((c) => (
              <div key={c.value} className={`vip-dd-heatmap-collabel${gs(c)}`} title={c.label}>
                {c.short}
              </div>
            ))}
          </div>

          {employees.map((emp) => (
            <div key={emp.id} className="vip-dd-heatmap-row">
              <Link to={`/employees/${emp.id}`} className="vip-dd-heatmap-exec vip-dd-heatmap-pin">
                <span className="vip-dd-avatar">{getInitials(emp.name)}</span>
                <span className="vip-dd-heatmap-name">{emp.name}</span>
                {/* Same badge the Day Review table uses — a manager is ranked
                    among the execs here on purpose, so the row needs to say
                    which one they are. */}
                {emp.role === ROLES.SALES_MANAGER && (
                  <span className="vip-role-tag" title={roleLabel(emp.role)}>
                    MGR
                  </span>
                )}
              </Link>

              {COLS.map((c) => {
                let pct = null
                let sub
                let onClick

                if (c.value === 'overall') {
                  // Same capped-at-100%-per-metric blend EmployeeProfile's rank
                  // pill and this card's own mobile row use — see
                  // blendedAttainmentFor's header comment for the bug this fixed.
                  const blended = blendedAttainmentFor(emp.id, actuals, targets, metrics)
                  pct = blended == null ? null : Math.round(blended * 100)
                  sub = 'weighted'
                  onClick = () => onOpenPanel(buildOverallAttainPanel({ employee: emp, targets, activities, rfqCounting, wonStageHistory, breakdownLeads, range, rangeLabel, metrics }))
                } else {
                  // RFQ Raised reads the already-filtered count (fresh RFQs, the
                  // desk's approval rule) through actualFor — a second raw tally
                  // here is exactly what once made this column disagree with the
                  // Sales Exec Profile.
                  const actual = actualFor(c, actuals, emp.id)
                  const target = targetFor(targets, emp.id, c.value)
                  if (target) pct = Math.round((actual / target) * 100)
                  if (c.kind === 'order_value') {
                    sub = target != null ? moneySub(actual, target) : '—'
                  } else {
                    // A count; a target_value can be a stored decimal, so round it.
                    sub = target != null ? `${actual}/${Math.round(target)}` : String(actual)
                  }
                  if (c.kind === 'order_value') {
                    // The Orders booked popup, opened on this exec — Dashboard
                    // builds it (see its `bookedFor`), so the cell only says whose.
                    onClick = () => onOpenBooked(emp.id)
                  } else if (isLeadCountMetric(c.value)) {
                    onClick = () =>
                      onOpenPanel(
                        buildLeadCountAttainPanel({ metric: c.value, employees, targets, breakdownLeads, range, employeeId: emp.id, rangeLabel, canCancelTarget })
                      )
                  } else {
                    onClick = () => onOpenLog(emp.id, c.value)
                  }
                }

                const heatClass = attainmentHeatClass(pct) ?? 'vip-dd-heat-none'

                return (
                  <button key={c.value} type="button" className={`vip-dd-heatmap-cell ${heatClass}${gs(c)}`} onClick={onClick} title={c.label}>
                    <span className="vip-dd-heatmap-pct">{pct != null ? `${pct}%` : '—'}</span>
                    <span className="vip-dd-heatmap-sub">{sub}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="vip-dd-heatmap-legend">
        <span className="vip-dd-hint">Attainment</span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-6" /> Hit target
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-5" /> 90–99%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-4" /> 75–89%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-3" /> 60–74%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-2" /> 40–59%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch vip-dd-heat-1" /> Below 40%
        </span>
      </div>
    </>
  )
}

export default DashboardHeatmap
