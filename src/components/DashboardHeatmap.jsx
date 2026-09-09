import { ROLES, roleLabel } from '../lib/roles'
import { useNavigate } from 'react-router-dom'
import { ACTIVITY_METRIC_OPTIONS } from '../lib/targetMetrics'
import { getInitials } from '../lib/initials'
import { computeOrderValueActuals, computeScanningLeadsActuals, targetFor } from './TargetsVsActualsCard'
import { buildOrderValueAttainPanel, buildOverallAttainPanel, buildScanningLeadsAttainPanel } from '../lib/drilldownBuilders'
import { attainmentHeatClass } from '../lib/statusColors'

// Driven off METRIC_OPTIONS' underlying pieces (see targetMetrics.js) rather
// than raw ACTIVITY_TYPES, so a metric dropped from targeting (Office Day,
// Booking Update, Site Visit, Architect Meeting) drops out of this heatmap
// too instead of showing a column nothing can ever be targeted against.
// won_count (Bookings) isn't a heatmap column either — it never was.
// Scanning Leads is the one column here computed from leads, not
// activities — see the 'scanning_leads' branch below.
const COLS = [
  { value: 'scanning_leads', label: 'Scanning Leads' },
  ...ACTIVITY_METRIC_OPTIONS,
  { value: 'order_value', label: 'Order value' },
  { value: 'overall', label: 'Overall' },
]

// Exec x metric attainment grid (mockup's VipHeatmap) — one column per
// targetable metric plus a blended "overall" column. Cell click opens the
// matching drill-down: the 4 activity-type cells fetch that exec's real log
// entries on demand (`onOpenLog`, async — see Dashboard.jsx); scanning
// leads, order value and overall are built synchronously from state already
// on the page.
function DashboardHeatmap({ employees, targets, activities, wonStageHistory, breakdownLeads, range, rangeLabel, onOpenLog, onOpenPanel }) {
  const navigate = useNavigate()
  const orderActuals = computeOrderValueActuals(wonStageHistory, range, true)
  const scanningActuals = computeScanningLeadsActuals(breakdownLeads, range, true)

  // The grid's column count is published to CSS rather than duplicated in the
  // stylesheet. COLS is derived from ACTIVITY_METRIC_OPTIONS, which has changed
  // once already; a hardcoded track count in vipsar-theme.css silently fell out
  // of step with it and left every row ending in an empty column. Setting it
  // here means the two cannot diverge again. (Phase 9 finding F-P3-2.)
  return (
    <div className="vip-dd-heatmap" style={{ '--vip-heatmap-cols': COLS.length }}>
      <div className="vip-dd-heatmap-row vip-dd-heatmap-head">
        <div className="vip-dd-heatmap-rowlabel">Sales exec</div>
        {COLS.map((c) => (
          <div key={c.value} className="vip-dd-heatmap-collabel">
            {c.label}
          </div>
        ))}
      </div>

      {employees.map((emp) => (
        <div key={emp.id} className="vip-dd-heatmap-row">
          <div className="vip-dd-heatmap-exec" onClick={() => navigate(`/employees/${emp.id}`)}>
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
          </div>

          {COLS.map((c) => {
            let actual
            let target
            let sub
            let onClick

            if (c.value === 'order_value') {
              actual = orderActuals.get(emp.id) ?? 0
              target = targetFor(targets, emp.id, 'order_value')
              sub = target != null ? `₹${(actual / 100000).toFixed(1)}/${(target / 100000).toFixed(0)}L` : '—'
              onClick = () => onOpenPanel(buildOrderValueAttainPanel({ employees, targets, wonStageHistory, range, employeeId: emp.id, rangeLabel }))
            } else if (c.value === 'scanning_leads') {
              actual = scanningActuals.get(emp.id) ?? 0
              target = targetFor(targets, emp.id, 'scanning_leads')
              sub = target != null ? `${actual}/${Math.round(target)}` : String(actual)
              onClick = () => onOpenPanel(buildScanningLeadsAttainPanel({ employees, targets, breakdownLeads, range, employeeId: emp.id, rangeLabel }))
            } else if (c.value === 'overall') {
              actual = null
              target = null
              sub = 'weighted'
              onClick = () => onOpenPanel(buildOverallAttainPanel({ employee: emp, targets, activities, wonStageHistory, breakdownLeads, range, rangeLabel }))
            } else {
              actual = activities.filter((a) => a.employee_id === emp.id && a.activity_type === c.value).length
              target = targetFor(targets, emp.id, c.value)
              // actual is already a whole count (array length); target_value
              // can be a decimal (SetTargetForm's input allows it) — round it
              // for display, a count target shouldn't show a fractional part.
              sub = target != null ? `${actual}/${Math.round(target)}` : String(actual)
              onClick = () => onOpenLog(emp.id, c.value)
            }

            let pct = null
            if (c.value === 'overall') {
              const metrics = ['scanning_leads', ...ACTIVITY_METRIC_OPTIONS.map((t) => t.value), 'order_value']
              const ratios = metrics
                .map((m) => {
                  const t = targetFor(targets, emp.id, m)
                  if (!t) return null
                  const a =
                    m === 'order_value'
                      ? orderActuals.get(emp.id) ?? 0
                      : m === 'scanning_leads'
                        ? scanningActuals.get(emp.id) ?? 0
                        : activities.filter((act) => act.employee_id === emp.id && act.activity_type === m).length
                  return a / t
                })
                .filter((r) => r != null)
              pct = ratios.length ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100) : null
            } else if (target) {
              pct = Math.round((actual / target) * 100)
            }

            const heatClass = attainmentHeatClass(pct) ?? 'vip-dd-heat-none'

            return (
              <button key={c.value} type="button" className={`vip-dd-heatmap-cell ${heatClass}`} onClick={onClick}>
                <span className="vip-dd-heatmap-pct">{pct != null ? `${pct}%` : '—'}</span>
                <span className="vip-dd-heatmap-sub">{sub}</span>
              </button>
            )
          })}
        </div>
      ))}

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
    </div>
  )
}

export default DashboardHeatmap
