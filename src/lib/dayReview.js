import { getInitials } from './initials'
import { formatCurrencyCompact } from './format'
import { parseTimestamp, formatClockTime } from './dbTime'
import { stageLabel } from './leadStageOptions'
import { stageChipClass } from './statusColors'
import { ACTIVITY_LABELS } from './activityTypes'
import { SOURCE_TYPE_LABELS } from './sourceTypeOptions'
import { TONE_GOOD, TONE_BAD, TONE_NEUTRAL, TONE_WON } from './statusColors'
import { leadDisplayName, leadNameTier, leadSiteLabel } from './leadName'
import { roleLabel } from './roles'
import { todayISO } from './followupDates'
import { officeAware } from './officeScope'

// Pure shaping for the Day Review — takes the raw rows fetched by
// dayReviewQueries.js and produces the per-exec table rows, the team totals,
// the four day KPIs, and one exec's day sheet. No network calls here, same
// division of labour drilldownBuilders.js already follows.
//
// EVERYTHING IS ONE CALENDAR DAY. Nothing in this file aggregates wider.

// The app-wide naming rule (src/lib/leadName.js), plus the one thing only this
// screen has: a follow-up or activity can name a PARTY with no lead attached at
// all (an Architect Meeting), so a bare party is tried before giving up on the
// id — leadDisplayName knows nothing about that case and shouldn't.
export function leadName(lead, fallbackParty) {
  if (!lead && fallbackParty?.name) return fallbackParty.name
  if (lead && leadNameTier(lead) === 'id' && fallbackParty?.name) return fallbackParty.name
  if (!lead) return '—'
  return leadDisplayName(lead)
}

function siteName(lead) {
  return leadSiteLabel(lead)
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
    // Meetings this person went ALONG to on a colleague's lead. Kept apart
    // from `activities` on purpose: every count below reads `activities`, and
    // an accompanied meeting is shown, never counted (the owner's ruling —
    // see accompaniedQueries.js). Only the display lists read this.
    accompanied: (data.accompanied ?? []).filter((a) => a.accompanied_by === employeeId),
  }
}

// "with Rajan Sharma" — who the colleague went along with. Plain text, not a
// link: the whole row is name-only for the colleague (no Lead Detail), and a
// rep can't open a peer's profile either.
function accompaniedWith(a) {
  return a.withName ? `with ${a.withName}` : 'with a colleague'
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
    // Went along on a colleague's lead: named, never linked (name-only is the
    // owner's ruling), and flagged so the row renders its "Accompanied" tag.
    ...own.accompanied.map((a) => ({
      id: `acc${a.id}`,
      at: parseTimestamp(a.created_at),
      color: 'var(--vip-teal)',
      leadId: null,
      accompanied: true,
      text: `${leadName(a.leads, a.parties)} — ${(ACTIVITY_LABELS[a.activity_type] ?? a.activity_type).toLowerCase()}`,
      // Its own line under the text, not appended to it — this row is one
      // truncating line on a phone, and "with {name}" is the part that
      // matters most here, so it can't be the part that gets cut off.
      withText: accompaniedWith(a),
    })),
  ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))

  // The LAST few, not the first — the most significant thing about a day at
  // 6 pm is what just happened, not what happened at 9 am.
  return entries.slice(-limit).map((e) => ({ ...e, time: formatClockTime(e.at) }))
}

const SUM_KEYS = ['total', 'calls', 'visits', 'touched', 'newLeads', 'changes', 'quotes', 'done', 'missed', 'pending', 'tomorrow']

export function buildDayTotals(rows, keys = SUM_KEYS) {
  const totals = Object.fromEntries(keys.map((k) => [k, 0]))
  rows.forEach((r) => keys.forEach((k) => { totals[k] += r[k] }))
  return totals
}

// ---------------------------------------------------------------------------
// The BDMs' version of the team table (Architect Network, owner only). Same
// day, same data, same attribution columns as buildDayRows — only the
// columns differ, because a BDM's day is architects and joineries, not site
// visits and quotes.
// ---------------------------------------------------------------------------

// Every kind of meeting in ONE column (the owner's ruling, 2026-09-24):
// architect meetings plus both client-meeting buckets. `client_meeting` is the
// legacy unbucketed value, counted so a stray old row isn't lost.
export const BDM_DAY_MEETING_TYPES = ['architect_meeting', 'client_meeting_old', 'client_meeting_new', 'client_meeting']

export const BDM_DAY_SUM_KEYS = ['total', 'calls', 'meetings', 'newLeads', 'joineries', 'done', 'missed', 'pending']

function bdmDayCounts(own) {
  return {
    calls: own.activities.filter((a) => a.activity_type === 'call').length,
    meetings: own.activities.filter((a) => BDM_DAY_MEETING_TYPES.includes(a.activity_type)).length,
    // New leads = every lead they created that day; Joineries = the subset
    // captured with "Joinery received: yes". Overlapping on purpose — the
    // same pair of rules as the BDM targets (computeBdmTargetActuals).
    newLeads: own.newLeads.length,
    joineries: own.newLeads.filter((l) => l.joinery_received === true).length,
  }
}

export function buildBdmDayRows(bdms, data, isPast) {
  return bdms.map((emp) => {
    const own = scopeToEmployee(data, emp.id)
    const fu = splitFollowUps(own.followUps, isPast)
    return {
      employeeId: emp.id,
      name: emp.name,
      role: emp.role ?? null,
      initials: getInitials(emp.name),
      total: own.activities.length,
      ...bdmDayCounts(own),
      done: fu.done,
      missed: fu.missed,
      pending: fu.pending,
    }
  })
}

// The leads the "New leads created" tile COUNTS: the ones created by someone on
// the roster the table is drawn for (buildDayRows' own attribution —
// created_by_employee_id, not whoever holds the lead now). A lead a coordinator
// entered for a rep, or a BDM brought in, has a creator outside the roster and
// is in no one's column. The tile's count, its "quoted" line and its popup all
// read this one list, so they cannot total differently.
function countedNewLeads(data, employeeIds) {
  const ids = new Set(employeeIds)
  return data.newLeads.filter((l) => ids.has(l.created_by_employee_id))
}

// Every stage_history 'won' row of the day that still has its lead — the tile
// counts these as they come, not one per lead.
function wonRowsOf(data) {
  return data.stageChanges.filter((s) => s.stage === 'won' && s.leads)
}

const dealValueOf = (lead) => Number(lead?.order_value ?? lead?.quote_value ?? 0)

// The four KPI tiles. These REPLACE the standing Dashboard KPIs for this
// period rather than re-filtering them — pipeline totals and month attainment
// are meaningless over eight hours.
//
// `onOpenTile(key)`, when given, makes "New leads created" and "Deals won"
// buttons that open buildDayTilePanel's popup; without it every tile stays a
// static figure (the exec's own surfaces, and the tests, pass nothing).
export function buildDayKpis(data, rows, isPast, onOpenTile) {
  const totals = buildDayTotals(rows)
  const otherActivities = totals.total - totals.calls - totals.visits

  const wonToday = wonRowsOf(data)
  const wonValue = wonToday.reduce((s, r) => s + dealValueOf(r.leads), 0)
  const wonNames = [...new Set(wonToday.map((r) => leadName(r.leads)))]

  const newValue = countedNewLeads(data, rows.map((r) => r.employeeId)).reduce((s, l) => s + Number(l.quote_value ?? 0), 0)
  const opens = (key) => (onOpenTile ? { onClick: () => onOpenTile(key) } : null)

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
      ...opens('new_leads'),
    },
    {
      key: 'won',
      label: 'Deals won',
      value: String(wonToday.length),
      color: TONE_WON,
      sub: wonToday.length ? `${formatCurrencyCompact(wonValue)} · ${wonNames.slice(0, 2).join(', ')}` : 'none closed',
      ...opens('won'),
    },
  ]
}

// ---------------------------------------------------------------------------
// The popup behind the "New leads created" and "Deals won" tiles. One day, the
// one on screen. Built from the rows the page already holds — no network call —
// out of the SAME lists the tiles count, so a popup cannot total differently
// from the tile that opened it (dayReview.test.js pins that).
//
//   New leads — credited to whoever CREATED the lead (the Day Review's rule),
//               so a lead since reassigned doesn't move to another exec's day.
//   Deals won — credited to the lead's CURRENT owner, the attribution every
//               booked-order figure uses, not whoever pressed Won.
// ---------------------------------------------------------------------------

function dayLabel(dateISO) {
  if (dateISO === todayISO()) return 'Today'
  const [y, m, d] = dateISO.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// One row per person, busiest first, plus the names of everyone who had
// nothing — "nobody brought in a lead" is a finding, so it is named rather than
// dropped, but as one line rather than a row of zeros per exec.
function groupByPerson(employees, items, ownerOf, valueOf) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const groups = new Map()
  items.forEach((item) => {
    const owner = ownerOf(item)
    const key = byId.has(owner) ? owner : 'other'
    const g = groups.get(key) ?? { count: 0, value: 0, valued: 0 }
    g.count += 1
    g.value += valueOf(item)
    if (valueOf(item) > 0) g.valued += 1
    groups.set(key, g)
  })
  const top = Math.max(1, ...[...groups.values()].map((g) => g.count))
  const rows = [...groups.entries()]
    .map(([key, g]) => {
      const emp = key === 'other' ? null : byId.get(key)
      return {
        key: String(key),
        id: emp?.id ?? null,
        // A deal whose owner isn't on this roster (an owner or BDM holding it).
        name: emp?.name ?? 'Someone else',
        initials: emp ? getInitials(emp.name) : '·',
        count: g.count,
        value: g.value,
        valued: g.valued,
        pct: `${Math.round((g.count / top) * 100)}%`,
      }
    })
    .sort((a, b) => b.count - a.count || b.value - a.value || a.name.localeCompare(b.name))
  return { rows, idle: employees.filter((e) => !groups.has(e.id)).map((e) => e.name) }
}

function newLeadsPanel({ data, employees, eyebrow, isToday }) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const leads = countedNewLeads(data, employees.map((e) => e.id))
  const quoteOf = (l) => Number(l.quote_value ?? 0)
  const quoted = leads.filter((l) => quoteOf(l) > 0)
  const quotedTotal = quoted.reduce((s, l) => s + quoteOf(l), 0)
  const biggest = quoted.reduce((best, l) => (best && quoteOf(best) >= quoteOf(l) ? best : l), null)

  const rows = leads
    .map((l) => {
      const stage = l.current_stage ?? 'calling'
      const creator = byId.get(l.created_by_employee_id)
      const owner = l.owner_employee_id != null && l.owner_employee_id !== l.created_by_employee_id ? byId.get(l.owner_employee_id) : null
      const at = parseTimestamp(l.created_at)
      return {
        id: l.id,
        leadId: l.id,
        name: leadName(l),
        bdmId: l.bdm_employee_id ?? null,
        at,
        time: formatClockTime(at),
        stage: { label: stageLabel(stage), chipClass: stageChipClass(stage) },
        personId: creator?.id ?? null,
        personName: creator?.name ?? null,
        meta: [SOURCE_TYPE_LABELS[l.source_type] ?? l.source_type, owner ? `now with ${owner.name}` : null].filter(Boolean).join(' · '),
        value: quoteOf(l) > 0 ? formatCurrencyCompact(quoteOf(l)) : '—',
        hasValue: quoteOf(l) > 0,
      }
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))

  const people = groupByPerson(employees, leads, (l) => l.created_by_employee_id, quoteOf)

  return {
    kind: 'dayTile',
    eyebrow,
    title: 'New leads created',
    value: String(leads.length),
    note: 'Counted by who created the lead, not who holds it now.',
    figures: leads.length
      ? [
          { label: 'Quoted so far', value: quotedTotal > 0 ? formatCurrencyCompact(quotedTotal) : '—', sub: quoted.length ? `across ${plural(quoted.length, 'quote')}` : 'none quoted yet' },
          {
            label: 'Average quote',
            value: quoted.length ? formatCurrencyCompact(quotedTotal / quoted.length) : '—',
            sub: quoted.length ? 'per quoted lead' : 'none quoted yet',
          },
          { label: 'Biggest quote', value: biggest ? formatCurrencyCompact(quoteOf(biggest)) : '—', sub: biggest ? leadName(biggest) : 'none quoted yet' },
          { label: 'Not quoted yet', value: String(leads.length - quoted.length), sub: leads.length === quoted.length ? 'every lead has one' : 'no quote on file' },
        ]
      : [],
    people: {
      show: employees.length > 1 && leads.length > 0,
      title: 'Created by',
      rows: people.rows.map((p) => ({ ...p, sub: p.value > 0 ? `${formatCurrencyCompact(p.value)} quoted` : 'none quoted' })),
      idleLabel: 'No new leads from',
      idle: people.idle,
    },
    list: {
      title: 'New leads',
      noun: 'leads',
      verb: 'by',
      rows,
      empty: isToday ? 'No leads created yet today.' : 'No leads were created this day.',
      noValueTitle: 'No quote on file yet',
    },
  }
}

function wonPanel({ data, employees, eyebrow, isToday }) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const wins = wonRowsOf(data)
  const valued = wins.filter((s) => dealValueOf(s.leads) > 0)
  const total = wins.reduce((s, r) => s + dealValueOf(r.leads), 0)
  const biggest = valued.reduce((best, s) => (best && dealValueOf(best.leads) >= dealValueOf(s.leads) ? best : s), null)

  const rows = wins
    .map((s) => {
      const owner = byId.get(s.leads.owner_employee_id)
      const at = parseTimestamp(s.changed_at)
      const v = dealValueOf(s.leads)
      return {
        id: s.id,
        leadId: s.lead_id ?? s.leads.id,
        name: leadName(s.leads),
        bdmId: s.leads.bdm_employee_id ?? null,
        at,
        time: formatClockTime(at),
        stage: null,
        personId: owner?.id ?? null,
        personName: owner?.name ?? null,
        meta: '',
        value: v > 0 ? formatCurrencyCompact(v) : '—',
        hasValue: v > 0,
      }
    })
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))

  const people = groupByPerson(employees, wins, (s) => s.leads.owner_employee_id, (s) => dealValueOf(s.leads))
  const unpriced = wins.length - valued.length

  return {
    kind: 'dayTile',
    eyebrow,
    title: 'Deals won',
    value: String(wins.length),
    note: "Credited to the lead's current owner. Value is the order value, else the quote.",
    figures: wins.length
      ? [
          { label: 'Order value', value: total > 0 ? formatCurrencyCompact(total) : '—', sub: plural(wins.length, 'deal') },
          {
            label: 'Average deal',
            value: valued.length ? formatCurrencyCompact(total / valued.length) : '—',
            sub: valued.length ? `per deal with a value` : 'no value on file',
          },
          { label: 'Biggest deal', value: biggest ? formatCurrencyCompact(dealValueOf(biggest.leads)) : '—', sub: biggest ? leadName(biggest.leads) : 'no value on file' },
          // Counted as ₹0 in the total (as the tile does) and left out of the average.
          { label: 'No value on file', value: String(unpriced), sub: unpriced > 0 ? 'counted as ₹0' : 'every deal has one' },
        ]
      : [],
    people: {
      show: employees.length > 1 && wins.length > 0,
      title: 'Closed by',
      rows: people.rows.map((p) => ({ ...p, sub: p.value > 0 ? formatCurrencyCompact(p.value) : 'no value on file' })),
      idleLabel: 'Nothing closed by',
      idle: people.idle,
    },
    list: {
      title: 'Closed deals',
      noun: 'deals',
      verb: 'closed by',
      rows,
      empty: isToday ? 'No deals won yet today.' : 'No deals were won this day.',
      noValueTitle: 'No order value or quote on file',
    },
  }
}

// `key` is the tile's key ('new_leads' | 'won'); anything else returns null.
// `employees` is the roster the tiles were drawn for (one person on an exec's
// own page), `data` is fetchDayReview's answer for `dateISO`.
function buildDayTilePanelCore(key, { data, employees, dateISO, scopeLabel }) {
  const scope = scopeLabel ?? (employees.length === 1 ? employees[0].name : 'Your team')
  const args = { data, employees, eyebrow: `${scope} · ${dayLabel(dateISO)}`, isToday: dateISO === todayISO() }
  if (key === 'new_leads') return newLeadsPanel(args)
  if (key === 'won') return wonPanel(args)
  return null
}

// The Office filter (src/lib/officeScope.js). The popup's two lists are the
// day's new leads and the day's won stage changes; both are cut down by the
// lead's office, and everything the popup prints (counts, values, who created
// or closed what) is derived from them, so it follows.
export const buildDayTilePanel = officeAware(buildDayTilePanelCore, {
  leadIds: (key, { data, employees }) =>
    key === 'won'
      ? wonRowsOf(data).map((s) => s.lead_id)
      : countedNewLeads(data, employees.map((e) => e.id)).map((l) => l.id),
  narrow: (scope, key, args) => [
    key,
    {
      ...args,
      data: {
        ...args.data,
        newLeads: scope.leads(args.data.newLeads),
        stageChanges: scope.rows(args.data.stageChanges, (s) => s.lead_id),
      },
    },
  ],
})

// ---------------------------------------------------------------------------
// The day sheet — one exec, one day. Opened from a table row (or from the
// exec's own Today screen). Read-only except the Reschedule buttons.
// ---------------------------------------------------------------------------

export function activityTag(type) {
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

// `bdmStats` swaps the last two header tiles (Leads touched, Sites visited)
// for the BDM's own figures — Meetings and New leads/joineries. Opt-in, so
// the BDM's own Today day sheet is unchanged.
export function buildDaySheetPanel({ employee, data, dateISO, isPast, changesUnavailable, changeLogStart, onReschedule, bdmStats = false }) {
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
    // Read by DrilldownPanel's "Open full profile →" link — a BDM has no
    // /employees/:id page at all (App.jsx's canOpenEmployeeProfiles gate), so
    // that link must not render on a BDM's own day sheet.
    employeeRole: employee.role,
    avatar: getInitials(employee.name),
    eyebrow: `Day sheet · ${dateLabel}`,
    title: employee.name,
    // roleLabel(), not an owner/else ternary — that ternary predated the
    // third, fourth and fifth roles and printed "Sales Executive" on a
    // coordinator's, manager's or BDM's own day sheet (the same bug already
    // fixed in EmployeeProfile.jsx's identity band).
    note: [roleLabel(employee.role), employee.office_location, workedSpan].filter(Boolean).join(' · '),
    stats: bdmStats ? bdmSheetStats(own, fu, isPast) : [
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

    // One time-ordered list of what they logged AND what they went along to,
    // so the day reads as it happened. Only `loggedCount` is a count: the
    // Activities stat above and the block's own hint read it, never this
    // list's length, because an accompanied meeting is shown, not counted.
    activities: [
      ...own.activities.map((a) => {
        const { line, rest } = firstLine(a.notes)
        return {
          id: a.id,
          at: parseTimestamp(a.created_at),
          time: formatClockTime(a.created_at),
          tag: activityTag(a.activity_type),
          party: leadName(a.leads, a.parties),
          leadId: a.lead_id,
          notes: line,
          more: rest,
        }
      }),
      // No leadId (name only, no link) and no notes — the RPC doesn't return
      // them; the colleague's record of this meeting is that they were there.
      ...own.accompanied.map((a) => ({
        id: `acc${a.id}`,
        at: parseTimestamp(a.created_at),
        time: formatClockTime(a.created_at),
        tag: activityTag(a.activity_type),
        party: leadName(a.leads, a.parties),
        leadId: null,
        accompaniedWith: accompaniedWith(a),
        notes: null,
        more: null,
      })),
    ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0)),
    loggedCount: own.activities.length,
    accompaniedCount: own.accompanied.length,

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

function bdmSheetStats(own, fu, isPast) {
  const c = bdmDayCounts(own)
  const other = own.activities.length - c.calls - c.meetings
  const architectsMet = new Set(
    own.activities.filter((a) => a.activity_type === 'architect_meeting' && a.party_id).map((a) => a.party_id)
  ).size
  return [
    {
      label: 'Activities',
      value: String(own.activities.length),
      sub: `${c.calls} calls · ${c.meetings} meetings · ${other} other`,
    },
    {
      label: 'Follow-ups',
      value: `${fu.done} / ${fu.due}`,
      sub: isPast ? `${fu.missed} missed` : `${fu.pending} still open`,
      color: (isPast ? fu.missed : fu.pending) > 0 ? TONE_BAD : TONE_GOOD,
    },
    {
      label: 'Meetings',
      value: String(c.meetings),
      sub: `${architectsMet} architect${architectsMet === 1 ? '' : 's'} met`,
      color: TONE_NEUTRAL,
    },
    {
      label: 'New leads',
      value: String(c.newLeads),
      sub: `${c.joineries} with joinery received`,
    },
  ]
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
