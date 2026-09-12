// Pure functions that shape already-fetched Dashboard state into the props
// DrilldownPanel.jsx needs, one per panel "kind" (see MetricPanel.dc.html in
// the Claude Design handoff this is modeled on). Nothing in here makes a
// network call and nothing in here produces a "verdict"/narrative field —
// nothing in DrilldownPanel renders one, and none of these functions build
// one.
import { ACTIVITY_TYPES, ACTIVITY_LABELS } from './activityTypes'
import { ACTIVITY_METRIC_OPTIONS } from './targetMetrics'
import { LEAD_STAGE_OPTIONS, stageLabel } from './leadStageOptions'
import { LOSS_REASON_OPTIONS } from './lossReasonOptions'
import { stageChipClass, stageFg, TONE_NEUTRAL } from './statusColors'
import { formatCurrencyCompact, formatTimeRange } from './format'
import { parseTimestamp } from './dbTime'
import {
  computeOrderValueActuals,
  computeScanningLeadsActuals,
  computeActivityActuals,
  countsTowardActivityMetric,
  blendedAttainmentFor,
  targetFor,
  targetRowFor,
} from '../components/TargetsVsActualsCard'
import { computeFunnel } from '../components/SalesFunnelCard'
import { dealValueFor } from './pipelineValue'
import { daysSince } from './dateMath'
import { getInitials } from './initials'
import { leadDisplayName } from './leadName'

const CLOSED_STAGES = ['won', 'lost']

function companyTargetFor(targets, employees, metric) {
  let total = 0
  let anySet = false
  employees.forEach((e) => {
    const t = targetFor(targets, e.id, metric)
    if (t != null) {
      total += t
      anySet = true
    }
  })
  return anySet ? total : null
}

function enumerateDays(start, end) {
  const days = []
  const cur = new Date(start)
  cur.setHours(0, 0, 0, 0)
  const last = new Date(end)
  last.setHours(0, 0, 0, 0)
  while (cur <= last) {
    days.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function dailyTotals(events, range, getDate, getValue = () => 1) {
  const days = enumerateDays(range.start, range.end)
  const totals = new Map(days.map((d) => [d.toDateString(), 0]))
  events.forEach((e) => {
    const key = new Date(getDate(e)).toDateString()
    if (totals.has(key)) totals.set(key, totals.get(key) + getValue(e))
  })
  return days.map((d) => totals.get(d.toDateString()))
}

// Cumulative-actual-vs-straight-line-to-target chart, matching MetricPanel's
// attain SVG (viewBox 0 0 560 150, baseline at y=126). The "target path" is a
// plain straight line from 0 to target over the range — a mechanical
// reference, not a projection/inference.
function buildPaceChart(daily, target) {
  if (daily.length < 2) return null
  let running = 0
  const cumulative = daily.map((v) => (running += v))
  const finalActual = cumulative[cumulative.length - 1]
  const maxY = Math.max(finalActual, target ?? 0, 1)
  const n = cumulative.length
  const px = (i) => (i * 560) / (n - 1)
  const py = (v) => 126 - Math.min(1, v / maxY) * 104
  const toPath = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')
  const actualPath = toPath(cumulative)
  const areaPath = `${actualPath} L560 126 L0 126 Z`
  const targetPath = target != null ? toPath(daily.map((_, i) => (target / (n - 1)) * i)) : null
  const pacePct = target != null ? Math.round((finalActual / target) * 100) : null
  return {
    actualPath,
    areaPath,
    targetPath,
    finalActual,
    pacePct: pacePct != null ? `${Math.min(100, Math.max(0, pacePct))}%` : '100%',
    paceLabel: target != null ? `${pacePct}% of target` : String(finalActual),
  }
}

// Mirrors computeOrderValueActuals' own "one row per lead, most recent won
// transition, inside range" dedup (src/components/TargetsVsActualsCard.jsx)
// — needed here because that function only returns totals, not the
// individual dated transactions the pace chart buckets by day.
export function wonEventsInRange(wonStageHistory, range) {
  const latestByLead = new Map()
  wonStageHistory.forEach((row) => {
    if (!row.leads) return
    if (!latestByLead.has(row.lead_id)) latestByLead.set(row.lead_id, row)
  })
  const events = []
  latestByLead.forEach((row) => {
    const changedAt = new Date(row.changed_at)
    if (changedAt >= range.start && changedAt <= range.end) {
      events.push({ changedAt, employeeId: row.leads.owner_employee_id, value: Number(row.leads.order_value ?? 0) })
    }
  })
  return events
}

// ---------- attain: order value (company-wide or one exec) ----------
export function buildOrderValueAttainPanel({ employees, targets, wonStageHistory, range, employeeId, rangeLabel, scopeLabel = 'Company', canCancelTarget = false }) {
  const employee = employeeId ? employees.find((e) => e.id === employeeId) : null
  const isCompanyScope = !employee && scopeLabel === 'Company'
  const actualsByEmployee = computeOrderValueActuals(wonStageHistory, range, true)
  const actual = employeeId
    ? actualsByEmployee.get(employeeId) ?? 0
    : [...actualsByEmployee.values()].reduce((s, v) => s + v, 0)
  // A single row (for its id, so "Cancel this target" can delete it) rather
  // than targetFor's plain value — only meaningful in single-employee mode,
  // a company-wide total has no one row to cancel.
  const targetRow = employeeId ? targetRowFor(targets, employeeId, 'order_value') : null
  const target = employeeId ? (targetRow ? Number(targetRow.target_value) : null) : companyTargetFor(targets, employees, 'order_value')

  const events = wonEventsInRange(wonStageHistory, range).filter((e) => !employeeId || e.employeeId === employeeId)
  const daily = dailyTotals(events, range, (e) => e.changedAt, (e) => e.value)
  const pace = buildPaceChart(daily, target)

  const contrib = employeeId || !isCompanyScope
    ? []
    : employees
        .map((e) => ({ label: e.name, value: actualsByEmployee.get(e.id) ?? 0 }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
  const maxContrib = Math.max(1, ...contrib.map((c) => c.value))

  return {
    kind: 'attain',
    eyebrow: employee ? `${employee.name} · order value` : `${scopeLabel} · order value`,
    title: employee || !isCompanyScope ? 'Booked value against personal target' : 'Booked value against company target',
    value: formatCurrencyCompact(actual),
    delta: target != null ? `of ${formatCurrencyCompact(target)} target` : null,
    note: `${rangeLabel}. Order value is the only rupee target this dashboard tracks — everything else on the grid is activity volume.`,
    stats: [
      { label: 'Booked', value: formatCurrencyCompact(actual), sub: rangeLabel, color: '#101617' },
      { label: 'Target', value: target != null ? formatCurrencyCompact(target) : '—', sub: 'for this period', color: '#485456' },
      { label: 'Gap', value: target != null ? formatCurrencyCompact(Math.max(0, target - actual)) : '—', sub: 'to target', color: '#b4232a' },
      { label: 'Won leads', value: String(events.length), sub: rangeLabel, color: '#101617' },
    ],
    pace,
    contribTitle: 'Contribution by exec',
    contrib: contrib.map((c) => ({
      label: c.label,
      value: formatCurrencyCompact(c.value),
      pct: `${Math.round((c.value / maxContrib) * 100)}%`,
    })),
    cancelTarget: canCancelTarget && targetRow ? { id: targetRow.id } : null,
  }
}

// Mirrors wonEventsInRange above but for Scanning Leads — one event per lead
// created inside the range whose source is Scanning, dated by creation
// rather than a stage change.
function scanningLeadEventsInRange(breakdownLeads, range) {
  return breakdownLeads
    .filter((l) => l.source_type === 'scanning' && l.created_at)
    .map((l) => ({ createdAt: new Date(l.created_at), employeeId: l.owner_employee_id }))
    .filter((e) => e.createdAt >= range.start && e.createdAt <= range.end)
}

// ---------- attain: scanning leads (company-wide or one exec) ----------
export function buildScanningLeadsAttainPanel({ employees, targets, breakdownLeads, range, employeeId, rangeLabel, scopeLabel = 'Company', canCancelTarget = false }) {
  const employee = employeeId ? employees.find((e) => e.id === employeeId) : null
  const isCompanyScope = !employee && scopeLabel === 'Company'
  const actualsByEmployee = computeScanningLeadsActuals(breakdownLeads, range, true)
  const actual = employeeId
    ? actualsByEmployee.get(employeeId) ?? 0
    : [...actualsByEmployee.values()].reduce((s, v) => s + v, 0)
  const targetRow = employeeId ? targetRowFor(targets, employeeId, 'scanning_leads') : null
  const target = employeeId ? (targetRow ? Number(targetRow.target_value) : null) : companyTargetFor(targets, employees, 'scanning_leads')

  const events = scanningLeadEventsInRange(breakdownLeads, range).filter((e) => !employeeId || e.employeeId === employeeId)
  const daily = dailyTotals(events, range, (e) => e.createdAt)
  const pace = buildPaceChart(daily, target)

  const contrib = employeeId || !isCompanyScope
    ? []
    : employees
        .map((e) => ({ label: e.name, value: actualsByEmployee.get(e.id) ?? 0 }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
  const maxContrib = Math.max(1, ...contrib.map((c) => c.value))

  return {
    kind: 'attain',
    eyebrow: employee ? `${employee.name} · scanning leads` : `${scopeLabel} · scanning leads`,
    title: employee || !isCompanyScope ? 'New scanning leads against personal target' : 'New scanning leads against company target',
    value: String(actual),
    delta: target != null ? `of ${Math.round(target)} target` : null,
    note: `${rangeLabel}. New leads captured with Scanning as the source, counted by lead owner.`,
    stats: [
      { label: 'Leads', value: String(actual), sub: rangeLabel, color: '#101617' },
      { label: 'Target', value: target != null ? String(Math.round(target)) : '—', sub: 'for this period', color: '#485456' },
      { label: 'Gap', value: target != null ? String(Math.max(0, Math.round(target) - actual)) : '—', sub: 'to target', color: '#b4232a' },
    ],
    pace,
    contribTitle: 'Contribution by exec',
    contrib: contrib.map((c) => ({
      label: c.label,
      value: String(c.value),
      pct: `${Math.round((c.value / maxContrib) * 100)}%`,
    })),
    cancelTarget: canCancelTarget && targetRow ? { id: targetRow.id } : null,
  }
}

// ---------- attain: activity volume (company-wide for the owner, own-only for a sales exec) ----------
export function buildActivitiesAttainPanel({ activities, targets, employees, range, rangeLabel, scopeLabel = 'Company' }) {
  const actual = activities.length
  // Activity counts are whole numbers; target_value can be stored as a
  // decimal (SetTargetForm's number input allows it, and a company total is
  // a sum of several employees' targets) — round every target here so it
  // reads as a count, not raw arithmetic.
  const rawTarget = ACTIVITY_TYPES.reduce((s, t) => s + (companyTargetFor(targets, employees, t.value) ?? 0), 0) || null
  const target = rawTarget != null ? Math.round(rawTarget) : null
  const daily = dailyTotals(activities, range, (a) => a.created_at)
  const pace = buildPaceChart(daily, target)

  const contrib = ACTIVITY_TYPES.map((t) => {
    const typeActual = activities.filter((a) => a.activity_type === t.value).length
    const rawTypeTarget = companyTargetFor(targets, employees, t.value)
    return { value: t.value, label: t.label, actual: typeActual, target: rawTypeTarget != null ? Math.round(rawTypeTarget) : null }
  })
  const maxContrib = Math.max(1, ...contrib.map((c) => c.actual))
  // Looked up by value, not position — ACTIVITY_TYPES has grown twice since
  // this stats row was written (client_meeting/architect_meeting were
  // inserted ahead of rfq_raised), and a positional contrib[2] silently
  // started reading Client Meeting's numbers under the "RFQ raised" label.
  const contribFor = (value) => contrib.find((c) => c.value === value)

  return {
    kind: 'attain',
    eyebrow: `${scopeLabel} · activity volume`,
    title: 'Activities logged, by type',
    value: String(actual),
    delta: target != null ? `of ${target} target` : null,
    note: `${rangeLabel}. Every logged site visit, call, RFQ, office day and booking update${scopeLabel === 'Company' ? ', across every exec' : ''}.`,
    stats: [
      { label: 'Total logged', value: String(actual), sub: target != null ? `of ${target} target` : rangeLabel, color: '#101617' },
      { label: 'Site visit', value: String(contribFor('site_visit')?.actual ?? 0), sub: contribFor('site_visit')?.target != null ? `of ${contribFor('site_visit').target}` : 'no target set', color: '#101617' },
      { label: 'Call', value: String(contribFor('call')?.actual ?? 0), sub: contribFor('call')?.target != null ? `of ${contribFor('call').target}` : 'no target set', color: '#101617' },
      { label: 'RFQ raised', value: String(contribFor('rfq_raised')?.actual ?? 0), sub: contribFor('rfq_raised')?.target != null ? `of ${contribFor('rfq_raised').target}` : 'no target set', color: '#101617' },
    ],
    pace,
    contribTitle: 'By activity type · actual vs target',
    contrib: contrib.map((c) => ({
      label: c.label,
      value: c.target != null ? `${c.actual} / ${c.target}` : `${c.actual}`,
      pct: `${Math.round((c.actual / maxContrib) * 100)}%`,
    })),
  }
}

// ---------- attain: one exec's blended attainment across every targetable metric (heatmap "overall" column) ----------
// Metrics here must match DashboardHeatmap's own COLS (scanning_leads +
// ACTIVITY_METRIC_OPTIONS + order_value) exactly — this panel is what that
// heatmap's "Overall" cell opens, so a mismatch would show a different
// number than the cell itself.
export function buildOverallAttainPanel({ employee, targets, activities, wonStageHistory, breakdownLeads, range, rangeLabel }) {
  const metrics = ['scanning_leads', ...ACTIVITY_METRIC_OPTIONS.map((t) => t.value), 'order_value']
  const orderValueActuals = computeOrderValueActuals(wonStageHistory, range, true)
  const scanningLeadsActuals = computeScanningLeadsActuals(breakdownLeads, range, true)
  const activityActuals = computeActivityActuals(activities, true)
  const orderActual = orderValueActuals.get(employee.id) ?? 0
  const scanningActual = scanningLeadsActuals.get(employee.id) ?? 0
  const rows = metrics.map((metric) => {
    const target = targetFor(targets, employee.id, metric)
    const actual =
      metric === 'order_value'
        ? orderActual
        : metric === 'scanning_leads'
          ? scanningActual
          // Read from the already-computed activityActuals map (excludes
          // revised RFQs) instead of re-deriving a raw count — same fix as
          // DashboardHeatmap.jsx's own cells, for the same reason: this is
          // the "Line by line" breakdown the heatmap's Overall column opens,
          // so a raw re-derivation here would disagree with the RFQ Raised
          // column right next to it.
          : (activityActuals.get(employee.id)?.[metric] ?? 0)
    return {
      label: metric === 'order_value' ? 'Order value' : metric === 'scanning_leads' ? 'Scanning Leads' : ACTIVITY_LABELS[metric],
      actual,
      target,
      pct: target ? Math.round((actual / target) * 100) : null,
    }
  })
  const withTarget = rows.filter((r) => r.pct != null)
  // Capped at 100% per metric before averaging — the same blendedAttainmentFor
  // rule EmployeeProfile's rank pill and the heatmap cell this panel opens
  // from both use, so this headline can't disagree with either of them. The
  // "Line by line" rows below stay uncapped (a real 225% on one metric is
  // still worth showing on its own) — see blendedAttainmentFor's own comment.
  const blended = blendedAttainmentFor(employee.id, { activityActuals, orderValueActuals, scanningLeadsActuals }, targets)
  const overallPct = blended == null ? null : Math.round(blended * 100)

  return {
    kind: 'attain',
    eyebrow: `${employee.name} · overall`,
    title: `Blended attainment across all ${metrics.length} targets`,
    value: overallPct != null ? `${overallPct}%` : '—',
    note: `${rangeLabel}. Average of whichever of the ${metrics.length} metrics have a target set for ${employee.name.split(' ')[0]}, each capped at 100% so overperforming on one metric can't inflate the blend.`,
    stats: [
      { label: 'Overall', value: overallPct != null ? `${overallPct}%` : '—', sub: `${withTarget.length} of ${metrics.length} have targets`, color: '#101617' },
      { label: 'Order value', value: formatCurrencyCompact(orderActual), sub: rows.find((r) => r.label === 'Order value')?.target != null ? `of ${formatCurrencyCompact(rows.find((r) => r.label === 'Order value').target)}` : 'no target set', color: '#101617' },
    ],
    contribTitle: 'Line by line',
    // pct above is computed from the raw (possibly fractional) target for
    // accuracy — only the displayed count here needs rounding.
    contrib: rows.map((r) => ({
      label: r.label,
      value:
        r.target != null
          ? r.label === 'Order value'
            ? `${formatCurrencyCompact(r.actual)} / ${formatCurrencyCompact(r.target)}`
            : `${r.actual} / ${Math.round(r.target)}`
          : `${r.actual}`,
      pct: r.pct != null ? `${Math.min(100, r.pct)}%` : '0%',
    })),
  }
}

// ---------- log: one exec, one activity type's real entries ----------
function lastNWeekdays(n) {
  const days = []
  const cur = new Date()
  cur.setHours(0, 0, 0, 0)
  while (days.length < n) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) days.unshift(new Date(cur))
    cur.setDate(cur.getDate() - 1)
  }
  return days
}

export function buildLogPanel({ employee, activityType, targets, range, rangeLabel, logRows, canCancelTarget = false }) {
  const label = ACTIVITY_LABELS[activityType]
  // The row (for its id, so "Cancel this target" can delete it), not just
  // targetFor's plain value.
  const targetRow = targetRowFor(targets, employee.id, activityType)
  // target_value can be a stored decimal — this is a log count, round it for
  // display (delta % below still divides by the raw value for accuracy).
  const rawTarget = targetRow ? Number(targetRow.target_value) : null
  const target = rawTarget != null ? Math.round(rawTarget) : null
  const inRange = logRows.filter((r) => {
    const at = new Date(r.created_at)
    return at >= range.start && at <= range.end
  })
  // The headline/target comparison counts toward the QUOTA (excludes revised
  // RFQs, same rule computeActivityActuals applies) — this panel opens from
  // clicking a heatmap cell, so its headline must agree with that cell.
  // `inRange`/`logRows` themselves stay unfiltered: the row list below is a
  // real audit trail of everything logged, and the rhythm chart is a
  // separate "how much paperwork happened" question (see
  // countsTowardActivityMetric's own comment).
  const quotaCount = inRange.filter((r) => countsTowardActivityMetric({ activity_type: activityType, rfq_kind: r.rfq_kind })).length

  const rhythmDays = lastNWeekdays(20)
  const counts = rhythmDays.map((d) => logRows.filter((r) => new Date(r.created_at).toDateString() === d.toDateString()).length)
  const maxCount = Math.max(1, ...counts)
  const rhythm = counts.map((c) => ({
    h: c ? `${Math.max(18, Math.round((c / maxCount) * 100))}%` : '10%',
    filled: c > 0,
    tip: c ? `${c} logged` : 'nothing logged',
  }))
  const silentDays = counts.filter((c) => c === 0).length

  return {
    kind: 'log',
    eyebrow: `${employee.name} · ${label}`,
    title: `${label} — logged entries`,
    value: target != null ? `${quotaCount} / ${target}` : String(quotaCount),
    delta: rawTarget != null ? `${Math.round((quotaCount / rawTarget) * 100)}%` : null,
    note: `${rangeLabel}. Every row below is a real entry ${employee.name.split(' ')[0]} logged in the Activity log.`,
    stats: [
      { label: 'Logged', value: String(quotaCount), sub: rangeLabel, color: '#101617' },
      { label: 'Target', value: target != null ? String(target) : '—', sub: 'for this period', color: '#485456' },
      { label: 'Last 20 working days', value: String(counts.reduce((s, c) => s + c, 0)), sub: 'entries logged', color: '#101617' },
      { label: 'Silent days', value: String(silentDays), sub: 'of last 20', color: silentDays > 6 ? '#b4232a' : silentDays > 3 ? '#7a6413' : '#1f6f4a' },
    ],
    rhythm,
    rhythmFrom: rhythmDays[0]?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    rhythmTo: rhythmDays[rhythmDays.length - 1]?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    // Scoped to the SELECTED period (inRange), not the full logRows fetch —
    // 2026-09-10 fix. This used to list every entry in the last ~60 days
    // regardless of whether Week/Month/Quarter was selected, so viewing a
    // single week's cell could show entries from several weeks back with
    // nothing to say they were outside the period being looked at — a real
    // reported confusion, and a real mismatch against this panel's own
    // headline count above (which was always period-scoped). The "Logging
    // rhythm" section above is deliberately UNCHANGED — it's a clearly
    // labelled, separate "last 20 working days" view, not meant to track
    // whatever period happens to be selected.
    logTitle: `${label} · ${rangeLabel} · most recent first`,
    log: inRange.slice(0, 40).map((r) => {
      const linkedLead = r.leads
      // An activity can be anchored on a PARTY with no lead at all (an
      // Architect Meeting), so a bare party stands in where there is no lead
      // to name — leadDisplayName (src/lib/leadName.js) owns the rest.
      const party = linkedLead ? leadDisplayName(linkedLead) : (r.parties?.name ?? '(no party)')
      const stage = linkedLead?.current_stage ?? null
      // Office Day's meta is its hours now that "leads generated" is retired
      // from the form (2026-08-18) — the leads_generated fallback stays for
      // the entries logged while that field existed.
      const meta =
        (r.accompanied_by ? `with ${r.employees?.name ?? 'colleague'}` : null) ??
        formatTimeRange(r.start_time, r.end_time) ??
        (r.leads_generated != null ? `${r.leads_generated} leads generated` : null)
      return {
        id: r.id,
        // parseTimestamp, not new Date(): activities.created_at is a naive
        // TIMESTAMP holding UTC, so a bare parse reads it as local and prints
        // every entry 5.5 hours early in IST. See src/lib/dbTime.js.
        date: parseTimestamp(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        time: parseTimestamp(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        party,
        stage: stage ? stageLabel(stage) : null,
        chipClass: stage ? stageChipClass(stage) : null,
        notes: r.notes || '—',
        meta,
      }
    }),
    cancelTarget: canCancelTarget && targetRow ? { id: targetRow.id } : null,
  }
}

// ---------- stageLeads: one stage's leads, opened from a pipeline panel ----------
// A second-level drill-down — DrilldownPanel pushes this over the pipeline
// panel that opened it (see its `stack` state) rather than replacing the
// panel prop, so "‹ Back" returns to the stage overview. Built here, eagerly,
// and attached to each pipeline stage row's `drill` field, which keeps
// DrilldownPanel presentational (no builder imports, no lead data of its own)
// exactly as this file's header comment intends.
export function buildStageLeadsPanel({ breakdownLeads, stage, scopeLabel = 'Company' }) {
  const stageLeads = breakdownLeads.filter((l) => (l.current_stage ?? 'calling') === stage)
  const total = stageLeads.reduce((s, l) => s + dealValueFor(l), 0)

  const owners = [
    ...new Map(
      stageLeads.filter((l) => l.owner_employee_id).map((l) => [l.owner_employee_id, l.employees?.name ?? 'Unassigned'])
    ),
  ]
    .map(([id, name]) => ({
      id,
      name,
      count: stageLeads.filter((l) => l.owner_employee_id === id).length,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    kind: 'stageLeads',
    eyebrow: `${scopeLabel} · ${stageLabel(stage)}`,
    title: `Every lead at ${stageLabel(stage)}`,
    value: formatCurrencyCompact(total),
    note: `${stageLeads.length} lead${stageLeads.length === 1 ? '' : 's'} sitting at this stage right now.`,
    stats: [
      { label: 'Leads', value: String(stageLeads.length), sub: 'at this stage', color: '#101617' },
      { label: 'Value', value: formatCurrencyCompact(total), sub: 'combined', color: '#101617' },
      { label: 'Owners', value: String(owners.length), sub: 'with a lead here', color: '#485456' },
    ],
    owners,
    leadRows: [...stageLeads]
      .sort((a, b) => dealValueFor(b) - dealValueFor(a))
      .map((l) => ({
        leadId: l.id,
        party: leadDisplayName(l),
        ownerId: l.owner_employee_id ?? null,
        owner: l.employees?.name ?? 'Unassigned',
        stage: stageLabel(l.current_stage ?? 'calling'),
        chipClass: stageChipClass(l.current_stage ?? 'calling'),
        value: formatCurrencyCompact(dealValueFor(l)),
      })),
  }
}

// ---------- pipeline ----------
// Used to take a `mode: 'stage' | 'funnel'` flag — Sales funnel's own
// "Details" link used to open this same panel with mode: 'funnel', but that
// only ever changed the header text (eyebrow/title); the body
// (stageRows/convRows/topLeads) was identical either way, and the one thing
// that would have been funnel-specific (`funnelRows`, reach + avg-days per
// stage) was computed but never actually rendered by PipelineBody. Removed
// (2026-08-09, at the user's request) along with Sales funnel's "Details"
// link entirely, rather than keeping a mode param with one caller.
//
// Gained an Active/On-hold toggle (2026-09-08, the time-independent-metrics
// feature's metric #1 — see TIME-INDEPENDENT-METRICS-LOG.md's Milestone 6
// entry). `computePipelineScope` below builds the value/note/stageRows/
// topLeads for one lead subset; `buildPipelinePanel` now calls it three
// times (all/active/onHold) and attaches all three under `scopeViews`, so
// PipelineBody can switch between them with local state and zero new
// queries — the brief's own "re-slices the already-loaded lead array
// client-side" instruction. `stats[1..3]` (Reached Calling/Won/Lost,
// all-time) and `convRows` are deliberately NOT part of `scopeViews` — both
// describe the lifetime funnel (from `funnelStageHistory`/`computeFunnel`),
// not which CURRENTLY OPEN leads are toggled into view, so they stay
// constant across all three positions. The top-level `value`/`note`/
// `stageRows`/`topLeads`/`stats[0]` fields mirror the 'all' scope exactly,
// unchanged from before this pass — every existing caller that reads those
// fields directly (KpiSparkRow's Open pipeline tile, Pipeline by stage's
// Details link) keeps seeing exactly what it always has.
// `topLeadsCount`/`withCumulative` back the Pipeline concentration metric
// (2026-09-08, Milestone 6 panel 2) — see buildPipelinePanel's own comment
// for when these are set to anything other than the "top 5, no cumulative"
// default every other entry point still gets.
function computePipelineScope(leads, stages, breakdownLeads, scopeLabel, noteSuffix, { topLeadsCount = 5, withCumulative = false } = {}) {
  const total = leads.reduce((s, l) => s + dealValueFor(l), 0)

  const stageRows = stages.map((stage) => {
    const stageLeads = leads.filter((l) => (l.current_stage ?? 'calling') === stage)
    return {
      label: stageLabel(stage),
      count: stageLeads.length,
      value: formatCurrencyCompact(stageLeads.reduce((s, l) => s + dealValueFor(l), 0)),
      color: stageFg(stage),
      // Clicking this row opens that stage's own lead list, one level
      // deeper — always drawn from the FULL breakdownLeads (every open
      // lead at that stage), not just this scope's subset, since a stage
      // drill-down is unambiguous regardless of which toggle led to it.
      drill: buildStageLeadsPanel({ breakdownLeads, stage, scopeLabel }),
    }
  })
  const maxStage = Math.max(1, ...stageRows.map((r) => r.count))

  const ranked = [...leads].sort((a, b) => dealValueFor(b) - dealValueFor(a))
  let runningValue = 0
  const topLeads = ranked.slice(0, topLeadsCount).map((l) => {
    const leadValue = dealValueFor(l)
    runningValue += leadValue
    return {
      leadId: l.id,
      party: leadDisplayName(l),
      stage: stageLabel(l.current_stage ?? 'calling'),
      chipClass: stageChipClass(l.current_stage ?? 'calling'),
      ownerId: l.owner_employee_id ?? null,
      owner: l.employees?.name ?? 'Unassigned',
      value: formatCurrencyCompact(leadValue),
      // Only computed when asked for — a plain top-5 list (every entry
      // point except Concentration) has no "share of total" framing to
      // offer, and total could be 0 for an empty on-hold/active scope.
      cumulativePct: withCumulative ? `${total > 0 ? Math.round((runningValue / total) * 100) : 0}%` : null,
    }
  })

  return {
    value: formatCurrencyCompact(total),
    note: `${leads.length} ${noteSuffix}`,
    statsOpen: { label: 'Open value', value: formatCurrencyCompact(total), sub: `${leads.length} leads`, color: '#101617' },
    stageRows: stageRows.map((r) => ({ ...r, pct: `${Math.round((r.count / maxStage) * 100)}%` })),
    topLeads,
    topLeadsTotal: leads.length,
    // Raw (unformatted) value of the topLeads slice — needed by
    // buildPipelinePanel's concentration header, which needs to do
    // arithmetic on it, not just display the already-formatted `value`
    // above (that's the WHOLE scope's total, not the top slice's).
    topLeadsValue: runningValue,
    scopeTotalValue: total,
  }
}

// `concentrationMode`/`isSinglePersonScope` back metric #7 (Pipeline
// concentration, Milestone 6 panel 2) — see TIME-INDEPENDENT-METRICS-LOG.md.
// Concentration is defined over the ACTIVE set only (same on-hold exclusion
// already flagged for veto in Milestone 2's log entry — un-vetoed, treated
// as confirmed), so this only ever changes `scopeViews.active`'s own
// topLeads shape; `all`/`onHold` are untouched by these two params. In
// multi-person scope this shows the top 10% of active leads by value
// (rounded up to at least 1, mirroring dashboard_snapshot_metrics()'s own
// `p_top_fraction` rule so the chip and this panel can't disagree on which
// leads are "top"); in single-person scope there is no meaningful "top 10%
// of 6" framing, so it drops the cutoff entirely and lists every one of
// that scope's own active leads, ranked, per the brief's own instruction.
export function buildPipelinePanel({
  breakdownLeads,
  funnelStageHistory,
  scopeLabel = 'Company',
  initialScope = 'all',
  concentrationMode = false,
  isSinglePersonScope = false,
}) {
  const openLeads = breakdownLeads.filter((l) => !CLOSED_STAGES.includes(l.current_stage ?? 'calling'))
  const activeLeads = openLeads.filter((l) => (l.current_stage ?? 'calling') !== 'on_hold')
  const onHoldLeads = openLeads.filter((l) => (l.current_stage ?? 'calling') === 'on_hold')

  const stagesAll = LEAD_STAGE_OPTIONS.filter((s) => !CLOSED_STAGES.includes(s))
  const stagesActive = stagesAll.filter((s) => s !== 'on_hold')

  const activeTopLeadsOptions = concentrationMode
    ? {
        topLeadsCount: isSinglePersonScope ? activeLeads.length : Math.max(1, Math.ceil(activeLeads.length * 0.1)),
        withCumulative: true,
      }
    : undefined

  const scopeViews = {
    all: computePipelineScope(openLeads, stagesAll, breakdownLeads, scopeLabel, "open leads, across every stage that isn't won or lost."),
    active: computePipelineScope(
      activeLeads,
      stagesActive,
      breakdownLeads,
      scopeLabel,
      'active leads — open, excluding anything on hold.',
      activeTopLeadsOptions
    ),
    // No stage bar chart for on-hold — every one of these leads shares the
    // one bucket, so a multi-stage bar list would be 8 empty rows and one
    // full one. `PipelineBody` already hides that section when stageRows is
    // empty (see `panel.stageRows?.length > 0` there), so this degrades to
    // just the stats + biggest-leads list — a reasonable stand-in until
    // Milestone 6's own On-hold pipeline insights panel (duration buckets,
    // hold reasons, owner breakdown) replaces this toggle position outright
    // per the brief's "don't build two UIs for the same slice" instruction.
    onHold: computePipelineScope(onHoldLeads, [], breakdownLeads, scopeLabel, 'leads currently on hold.'),
  }

  const funnel = computeFunnel(funnelStageHistory, breakdownLeads)
  // 'lost' is a parallel exit a lead can hit from any stage, not the next
  // step after 'won' — excluded here so the chain doesn't produce a
  // nonsensical "won → lost" conversion card. 'on_hold' is excluded for the
  // same reason — it's an independent pause reachable from any stage, not a
  // sequential funnel step.
  const progression = funnel.filter((f) => f.stage !== 'lost' && f.stage !== 'on_hold')
  const convRows = []
  for (let i = 1; i < progression.length; i++) {
    const prev = progression[i - 1]
    const cur = progression[i]
    if (!prev.reached) continue
    const rate = Math.round((cur.reached / prev.reached) * 100)
    // `stage_history` only logs a lead's destination stage, so a lead that
    // jumps straight from an earlier stage to a later one (skipping the
    // stage in between) never contributes to the skipped stage's "reached"
    // count while still counting toward the later one's — that can push
    // this rate above 100%. That's a real, expected consequence of stages
    // not being strictly sequential in how reps log them, not a bug, but a
    // plain percentage with no explanation reads as broken math. Flagged
    // here so the render can say so instead of grading it red/amber/green
    // like a normal conversion rate.
    const skipped = rate > 100
    convRows.push({
      label: `${stageLabel(prev.stage)} → ${stageLabel(cur.stage)}`,
      pct: `${rate}%`,
      sub: skipped ? `${prev.reached} → ${cur.reached} · stage skipped` : `${prev.reached} → ${cur.reached}`,
      color: skipped ? TONE_NEUTRAL : rate >= 60 ? '#1f6f4a' : rate >= 40 ? '#7a6413' : '#b4232a',
      skipped,
    })
  }

  // ⚠️ Real bug, fixed the same day it shipped: the first version of this
  // panel reused the "Open pipeline by stage" title/eyebrow/value/note/stats
  // verbatim for the Concentration entry point too — reported directly
  // ("concentration drill down shows open pipeline???"), and rightly so: a
  // user tapping a distinct "Concentration" tile landed on a header reading
  // "Open pipeline by stage" with an unrelated stage bar chart and
  // stage-to-stage conversion cards above the one section that actually
  // answered their question. "Extend the existing section rather than
  // duplicating it" (the brief's own instruction) meant reuse the ROW/LIST
  // RENDERING code, not present the whole generic pipeline panel with a
  // concentration afterthought at the bottom. Concentration mode now gets
  // its OWN header content (below) and — see PipelineBody in
  // DrilldownPanel.jsx — hides the toggle, stage bars and conversion cards
  // entirely, leaving only the ranked, cumulative-% list a "Concentration"
  // tap actually promised.
  const concentrationHeader = concentrationMode
    ? (() => {
        const topN = scopeViews.active.topLeads.length
        const topValue = scopeViews.active.topLeadsValue
        const activeTotal = scopeViews.active.scopeTotalValue
        const activeCount = scopeViews.active.topLeadsTotal
        const pct = activeTotal > 0 ? Math.round((topValue / activeTotal) * 100) : 0
        const restCount = activeCount - topN
        const restValue = activeTotal - topValue
        // A 4th stat, deliberately — StatsGrid's shared .vip-dd-stats class
        // is a fixed 2-col (mobile) / 4-col (desktop) grid every OTHER
        // 'pipeline' stats array already fills exactly (Open value/Reached
        // Calling/Won/Lost). Shipping 3 here left a visible empty cell at
        // both widths — caught live in the browser, the same "wrong tile
        // count in a fixed grid" trap this codebase has hit more than once
        // before (DashboardHeatmap's column count, the Report grid pairing
        // rule). "Rest of pipeline" is also genuinely informative, not
        // filler: it's the direct complement of the headline % — in
        // single-person scope every active lead is already in the top
        // slice, so this correctly reads as 0 leads / ₹0 / 0%, which is the
        // honest answer, not a rounding artifact.
        return {
          eyebrow: `${scopeLabel} · concentration`,
          title: 'Pipeline concentration',
          value: `${pct}%`,
          note: isSinglePersonScope
            ? `All ${activeCount} of your active leads, ranked by value.`
            : `Top ${topN} of ${activeCount} active leads (top 10%) hold ${pct}% of active pipeline value.`,
          stats: [
            { label: 'Leads counted', value: String(topN), sub: isSinglePersonScope ? 'all active leads' : `of ${activeCount} active`, color: '#101617' },
            { label: 'Value held', value: formatCurrencyCompact(topValue), sub: 'combined', color: '#101617' },
            { label: 'Rest of pipeline', value: formatCurrencyCompact(restValue), sub: `${restCount} leads · ${100 - pct}%`, color: '#485456' },
            { label: 'Active pipeline total', value: formatCurrencyCompact(activeTotal), sub: `${activeCount} leads`, color: '#101617' },
          ],
        }
      })()
    : null

  return {
    kind: 'pipeline',
    eyebrow: concentrationHeader?.eyebrow ?? `${scopeLabel} · open pipeline`,
    title: concentrationHeader?.title ?? 'Open pipeline by stage',
    // Mirrors scopeViews.all exactly when not in concentration mode — see
    // this function's own header comment for why every pre-existing caller
    // is unaffected.
    value: concentrationHeader?.value ?? scopeViews.all.value,
    note: concentrationHeader?.note ?? scopeViews.all.note,
    stats: concentrationHeader?.stats ?? [
      scopeViews.all.statsOpen,
      { label: 'Reached Calling', value: String(funnel[0]?.reached ?? 0), sub: 'all-time', color: '#101617' },
      { label: 'Reached Won', value: String(funnel.find((f) => f.stage === 'won')?.reached ?? 0), sub: 'all-time', color: '#1f6f4a' },
      { label: 'Reached Lost', value: String(funnel.find((f) => f.stage === 'lost')?.reached ?? 0), sub: 'all-time', color: '#b4232a' },
    ],
    stageRows: scopeViews.all.stageRows,
    convRows,
    topLeads: scopeViews.all.topLeads,
    // New: the segmented All/Active/On-hold toggle's own data, and which
    // position PipelineBody should reset to when this panel (re)opens —
    // 'all' for every existing caller, 'onHold' for the "Right now" strip's
    // On-Hold Pipeline chip (RightNowStrip.jsx's onOpenOnHold), 'active'
    // for its Concentration chip (see concentrationMode below). Note
    // PipelineBody hides the toggle outright when concentrationMode is
    // true — see this function's own note above on why switching away from
    // "Active" would contradict the concentration-specific header above.
    scopeViews,
    initialScope,
    // Tells PipelineBody to render the cumulative-% column and the wider
    // (top-10%-or-all) row count on the 'active' scope's own leads list,
    // AND to hide the toggle/stage-bars/conversion-cards sections that
    // belong to the general "Open pipeline by stage" view, not this one.
    concentrationMode,
  }
}

// ---------- follow-up coverage gap (metric #5, Milestone 6 panel 3) ----------
// Reuses the `ageing` KIND's RENDERING (AgeingBody in DrilldownPanel.jsx
// already supports a swipe-to-set-a-follow-up action per row and a bulk
// "set a follow-up on all N" button — exactly the fix this metric points
// at) but builds its own panel object here rather than calling
// attention.js's buildAgeingPanel(). Deliberate: that function backs the
// already-shipped, already-tested Needs Attention feature
// (attention.test.js), and this metric's own owner-dropdown + stage-chip
// filters (see AgeingBody's `showListFilters` gate below) are NOT
// something Needs Attention's five buckets asked for or should suddenly
// grow as a side effect of this one. Reusing the render path without
// reusing the builder keeps this new metric from leaking behaviour into
// that unrelated, already-verified screen — the same reasoning that kept
// Milestone 5's dashboard_snapshot_metrics() rewrite from calling back into
// the five detail functions once that coupling turned out to cost too much.
//
// `allowLogCall: false` — "log a call" credits whoever clicks, which is
// the wrong fix for a lead with no follow-up at all (per the brief).
// `queueActions: true` — the swipe/bulk "Set date" action IS the point of
// this panel, unlike Dashboard's own Needs Attention buckets which pass
// `queueActions: false` deliberately (a read-only company view).
//
// `rows` are `leads_followup_gap_detail()`'s raw rows (lead_id, party,
// owner_id, owner_name, stage, value, last_activity_at) — see
// Schema/migration_time_independent_dashboard_metrics.sql. On-hold leads
// are already excluded at the SQL layer (per FOLLOWUPS.md Rule 8.2 — they
// always carry a mandatory hold-review reminder, so they can't genuinely be
// gapped), so nothing here needs to re-check that.
export function buildFollowupGapPanel(rows, scopeLabel = 'Company', isSinglePersonScope = false) {
  const ageRows = rows
    .map((r) => {
      const age = daysSince(r.last_activity_at)
      return {
        leadId: r.lead_id,
        party: r.party,
        stage: stageLabel(r.stage),
        chipClass: stageChipClass(r.stage),
        last: age != null ? `Last activity ${age}d ago` : 'No activity logged since created',
        age: age ?? 0,
        rawValue: Number(r.value ?? 0),
        ownerId: r.owner_id ?? null,
        owner: r.owner_name ?? 'Unassigned',
      }
    })
    .sort((a, b) => b.age - a.age)

  const owners = new Map()
  ageRows.forEach((r) => {
    const key = r.ownerId ?? 'unassigned'
    if (!owners.has(key)) owners.set(key, { id: r.ownerId, name: r.owner, count: 0, value: 0 })
    const entry = owners.get(key)
    entry.count += 1
    entry.value += r.rawValue
  })
  const ownerList = [...owners.values()].sort((a, b) => b.count - a.count)
  const maxOwnerCount = Math.max(1, ...ownerList.map((o) => o.count))

  const totalValue = ageRows.reduce((s, r) => s + r.rawValue, 0)
  const ages = ageRows.map((r) => r.age).sort((a, b) => a - b)

  return {
    kind: 'ageing',
    eyebrow: `${scopeLabel} · follow-up gap`,
    title: 'Leads with no follow-up set',
    value: String(ageRows.length),
    note: 'Currently-open leads (excluding on-hold) with no open follow-up reminder at all.',
    queueActions: true,
    allowLogCall: false,
    viewerEmployeeId: null,
    stats: [
      { label: 'Value involved', value: formatCurrencyCompact(totalValue), sub: `across ${ageRows.length} lead${ageRows.length === 1 ? '' : 's'}`, color: '#7a6413' },
      { label: 'Oldest', value: ages.length ? `${ages[ages.length - 1]}d` : '—', sub: 'longest since touch', color: '#7a6413' },
      { label: 'Median age', value: ages.length ? `${ages[Math.floor(ages.length / 2)]}d` : '—', sub: 'typical', color: '#7a6413' },
      { label: 'Owners involved', value: String(ownerList.length), sub: 'sales execs', color: '#101617' },
    ],
    ownerTitle: 'Whose leads these are',
    // Empty in single-person scope (per the role-matrix rule — one owner
    // makes both the rollup and its own filter meaningless), which also
    // hides the owner dropdown below (AgeingBody gates it on
    // ownerRows.length > 0).
    ownerRows: isSinglePersonScope
      ? []
      : ownerList.map((o) => ({
          id: o.id,
          initials: getInitials(o.name),
          name: o.name,
          count: o.count,
          value: formatCurrencyCompact(o.value),
          pct: `${Math.round((o.count / maxOwnerCount) * 100)}%`,
          color: o.count >= 3 ? '#b4232a' : o.count >= 2 ? '#7a6413' : '#9aa5a6',
        })),
    listTitle: 'Longest since last touch first',
    listHint: 'no open follow-up',
    ageRows: ageRows.map((r) => ({
      leadId: r.leadId,
      party: r.party,
      stage: r.stage,
      chipClass: r.chipClass,
      last: r.last,
      age: `${r.age}d`,
      value: formatCurrencyCompact(r.rawValue),
      initials: getInitials(r.owner),
      ownerId: r.ownerId,
      owner: r.owner,
    })),
    // AgeingBody-only flag: opts into the owner dropdown + stage filter
    // chips this metric's own spec asks for. Every EXISTING `ageing` caller
    // (Needs Attention's five buckets, Today's work queue, the KPI row's
    // Stale leads tile — all still built via attention.js's
    // buildAgeingPanel, untouched by this pass) leaves this unset, so they
    // keep rendering exactly as before.
    showListFilters: true,
  }
}

// ---------- on-hold pipeline insights (metric #3, Milestone 6 panel 4) ----------
// A GENUINELY NEW kind (`onHoldInsights`), not another `ageing` reuse like
// panel 3's coverage-gap panel. Deliberate: this metric needs duration
// buckets and a sort toggle that `ageing`/AgeingBody has no shape for, and
// per the brief it must be READ-ONLY — no swipe-to-act, no bulk button
// ("a hold is a deliberate pause, not a queue to clear, unlike the ageing
// kind it's modeled on"). Bolting three more caller-specific flags onto
// AgeingBody to fake this shape would repeat the exact mistake
// buildPipelinePanel's own `mode` param was removed for once it only ever
// had one real caller left — better to give this its own small, honest
// shape than keep growing a shared component's surface for one consumer.
//
// Duration bucket cutoffs are the exact ones confirmed in Milestone 1
// (TIME-INDEPENDENT-METRICS-LOG.md) — contiguous, no gaps, every on-hold
// lead lands in exactly one. Deliberately NOT reusing attention.js's
// STALE_DAYS/ATTENTION_DAYS constants, per the brief: this measures time
// since entering on_hold (via stage_history), a different question from
// time since last activity.
const ON_HOLD_BUCKETS = [
  { key: 'lt1m', label: '< 1 month', min: 0, max: 29 },
  { key: '1to3m', label: '1–3 months', min: 30, max: 89 },
  { key: '3to6m', label: '3–6 months', min: 90, max: 179 },
  { key: '6to12m', label: '6–12 months', min: 180, max: 359 },
  { key: '12mPlus', label: '12+ months', min: 360, max: Infinity },
]

function onHoldBucketFor(days) {
  return ON_HOLD_BUCKETS.find((b) => days >= b.min && days <= b.max) ?? ON_HOLD_BUCKETS[ON_HOLD_BUCKETS.length - 1]
}

// `rows` are leads_on_hold_detail()'s raw rows (lead_id, party, owner_id,
// owner_name, value, on_hold_reason, on_hold_since, days_on_hold,
// resume_date) — see Schema/migration_time_independent_dashboard_metrics.sql.
export function buildOnHoldInsightsPanel(rows, scopeLabel = 'Company', isSinglePersonScope = false) {
  const shaped = rows.map((r) => {
    const days = r.days_on_hold ?? 0
    const bucket = onHoldBucketFor(days)
    const reason = r.on_hold_reason && r.on_hold_reason.trim() ? r.on_hold_reason.trim() : null
    return {
      leadId: r.lead_id,
      party: r.party,
      ownerId: r.owner_id ?? null,
      owner: r.owner_name ?? 'Unassigned',
      rawValue: Number(r.value ?? 0),
      days,
      bucketKey: bucket.key,
      bucketLabel: bucket.label,
      reason,
      // Plain DATE column — same UTC-midnight-then-locale-format pattern
      // buildForecastPanel's own `close` field already uses for
      // estimated_close_date, deliberately not a new date-formatting
      // helper for one more DATE column of the same shape.
      resumeDate: r.resume_date ? new Date(r.resume_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null,
    }
  })

  const totalValue = shaped.reduce((s, r) => s + r.rawValue, 0)
  const avgDays = shaped.length ? Math.round(shaped.reduce((s, r) => s + r.days, 0) / shaped.length) : 0
  const oldestDays = shaped.length ? Math.max(...shaped.map((r) => r.days)) : 0

  const bucketCounts = ON_HOLD_BUCKETS.map((b) => {
    const inBucket = shaped.filter((r) => r.bucketKey === b.key)
    return {
      key: b.key,
      label: b.label,
      count: inBucket.length,
      value: formatCurrencyCompact(inBucket.reduce((s, r) => s + r.rawValue, 0)),
    }
  })
  const maxBucketCount = Math.max(1, ...bucketCounts.map((b) => b.count))

  const owners = new Map()
  shaped.forEach((r) => {
    const key = r.ownerId ?? 'unassigned'
    if (!owners.has(key)) owners.set(key, { id: r.ownerId, name: r.owner, count: 0, value: 0 })
    const entry = owners.get(key)
    entry.count += 1
    entry.value += r.rawValue
  })
  const ownerList = [...owners.values()].sort((a, b) => b.count - a.count)
  const maxOwnerCount = Math.max(1, ...ownerList.map((o) => o.count))

  return {
    kind: 'onHoldInsights',
    eyebrow: `${scopeLabel} · on-hold pipeline`,
    title: 'On-hold pipeline insights',
    value: String(shaped.length),
    note: shaped.length
      ? `${shaped.length} lead${shaped.length === 1 ? '' : 's'} on hold, averaging ${avgDays}d parked.`
      : 'Nothing is currently on hold.',
    stats: [
      { label: 'Value on hold', value: formatCurrencyCompact(totalValue), sub: `across ${shaped.length} lead${shaped.length === 1 ? '' : 's'}`, color: '#485456' },
      { label: 'Avg. days parked', value: shaped.length ? `${avgDays}d` : '—', sub: 'mean', color: '#485456' },
      { label: 'Oldest hold', value: shaped.length ? `${oldestDays}d` : '—', sub: 'longest parked', color: '#485456' },
      { label: 'Owners involved', value: String(ownerList.length), sub: 'sales execs', color: '#101617' },
    ],
    // Display-only breakdown (not a filter, unlike panel 3's stage chips) —
    // the brief lists duration buckets and the owner dropdown/sort toggle
    // as separate things, so buckets stay informational for this pass.
    buckets: bucketCounts.map((b) => ({ ...b, pct: `${Math.round((b.count / maxBucketCount) * 100)}%` })),
    ownerTitle: 'Whose leads these are',
    // Empty in single-person scope — one owner makes the rollup and its own
    // dropdown filter meaningless, same role-matrix rule every other panel
    // in this feature already follows.
    ownerRows: isSinglePersonScope
      ? []
      : ownerList.map((o) => ({
          id: o.id,
          initials: getInitials(o.name),
          name: o.name,
          count: o.count,
          value: formatCurrencyCompact(o.value),
          pct: `${Math.round((o.count / maxOwnerCount) * 100)}%`,
          color: o.count >= 3 ? '#7a6413' : '#9aa5a6',
        })),
    rows: shaped.map((r) => ({
      leadId: r.leadId,
      party: r.party,
      ownerId: r.ownerId,
      owner: r.owner,
      value: formatCurrencyCompact(r.rawValue),
      rawValue: r.rawValue,
      days: r.days,
      sub: r.reason ? `${r.bucketLabel} · ${r.reason}` : r.bucketLabel,
      resumeDate: r.resumeDate ?? '—',
    })),
  }
}

// ---------- team workload balance (metric #6, Milestone 6 panel 5) ----------
// A GENUINELY NEW kind (`workload`) — and a real inversion of every panel
// built so far in this feature. Panels 3/4 treat the owner breakdown as a
// SECONDARY rollup sitting below a lead-level row list; this metric's whole
// point is the owner breakdown, so it IS the primary content and there is
// no lead-level list at all — per the brief, tapping a row opens that
// exec's existing Sales Exec Profile (/employees/:id) instead of building
// a redundant list here.
//
// Sortable by count or by value in the Body (not this builder) — "busiest"
// isn't always the same person by both measures. Both percentages are
// precomputed here against their own metric's max so the Body never has to
// re-derive them on every toggle flip.
//
// `rows` are leads_workload_by_owner()'s raw rows (owner_id, owner_name,
// open_lead_count, open_pipeline_value) — already grouped server-side, one
// row per employee who owns at least one open lead (on-hold included, see
// that function's own header comment for the flagged workload-vs-active
// definition difference); an employee with zero open leads never appears.
//
// NEVER called in single-person scope — RightNowStrip's own `showWorkload`
// prop hides the chip entirely there (a lone employee has nothing to
// compare their own workload against), so unlike every other builder in
// this file there is no `isSinglePersonScope` param to gate a section on.
export function buildWorkloadPanel(rows, scopeLabel = 'Company') {
  const shaped = rows.map((r) => ({
    id: r.owner_id ?? null,
    name: r.owner_name ?? 'Unassigned',
    count: Number(r.open_lead_count ?? 0),
    rawValue: Number(r.open_pipeline_value ?? 0),
  }))

  const busiest = shaped.length ? [...shaped].sort((a, b) => b.count - a.count)[0] : null
  const lightest = shaped.length ? [...shaped].sort((a, b) => a.count - b.count)[0] : null
  const totalLeads = shaped.reduce((s, o) => s + o.count, 0)
  const totalValue = shaped.reduce((s, o) => s + o.rawValue, 0)
  const avgCount = shaped.length ? Math.round(totalLeads / shaped.length) : 0

  const maxCount = Math.max(1, ...shaped.map((o) => o.count))
  const maxValue = Math.max(1, ...shaped.map((o) => o.rawValue))

  return {
    kind: 'workload',
    eyebrow: `${scopeLabel} · team workload`,
    title: 'Team workload balance',
    value: String(shaped.length),
    // Three distinct cases, not two — collapsing the single-employee case
    // into the same "evenly" branch as a genuine multi-employee tie read as
    // nonsense ("1 employee currently holds open leads, evenly.", caught
    // live testing a real one-person coordinator team on port 5182).
    note:
      shaped.length === 1
        ? `${shaped[0].name} is the only one currently holding open leads (${shaped[0].count}).`
        : busiest && lightest && busiest.id !== lightest.id
          ? `${busiest.name} carries the most open leads (${busiest.count}); ${lightest.name} carries the least (${lightest.count}).`
          : shaped.length
            ? `${shaped.length} employees are evenly loaded, ${shaped[0].count} open lead${shaped[0].count === 1 ? '' : 's'} each.`
            : 'No one currently holds an open lead.',
    stats: [
      { label: 'Employees', value: String(shaped.length), sub: 'with open leads', color: '#101617' },
      { label: 'Avg. per person', value: shaped.length ? String(avgCount) : '—', sub: 'open leads', color: '#485456' },
      { label: 'Busiest', value: busiest ? String(busiest.count) : '—', sub: busiest ? busiest.name : '—', color: '#7a6413' },
      { label: 'Total pipeline', value: formatCurrencyCompact(totalValue), sub: `${totalLeads} lead${totalLeads === 1 ? '' : 's'}`, color: '#101617' },
    ],
    // Sorted by count desc by default (matches leads_workload_by_owner()'s
    // own ORDER BY) — the Body's toggle re-sorts client-side from this same
    // array rather than re-fetching.
    ownerRows: shaped.map((o) => ({
      id: o.id,
      initials: getInitials(o.name),
      name: o.name,
      count: o.count,
      rawValue: o.rawValue,
      value: formatCurrencyCompact(o.rawValue),
      countPct: `${Math.round((o.count / maxCount) * 100)}%`,
      valuePct: `${Math.round((o.rawValue / maxValue) * 100)}%`,
    })),
  }
}

// ---------- lead data completeness (metric #4, Milestone 6 panel 6 — the final panel) ----------
// The exact 6 fields leads_completeness_detail() checks (see that function's
// own header comment in the migration for why architect fields are
// deliberately excluded — not every deal has one, and folding them in would
// unfairly penalize leads that genuinely don't need one).
const COMPLETENESS_FIELDS = [
  { key: 'client_name', label: 'Client name', hasKey: 'has_client_name' },
  { key: 'client_number', label: 'Client number', hasKey: 'has_client_number' },
  { key: 'address', label: 'Address', hasKey: 'has_address' },
  { key: 'pincode', label: 'Pincode', hasKey: 'has_pincode' },
  { key: 'site_stage', label: 'Site stage', hasKey: 'has_site_stage' },
  { key: 'product', label: 'Product', hasKey: 'has_product' },
]

// A GENUINELY NEW kind (`completeness`) — reuses rendering PRIMITIVES from
// two different existing kinds rather than either one's whole identity:
// the field bars below reuse `loss`'s `.vip-dd-stage-*` row shape (a
// count/value bar list is a count/value bar list, whether the count is
// "leads lost to this reason" or "leads missing this field"), and the
// per-lead rows reuse `loss`'s own `.vip-dd-lead-row` shape (party + a
// `.vip-dd-hint` detail line + owner + a right-aligned figure). Neither
// panel is reused wholesale — this is exactly the "reuse primitives, never
// borrow a whole panel's identity" rule this file's own Concentration fix
// (Milestone 6 panel 2) exists to enforce.
//
// `rows` are leads_completeness_detail()'s raw rows (lead_id, party,
// owner_id, owner_name, has_client_name, has_client_number, has_address,
// has_pincode, has_site_stage, has_product, missing_fields, completeness_pct)
// — one row per currently-open lead, already scoped by the caller's RLS/
// p_owner_ids.
export function buildCompletenessPanel(rows, scopeLabel = 'Company', isSinglePersonScope = false) {
  const shaped = rows.map((r) => ({
    leadId: r.lead_id,
    // The RPC's own generic fallback chain lands on the literal string
    // '(no party)' when nothing resolves (see its header comment) — this
    // panel is specifically about data completeness, and "client name" is
    // one of the six fields being measured, so a more informative label
    // fits this one context better than the generic fallback every other
    // panel's party column uses unchanged.
    party: r.party && r.party !== '(no party)' ? r.party : 'No client linked yet',
    ownerId: r.owner_id ?? null,
    owner: r.owner_name ?? 'Unassigned',
    missingFields: r.missing_fields ?? [],
    rawPct: Number(r.completeness_pct ?? 0),
  }))

  const total = shaped.length
  const blendedPct = total ? Math.round(shaped.reduce((s, r) => s + r.rawPct, 0) / total) : null
  const fullyComplete = shaped.filter((r) => r.rawPct >= 100).length

  // Computed straight off the raw `has_*` booleans (not off `shaped`, which
  // only carries the derived/display fields) — one field-completeness % per
  // field, matching dashboard_snapshot_metrics()'s own *_pct scalars exactly
  // (same rows, same formula), though this panel always recomputes fresh
  // from its own detail rows rather than trusting the snapshot's cached
  // scalar, same "one definition, fetched lazily" split every sibling panel
  // in this feature already follows.
  const fieldStats = COMPLETENESS_FIELDS.map((f) => {
    const completeCount = rows.filter((r) => r[f.hasKey]).length
    const missing = total - completeCount
    const pct = total ? Math.round((completeCount / total) * 100) : 0
    return { key: f.key, label: f.label, pct: `${pct}%`, rawPct: pct, count: completeCount, missing }
  })
  const worstField = fieldStats.length ? [...fieldStats].sort((a, b) => b.missing - a.missing)[0] : null

  const owners = new Map()
  shaped.forEach((r) => {
    const key = r.ownerId ?? 'unassigned'
    if (!owners.has(key)) owners.set(key, { id: r.ownerId, name: r.owner, count: 0, sumPct: 0 })
    const entry = owners.get(key)
    entry.count += 1
    entry.sumPct += r.rawPct
  })
  // Worst-first (ascending avg %) — the point of this rollup is spotting
  // whose leads need cleanup, not celebrating whoever's tidiest, so the
  // employee most worth following up with sorts to the top.
  const ownerList = [...owners.values()]
    .map((o) => ({ ...o, avgPct: Math.round(o.sumPct / o.count) }))
    .sort((a, b) => a.avgPct - b.avgPct)

  return {
    kind: 'completeness',
    eyebrow: `${scopeLabel} · data completeness`,
    title: 'Lead data completeness',
    value: blendedPct != null ? `${blendedPct}%` : '—',
    note: total
      ? `${total} open lead${total === 1 ? '' : 's'} checked across 6 fields.${
          worstField && worstField.missing > 0
            ? ` ${worstField.label} is missing most often (${worstField.missing} lead${worstField.missing === 1 ? '' : 's'}).`
            : ' Every field is complete on every open lead.'
        }`
      : 'No open leads to check right now.',
    stats: [
      { label: 'Leads checked', value: String(total), sub: 'currently open', color: '#101617' },
      { label: 'Avg. completeness', value: blendedPct != null ? `${blendedPct}%` : '—', sub: 'across 6 fields', color: '#485456' },
      { label: 'Fully complete', value: String(fullyComplete), sub: 'all 6 fields set', color: '#1f6f4a' },
      { label: 'Worst field', value: worstField && worstField.missing > 0 ? worstField.label : '—', sub: worstField && worstField.missing > 0 ? `${worstField.missing} missing` : 'none missing', color: '#b4232a' },
    ],
    fieldStats,
    ownerTitle: 'Average completeness by owner',
    // Empty in single-person scope, same role-matrix rule every other
    // owner rollup in this feature already follows — one person has
    // nothing to compare their own completeness against.
    ownerRows: isSinglePersonScope
      ? []
      : ownerList.map((o) => ({
          id: o.id,
          initials: getInitials(o.name),
          name: o.name,
          count: o.count,
          value: `${o.avgPct}%`,
          pct: `${o.avgPct}%`,
          color: o.avgPct >= 80 ? '#1f6f4a' : o.avgPct >= 50 ? '#7a6413' : '#b4232a',
        })),
    // Only fields with at least one missing lead get a filter chip — a
    // "Missing product" chip that matches zero rows is the same pointless-
    // control failure mode panel 4's empty-state fix already exists to
    // avoid, just for a filter chip instead of a whole section.
    fieldFilters: fieldStats.filter((f) => f.missing > 0).map((f) => ({ key: f.key, label: f.label, missing: f.missing })),
    rows: shaped.map((r) => ({
      leadId: r.leadId,
      party: r.party,
      ownerId: r.ownerId,
      owner: r.owner,
      missingFields: r.missingFields,
      missingSummary: r.missingFields.length
        ? `Missing: ${r.missingFields.map((k) => COMPLETENESS_FIELDS.find((f) => f.key === k)?.label ?? k).join(', ')}`
        : 'All fields complete',
      pctLabel: `${Math.round(r.rawPct)}%`,
      rawPct: r.rawPct,
    })),
  }
}

// ---------- win rate (its own minimal kind — a real per-exec breakdown, not a forced reuse of `pipeline`) ----------
export function buildWinRatePanel({ decidedStageHistory, employees, range, rangeLabel, scopeLabel = 'Company' }) {
  const inRange = decidedStageHistory.filter((row) => row.leads && new Date(row.changed_at) >= range.start && new Date(row.changed_at) <= range.end)
  const won = inRange.filter((r) => r.stage === 'won')
  const lost = inRange.filter((r) => r.stage === 'lost')
  const winRate = inRange.length ? Math.round((won.length / inRange.length) * 100) : null

  const byExec = new Map()
  inRange.forEach((row) => {
    const key = row.leads.owner_employee_id ?? 'unassigned'
    if (!byExec.has(key)) byExec.set(key, { won: 0, lost: 0 })
  })
  won.forEach((row) => byExec.get(row.leads.owner_employee_id ?? 'unassigned').won++)
  lost.forEach((row) => byExec.get(row.leads.owner_employee_id ?? 'unassigned').lost++)
  const nameFor = (id) => employees.find((e) => e.id === id)?.name ?? 'Unassigned'

  return {
    kind: 'winrate',
    eyebrow: `${scopeLabel} · win rate`,
    title: scopeLabel === 'Company' ? 'Won vs lost, by exec' : 'Won vs lost',
    value: winRate != null ? `${winRate}%` : '—',
    note: `${rangeLabel}. Measured on decided leads only (won or lost) — a lead still open isn't counted either way.`,
    stats: [
      { label: 'Won', value: String(won.length), sub: rangeLabel, color: '#1f6f4a' },
      { label: 'Lost', value: String(lost.length), sub: rangeLabel, color: '#b4232a' },
      { label: 'Win rate', value: winRate != null ? `${winRate}%` : '—', sub: 'of decided leads', color: '#101617' },
      { label: 'Decided', value: String(inRange.length), sub: rangeLabel, color: '#101617' },
    ],
    execRows: [...byExec.entries()]
      .map(([id, v]) => ({
        name: id === 'unassigned' ? 'Unassigned' : nameFor(id),
        won: v.won,
        lost: v.lost,
        total: v.won + v.lost,
        rate: v.won + v.lost ? Math.round((v.won / (v.won + v.lost)) * 100) : null,
      }))
      .sort((a, b) => b.total - a.total),
  }
}

// ---------- forecast ----------
export function buildForecastPanel({ forecast, scopeLabel = 'Company' }) {
  const total = forecast.length
  const gross = forecast.reduce((s, l) => s + Number(l.quote_value ?? 0), 0)
  const weighted = forecast.reduce((s, l) => s + (Number(l.quote_value ?? 0) * (l.closure_probability ?? 0)) / 100, 0)

  const buckets = new Map()
  forecast.forEach((l) => {
    const key = l.estimated_close_date ? new Date(l.estimated_close_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'No date set'
    if (!buckets.has(key)) buckets.set(key, { gross: 0, weighted: 0 })
    const b = buckets.get(key)
    b.gross += Number(l.quote_value ?? 0)
    b.weighted += (Number(l.quote_value ?? 0) * (l.closure_probability ?? 0)) / 100
  })
  const maxGross = Math.max(1, ...[...buckets.values()].map((b) => b.gross))

  return {
    kind: 'forecast',
    eyebrow: `${scopeLabel} · weighted closure forecast`,
    title: 'What the open pipeline is worth, weighted by probability',
    value: formatCurrencyCompact(weighted),
    note: `${total} leads with a quote sent or a closure probability set. Weighted = quote value × closure probability.`,
    stats: [
      { label: 'Weighted total', value: formatCurrencyCompact(weighted), sub: `${total} leads`, color: '#0f6b6b' },
      { label: 'Gross', value: formatCurrencyCompact(gross), sub: 'unadjusted', color: '#485456' },
      { label: 'High confidence', value: formatCurrencyCompact(forecast.filter((l) => (l.closure_probability ?? 0) >= 70).reduce((s, l) => s + Number(l.quote_value ?? 0), 0)), sub: '70%+ probability', color: '#1f6f4a' },
      { label: 'At risk', value: formatCurrencyCompact(forecast.filter((l) => (l.closure_probability ?? 0) < 40).reduce((s, l) => s + Number(l.quote_value ?? 0), 0)), sub: 'below 40%', color: '#b4232a' },
    ],
    fcBuckets: [...buckets.entries()].map(([label, b]) => ({
      label,
      gross: formatCurrencyCompact(b.gross),
      weighted: formatCurrencyCompact(b.weighted),
      grossH: `${Math.round((b.gross / maxGross) * 100)}%`,
      weightedH: b.gross ? `${Math.round((b.weighted / b.gross) * 100)}%` : '0%',
    })),
    fcRows: forecast.map((l) => ({
      leadId: l.id,
      party: leadDisplayName(l),
      sub: stageLabel(l.current_stage ?? 'calling'),
      ownerId: l.owner_employee_id ?? null,
      owner: l.employees?.name ?? 'Unassigned',
      prob: l.closure_probability != null ? `${l.closure_probability}%` : '—',
      // An unset probability renders as an em-dash — paint it neutral, not
      // the red the old `?? 0` gave it. "Nobody has assessed this lead" is
      // not the same claim as "this lead is unlikely to close".
      probColor:
        l.closure_probability == null
          ? TONE_NEUTRAL
          : l.closure_probability >= 70
            ? '#1f6f4a'
            : l.closure_probability >= 45
              ? '#7a6413'
              : '#b4232a',
      value: formatCurrencyCompact(l.quote_value),
      close: l.estimated_close_date ? new Date(l.estimated_close_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
    })),
  }
}

// ---------- mix: leads by source ----------
export function buildMixPanel({ periodLeads, breakdownLeads, sourceOptions, rangeLabel, scopeLabel = 'Company' }) {
  const total = periodLeads.length
  const counts = sourceOptions.map((opt) => ({
    label: opt.label,
    value: opt.value,
    count: periodLeads.filter((l) => l.source_type === opt.value).length,
  }))
  const palette = ['#0f6b6b', '#2f5878', '#5a4287', '#7a6413', '#9aa5a6']

  const mixRows = counts.map((c, i) => {
    const allTime = breakdownLeads.filter((l) => l.source_type === c.value)
    const won = allTime.filter((l) => l.current_stage === 'won').length
    const conv = allTime.length ? Math.round((won / allTime.length) * 100) : null
    return {
      label: c.label,
      count: c.count,
      share: total ? `${Math.round((c.count / total) * 100)}%` : '0%',
      conv: conv != null ? `${conv}%` : '—',
      color: palette[i % palette.length],
      convColor: conv == null ? '#8a9698' : conv >= 45 ? '#1f6f4a' : conv >= 30 ? '#7a6413' : '#b4232a',
    }
  })

  return {
    kind: 'mix',
    eyebrow: `${scopeLabel} · lead source`,
    title: 'Where new leads come from',
    value: String(total),
    note: `${rangeLabel}. Conversion is all-time (won ÷ total) for that source, not scoped to this period.`,
    mixTotal: String(total),
    mixUnit: 'NEW',
    mixRows,
  }
}

const CATEGORY_PALETTE = ['#0f6b6b', '#2f5878', '#5a4287', '#7a6413', '#9aa5a6', '#0b5252', '#4a7a9e', '#8a6bab', '#a8853a', '#6f7c7e']

// ---------- mix: generic category breakdown (Area / Site stage / Product) ----------
// Reuses the exact same `mix` kind as buildMixPanel above — donut + legend
// rows are a generic enough shape for "count of leads per bucket" that a
// second kind isn't needed. Unlike source (which is date-range scoped),
// these are pipeline snapshots off the same unbounded `breakdownLeads` the
// compact card itself groups — same numbers, just the rows the card capped.
export function buildCategoryMixPanel({ breakdownLeads, getCategory, eyebrow, title, unit }) {
  const counts = new Map()
  breakdownLeads.forEach((lead) => {
    const cat = getCategory(lead)
    if (!counts.has(cat)) counts.set(cat, { count: 0, won: 0, value: 0 })
    const entry = counts.get(cat)
    entry.count += 1
    entry.value += Number(lead.order_value ?? 0)
    if ((lead.current_stage ?? 'calling') === 'won') entry.won += 1
  })
  const total = breakdownLeads.length
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)

  const mixRows = sorted.map(([label, v], i) => {
    const conv = v.count ? Math.round((v.won / v.count) * 100) : null
    return {
      label,
      count: v.count,
      share: total ? `${Math.round((v.count / total) * 100)}%` : '0%',
      conv: conv != null ? `${conv}%` : '—',
      color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
      convColor: conv == null ? '#8a9698' : conv >= 45 ? '#1f6f4a' : conv >= 30 ? '#7a6413' : '#b4232a',
    }
  })

  return {
    kind: 'mix',
    eyebrow,
    title,
    value: String(total),
    note: `${total} leads in the current pipeline, grouped by ${unit}. Conversion is won ÷ total for that bucket.`,
    mixTotal: String(total),
    mixUnit: unit.toUpperCase(),
    mixRows,
  }
}

// ---------- loss ----------
export function buildLossPanel({ lossReasons }) {
  const reasonCounts = new Map(LOSS_REASON_OPTIONS.map((r) => [r, { count: 0, value: 0 }]))
  const competitorCounts = new Map()
  const total = lossReasons.length
  let totalValue = 0

  lossReasons.forEach((row) => {
    const reason = row.reason && reasonCounts.has(row.reason) ? row.reason : 'other'
    const value = Number(row.leads?.order_value ?? row.leads?.quote_value ?? 0)
    const entry = reasonCounts.get(reason)
    entry.count += 1
    entry.value += value
    totalValue += value
    if (row.competitor_name) {
      const name = row.competitor_name.trim()
      if (!competitorCounts.has(name)) competitorCounts.set(name, { count: 0, value: 0 })
      const c = competitorCounts.get(name)
      c.count += 1
      c.value += value
    }
  })
  const maxReason = Math.max(1, ...[...reasonCounts.values()].map((r) => r.count))

  const lostLeads = [...lossReasons]
    .sort((a, b) => new Date(b.lost_at) - new Date(a.lost_at))
    .slice(0, 20)
    .map((row) => ({
      leadId: row.lead_id,
      party: row.leads ? leadDisplayName(row.leads) : '(no party)',
      reason: row.reason ?? 'other',
      ownerId: row.leads?.owner_employee_id ?? null,
      owner: row.leads?.employees?.name ?? 'Unassigned',
      value: formatCurrencyCompact(row.leads?.order_value ?? row.leads?.quote_value ?? 0),
      date: row.lost_at ? new Date(row.lost_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
    }))

  return {
    kind: 'loss',
    eyebrow: 'Company · lost leads',
    title: 'Why we lose, and to whom',
    value: String(total),
    note: `${formatCurrencyCompact(totalValue)} of value across every lead marked lost. Reasons are captured at the point of marking a lead lost.`,
    stats: [
      { label: 'Lost', value: String(total), sub: 'all-time', color: '#b4232a' },
      { label: 'Value lost', value: formatCurrencyCompact(totalValue), sub: 'gross', color: '#b4232a' },
      { label: 'Named competitors', value: String(competitorCounts.size), sub: 'distinct', color: '#101617' },
      { label: 'Top reason', value: [...reasonCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0]?.[0] ?? '—', sub: 'most common', color: '#7a6413' },
    ],
    lossRows: [...reasonCounts.entries()].map(([label, r]) => ({
      label,
      count: r.count,
      value: formatCurrencyCompact(r.value),
      pct: `${Math.round((r.count / maxReason) * 100)}%`,
    })),
    compRows: [...competitorCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, c]) => ({ name, count: c.count, value: formatCurrencyCompact(c.value) })),
    lostLeads,
  }
}
