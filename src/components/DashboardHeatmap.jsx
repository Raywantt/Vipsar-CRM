import { useNavigate } from 'react-router-dom'
import { ACTIVITY_TYPES } from '../lib/activityTypes'
import { getInitials } from '../lib/initials'
import { computeOrderValueActuals, targetFor } from './TargetsVsActualsCard'
import { buildOrderValueAttainPanel, buildOverallAttainPanel } from '../lib/drilldownBuilders'

const COLS = [...ACTIVITY_TYPES, { value: 'order_value', label: 'Order value' }, { value: 'overall', label: 'Overall' }]

// Literal 5-step attainment scale from the Claude Design mockup's own
// `heatStyle()` — kept local since nothing else in the app needs this exact
// palette.
function heatStyle(pct) {
  if (pct == null) return { bg: 'var(--vip-canvas)', border: 'var(--vip-line)', fg: 'var(--vip-muted)', subFg: 'var(--vip-muted)' }
  if (pct >= 100) return { bg: '#0f6b6b', border: '#0f6b6b', fg: '#ffffff', subFg: '#cfe4e3' }
  if (pct >= 85) return { bg: '#a9cfcb', border: '#93c2bd', fg: '#0b3f3f', subFg: '#3d6a68' }
  if (pct >= 70) return { bg: '#dff0ef', border: '#cbe4e2', fg: '#0f6b6b', subFg: '#5f8785' }
  if (pct >= 50) return { bg: '#f4f1e0', border: '#e6e0c4', fg: '#7a6413', subFg: '#96854a' }
  return { bg: '#fbeaea', border: '#f2d6d6', fg: '#b4232a', subFg: '#b57a7d' }
}

// Exec x metric attainment grid (mockup's VipHeatmap) — one column per
// activity type plus order value and a blended "overall" column. Cell click
// opens the matching drill-down: the 5 activity-type cells fetch that exec's
// real log entries on demand (`onOpenLog`, async — see Dashboard.jsx), order
// value and overall are built synchronously from state already on the page.
function DashboardHeatmap({ employees, targets, activities, wonStageHistory, range, rangeLabel, onOpenLog, onOpenPanel }) {
  const navigate = useNavigate()
  const orderActuals = computeOrderValueActuals(wonStageHistory, range, true)

  return (
    <div className="vip-dd-heatmap">
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
            } else if (c.value === 'overall') {
              actual = null
              target = null
              sub = 'weighted'
              onClick = () => onOpenPanel(buildOverallAttainPanel({ employee: emp, targets, activities, wonStageHistory, range, rangeLabel }))
            } else {
              actual = activities.filter((a) => a.employee_id === emp.id && a.activity_type === c.value).length
              target = targetFor(targets, emp.id, c.value)
              sub = target != null ? `${actual}/${target}` : String(actual)
              onClick = () => onOpenLog(emp.id, c.value)
            }

            let pct = null
            if (c.value === 'overall') {
              const metrics = [...ACTIVITY_TYPES.map((t) => t.value), 'order_value']
              const ratios = metrics
                .map((m) => {
                  const t = targetFor(targets, emp.id, m)
                  if (!t) return null
                  const a = m === 'order_value' ? orderActuals.get(emp.id) ?? 0 : activities.filter((act) => act.employee_id === emp.id && act.activity_type === m).length
                  return a / t
                })
                .filter((r) => r != null)
              pct = ratios.length ? Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100) : null
            } else if (target) {
              pct = Math.round((actual / target) * 100)
            }

            const style = heatStyle(pct)

            return (
              <button
                key={c.value}
                type="button"
                className="vip-dd-heatmap-cell"
                style={{ background: style.bg, borderColor: style.border }}
                onClick={onClick}
              >
                <span className="vip-dd-heatmap-pct" style={{ color: style.fg }}>
                  {pct != null ? `${pct}%` : '—'}
                </span>
                <span className="vip-dd-heatmap-sub" style={{ color: style.subFg }}>
                  {sub}
                </span>
              </button>
            )
          })}
        </div>
      ))}

      <div className="vip-dd-heatmap-legend">
        <span className="vip-dd-hint">Attainment</span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch" style={{ background: '#0f6b6b' }} /> Hit target
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch" style={{ background: '#a9cfcb' }} /> 85–99%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch" style={{ background: '#dff0ef' }} /> 70–84%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch" style={{ background: '#f4f1e0' }} /> 50–69%
        </span>
        <span className="vip-dd-legend-item">
          <span className="vip-dd-legend-swatch" style={{ background: '#fbeaea' }} /> Below 50%
        </span>
      </div>
    </div>
  )
}

export default DashboardHeatmap
