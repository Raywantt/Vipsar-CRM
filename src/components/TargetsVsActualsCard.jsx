import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { formatCurrency } from '../lib/format'
import SetTargetForm from './SetTargetForm'
import '../pages/Dashboard.css'

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
// and are skipped.
function computeOrderValueActuals(wonStageHistory, range, showByEmployee) {
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

function targetFor(targets, employeeId, metric) {
  const row = targets.find(
    (t) => t.metric_name === metric && (employeeId == null || t.employee_id === employeeId)
  )
  return row ? Number(row.target_value) : null
}

function formatValue(metric, value) {
  return metric === 'order_value' ? formatCurrency(value) : value
}

function TargetsVsActualsCard({ preset, activities, wonStageHistory, targets, range, employees, showByEmployee, onTargetCreated }) {
  const [employeeFilter, setEmployeeFilter] = useState('')
  const visibleEmployees = employeeFilter ? employees.filter((e) => String(e.id) === employeeFilter) : employees

  return (
    <section className="dashboard-card">
      <h2>Targets vs. actuals</h2>

      {preset === 'custom' ? (
        <p className="dashboard-empty">
          Targets are tracked by week/month — pick "This Week" or "This Month" to see them.
        </p>
      ) : (
        <>
          {showByEmployee && (
            <label className="dashboard-field">
              Sales exec
              <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                <option value="">— All employees —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <TargetsTable
            activities={activities}
            wonStageHistory={wonStageHistory}
            targets={targets}
            range={range}
            employees={visibleEmployees}
            showByEmployee={showByEmployee}
          />
        </>
      )}

      {showByEmployee && preset !== 'custom' && (
        <SetTargetForm employees={employees} onCreated={onTargetCreated} />
      )}
    </section>
  )
}

function TargetsTable({ activities, wonStageHistory, targets, range, employees, showByEmployee }) {
  const activityActuals = computeActivityActuals(activities, showByEmployee)
  const orderValueActuals = computeOrderValueActuals(wonStageHistory, range, showByEmployee)

  if (!showByEmployee) {
    const rows = METRIC_OPTIONS.map((m) => {
      const actual = m.value === 'order_value' ? orderValueActuals : activityActuals[m.value]
      const target = targetFor(targets, null, m.value)
      return { metric: m, actual, target }
    })

    return (
      <div className="dashboard-table-wrap">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Actual</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ metric, actual, target }) => (
              <tr key={metric.value}>
                <td>{metric.label}</td>
                <td>{formatValue(metric.value, actual)}</td>
                <td>{target == null ? 'no target set' : formatValue(metric.value, target)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const rows = []
  employees.forEach((emp) => {
    METRIC_OPTIONS.forEach((m) => {
      const actual =
        m.value === 'order_value' ? orderValueActuals.get(emp.id) ?? 0 : activityActuals.get(emp.id)?.[m.value] ?? 0
      const target = targetFor(targets, emp.id, m.value)
      rows.push({ employee: emp, metric: m, actual, target })
    })
  })

  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Metric</th>
            <th>Actual</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ employee, metric, actual, target }) => (
            <tr key={`${employee.id}-${metric.value}`}>
              <td>{employee.name}</td>
              <td>{metric.label}</td>
              <td>{formatValue(metric.value, actual)}</td>
              <td>{target == null ? 'no target set' : formatValue(metric.value, target)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default TargetsVsActualsCard
