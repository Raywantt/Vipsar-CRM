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
import { computeOrderValueActuals, targetFor } from '../components/TargetsVsActualsCard'
import { computeFunnel } from '../components/SalesFunnelCard'
import { dealValueFor } from './pipelineValue'

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
export function buildOrderValueAttainPanel({ employees, targets, wonStageHistory, range, employeeId, rangeLabel, scopeLabel = 'Company' }) {
  const employee = employeeId ? employees.find((e) => e.id === employeeId) : null
  const isCompanyScope = !employee && scopeLabel === 'Company'
  const actualsByEmployee = computeOrderValueActuals(wonStageHistory, range, true)
  const actual = employeeId
    ? actualsByEmployee.get(employeeId) ?? 0
    : [...actualsByEmployee.values()].reduce((s, v) => s + v, 0)
  const target = employeeId ? targetFor(targets, employeeId, 'order_value') : companyTargetFor(targets, employees, 'order_value')

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

// ---------- attain: one exec's blended attainment across all 5 metrics (heatmap "overall" column) ----------
// Metrics here must match DashboardHeatmap's own COLS (ACTIVITY_METRIC_OPTIONS
// + order_value) exactly — this panel is what that heatmap's "Overall" cell
// opens, so a mismatch would show a different number than the cell itself.
export function buildOverallAttainPanel({ employee, targets, activities, wonStageHistory, range, rangeLabel }) {
  const metrics = [...ACTIVITY_METRIC_OPTIONS.map((t) => t.value), 'order_value']
  const orderActual = computeOrderValueActuals(wonStageHistory, range, true).get(employee.id) ?? 0
  const rows = metrics.map((metric) => {
    const target = targetFor(targets, employee.id, metric)
    const actual =
      metric === 'order_value' ? orderActual : activities.filter((a) => a.employee_id === employee.id && a.activity_type === metric).length
    return {
      label: metric === 'order_value' ? 'Order value' : ACTIVITY_LABELS[metric],
      actual,
      target,
      pct: target ? Math.round((actual / target) * 100) : null,
    }
  })
  const withTarget = rows.filter((r) => r.pct != null)
  const overallPct = withTarget.length ? Math.round(withTarget.reduce((s, r) => s + r.pct, 0) / withTarget.length) : null

  return {
    kind: 'attain',
    eyebrow: `${employee.name} · overall`,
    title: 'Blended attainment across all five targets',
    value: overallPct != null ? `${overallPct}%` : '—',
    note: `${rangeLabel}. Simple average of whichever of the five metrics have a target set for ${employee.name.split(' ')[0]}.`,
    stats: [
      { label: 'Overall', value: overallPct != null ? `${overallPct}%` : '—', sub: `${withTarget.length} of 5 have targets`, color: '#101617' },
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

export function buildLogPanel({ employee, activityType, targets, range, rangeLabel, logRows }) {
  const label = ACTIVITY_LABELS[activityType]
  // target_value can be a stored decimal — this is a log count, round it for
  // display (delta % below still divides by the raw value for accuracy).
  const rawTarget = targetFor(targets, employee.id, activityType)
  const target = rawTarget != null ? Math.round(rawTarget) : null
  const inRange = logRows.filter((r) => {
    const at = new Date(r.created_at)
    return at >= range.start && at <= range.end
  })

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
    value: target != null ? `${inRange.length} / ${target}` : String(inRange.length),
    delta: rawTarget != null ? `${Math.round((inRange.length / rawTarget) * 100)}%` : null,
    note: `${rangeLabel}. Every row below is a real entry ${employee.name.split(' ')[0]} logged in the Activity log.`,
    stats: [
      { label: 'Logged', value: String(inRange.length), sub: rangeLabel, color: '#101617' },
      { label: 'Target', value: target != null ? String(target) : '—', sub: 'for this period', color: '#485456' },
      { label: 'Last 20 working days', value: String(counts.reduce((s, c) => s + c, 0)), sub: 'entries logged', color: '#101617' },
      { label: 'Silent days', value: String(silentDays), sub: 'of last 20', color: silentDays > 6 ? '#b4232a' : silentDays > 3 ? '#7a6413' : '#1f6f4a' },
    ],
    rhythm,
    rhythmFrom: rhythmDays[0]?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    rhythmTo: rhythmDays[rhythmDays.length - 1]?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    logTitle: `${label} · most recent first`,
    log: logRows.slice(0, 40).map((r) => {
      const linkedLead = r.leads
      const party = linkedLead?.parties?.name ?? r.parties?.name ?? '(no party)'
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
        party: l.parties?.name ?? l.sites?.nickname ?? '(no party)',
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
export function buildPipelinePanel({ breakdownLeads, funnelStageHistory, scopeLabel = 'Company' }) {
  const openLeads = breakdownLeads.filter((l) => !CLOSED_STAGES.includes(l.current_stage ?? 'calling'))
  const openTotal = openLeads.reduce((s, l) => s + dealValueFor(l), 0)

  const stageRows = LEAD_STAGE_OPTIONS.filter((s) => !CLOSED_STAGES.includes(s)).map((stage) => {
    const stageLeads = openLeads.filter((l) => (l.current_stage ?? 'calling') === stage)
    return {
      label: stageLabel(stage),
      count: stageLeads.length,
      value: formatCurrencyCompact(stageLeads.reduce((s, l) => s + dealValueFor(l), 0)),
      color: stageFg(stage),
      // Clicking this row opens that stage's own lead list, one level deeper.
      drill: buildStageLeadsPanel({ breakdownLeads, stage, scopeLabel }),
    }
  })
  const maxStage = Math.max(1, ...stageRows.map((r) => r.count))

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
    convRows.push({
      label: `${stageLabel(prev.stage)} → ${stageLabel(cur.stage)}`,
      pct: `${rate}%`,
      sub: `${prev.reached} → ${cur.reached}`,
      color: rate >= 60 ? '#1f6f4a' : rate >= 40 ? '#7a6413' : '#b4232a',
    })
  }

  const topLeads = [...openLeads]
    .sort((a, b) => dealValueFor(b) - dealValueFor(a))
    .slice(0, 5)
    .map((l) => ({
      leadId: l.id,
      party: l.parties?.name ?? l.sites?.nickname ?? '(no party)',
      stage: stageLabel(l.current_stage ?? 'calling'),
      chipClass: stageChipClass(l.current_stage ?? 'calling'),
      owner: l.employees?.name ?? 'Unassigned',
      value: formatCurrencyCompact(dealValueFor(l)),
    }))

  return {
    kind: 'pipeline',
    eyebrow: `${scopeLabel} · open pipeline`,
    title: 'Open pipeline by stage',
    value: formatCurrencyCompact(openTotal),
    note: `${openLeads.length} open leads, across every stage that isn't won or lost.`,
    stats: [
      { label: 'Open value', value: formatCurrencyCompact(openTotal), sub: `${openLeads.length} leads`, color: '#101617' },
      { label: 'Reached Calling', value: String(funnel[0]?.reached ?? 0), sub: 'all-time', color: '#101617' },
      { label: 'Reached Won', value: String(funnel.find((f) => f.stage === 'won')?.reached ?? 0), sub: 'all-time', color: '#1f6f4a' },
      { label: 'Reached Lost', value: String(funnel.find((f) => f.stage === 'lost')?.reached ?? 0), sub: 'all-time', color: '#b4232a' },
    ],
    stageRows: stageRows.map((r) => ({ ...r, pct: `${Math.round((r.count / maxStage) * 100)}%` })),
    convRows,
    topLeads,
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
      party: l.parties?.name ?? '(no party)',
      sub: stageLabel(l.current_stage ?? 'calling'),
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
      party: row.leads?.parties?.name ?? '(no party)',
      reason: row.reason ?? 'other',
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
