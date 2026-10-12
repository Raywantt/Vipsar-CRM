// The Team Report (/team-report, 2026-10-12) — the numbers of the people who
// work for the viewer, by week / month / quarter / year, on screen ("the
// briefing") and as an Excel download. Pure: the screen fetches, this file
// shapes, src/lib/teamReportFile.js turns the shape into a workbook.
//
// The owner's rulings (2026-10-12):
//   - Periods are TICKED FROM A LIST of recent weeks / months / quarters /
//     years, gaps allowed — not a from–to range.
//   - Eleven measures. "Other meetings" was dropped; Site visits is its own.
//   - Fresh RFQs follow the RFQ target's rule — once per lead, on the day the
//     RFQ passes the technical check (before the desk went live, the day it was
//     logged) — so this report and the Targets card can't disagree. Revised
//     RFQs count on the day they were logged.
//   - Leads count for the lead's CURRENT OWNER on the day the lead was created
//     (the Scanning Leads target's rule); order value for the current owner on
//     the day the lead was marked Won (the Order Value target's rule).
//   - The owner's report lists the business development managers in a section
//     of their own, credited by "brought in by" (leads.bdm_employee_id) and
//     left out of the team total — a lead a BDM brought in and an exec now owns
//     shows on both rows, so one total over both would count it twice.
//   - Each person's target sits beside the actual wherever one was set for that
//     person and period (Week / Month / Quarter — a Year has no target period).
//
// EVERY FIGURE IS AN EXISTING RULE. Calls, both meeting buckets and Fresh RFQs
// come from computeActivityActuals, leads from computeSourceLeadsActuals, order
// value from computeOrderValueActuals — the functions behind the Targets card
// and the heatmap — so a period here reads exactly what those read for the same
// period. teamReport.test.js pins each one against its source.
import {
  computeActivityActuals,
  computeOrderValueActuals,
  computeSourceLeadsActuals,
  targetFor,
} from '../components/TargetsVsActualsCard'
import { OLD_MEETING, NEW_MEETING } from './meetingBucket'
import { parseTimestamp } from './dbTime'
import { periodSpanLabel, startOfWeek } from './dateRanges'
import { periodValueForDate } from './targetPeriods'
import { hasImportDate } from './leadSources'
import { hasImportWinDate } from './bookedOrders'
import { HISTORY_STARTS_AT } from './attention'

// ---------- periods ----------

// `listSize` — how many recent periods the list offers before "Show older";
// `ticked` — how many of the newest start ticked.
export const REPORT_PERIOD_TYPES = [
  { value: 'week', label: 'Week', plural: 'weeks', listSize: 12, ticked: 4 },
  { value: 'month', label: 'Month', plural: 'months', listSize: 12, ticked: 3 },
  { value: 'quarter', label: 'Quarter', plural: 'quarters', listSize: 8, ticked: 2 },
  { value: 'year', label: 'Year', plural: 'years', listSize: 4, ticked: 1 },
]

export function periodTypeInfo(type) {
  return REPORT_PERIOD_TYPES.find((t) => t.value === type) ?? REPORT_PERIOD_TYPES[0]
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfPeriod(type, date) {
  if (type === 'week') return startOfWeek(date)
  if (type === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
  if (type === 'quarter') return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
  return new Date(date.getFullYear(), 0, 1)
}

// The start of the period `steps` periods after the one starting at `start`
// (negative = earlier). Built from calendar fields, never by adding
// milliseconds, so a daylight-saving viewer can't drift off midnight.
function shiftStart(type, start, steps) {
  if (type === 'week') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + steps * 7)
  if (type === 'month') return new Date(start.getFullYear(), start.getMonth() + steps, 1)
  if (type === 'quarter') return new Date(start.getFullYear(), start.getMonth() + steps * 3, 1)
  return new Date(start.getFullYear() + steps, 0, 1)
}

function periodKey(type, start) {
  return type === 'year' ? String(start.getFullYear()) : periodValueForDate(type, start)
}

// One period: local-time bounds (the Dashboard's own — Monday-start weeks,
// calendar months and quarters), its labels, and the targets.period_value it
// keys (null for a year, which no target is set against).
export function makePeriod(type, start, now = new Date()) {
  const end = new Date(shiftStart(type, start, 1).getTime() - 1)
  const isCurrent = now >= start && now <= end
  let label
  let fullLabel
  if (type === 'week') {
    label = periodSpanLabel('week', { start, end }, now)
    fullLabel = periodSpanLabel('week', { start, end }, new Date(0))
  } else if (type === 'month') {
    label = `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}`
    fullLabel = label
  } else if (type === 'quarter') {
    const q = Math.floor(start.getMonth() / 3) + 1
    label = `Q${q} ${start.getFullYear()}`
    fullLabel = `${label} (${MONTH_SHORT[start.getMonth()]} – ${MONTH_SHORT[end.getMonth()]})`
  } else {
    label = String(start.getFullYear())
    fullLabel = label
  }
  const key = periodKey(type, start)
  return {
    key,
    type,
    start,
    end,
    isCurrent,
    label,
    fullLabel,
    targetValue: type === 'year' ? null : key,
  }
}

// The `count` most recent periods of a type, NEWEST FIRST — the list the
// screen ticks from. The first is the current period, still running.
export function listReportPeriods(type, count, now = new Date()) {
  const current = startOfPeriod(type, now)
  return Array.from({ length: count }, (_, i) => makePeriod(type, shiftStart(type, current, -i), now))
}

// What the data reads have to cover for a list of periods: the oldest start to
// the newest end. Day-padded at the start, because the lead and order rules
// read naive timestamps the old way (new Date() — see TargetsVsActualsCard)
// and a row can sit up to 5½ hours either side of its UTC instant; the period
// filters below decide membership, this only has to fetch enough.
export function dataSpanFor(periods) {
  if (!periods.length) return null
  const start = new Date(Math.min(...periods.map((p) => p.start.getTime())))
  const end = new Date(Math.max(...periods.map((p) => p.end.getTime())))
  return { start: new Date(start.getTime() - 86400000), end: new Date(end.getTime() + 86400000) }
}

// Ticked periods in the order a table reads them: oldest on the left.
export function chronological(periods) {
  return [...periods].sort((a, b) => a.start - b.start)
}

// "4 weeks" / "1 month".
export function periodCountLabel(type, n) {
  const info = periodTypeInfo(type)
  return `${n} ${n === 1 ? info.label.toLowerCase() : info.plural}`
}

// ---------- measures ----------

// In deal-flow order: the leads someone brought in, the work they did, the
// RFQs it produced, the orders it closed. `target` is the targets.metric_name a
// salesperson's target is kept under; `bdmTarget` a BDM's (targetMetrics.js).
export const REPORT_MEASURES = [
  { key: 'scanning_leads', label: 'Scanning leads', short: 'Scanning', group: 'leads', target: 'scanning_leads' },
  { key: 'referral_leads', label: 'Referral leads', short: 'Referral', group: 'leads' },
  { key: 'architect_leads', label: 'Architect leads', short: 'Architect', group: 'leads' },
  { key: 'calls', label: 'Calls', short: 'Calls', group: 'work', target: 'call' },
  { key: 'site_visits', label: 'Site visits', short: 'Site visits', group: 'work' },
  { key: 'new_meetings', label: 'New meetings', short: 'New mtgs', group: 'work', target: NEW_MEETING },
  { key: 'old_meetings', label: 'Old meetings', short: 'Old mtgs', group: 'work', target: OLD_MEETING },
  {
    key: 'architect_meetings',
    label: 'Architect meetings',
    short: 'Arch. mtgs',
    group: 'work',
    bdmTarget: 'bdm_architect_meetings',
  },
  { key: 'fresh_rfqs', label: 'Fresh RFQs', short: 'Fresh RFQs', group: 'rfqs', target: 'rfq_raised' },
  { key: 'revised_rfqs', label: 'Revised RFQs', short: 'Revised', group: 'rfqs' },
  { key: 'order_value', label: 'Order value booked', short: 'Order value', group: 'orders', money: true, target: 'order_value' },
]

export const MEASURE_GROUPS = [
  { key: 'leads', label: 'Leads brought in' },
  { key: 'work', label: 'Calls and meetings' },
  { key: 'rfqs', label: 'RFQs' },
  { key: 'orders', label: 'Orders' },
]

export const MEASURES_BY_KEY = new Map(REPORT_MEASURES.map((m) => [m.key, m]))

// The chosen measure keys in REPORT_MEASURES order, unknown keys dropped —
// whatever order they were ticked in, or remembered from an older build.
export function orderedMeasures(keys) {
  const chosen = new Set(keys)
  return REPORT_MEASURES.filter((m) => chosen.has(m.key))
}

// The metric a person's target for this measure is kept under, if any.
export function targetMetricFor(measure, section) {
  return section === 'bdm' ? measure.bdmTarget ?? null : measure.target ?? null
}

// ---------- the figures ----------

function inPeriod(value, period) {
  const at = parseTimestamp(value)
  return Boolean(at) && at >= period.start && at <= period.end
}

const bdmOfLead = (lead) => lead.bdm_employee_id
const bdmOfWonRow = (row) => row.leads.bdm_employee_id

// Every person's figures for ONE period, credited both ways — by owner (the
// sales section) and by BDM (the BDM section). Activity figures are the same
// either way: they belong to whoever logged them.
//
// `data` is the screen's one read (fetchTeamReportData):
//   activities  { activity_type, employee_id, rfq_kind, created_at }
//   leads       { id, source_type, owner_employee_id, bdm_employee_id, created_at, external_reference_id }
//   won         stage_history 'won' rows, newest first, with leads(owner_employee_id, bdm_employee_id, order_value, external_reference_id)
//   counted     the RFQs that count toward the target, { raised_by_employee_id, approved_at }
//   liveFrom    the RFQ desk's cutover (null = the desk is off)
export function periodFigures(period, data) {
  const activities = (data.activities ?? []).filter((a) => inPeriod(a.created_at, period))
  const counted = (data.counted ?? []).filter((r) => inPeriod(r.approved_at, period))
  const targetActuals = computeActivityActuals(activities, true, { liveFrom: data.liveFrom ?? null, counted })

  const extra = new Map()
  const bump = (id, key) => {
    if (!extra.has(id)) extra.set(id, { site_visits: 0, architect_meetings: 0, revised_rfqs: 0 })
    extra.get(id)[key] += 1
  }
  activities.forEach((a) => {
    const id = a.employee_id ?? 'unassigned'
    if (a.activity_type === 'site_visit') bump(id, 'site_visits')
    else if (a.activity_type === 'architect_meeting') bump(id, 'architect_meetings')
    else if (a.activity_type === 'rfq_raised' && a.rfq_kind === 'revised') bump(id, 'revised_rfqs')
  })

  const leads = data.leads ?? []
  const won = data.won ?? []
  const byOwner = {
    scanning_leads: computeSourceLeadsActuals(leads, 'scanning', period, true),
    referral_leads: computeSourceLeadsActuals(leads, 'referral_other', period, true),
    architect_leads: computeSourceLeadsActuals(leads, 'referral_architect', period, true),
    order_value: computeOrderValueActuals(won, period, true),
  }
  const byBdm = {
    scanning_leads: computeSourceLeadsActuals(leads, 'scanning', period, true, bdmOfLead),
    referral_leads: computeSourceLeadsActuals(leads, 'referral_other', period, true, bdmOfLead),
    architect_leads: computeSourceLeadsActuals(leads, 'referral_architect', period, true, bdmOfLead),
    order_value: computeOrderValueActuals(won, period, true, bdmOfWonRow),
  }

  return function figuresFor(id, section) {
    const t = targetActuals.get(id)
    const x = extra.get(id)
    const credited = section === 'bdm' ? byBdm : byOwner
    return {
      scanning_leads: credited.scanning_leads.get(id) ?? 0,
      referral_leads: credited.referral_leads.get(id) ?? 0,
      architect_leads: credited.architect_leads.get(id) ?? 0,
      calls: t?.call ?? 0,
      site_visits: x?.site_visits ?? 0,
      new_meetings: t?.[NEW_MEETING] ?? 0,
      old_meetings: t?.[OLD_MEETING] ?? 0,
      architect_meetings: x?.architect_meetings ?? 0,
      fresh_rfqs: t?.rfq_raised ?? 0,
      revised_rfqs: x?.revised_rfqs ?? 0,
      order_value: credited.order_value.get(id) ?? 0,
    }
  }
}

function targetsOfPeriod(targets, period) {
  if (!period.targetValue) return []
  return (targets ?? []).filter((t) => t.period_type === period.type && t.period_value === period.targetValue)
}

function sumOf(values) {
  return values.reduce((s, v) => s + v, 0)
}

// A total target is the sum of the periods' targets only when EVERY period has
// one — "65 calls of a 40 target" would set three weeks of work against one
// week's target. Otherwise there is no honest total, and it reads blank.
function totalTarget(targets) {
  return targets.length && targets.every((t) => t != null) ? sumOf(targets) : null
}

// Whole percent, or null with no target to measure against.
export function attainment(actual, target) {
  return target > 0 ? Math.round((actual / target) * 100) : null
}

// The report itself.
//   periods   the TICKED periods, any order (shown oldest first)
//   people    [{ id, name, role, section: 'sales' | 'bdm' }], in display order
//   measures  REPORT_MEASURES entries, in display order
//   data      as periodFigures, plus `targets` — targets rows for the periods
//
// Returns { periods, measures, sections: [{ key, label, rows, total }], notes }
// where a row is { id, name, role, section, cells } and cells[measureKey] is
// { values: [per period], total, targets: [per period | null] | null,
//   targetTotal } — `targets` null when the measure carries no target for that
// person's section. A section's total row has no targets.
export function buildTeamReport({ periods, people, measures, data }) {
  const ordered = chronological(periods)
  const figures = ordered.map((p) => periodFigures(p, data))
  const periodTargets = ordered.map((p) => targetsOfPeriod(data.targets, p))

  const rowFor = (person) => {
    const perPeriod = figures.map((f) => f(person.id, person.section))
    const cells = {}
    measures.forEach((m) => {
      const values = perPeriod.map((v) => v[m.key])
      const metric = targetMetricFor(m, person.section)
      const targets = metric ? periodTargets.map((rows) => targetFor(rows, person.id, metric)) : null
      cells[m.key] = {
        values,
        total: sumOf(values),
        targets,
        targetTotal: targets ? totalTarget(targets) : null,
      }
    })
    return { id: person.id, name: person.name, role: person.role, section: person.section, cells }
  }

  const totalOf = (rows) => {
    const cells = {}
    measures.forEach((m) => {
      const values = ordered.map((_, i) => sumOf(rows.map((r) => r.cells[m.key].values[i])))
      cells[m.key] = { values, total: sumOf(values), targets: null, targetTotal: null }
    })
    return cells
  }

  const sections = []
  const sales = people.filter((p) => p.section !== 'bdm').map(rowFor)
  const bdms = people.filter((p) => p.section === 'bdm').map(rowFor)
  if (sales.length) sections.push({ key: 'sales', label: 'Sales team', totalLabel: 'Team total', rows: sales, total: totalOf(sales) })
  if (bdms.length) {
    sections.push({
      key: 'bdm',
      label: 'Business development managers',
      totalLabel: 'BDM total',
      rows: bdms,
      total: totalOf(bdms),
    })
  }

  return { periods: ordered, measures, sections, notes: reportNotes({ periods: ordered, people, measures, data }) }
}

// ---------- notes ----------

// The lines the screen and the file print under the figures — what each
// measure means, and what the figures can't be trusted to say.
export function reportNotes({ periods, people, measures, data }) {
  const notes = []
  const keys = new Set(measures.map((m) => m.key))
  const leadMeasures = ['scanning_leads', 'referral_leads', 'architect_leads'].filter((k) => keys.has(k))
  const hasBdms = people.some((p) => p.section === 'bdm')

  if (periods.some((p) => p.isCurrent)) {
    notes.push({ key: 'current', text: `${periods.find((p) => p.isCurrent).fullLabel} is still running — its figures are so far.` })
  }

  // There is no single day the logging began: a few people logged from April
  // 2026, most of the team from September (HISTORY_STARTS_AT is when the
  // spreadsheet imports landed). So the note names no date it can't stand
  // behind — it says what a low early figure may mean.
  const historyStart = new Date(`${HISTORY_STARTS_AT}T00:00:00`)
  if (periods.some((p) => p.start < historyStart)) {
    notes.push({
      key: 'history',
      text: 'Calls, visits, meetings and RFQs count only what was logged in the CRM. Most of the team started logging here in September 2026, so an earlier period can read low or zero for someone who simply wasn’t using the CRM yet. Leads and orders go back further because of the spreadsheet imports.',
    })
  }

  if (leadMeasures.length) {
    notes.push({
      key: 'leads',
      text: hasBdms
        ? 'Leads count on the day they were created, for the person who owns the lead now — the Scanning Leads target’s rule. A BDM’s row counts the leads that BDM brought in.'
        : 'Leads count on the day they were created, for the person who owns the lead now — the Scanning Leads target’s rule.',
    })
  }
  if (keys.has('fresh_rfqs') || keys.has('revised_rfqs')) {
    notes.push({
      key: 'rfqs',
      text: 'Fresh RFQs follow the RFQ target: once per lead, on the day the RFQ passes the technical check (before the RFQ desk, the day it was logged). Revised RFQs count on the day they were logged.',
    })
  }
  if (keys.has('order_value')) {
    notes.push({
      key: 'orders',
      text: hasBdms
        ? 'Order value: leads marked Won in the period, at the order value on file, for the lead’s current owner — the Order Value target’s rule. A BDM’s row counts the leads that BDM brought in.'
        : 'Order value: leads marked Won in the period, at the order value on file, for the lead’s current owner — the Order Value target’s rule.',
    })
  }
  if (measures.some((m) => m.target || m.bdmTarget) && periods.some((p) => p.targetValue)) {
    notes.push({
      key: 'targets',
      text: 'Targets show where one was set for that person and period. A total target shows only when every period has one.',
    })
  }
  if (hasBdms) {
    notes.push({
      key: 'bdm-total',
      text: 'BDMs are left out of the team total: a lead a BDM brought in also counts for the exec who owns it.',
    })
  }

  const imports = importDatedCounts({ periods, people, measures, data })
  if (imports.leads) {
    notes.push({
      key: 'import-leads',
      text: `${imports.leads} of the leads counted carry the day a spreadsheet was imported, not the day the lead arrived. They are counted, as the Dashboard counts them.`,
    })
  }
  if (imports.wins) {
    notes.push({
      key: 'import-wins',
      text: `${imports.wins} of the orders counted carry the day a spreadsheet was imported, not the day the order was won. They are counted, as the Dashboard counts them.`,
    })
  }

  notes.push({ key: 'active', text: 'Only people with an active CRM account are listed.' })
  return notes
}

const LEAD_SOURCE_FOR = {
  scanning_leads: 'scanning',
  referral_leads: 'referral_other',
  architect_leads: 'referral_architect',
}

// How many of the leads and orders behind the shown figures carry an import
// date — the same membership the figures use (created / won in a ticked period,
// credited to someone on the report), so the footnote can't count rows the
// table doesn't.
export function importDatedCounts({ periods, people, measures, data }) {
  const keys = new Set(measures.map((m) => m.key))
  const sources = new Set(Object.entries(LEAD_SOURCE_FOR).filter(([k]) => keys.has(k)).map(([, s]) => s))
  const owners = new Set(people.filter((p) => p.section !== 'bdm').map((p) => p.id))
  const bdms = new Set(people.filter((p) => p.section === 'bdm').map((p) => p.id))
  const inAny = (date) => periods.some((p) => date >= p.start && date <= p.end)

  let leads = 0
  if (sources.size) {
    ;(data.leads ?? []).forEach((l) => {
      if (!sources.has(l.source_type) || !l.created_at) return
      if (!owners.has(l.owner_employee_id) && !bdms.has(l.bdm_employee_id)) return
      if (inAny(new Date(l.created_at)) && hasImportDate(l)) leads += 1
    })
  }

  let wins = 0
  if (keys.has('order_value')) {
    const seen = new Set()
    ;(data.won ?? []).forEach((row) => {
      if (!row.leads || seen.has(row.lead_id)) return
      seen.add(row.lead_id)
      if (!owners.has(row.leads.owner_employee_id) && !bdms.has(row.leads.bdm_employee_id)) return
      if (inAny(new Date(row.changed_at)) && hasImportWinDate(row.leads, row.changed_at)) wins += 1
    })
  }
  return { leads, wins }
}

// ---------- the people ----------

// Who the report is about, by the viewer's role — the Dashboard's own scoping
// (Dashboard.jsx's roster memo): the owner every salesperson plus, in a
// section of their own, every BDM; a coordinator their team; a manager
// themselves first, then their reports. `execs` is fetchActiveSalesExecs()
// (execs + managers), `bdms` fetchActiveBdms(). Anyone else gets nobody.
export function reportPeople({ viewer, execs, bdms }) {
  if (!viewer) return []
  const byName = (a, b) => (a.name ?? '').localeCompare(b.name ?? '')
  const sales = (list) => [...list].sort(byName).map((e) => ({ id: e.id, name: e.name, role: e.role, section: 'sales' }))
  if (viewer.role === 'owner') {
    return [
      ...sales(execs ?? []),
      ...[...(bdms ?? [])].sort(byName).map((b) => ({ id: b.id, name: b.name, role: 'business_development_manager', section: 'bdm' })),
    ]
  }
  if (viewer.role === 'sales_coordinator') {
    return sales((execs ?? []).filter((e) => e.coordinator_id === viewer.id))
  }
  if (viewer.role === 'sales_manager') {
    const self = (execs ?? []).find((e) => e.id === viewer.id) ?? { id: viewer.id, name: viewer.name, role: viewer.role }
    return [
      { id: self.id, name: self.name, role: self.role ?? viewer.role, section: 'sales' },
      ...sales((execs ?? []).filter((e) => e.manager_id === viewer.id && e.id !== viewer.id)),
    ]
  }
  return []
}
