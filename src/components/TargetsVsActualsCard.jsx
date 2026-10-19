import { useState } from 'react'
import { METRIC_OPTIONS, METRIC_GROUPS, ACTIVITY_METRIC_OPTIONS, SOURCE_METRIC_OPTIONS, metricsForPeriod } from '../lib/targetMetrics'
import { formatCurrencyCompact } from '../lib/format'
import SetTargetForm from './SetTargetForm'
import DashboardHeatmap from './DashboardHeatmap'
import { loggedWhileDeskLive } from '../lib/rfqDesk'

// Only the activity-type metrics are tallied from activities; the rest have
// their own functions below, so they're left out of this zero-init.
function emptyMetricCounts() {
  return Object.fromEntries(ACTIVITY_METRIC_OPTIONS.map((m) => [m.value, 0]))
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
//
// ONCE THE RFQ DESK IS LIVE (RFQ-DESK.md Step 6) an RFQ counts when it passes
// the technical check, not when it is logged: `liveFrom` is the cutover
// (rfq_desk_settings.live_from). An RFQ Raised logged before it still counts
// here by the day it was logged; one logged after counts through
// rfqCounting.counted instead (see computeActivityActuals) — never both.
export function countsTowardActivityMetric(a, liveFrom = null) {
  if (a.activity_type !== 'rfq_raised') return true
  if (a.rfq_kind === 'revised') return false
  return !loggedWhileDeskLive(a, liveFrom)
}

// What the RFQ Raised target reads besides the activities, from
// fetchDashboardPeriod: `liveFrom` (the desk's cutover; null = the desk is
// off) and `counted` — the RFQs approved in the period that count, each
// { raised_by_employee_id, approved_at }. The database decides which count
// (once per lead, frozen at approval — Schema/migration_rfq_desk_reporting.sql).
// The default is "desk off": every RFQ counts by its logging day, as before.
export const NO_RFQ_DESK = Object.freeze({ liveFrom: null, counted: [] })

// The approvals that count for this period, or none while the desk is off —
// with no cutover every RFQ already counted by its logging day above, so an
// approval as well would count it twice. Exported for buildLogPanel, whose
// headline must equal the heatmap cell it opens from.
export function countedRfqsFor(rfqCounting) {
  return rfqCounting?.liveFrom ? rfqCounting.counted ?? [] : []
}

// activities is already scoped to the current period + role by the caller
// (same array ActivityCountsCard uses) — just tally by activity_type, and by
// employee_id too when showByEmployee. Exported so DashboardHeatmap.jsx and
// buildOverallAttainPanel (drilldownBuilders.js) can feed the exact same
// per-employee actuals into blendedAttainmentFor below, instead of each
// re-deriving its own copy of "how many of X did this exec log" — see that
// function's own comment for why a second copy of this specifically caused
// a real, reported discrepancy.
//
// `rfqCounting` (NO_RFQ_DESK's shape) carries the RFQ desk's part of RFQ
// Raised, scoped by the caller exactly like `activities` — each counted RFQ
// is credited to the exec who raised it (raised_by_employee_id).
export function computeActivityActuals(activities, showByEmployee, rfqCounting = NO_RFQ_DESK) {
  const liveFrom = rfqCounting?.liveFrom ?? null
  const counted = countedRfqsFor(rfqCounting)
  if (!showByEmployee) {
    const totals = emptyMetricCounts()
    activities.forEach((a) => {
      if (a.activity_type in totals && countsTowardActivityMetric(a, liveFrom)) totals[a.activity_type] += 1
    })
    if ('rfq_raised' in totals) totals.rfq_raised += counted.length
    return totals
  }
  const map = new Map()
  const totalsFor = (key) => {
    if (!map.has(key)) map.set(key, emptyMetricCounts())
    return map.get(key)
  }
  activities.forEach((a) => {
    const totals = totalsFor(a.employee_id ?? 'unassigned')
    if (a.activity_type in totals && countsTowardActivityMetric(a, liveFrom)) totals[a.activity_type] += 1
  })
  counted.forEach((r) => {
    const totals = totalsFor(r.raised_by_employee_id ?? 'unassigned')
    if ('rfq_raised' in totals) totals.rfq_raised += 1
  })
  return map
}

// wonStageHistory is unbounded (all time) and pre-sorted most-recent-first,
// so the first row seen per lead_id is that lead's most recent 'won'
// transition. Rows with leads: null are ones RLS hid (not this user's lead)
// and are skipped. Exported so Dashboard's KPI band can reuse the exact same
// "won value in range" definition instead of a second, possibly-drifting one.
//
// `keyOf` says who a deal is credited to when showByEmployee — the lead's
// current owner, everywhere but the Team Report's BDM rows, which pass the BDM
// who brought the lead in (src/lib/teamReport.js). Same rule, another key.
export function computeOrderValueActuals(wonStageHistory, range, showByEmployee, keyOf = ownerOfWonRow) {
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
    const key = keyOf(row) ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + Number(row.leads.order_value ?? 0))
  })
  return map
}

function ownerOfWonRow(row) {
  return row.leads.owner_employee_id
}

// "Scanning Leads" actual — new leads (not activities) whose source is
// Scanning, dated by creation and attributed to the lead's owner. Same
// breakdownLeads array and same "own row" shape as computeQuoteSentActuals
// just below — no second query.
export function computeScanningLeadsActuals(breakdownLeads, range, showByEmployee) {
  return computeSourceLeadsActuals(breakdownLeads, 'scanning', range, showByEmployee)
}

// The same count for any one lead source — the Team Report's Referral and
// Architect leads use it alongside Scanning, so all three are dated and
// credited by one rule (the Scanning Leads target's). `keyOf` as in
// computeOrderValueActuals: the owner, or the BDM on the report's BDM rows.
export function computeSourceLeadsActuals(leads, sourceType, range, showByEmployee, keyOf = ownerOfLead) {
  const inRange = leads.filter((l) => {
    if (l.source_type !== sourceType) return false
    if (!l.created_at) return false
    const createdAt = new Date(l.created_at)
    return createdAt >= range.start && createdAt <= range.end
  })

  if (!showByEmployee) return inRange.length

  const map = new Map()
  inRange.forEach((l) => {
    const key = keyOf(l) ?? 'unassigned'
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return map
}

function ownerOfLead(lead) {
  return lead.owner_employee_id
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

// Every target metric's actual for one period, in one object — the ONE call
// the targets card, the heatmap and its Overall popup all make, so no two of
// them can count a metric differently. With showByEmployee each figure is a
// Map of employee id → count (or rupees); without, a single number.
// `inputs` is { activities, rfqCounting, wonStageHistory, breakdownLeads, range }.
export function computeTargetActuals({ activities, rfqCounting = NO_RFQ_DESK, wonStageHistory, breakdownLeads, range }, showByEmployee) {
  const leads = breakdownLeads ?? []
  return {
    activityActuals: computeActivityActuals(activities, showByEmployee, rfqCounting),
    orderValueActuals: computeOrderValueActuals(wonStageHistory, range, showByEmployee),
    scanningLeadsActuals: computeScanningLeadsActuals(leads, range, showByEmployee),
    quoteSentActuals: computeQuoteSentActuals(leads, range, showByEmployee),
    sourceLeadsActuals: Object.fromEntries(
      SOURCE_METRIC_OPTIONS.filter((m) => m.value !== 'scanning_leads').map((m) => [m.value, computeSourceLeadsActuals(leads, m.source, range, showByEmployee)])
    ),
  }
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
  // The RFQ desk's part of RFQ Raised (NO_RFQ_DESK's shape), scoped like
  // `activities`.
  rfqCounting = NO_RFQ_DESK,
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
  // Opens the Orders booked popup on one exec — Dashboard owns it (it has to
  // follow the leads fetch as it lands), so this asks rather than builds.
  onOpenBooked,
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
  const showHeatmap = showByEmployee && onOpenLog && onOpenPanel && onOpenBooked
  // The targets for the kind of period on screen — a week has no order value
  // target (targetMetrics.js). Every view below reads this one list.
  const metrics = metricsForPeriod(displayPeriod?.periodType)

  return (
    <div className="vip-card">
      <h2 className="vip-card-title">Targets vs. actuals</h2>

      {showHeatmap && (
        <div className="vip-only-desktop">
          <DashboardHeatmap
            employees={employees}
            targets={targets}
            activities={activities}
            rfqCounting={rfqCounting}
            wonStageHistory={wonStageHistory}
            breakdownLeads={breakdownLeads}
            range={range}
            rangeLabel={rangeLabel}
            onOpenLog={onOpenLog}
            onOpenPanel={onOpenPanel}
            onOpenBooked={onOpenBooked}
            canCancelTarget={canCancelTarget}
            metrics={metrics}
          />
        </div>
      )}

      <div className={showHeatmap ? 'vip-only-mobile' : undefined}>
        {/* A dropdown, not a row of buttons (owner's choice, 2026-09-21): the
            row held All + one button per exec, and with seven execs it ran
            ~90px past a 375px phone and let the whole page slide sideways.
            A list has no width to outgrow, so it also carries full names. */}
        {showByEmployee && (
          <select
            className="vip-select"
            aria-label="Whose targets to show"
            value={employeeFilter}
            onChange={(ev) => setEmployeeFilter(ev.target.value)}
          >
            <option value="">All</option>
            {employees.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        <TargetsTable
          activities={activities}
          rfqCounting={rfqCounting}
          wonStageHistory={wonStageHistory}
          breakdownLeads={breakdownLeads}
          targets={targets}
          range={range}
          employees={visibleEmployees}
          showByEmployee={showByEmployee}
          metrics={metrics}
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

// One metric's actual out of computeTargetActuals' object — a number, for one
// employee or (employeeId null) the single-person total. A figure the object
// doesn't carry reads 0; that only happens for a metric nobody passed in.
export function actualFor(m, actuals, employeeId) {
  const pick = (v) => (employeeId == null ? v ?? 0 : v?.get(employeeId) ?? 0)
  switch (m.kind) {
    case 'order_value': return pick(actuals.orderValueActuals)
    case 'quotes': return pick(actuals.quoteSentActuals)
    case 'source': return pick(m.value === 'scanning_leads' ? actuals.scanningLeadsActuals : actuals.sourceLeadsActuals?.[m.value])
    default:
      return employeeId == null ? actuals.activityActuals?.[m.value] ?? 0 : actuals.activityActuals?.get(employeeId)?.[m.value] ?? 0
  }
}

// Same "mean of the metric ratios, each capped at 100%" definition
// EmployeeProfile.jsx's rank pill uses (blendedAttainment there) — scoped
// here to every METRIC_OPTIONS entry rather than that page's own 6 tiles (a
// different list, see targetMetrics.js), and skipping any metric with no target
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
// `metrics` is the list for the period on screen (metricsForPeriod) — a week
// leaves Order value out, so a stray weekly order-value target can't move a
// week's Overall. Defaults to every metric.
export function blendedAttainmentFor(employeeId, actuals, targets, metrics = METRIC_OPTIONS) {
  const ratios = []
  metrics.forEach((m) => {
    const target = targetFor(targets, employeeId, m.value)
    if (!target) return
    ratios.push(Math.min(actualFor(m, actuals, employeeId) / target, ATTAINMENT_CAP))
  })
  if (ratios.length === 0) return null
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length
}

// Exported for the business development manager's targets card
// (BdmTargetsCard.jsx), so a BDM's target bar reads exactly like an exec's.
// showActualWithoutTarget: print the actual even when no target is on file.
// Off everywhere a person reads their own card (unchanged behaviour); on for
// the owner's Architect Network, where a BDM with no targets yet would
// otherwise show three rows and not one number.
// onOpen: when given, the whole row is a button opening the popup behind its
// figure (the BDM cards — src/lib/bdmPopups.js). The row's own markup is the same
// either way; as a button it is spans with block display, since a button may
// hold only phrasing content.
export function TargetRow({ row, showActualWithoutTarget = false, onOpen = null }) {
  const Outer = onOpen ? 'button' : 'div'
  const Part = onOpen ? 'span' : 'div'
  const outerProps = onOpen ? { type: 'button', className: 'vip-target-row-btn', onClick: onOpen } : { style: { display: 'flex', flexDirection: 'column', gap: 5 } }
  const chevron = onOpen ? <span className="vip-target-row-chevron">›</span> : null
  return (
    <Outer {...outerProps}>
      <Part style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <Part style={{ fontSize: 13, fontWeight: 500, color: 'var(--vip-ink)' }}>{row.label}</Part>
        {row.target != null ? (
          <Part className="vip-bar-value" style={{ flex: '0 0 auto' }}>
            {formatValue(row.metric, row.actual)} / {formatValue(row.metric, row.target)}
            {chevron}
          </Part>
        ) : showActualWithoutTarget && row.actual != null ? (
          <Part className="vip-bar-value" style={{ flex: '0 0 auto' }}>
            {formatValue(row.metric, row.actual)}
            {chevron}
          </Part>
        ) : null}
      </Part>
      {row.target == null ? (
        onOpen ? (
          <span className="vip-empty" style={{ display: 'block', margin: 0, padding: 0 }}>
            no target set{row.actual != null && !showActualWithoutTarget ? chevron : null}
          </span>
        ) : (
          <p className="vip-empty" style={{ margin: 0, padding: 0 }}>
            no target set
          </p>
        )
      ) : (
        <Part className="vip-bar-track vip-thick" style={onOpen ? { display: 'block' } : undefined}>
          <Part
            className={row.actual >= row.target ? 'vip-bar-fill vip-won' : 'vip-bar-fill'}
            style={{ width: `${Math.min(100, (row.actual / row.target) * 100)}%`, ...(onOpen ? { display: 'block' } : {}) }}
          />
        </Part>
      )}
    </Outer>
  )
}

// One collapsed row per exec (name · blended attainment · a single bar),
// expanding to that person's METRIC_OPTIONS rows, grouped, on tap — replaces
// what used to be employees.length × every-metric flat rows shown unconditionally (see
// TargetsTable below: this only ever mounts on mobile now, paired with
// DashboardHeatmap on desktop). Reuses .vip-detail-row, the same tap-to-
// expand summary row Lead Detail's mobile collapsed sections already use,
// rather than inventing a second collapsible-row style.
function ExecAttainmentRow({ employee, actuals, targets, metrics }) {
  const [open, setOpen] = useState(false)
  const blended = blendedAttainmentFor(employee.id, actuals, targets, metrics)

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
        <div style={{ paddingBottom: 10 }}>
          <GroupedTargetRows actuals={actuals} targets={targets} employeeId={employee.id} metrics={metrics} />
        </div>
      )}
    </div>
  )
}

// Every metric as a TargetRow, under the same Results / Activity / Leads
// headings as the desktop heatmap's column groups. employeeId null = the
// single-person view (an exec's own card), whose actuals are plain numbers.
function GroupedTargetRows({ actuals, targets, employeeId, metrics }) {
  return (
    <div className="vip-stack-s">
      {METRIC_GROUPS.map((g) => (
        <div key={g.key} className="vip-stack-s">
          <div className="vip-target-group-head">{g.label}</div>
          {metrics.filter((m) => m.group === g.key).map((m) => (
            <TargetRow
              key={m.value}
              row={{ label: m.label, actual: actualFor(m, actuals, employeeId), target: targetFor(targets, employeeId, m.value), metric: m.value }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function TargetsTable({ activities, rfqCounting, wonStageHistory, breakdownLeads, targets, range, employees, showByEmployee, metrics }) {
  const actuals = computeTargetActuals({ activities, rfqCounting, wonStageHistory, breakdownLeads, range }, showByEmployee)

  if (!showByEmployee) return <GroupedTargetRows actuals={actuals} targets={targets} employeeId={null} metrics={metrics} />


  return (
    <div className="vip-stack-s">
      {employees.map((emp) => (
        <ExecAttainmentRow key={emp.id} employee={emp} actuals={actuals} targets={targets} metrics={metrics} />
      ))}
    </div>
  )
}

export default TargetsVsActualsCard
