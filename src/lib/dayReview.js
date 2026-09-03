import { getInitials } from './initials'
import { formatCurrencyCompact } from './format'
import { parseTimestamp, formatClockTime } from './dbTime'
import { stageLabel } from './leadStageOptions'
import { stageChipClass } from './statusColors'
import { ACTIVITY_LABELS } from './activityTypes'
import { SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { TONE_GOOD, TONE_BAD, TONE_NEUTRAL, TONE_WON } from './statusColors'

// Pure shaping for the Day Review — takes the raw rows fetched by
// dayReviewQueries.js and produces the per-exec table rows, the team totals,
// the four day KPIs, and one exec's day sheet. No network calls here, same
// division of labour drilldownBuilders.js already follows.
//
// EVERYTHING IS ONE CALENDAR DAY. Nothing in this file aggregates wider.

// The lead-naming fallback chain used everywhere else in this app.
export function leadName(lead, fallbackParty) {
  return (
    lead?.parties?.name ||
    lead?.sites?.nickname ||
    lead?.sites?.locality ||
    fallbackParty?.name ||
    (lead?.id ? `Lead #${lead.id}` : '—')
  )
}

function siteName(lead) {
  return lead?.sites?.nickname || lead?.sites?.locality || null
}

// A follow-up that's still open is only MISSED once its day is genuinely
// over. While D is today it's PENDING — the rep still has hours left, and
// calling that a miss at 10 am would be a lie the manager acts on. There's no
// configured end-of-working-day in this app, so the boundary is midnight:
// pending all of D, missed from D+1 onward. (§4.4 of the design handoff.)
//
// Reads `status`, not the legacy is_done boolean, so a CANCELLED follow-up is
// counted as neither done nor missed (FOLLOWUPS.md Rule 2.2 — cancelled never
// counts as done). It drops out of `due` as well: a reminder that was
// deliberately called off was not work the rep failed to do, and leaving it in
// the denominator would quietly penalise them for cancelling it.
function splitFollowUps(allRows, isPast) {
  const rows = allRows.filter((f) => f.status !== 'cancelled')
  const done = rows.filter((f) => f.status === 'done')
  const open = rows.filter((f) => f.status === 'open')
  return {
    due: rows.length,
    done: done.length,
    missed: isPast ? open.length : 0,
    pending: isPast ? 0 : open.length,
    doneRows: done,
    openRows: open,
    cancelled: allRows.length - rows.length,
  }
}

// Every lead the exec put a hand on: logged an activity against, edited a
// field of, moved a stage on, or created.
function touchedLeadIds({ activities, changes, stageChanges, newLeads }) {
  const ids = new Set()
  activities.forEach((a) => a.lead_id && ids.add(a.lead_id))
  changes.forEach((c) => c.lead_id && ids.add(c.lead_id))
  stageChanges.forEach((s) => s.lead_id && ids.add(s.lead_id))
  newLeads.forEach((l) => ids.add(l.id))
  return ids
}

// Narrows every fetched collection down to one employee. Note the differing
// attribution columns — each table names the acting employee differently, and
// leads uses created_by_employee_id (who made it) rather than
// owner_employee_id (who holds it now), so a reassignment can't retroactively
// rewrite an old day.
function scopeToEmployee(data, employeeId) {
  return {
    activities: data.activities.filter((a) => a.employee_id === employeeId),
    changes: data.changes.filter((c) => c.changed_by === employeeId),
    // stage_history SELECT is RLS-scoped, but a sales exec's rows on leads
    // they don't own can still arrive with a null `leads` embed — dropped
    // here as belt-and-braces, same as fetchStageHistoryForFunnel's consumers.
    stageChanges: data.stageChanges.filter((s) => s.changed_by === employeeId && s.leads),
    newLeads: data.newLeads.filter((l) => l.created_by_employee_id === employeeId),
    followUps: data.followUps.filter((f) => f.assigned_to === employeeId),
    tomorrowFollowUps: data.tomorrowFollowUps.filter((f) => f.assigned_to === employeeId),
    quotesSent: data.quotesSent.filter((l) => l.owner_employee_id === employeeId),
  }
}

// One table row per exec. `isPast` drives the pending/missed split above.
export function buildDayRows(employees, data, isPast) {
  return employees.map((emp) => {
    const own = scopeToEmployee(data, emp.id)
    const fu = splitFollowUps(own.followUps, isPast)

    return {
      employeeId: emp.id,
      name: emp.name,
      // Carried so the owner's table can badge a sales manager sitting among
      // the execs. They are ranked together deliberately (the owner's ruling:
      // "mixed in, with a role badge"), and without the badge a manager's row
      // is indistinguishable from a rep's — which matters when reading a
      // lighter personal number next to someone whose whole job is selling.
      role: emp.role ?? null,
      initials: getInitials(emp.name),
      total: own.activities.length,
      calls: own.activities.filter((a) => a.activity_type === 'call').length,
      visits: own.activities.filter((a) => a.activity_type === 'site_visit').length,
      touched: touchedLeadIds(own).size,
      newLeads: own.newLeads.length,
      // "Changes" is field-level edits plus stage moves. Creation rows are
      // excluded (a new lead is already its own column), matching the
      // design's own column definition — but stage moves are NOT, since
      // "stage moved" is the first thing decision #9 asks this trail to
      // capture, and in this app that fact lives in stage_history rather
      // than lead_change_log.
      changes: own.changes.filter((c) => c.field !== 'created').length + own.stageChanges.length,
      quotes: own.quotesSent.length,
      done: fu.done,
      missed: fu.missed,
      pending: fu.pending,
      tomorrow: own.tomorrowFollowUps.length,
      tomorrowVisits: own.tomorrowFollowUps.filter((f) => f.activity_type === 'site_visit').length,
      // Only the exec's own Today screen uses these two — the team table has
      // no column for either, but they come free from rows already scoped.
      quotesValue: own.quotesSent.reduce((s, l) => s + Number(l.quote_value ?? 0), 0),
      firstActivityAt: own.activities.length
        ? formatClockTime(own.activities.map((a) => parseTimestamp(a.created_at)).filter(Boolean).sort((a, b) => a - b)[0])
        : null,
    }
  })
}

// The day's three most significant entries, for the exec's own Today screen —
// a coloured dot per kind (teal = activity, navy = a lead edit, red/green = a
// deal lost or won). Newest last, matching the way the day reads top to bottom.
export function buildSignificantEntries(employee, data, limit = 3) {
  const own = scopeToEmployee(data, employee.id)

  const entries = [
    ...own.activities.map((a) => ({
      id: `a${a.id}`,
      at: parseTimestamp(a.created_at),
      color: 'var(--vip-teal)',
      leadId: a.lead_id,
      text: `${leadName(a.leads, a.parties)} — ${(ACTIVITY_LABELS[a.activity_type] ?? a.activity_type).toLowerCase()}`,
    })),
    ...own.changes
      .filter((c) => c.field !== 'created')
      .map((c) => ({
        id: `c${c.id}`,
        at: parseTimestamp(c.changed_at),
        color: 'var(--vip-navy)',
        leadId: c.lead_id,
        text: `${leadName(c.leads)} — ${(FIELD_LABELS[c.field] ?? c.field).toLowerCase()} ${prettyValue(c.field, c.new_value) ?? 'changed'}`,
      })),
    ...own.stageChanges.map((s) => ({
      id: `s${s.id}`,
      at: parseTimestamp(s.changed_at),
      color: s.stage === 'lost' ? 'var(--vip-lost)' : s.stage === 'won' ? 'var(--vip-won)' : 'var(--vip-navy)',
      leadId: s.lead_id,
      text:
        s.stage === 'lost'
          ? `${leadName(s.leads)} — marked lost`
          : s.stage === 'won'
            ? `${leadName(s.leads)} — marked won`
            : `${leadName(s.leads)} — moved to ${stageLabel(s.stage)}`,
    })),
  ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))

  // The LAST few, not the first — the most significant thing about a day at
  // 6 pm is what just happened, not what happened at 9 am.
  return entries.slice(-limit).map((e) => ({ ...e, time: formatClockTime(e.at) }))
}

const SUM_KEYS = ['total', 'calls', 'visits', 'touched', 'newLeads', 'changes', 'quotes', 'done', 'missed', 'pending', 'tomorrow']

export function buildDayTotals(rows) {
  const totals = Object.fromEntries(SUM_KEYS.map((k) => [k, 0]))
  rows.forEach((r) => SUM_KEYS.forEach((k) => { totals[k] += r[k] }))
  return totals
}

// The four KPI tiles. These REPLACE the standing Dashboard KPIs for this
// period rather than re-filtering them — pipeline totals and month attainment
// are meaningless over eight hours.
export function buildDayKpis(data, rows, isPast) {
  const totals = buildDayTotals(rows)
  const otherActivities = totals.total - totals.calls - totals.visits

  const wonToday = data.stageChanges.filter((s) => s.stage === 'won' && s.leads)
  const wonValue = wonToday.reduce((s, r) => s + Number(r.leads?.order_value ?? r.leads?.quote_value ?? 0), 0)
  const wonNames = [...new Set(wonToday.map((r) => leadName(r.leads)))]

  const newValue = data.newLeads.reduce((s, l) => s + Number(l.quote_value ?? 0), 0)

  const followUpSub = isPast
    ? `${totals.done + totals.missed} were due`
    : `${totals.done + totals.pending} due · ${totals.pending} still open`

  return [
    {
      key: 'activities',
      label: 'Activities logged',
      value: String(totals.total),
      sub: `${totals.calls} calls · ${totals.visits} visits · ${otherActivities} other`,
    },
    {
      key: 'followups',
      // "Follow-ups done / missed" truncates to "FOLLOW-UPS DONE / MISS…" in a
      // 2-up tile on a phone. The value's own colours already say which number
      // is which, and the day sheet's stat strip uses this same short label.
      label: 'Follow-ups',
      // Rendered as two coloured halves by the tile, not one string — see
      // DayReviewKpis in DayReviewCard.jsx.
      value: null,
      done: totals.done,
      missed: isPast ? totals.missed : totals.pending,
      missedIsPending: !isPast,
      sub: followUpSub,
    },
    {
      key: 'new_leads',
      label: 'New leads created',
      value: String(totals.newLeads),
      sub: newValue > 0 ? `${formatCurrencyCompact(newValue)} quoted` : 'no value quoted yet',
    },
    {
      key: 'won',
      label: 'Deals won',
      value: String(wonToday.length),
      color: TONE_WON,
      sub: wonToday.length ? `${formatCurrencyCompact(wonValue)} · ${wonNames.slice(0, 2).join(', ')}` : 'none closed',
    },
  ]
}

// ---------------------------------------------------------------------------
// The day sheet — one exec, one day. Opened from a table row (or from the
// exec's own Today screen). Read-only except the Reschedule buttons.
// ---------------------------------------------------------------------------

function activityTag(type) {
  return { label: ACTIVITY_LABELS[type] ?? type, className: `vip-dd-day-tag vip-dd-day-tag-${type}` }
}

// First line only, with the rest available on tap (decision #17).
function firstLine(notes) {
  if (!notes) return { line: null, rest: null }
  const idx = notes.indexOf('\n')
  if (idx === -1) return { line: notes, rest: null }
  return { line: notes.slice(0, idx), rest: notes.slice(idx + 1).trim() || null }
}

function prettyValue(field, raw) {
  if (raw == null || raw === '') return null
  if (field === 'quote_value' || field === 'order_value') return formatCurrencyCompact(Number(raw))
  return raw
}

const FIELD_LABELS = {
  quote_value: 'Quote value',
  order_value: 'Order value',
  product: 'Product',
  created: 'Created',
}

// Merges lead_change_log rows and stage_history rows into one time-ordered
// list of "what this rep altered". Multiple edits to the same lead stay as
// separate rows in time order — deliberately not collapsed (§5.5).
function buildChangeRows(own, priorStageByLead) {
  const fromLog = own.changes.map((c) => {
    const oldV = prettyValue(c.field, c.old_value)
    const newV = prettyValue(c.field, c.new_value)
    const rose = (c.field === 'quote_value' || c.field === 'order_value') && Number(c.new_value ?? 0) > Number(c.old_value ?? 0)

    return {
      id: `c${c.id}`,
      at: parseTimestamp(c.changed_at),
      time: formatClockTime(c.changed_at),
      party: leadName(c.leads),
      leadId: c.lead_id,
      type: c.field === 'created' ? 'created' : 'value',
      label: FIELD_LABELS[c.field] ?? c.field,
      oldText: oldV,
      newText: newV,
      newColor: c.field === 'created' ? undefined : rose ? TONE_WON : TONE_BAD,
      detail: c.field === 'created' && c.detail ? `Source: ${SOURCE_TYPE_LABELS[c.detail] ?? c.detail}` : null,
    }
  })

  const fromStage = own.stageChanges.map((s) => {
    const prior = priorStageByLead.get(s.lead_id)
    return {
      id: `s${s.id}`,
      at: parseTimestamp(s.changed_at),
      time: formatClockTime(s.changed_at),
      party: leadName(s.leads),
      leadId: s.lead_id,
      type: 'stage',
      label: s.stage === 'won' || s.stage === 'lost' ? 'Status' : 'Stage',
      oldStage: prior ? { label: stageLabel(prior), chipClass: stageChipClass(prior) } : null,
      newStage: { label: stageLabel(s.stage), chipClass: stageChipClass(s.stage) },
    }
  })

  return [...fromLog, ...fromStage].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
}

// The prior stage for each lead: the most recent stage_history row before the
// day started. The query returns them already sorted newest-first, so the
// first one seen per lead is the one we want.
export function priorStageMap(priorStages) {
  const map = new Map()
  priorStages.forEach((r) => {
    if (!map.has(r.lead_id)) map.set(r.lead_id, r.stage)
  })
  return map
}

// Assembled part-by-part rather than via one toLocaleDateString options
// object — en-IN renders that as "Mon, 10 Aug, 2026", and the second comma
// reads as a typo in an eyebrow this short.
function longDayLabel(y, m, d) {
  const date = new Date(y, m - 1, d)
  const weekday = date.toLocaleDateString('en-IN', { weekday: 'short' })
  const day = date.toLocaleDateString('en-IN', { day: '2-digit' })
  const month = date.toLocaleDateString('en-IN', { month: 'short' })
  return `${weekday} ${day} ${month} ${y}`
}

export function buildDaySheetPanel({ employee, data, dateISO, isPast, changesUnavailable, changeLogStart, onReschedule }) {
  const own = scopeToEmployee(data, employee.id)
  const fu = splitFollowUps(own.followUps, isPast)
  const priorStageByLead = priorStageMap(data.priorStages ?? [])
  const changeRows = buildChangeRows(own, priorStageByLead)

  const [y, m, d] = dateISO.split('-').map(Number)
  const dateLabel = longDayLabel(y, m, d)

  const times = own.activities.map((a) => parseTimestamp(a.created_at)).filter(Boolean).sort((a, b) => a - b)
  // Drop the clause entirely when there are no activities rather than
  // printing "worked — – —" (§5.1).
  const workedSpan = times.length ? `logged ${formatClockTime(times[0])} – ${formatClockTime(times[times.length - 1])}` : null

  const sites = [...new Set(own.activities.filter((a) => a.activity_type === 'site_visit').map((a) => siteName(a.leads)).filter(Boolean))]
  const otherCount = own.activities.length - own.activities.filter((a) => a.activity_type === 'call').length - own.activities.filter((a) => a.activity_type === 'site_visit').length
  const touched = touchedLeadIds(own).size
  const changeCount = changeRows.filter((r) => r.type !== 'created').length
  const changedLeadCount = new Set(changeRows.filter((r) => r.type !== 'created').map((r) => r.leadId)).size

  const tomorrowVisits = own.tomorrowFollowUps.filter((f) => f.activity_type === 'site_visit').length

  return {
    kind: 'daySheet',
    employeeId: employee.id,
    avatar: getInitials(employee.name),
    eyebrow: `Day sheet · ${dateLabel}`,
    title: employee.name,
    note: [employee.role === 'owner' ? 'Owner' : 'Sales Executive', employee.office_location, workedSpan].filter(Boolean).join(' · '),
    stats: [
      {
        label: 'Activities',
        value: String(own.activities.length),
        sub: `${own.activities.filter((a) => a.activity_type === 'call').length} calls · ${own.activities.filter((a) => a.activity_type === 'site_visit').length} visits · ${otherCount} other`,
      },
      {
        label: 'Follow-ups',
        value: `${fu.done} / ${fu.due}`,
        sub: isPast ? `${fu.missed} missed` : `${fu.pending} still open`,
        color: (isPast ? fu.missed : fu.pending) > 0 ? TONE_BAD : TONE_GOOD,
      },
      {
        label: 'Leads touched',
        value: String(touched),
        sub: `${own.newLeads.length} new · ${changeCount} change${changeCount === 1 ? '' : 's'}`,
      },
      {
        label: 'Sites visited',
        value: String(sites.length),
        sub: sites.length ? sites.slice(0, 2).join(', ') : 'none today',
        color: TONE_NEUTRAL,
      },
    ],

    followUps: {
      ...fu,
      isPast,
      missedRows: (isPast ? fu.openRows : []).map((f) => shapeFollowUp(f)),
      pendingRows: (isPast ? [] : fu.openRows).map((f) => shapeFollowUp(f)),
      completedRows: fu.doneRows.map((f) => shapeFollowUp(f)),
    },
    onReschedule,

    activities: own.activities
      .slice()
      .sort((a, b) => (parseTimestamp(a.created_at) ?? 0) - (parseTimestamp(b.created_at) ?? 0))
      .map((a) => {
        const { line, rest } = firstLine(a.notes)
        return {
          id: a.id,
          time: formatClockTime(a.created_at),
          tag: activityTag(a.activity_type),
          party: leadName(a.leads, a.parties),
          leadId: a.lead_id,
          notes: line,
          more: rest,
        }
      }),

    changeRows,
    changeCount,
    changedLeadCount,
    // Creations are listed in this block but excluded from the edit count
    // (they're their own column on the team table), so the header has to say
    // so — "0 edits across 0 leads" above a visible row reads as a bug.
    createdCount: changeRows.length - changeCount,
    // An honest empty state for any date before the audit trail shipped —
    // "this rep changed nothing" and "nothing was recorded" are different
    // facts and must not look the same (§3.3).
    changesUnavailable,
    changeLogStart,

    tomorrow: {
      followUps: own.tomorrowFollowUps.length,
      siteVisits: tomorrowVisits,
    },
  }
}

function shapeFollowUp(f) {
  const time = f.due_time ? formatTimeOfDay(f.due_time) : null
  const kind = f.activity_type ? ACTIVITY_LABELS[f.activity_type] ?? 'Follow-up' : 'Follow-up'
  return {
    id: f.id,
    party: leadName(f.leads, f.parties) || f.title,
    title: f.title,
    leadId: f.lead_id,
    stage: f.leads?.current_stage ? { label: stageLabel(f.leads.current_stage), chipClass: stageChipClass(f.leads.current_stage) } : null,
    due: time ? `Due ${time} · ${kind}` : kind,
    closed: f.done_at ? `Closed ${formatClockTime(f.done_at)} · ${kind}` : kind,
  }
}

// follow_ups.due_time is a bare TIME with no date and no zone — it means what
// it says on a wall clock, so it must NOT go through parseTimestamp's
// UTC-correction path.
export function formatTimeOfDay(timeStr) {
  const [h, m] = String(timeStr).split(':')
  const d = new Date()
  d.setHours(Number(h), Number(m), 0, 0)
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(/\s+/g, ' ')
}
