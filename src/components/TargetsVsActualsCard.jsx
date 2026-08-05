import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { formatCurrency } from '../lib/format'
import SetTargetForm from './SetTargetForm'
import DashboardHeatmap from './DashboardHeatmap'

function emptyMetricCounts() {
  return Object.fromEntries(METRIC_OPTIONS.filter((m) => m.value !== 'order_value').map((m) => [m.value, 0]))
}

// activities is already scoped to the current period + role by the caller
// (same array ActivityCountsCard uses) — just tally by activity_type, and by
// employee_id too when showByEmployee.
function computeActivityActuals(activities, showByEmployee) {
  if (!showByEmployee) {
    const totals = emptyMetricCounts()
    activities.forEach((a) => {
      if (a.activity_type in totals) totals[a.activity_type] += 1
    })
    return totals
  }
  const map = new Map()
  activities.forEach((a) => {
    const key = a.employee_id ?? 'unassigned'
    if (!map.has(key)) map.set(key, emptyMetricCounts())
    const totals = map.get(key)
    if (a.activity_type in totals) totals[a.activity_type] += 1
  })
  return map
}

// wonStageHistory is unbounded (all time) and pre-sorted most-recent-first,
// so the first row seen per lead_id is that lead's most recent 'won'
// transition. Rows with leads: null are ones RLS hid (not this user's lead)
// and are skipped. Exported so Dashboard's KPI band can reuse the exact same
// "won value in range" definition instead of a second, possibly-drifting one.
export function computeOrderValueActuals(wonStageHistory, range, showByEmployee) {
  const latestByLead = new Map()
  wonStageHistory.forEach((row) => {
    if (!row.leads) return
    if (!latestByLead.has(row.lead_id)) latestByLead.set(row.lead_id, row)
  })

  if (!showByEmployee) {
    let total = 0
    latestByLead.forEach((row) => {
      const changedAt = new Date(row.changed_at)
      if (changedAt >= range.start && changedAt <= range.end) {
        total += Number(row.leads.order_value ?? 0)
      }
    })
    return total
  }

  const map = new Map()
  latestByLead.forEach((row) => {
    const changedAt = new Date(row.changed_at)
    if (changedAt < range.start || changedAt > range.end) return
    const key = row.leads.owner_employee_id ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + Number(row.leads.order_value ?? 0))
  })
  return map
}

// Exported so the drill-down builders (src/lib/drilldownBuilders.js) look up
// a target the exact same way this card does, instead of a second lookup
// that could drift from it.
export function targetFor(targets, employeeId, metric) {
  const row = targets.find(
    (t) => t.metric_name === metric && (employeeId == null || t.employee_id === employeeId)
  )
  return row ? Number(row.target_value) : null
}

function formatValue(metric, value) {
  return metric === 'order_value' ? formatCurrency(value) : value
}

function TargetsVsActualsCard({
  preset,
  activities,
  wonStageHistory,
  targets,
  range,
  employees,
  showByEmployee,
  onTargetCreated,
  rangeLabel,
  onOpenLog,
  onOpenPanel,
}) {
  const [employeeFilter, setEmployeeFilter] = useState('')
  const visibleEmployees = employeeFilter ? employees.filter((e) => String(e.id) === employeeFilter) : employees

  // targets.period_type only knows week/month (see Schema/tostem_crm_schema.sql)
  // — 15D, Quarter and Custom have no matching target period to compare
  // against, same as Custom always did.
  const isTargetPeriod = preset === 'week' || preset === 'month'

  // The heatmap only makes sense with more than one row to compare — a
  // sales exec (showByEmployee false) keeps the plain bar-list view at every
  // width, same as before this redesign.
  const showHeatmap = showByEmployee && isTargetPeriod && onOpenLog && onOpenPanel

  return (
    <div className="vip-card">
      <div className="vip-card-title">Targets vs. actuals</div>

      {!isTargetPeriod ? (
        <p className="vip-empty">Targets are tracked by week/month — pick "Week" or "Month" to see them.</p>
      ) : (
        <>
          {showHeatmap && (
            <div className="vip-only-desktop">
              <DashboardHeatmap
                employees={employees}
                targets={targets}
                activities={activities}
                wonStageHistory={wonStageHistory}
                range={range}
                rangeLabel={rangeLabel}
                onOpenLog={onOpenLog}
                onOpenPanel={onOpenPanel}
              />
            </div>
          )}

          <div className={showHeatmap ? 'vip-only-mobile' : undefined}>
            {showByEmployee && (
              <div className="vip-seg vip-seg-outline">
                <button
                  type="button"
                  className={employeeFilter === '' ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                  onClick={() => setEmployeeFilter('')}
                >
                  All
                </button>
                {employees.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={employeeFilter === String(e.id) ? 'vip-seg-btn vip-active' : 'vip-seg-btn'}
                    onClick={() => setEmployeeFilter(String(e.id))}
                  >
                    {e.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            )}
            <TargetsTable
              activities={activities}
              wonStageHistory={wonStageHistory}
              targets={targets}
              range={range}
              employees={visibleEmployees}
              showByEmployee={showByEmployee}
            />
          </div>
        </>
      )}

      {showByEmployee && isTargetPeriod && (
        <SetTargetForm employees={employees} onCreated={onTargetCreated} />
      )}
    </div>
  )
}

function TargetsTable({ activities, wonStageHistory, targets, range, employees, showByEmployee }) {
  const activityActuals = computeActivityActuals(activities, showByEmployee)
  const orderValueActuals = computeOrderValueActuals(wonStageHistory, range, showByEmployee)

  const rows = !showByEmployee
    ? METRIC_OPTIONS.map((m) => ({
        label: m.label,
        actual: m.value === 'order_value' ? orderValueActuals : activityActuals[m.value],
        target: targetFor(targets, null, m.value),
        metric: m.value,
      }))
    : employees.flatMap((emp) =>
        METRIC_OPTIONS.map((m) => ({
          label: `${emp.name.split(' ')[0]} · ${m.label}`,
          actual: m.value === 'order_value' ? orderValueActuals.get(emp.id) ?? 0 : activityActuals.get(emp.id)?.[m.value] ?? 0,
          target: targetFor(targets, emp.id, m.value),
          metric: m.value,
          key: `${emp.id}-${m.value}`,
        }))
      )

  return (
    <div className="vip-stack-s">
      {rows.map((row) => (
        <div key={row.key ?? row.metric} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--vip-ink)' }}>{row.label}</div>
            {row.target != null && (
              <div className="vip-bar-value" style={{ flex: '0 0 auto' }}>
                {formatValue(row.metric, row.actual)} / {formatValue(row.metric, row.target)}
              </div>
            )}
          </div>
          {row.target == null ? (
            <p className="vip-empty" style={{ margin: 0, padding: 0 }}>
              no target set
            </p>
          ) : (
            <div className="vip-bar-track vip-thick">
              <div
                className={row.actual >= row.target ? 'vip-bar-fill vip-won' : 'vip-bar-fill'}
                style={{ width: `${Math.min(100, (row.actual / row.target) * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default TargetsVsActualsCard
