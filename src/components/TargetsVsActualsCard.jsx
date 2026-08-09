import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { formatCurrency } from '../lib/format'
import SetTargetForm from './SetTargetForm'
import DashboardHeatmap from './DashboardHeatmap'

// order_value/quote_sent/won_count are computed by their own dedicated
// functions below (not tallied from activities), so they're excluded from
// the activity-type tally's zero-init the same way order_value already was.
const NON_ACTIVITY_METRICS = ['order_value', 'quote_sent', 'won_count']

function emptyMetricCounts() {
  return Object.fromEntries(METRIC_OPTIONS.filter((m) => !NON_ACTIVITY_METRICS.includes(m.value)).map((m) => [m.value, 0]))
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

// "Offers sent" actual — leads has no per-quote log, just a single
// quote_sent_at timestamp per lead, so this counts leads whose quote was
// sent inside the range. breakdownLeads is the same unbounded, RLS-scoped
// array Dashboard.jsx already fetches for the category-breakdown cards
// (fetchLeadsForBreakdown) — no second query.
export function computeQuoteSentActuals(breakdownLeads, range, showByEmployee) {
  const inRange = breakdownLeads.filter((l) => {
    if (!l.quote_sent_at) return false
    const sentAt = new Date(l.quote_sent_at)
    return sentAt >= range.start && sentAt <= range.end
  })

  if (!showByEmployee) return inRange.length

  const map = new Map()
  inRange.forEach((l) => {
    const key = l.owner_employee_id ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return map
}

// "Bookings" actual — count of leads (not summed value, unlike order_value
// above) whose most recent stage_history row is 'won' inside the range.
// Same latestByLead reduction as computeOrderValueActuals, so a lead with
// multiple 'won' rows (re-opened and re-won) is still counted once, and this
// tile's count matches whatever the exec profile's funnel "Won" step shows
// for the same range by construction.
export function computeWonCountActuals(wonStageHistory, range, showByEmployee) {
  const latestByLead = new Map()
  wonStageHistory.forEach((row) => {
    if (!row.leads) return
    if (!latestByLead.has(row.lead_id)) latestByLead.set(row.lead_id, row)
  })

  if (!showByEmployee) {
    let count = 0
    latestByLead.forEach((row) => {
      const changedAt = new Date(row.changed_at)
      if (changedAt >= range.start && changedAt <= range.end) count += 1
    })
    return count
  }

  const map = new Map()
  latestByLead.forEach((row) => {
    const changedAt = new Date(row.changed_at)
    if (changedAt < range.start || changedAt > range.end) return
    const key = row.leads.owner_employee_id ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + 1)
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

// order_value is real money — never show paise. Every other metric here is
// a count (site visits, calls, ...) — a target_value can be entered/stored
// as a decimal (SetTargetForm's number input allows it), but a count should
// never render with a fractional part.
function formatValue(metric, value) {
  return metric === 'order_value' ? formatCurrency(value, { maximumFractionDigits: 0 }) : Math.round(value)
}

// Only ever mounted by Dashboard.jsx for a week/month/quarter preset —
// 15D/Custom have no period-keyed target row to compare against, so
// Dashboard hides this card entirely for those instead of asking it to
// render an empty state (see the Dashboard section of CLAUDE.md).
function TargetsVsActualsCard({
  activities,
  wonStageHistory,
  breakdownLeads,
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
  const [showTargetForm, setShowTargetForm] = useState(false)
  const visibleEmployees = employeeFilter ? employees.filter((e) => String(e.id) === employeeFilter) : employees

  // The heatmap only makes sense with more than one row to compare — a
  // sales exec (showByEmployee false) keeps the plain bar-list view at every
  // width, same as before this redesign.
  const showHeatmap = showByEmployee && onOpenLog && onOpenPanel

  return (
    <div className="vip-card">
      <div className="vip-card-title">Targets vs. actuals</div>

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
          breakdownLeads={breakdownLeads}
          targets={targets}
          range={range}
          employees={visibleEmployees}
          showByEmployee={showByEmployee}
        />
      </div>

      {showByEmployee && (
        showTargetForm ? (
          <SetTargetForm
            employees={employees}
            onCreated={onTargetCreated}
            onCancel={() => setShowTargetForm(false)}
          />
        ) : (
          <button type="button" className="vip-btn vip-btn-secondary vip-btn-sm" onClick={() => setShowTargetForm(true)}>
            + Set a target
          </button>
        )
      )}
    </div>
  )
}

function actualFor(m, { activityActuals, orderValueActuals, quoteSentActuals, wonCountActuals }, employeeId) {
  if (m.value === 'order_value') return employeeId == null ? orderValueActuals : orderValueActuals.get(employeeId) ?? 0
  if (m.value === 'quote_sent') return employeeId == null ? quoteSentActuals : quoteSentActuals.get(employeeId) ?? 0
  if (m.value === 'won_count') return employeeId == null ? wonCountActuals : wonCountActuals.get(employeeId) ?? 0
  return employeeId == null ? activityActuals[m.value] : activityActuals.get(employeeId)?.[m.value] ?? 0
}

function TargetsTable({ activities, wonStageHistory, breakdownLeads, targets, range, employees, showByEmployee }) {
  const actuals = {
    activityActuals: computeActivityActuals(activities, showByEmployee),
    orderValueActuals: computeOrderValueActuals(wonStageHistory, range, showByEmployee),
    quoteSentActuals: computeQuoteSentActuals(breakdownLeads ?? [], range, showByEmployee),
    wonCountActuals: computeWonCountActuals(wonStageHistory, range, showByEmployee),
  }

  const rows = !showByEmployee
    ? METRIC_OPTIONS.map((m) => ({
        label: m.label,
        actual: actualFor(m, actuals, null),
        target: targetFor(targets, null, m.value),
        metric: m.value,
      }))
    : employees.flatMap((emp) =>
        METRIC_OPTIONS.map((m) => ({
          label: `${emp.name.split(' ')[0]} · ${m.label}`,
          actual: actualFor(m, actuals, emp.id),
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
