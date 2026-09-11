import { useState } from 'react'
import { METRIC_OPTIONS } from '../lib/targetMetrics'
import { formatCurrencyCompact } from '../lib/format'
import SetTargetForm from './SetTargetForm'
import DashboardHeatmap from './DashboardHeatmap'

// order_value/scanning_leads are computed by their own dedicated functions
// below (not tallied from activities), so they're excluded from the
// activity-type tally's zero-init.
const NON_ACTIVITY_METRICS = ['order_value', 'scanning_leads']

function emptyMetricCounts() {
  return Object.fromEntries(METRIC_OPTIONS.filter((m) => !NON_ACTIVITY_METRICS.includes(m.value)).map((m) => [m.value, 0]))
}

// A revised RFQ is still real work, but not toward the RFQ-raised quota —
// the owner's ruling (2026-09-09) is that the target measures fresh
// sourcing progress, not how many times a quotation got redone. A row with
// no rfq_kind at all (every activity logged before this shipped, since
// there's no retroactive reclassification — see
// Schema/migration_rfq_kind.sql) still counts, exactly as it did before
// this distinction existed. ActivityCountsCard's own raw tally is
// deliberately unaffected by this — "how much RFQ paperwork happened" and
// "how much fresh RFQ quota was hit" are different questions.
// Exported so buildLogPanel (drilldownBuilders.js) can apply the exact same
// rule to its own headline count instead of re-deriving it — that panel is
// opened by clicking a heatmap cell, so a second copy of this rule is
// exactly the kind of drift that already broke this once (see
// computeActivityActuals's own comment above).
export function countsTowardActivityMetric(a) {
  return !(a.activity_type === 'rfq_raised' && a.rfq_kind === 'revised')
}

// activities is already scoped to the current period + role by the caller
// (same array ActivityCountsCard uses) — just tally by activity_type, and by
// employee_id too when showByEmployee. Exported so DashboardHeatmap.jsx and
// buildOverallAttainPanel (drilldownBuilders.js) can feed the exact same
// per-employee actuals into blendedAttainmentFor below, instead of each
// re-deriving its own copy of "how many of X did this exec log" — see that
// function's own comment for why a second copy of this specifically caused
// a real, reported discrepancy.
export function computeActivityActuals(activities, showByEmployee) {
  if (!showByEmployee) {
    const totals = emptyMetricCounts()
    activities.forEach((a) => {
      if (a.activity_type in totals && countsTowardActivityMetric(a)) totals[a.activity_type] += 1
    })
    return totals
  }
  const map = new Map()
  activities.forEach((a) => {
    const key = a.employee_id ?? 'unassigned'
    if (!map.has(key)) map.set(key, emptyMetricCounts())
    const totals = map.get(key)
    if (a.activity_type in totals && countsTowardActivityMetric(a)) totals[a.activity_type] += 1
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

// "Scanning Leads" actual — new leads (not activities) whose source is
// Scanning, dated by creation and attributed to the lead's owner. Same
// breakdownLeads array and same "own row" shape as computeQuoteSentActuals
// just below — no second query.
export function computeScanningLeadsActuals(breakdownLeads, range, showByEmployee) {
  const inRange = breakdownLeads.filter((l) => {
    if (l.source_type !== 'scanning') return false
    if (!l.created_at) return false
    const createdAt = new Date(l.created_at)
    return createdAt >= range.start && createdAt <= range.end
  })

  if (!showByEmployee) return inRange.length

  const map = new Map()
  inRange.forEach((l) => {
    const key = l.owner_employee_id ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return map
}

// "Offers sent" actual — leads has no per-quote log, just a single
// quote_sent_at timestamp per lead, so this counts leads whose quote was
// sent inside the range. breakdownLeads is the same unbounded, RLS-scoped
// array Dashboard.jsx already fetches for the category-breakdown cards
// (fetchLeadsForBreakdown) — no second query. Exported for the Sales Exec
// Profile's own "Offers sent" tile — not part of this card's METRIC_OPTIONS.
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
// for the same range by construction. Exported for the Sales Exec Profile's
// own "Bookings" tile — dropped from this card's METRIC_OPTIONS 2026-09-08.
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

// Same lookup as targetFor, but returns the ROW (for its `id`) rather than
// just the numeric value — needed by the drill-down builders that attach a
// "Cancel this target" option (buildLogPanel/buildOrderValueAttainPanel/
// buildScanningLeadsAttainPanel), since deleting a target needs its id, not
// its value. Only meaningful for a single-employee lookup (employeeId given)
// — a company-wide aggregate has no one row to cancel, so callers in that
// mode should never call this.
export function targetRowFor(targets, employeeId, metric) {
  return targets.find((t) => t.metric_name === metric && t.employee_id === employeeId) ?? null
}

// Merges a just-saved target row into the `targets` array Dashboard holds.
//
// THE CONTRACT THIS ENFORCES: `targets` holds exactly the rows for the ONE
// period currently on screen, and nothing else. targetFor/targetRowFor above
// deliberately don't filter by period — they match on employee + metric
// alone, because the array is supposed to be period-scoped already. That
// makes this function the one place that contract can be violated, so it is
// the one place that defends it.
//
// Two real reported bugs came from there being no such defence (fixed
// 2026-09-11), and both are worth keeping in mind before loosening this:
//
//  1. "Set a target for next week and it shows up under the current week."
//     A row saved for a DIFFERENT period was merged into the displayed
//     period's array anyway, and targetFor — having no period filter —
//     happily returned it as the current week's target. It only bit in the
//     session that did the saving (a reload refetches scoped to the right
//     period), which is exactly why an earlier pass that verified the
//     save/read path against the database found nothing wrong.
//  2. Correcting a CURRENT-period target appeared to do nothing. The old
//     replace-vs-append test compared period_type/period_value, which were
//     `undefined` on every fetched row (fetchTargetsForPeriod didn't select
//     them), so it never matched — the corrected row was appended after the
//     stale one, and targetFor returns its FIRST match, i.e. the old value.
//     insertTarget() is an upsert, so the database had it right the whole
//     time; only the screen was lying.
//
// displayPeriod is { periodType, periodValue } — whatever periodForPreset()
// resolved for the preset the dashboard is currently showing.
export function mergeTargetRow(targets, row, displayPeriod) {
  if (!row) return targets
  // A target for a period nobody is looking at has nowhere honest to go:
  // there is no row on screen representing that period, so putting it in
  // this array can only ever make some OTHER period display it.
  if (
    !displayPeriod ||
    row.period_type !== displayPeriod.periodType ||
    row.period_value !== displayPeriod.periodValue
  ) {
    return targets
  }
  // Within a single-period array, "the same target" is employee + metric —
  // deliberately NOT re-testing the period, which is already known equal
  // above. Reading it back off the stored rows is what broke bug 2.
  const isSameTarget = (t) => t.employee_id === row.employee_id && t.metric_name === row.metric_name
  return targets.some(isSameTarget) ? targets.map((t) => (isSameTarget(t) ? row : t)) : [...targets, row]
}

// order_value is real money — never show paise. Every other metric here is
// a count (site visits, calls, ...) — a target_value can be entered/stored
// as a decimal (SetTargetForm's number input allows it), but a count should
// never render with a fractional part.
function formatValue(metric, value) {
  return metric === 'order_value' ? formatCurrencyCompact(value) : Math.round(value)
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
  canCancelTarget = false,
  // { periodType, periodValue } for the period this card is showing —
  // passed through to SetTargetForm so it can say out loud when a target is
  // being saved for a DIFFERENT period than the table above it displays.
  // Without that, saving for next week looks like it did nothing.
  displayPeriod = null,
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
            breakdownLeads={breakdownLeads}
            range={range}
            rangeLabel={rangeLabel}
            onOpenLog={onOpenLog}
            onOpenPanel={onOpenPanel}
            canCancelTarget={canCancelTarget}
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
            displayPeriod={displayPeriod}
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

function actualFor(m, { activityActuals, orderValueActuals, scanningLeadsActuals }, employeeId) {
  if (m.value === 'order_value') return employeeId == null ? orderValueActuals : orderValueActuals.get(employeeId) ?? 0
  if (m.value === 'scanning_leads') return employeeId == null ? scanningLeadsActuals : scanningLeadsActuals.get(employeeId) ?? 0
  return employeeId == null ? activityActuals[m.value] : activityActuals.get(employeeId)?.[m.value] ?? 0
}

// Same "mean of the metric ratios, each capped at 100%" definition
// EmployeeProfile.jsx's rank pill uses (blendedAttainment there) — scoped
// here to all 6 METRIC_OPTIONS rather than that page's own 6 tiles (a
// different 6, see targetMetrics.js), and skipping any metric with no target
// set for this employee (same as each metric row's own "no target set"
// fallback below) rather than treating a missing target as a zero, which
// would unfairly drag the average down.
//
// Capped at exactly 1.0, not something above it (owner's ruling,
// 2026-09-10, after this cap's own inconsistency was found and fixed —
// see below): "Overall" answers how close each metric got to being fully
// met, on average — a metric already at or past its target contributes
// its maximum, full credit, and no more. Overperforming on one metric
// (a real case: Raghav Gupta logged 9 RFQs against a target of 4, 225%)
// still can't drag the blend down, but it also can't inflate it past what
// hitting every target outright would already give.
const ATTAINMENT_CAP = 1.0

// Exported (2026-09-10) after a reported/confirmed bug: DashboardHeatmap.jsx's
// desktop "Overall" column and its buildOverallAttainPanel drill-down each
// re-derived their OWN blended-attainment average with no cap at all, so an
// exec with one metric wildly over target (the Raghav Gupta case above) had
// that 225% pulled straight into the average instead of clamped first — the
// desktop heatmap showed 63% Overall for him where this function (already
// used by EmployeeProfile's rank pill and this card's own mobile
// ExecAttainmentRow) shows 38% for the identical person/period. Both call
// sites now import this instead of re-deriving it, so "Overall" can no
// longer mean two different numbers depending on where you're looking at
// it from.
export function blendedAttainmentFor(employeeId, actuals, targets) {
  const ratios = []
  METRIC_OPTIONS.forEach((m) => {
    const target = targetFor(targets, employeeId, m.value)
    if (!target) return
    ratios.push(Math.min(actualFor(m, actuals, employeeId) / target, ATTAINMENT_CAP))
  })
  if (ratios.length === 0) return null
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length
}

function TargetRow({ row }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
  )
}

// One collapsed row per exec (name · blended attainment · a single bar),
// expanding to that person's 6 METRIC_OPTIONS rows on tap — replaces what
// used to be employees.length × 6 flat rows shown unconditionally (see
// TargetsTable below: this only ever mounts on mobile now, paired with
// DashboardHeatmap on desktop). Reuses .vip-detail-row, the same tap-to-
// expand summary row Lead Detail's mobile collapsed sections already use,
// rather than inventing a second collapsible-row style.
function ExecAttainmentRow({ employee, actuals, targets }) {
  const [open, setOpen] = useState(false)
  const blended = blendedAttainmentFor(employee.id, actuals, targets)

  return (
    <div>
      <button type="button" className="vip-detail-row" onClick={() => setOpen((o) => !o)}>
        <span className="vip-detail-row-title">{employee.name.split(' ')[0]}</span>
        <span className="vip-detail-row-summary">
          {blended == null ? 'no targets set' : `${Math.round(blended * 100)}% attainment`} {open ? '▾' : '›'}
        </span>
      </button>
      {blended != null && (
        <div className="vip-bar-track vip-thick" style={{ marginBottom: open ? 10 : 0 }}>
          <div
            className={blended >= 1 ? 'vip-bar-fill vip-won' : 'vip-bar-fill'}
            style={{ width: `${Math.min(100, blended * 100)}%` }}
          />
        </div>
      )}
      {open && (
        <div className="vip-stack-s" style={{ paddingBottom: 10 }}>
          {METRIC_OPTIONS.map((m) => (
            <TargetRow
              key={m.value}
              row={{
                label: m.label,
                actual: actualFor(m, actuals, employee.id),
                target: targetFor(targets, employee.id, m.value),
                metric: m.value,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TargetsTable({ activities, wonStageHistory, breakdownLeads, targets, range, employees, showByEmployee }) {
  const actuals = {
    activityActuals: computeActivityActuals(activities, showByEmployee),
    orderValueActuals: computeOrderValueActuals(wonStageHistory, range, showByEmployee),
    scanningLeadsActuals: computeScanningLeadsActuals(breakdownLeads ?? [], range, showByEmployee),
  }

  if (!showByEmployee) {
    const rows = METRIC_OPTIONS.map((m) => ({
      label: m.label,
      actual: actualFor(m, actuals, null),
      target: targetFor(targets, null, m.value),
      metric: m.value,
    }))
    return (
      <div className="vip-stack-s">
        {rows.map((row) => (
          <TargetRow key={row.metric} row={row} />
        ))}
      </div>
    )
  }

  return (
    <div className="vip-stack-s">
      {employees.map((emp) => (
        <ExecAttainmentRow key={emp.id} employee={emp} actuals={actuals} targets={targets} />
      ))}
    </div>
  )
}

export default TargetsVsActualsCard
