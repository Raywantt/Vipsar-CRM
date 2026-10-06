// The RFQ desk's rules, as the app reads them (RFQ-DESK.md). Pure — no
// network calls — so every surface that shows or acts on a desk RFQ (Log
// Activity, Lead Detail's RFQ card, Today's RFQ line, and from Step 4 the
// desk's own queues) reads one definition.
//
// The database is the boundary for every action here: each rule that decides
// whether a control is OFFERED mirrors the matching SQL function's own test in
// Schema/migration_rfq_desk.sql, which refuses anything these let through.

import { parseTimestamp } from './dbTime'
import { formatCurrency } from './format'
import { toISODate } from './followupDates'
import { canEstimateRfqs } from './roles'
import { leadDisplayName } from './leadName'

// ---- Product segments ----
//
// A CLOSED list on both sides: rfqs.segments / activities.rfq_segments carry
// a CHECK of exactly these values (migration_rfq_desk.sql STEPS 1–2), so an
// option offered here that the CHECK doesn't know fails the whole RFQ Raised
// save. rfqDesk.test.js reads the SQL and pins the two together. Order is the
// owner's (RFQ-DESK.md §3 Step 1 rulings).
export const RFQ_SEGMENT_OPTIONS = [
  { value: 'windows', label: 'Windows' },
  { value: 'giesta', label: 'Giesta' },
  { value: 'in16', label: 'IN16' },
  { value: 'skylight', label: 'Skylight' },
  { value: 'facade', label: 'Facade' },
  { value: 'wrapping_bars', label: 'Wrapping bars' },
]

const SEGMENT_LABELS = Object.fromEntries(RFQ_SEGMENT_OPTIONS.map((o) => [o.value, o.label]))

export function segmentLabel(value) {
  return SEGMENT_LABELS[value] ?? value
}

// "Windows + IN16" — the way Harpreet's sheet already writes a combination.
// Kept in the option list's order, not the order they were tapped.
export function segmentsLabel(segments) {
  if (!segments?.length) return null
  const order = RFQ_SEGMENT_OPTIONS.map((o) => o.value)
  return [...segments]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(segmentLabel)
    .join(' + ')
}

// ---- Status ----

export const RFQ_STATUS = {
  WITH_TECHNICAL: 'with_technical',
  WITH_ESTIMATION: 'with_estimation',
  WITH_LIXIL: 'with_lixil',
  QUOTED: 'quoted',
  SENT_BACK: 'sent_back',
  WITHDRAWN: 'withdrawn',
}

// Named for the STEP, not the person: there can be more than one Production
// or Estimation Executive, and an RFQ waiting at a step isn't anyone's yet.
const STATUS_LABELS = {
  with_technical: 'Technical check',
  with_estimation: 'Estimation',
  with_lixil: 'With Lixil',
  quoted: 'Quote in',
  sent_back: 'Sent back',
  withdrawn: 'Withdrawn',
}

export function rfqStatusLabel(status) {
  return STATUS_LABELS[status] ?? status
}

// Still somewhere in the desk's hands (any of the three waiting steps).
export function isRfqOpen(rfq) {
  return [RFQ_STATUS.WITH_TECHNICAL, RFQ_STATUS.WITH_ESTIMATION, RFQ_STATUS.WITH_LIXIL].includes(rfq?.status)
}

// "Fresh", "R1", "R2"… — the RFQ's identity on its lead (RFQ-DESK.md §3: no
// RFQ number; lead + revision identifies it). `revision` counts the lead's
// earlier RFQ Raised activities, so R1 is the first revision. A price
// revision repeats the number it re-quotes and says so.
export function revisionLabel(rfq) {
  if (!rfq) return ''
  if (rfq.kind === 'price_revision') return rfq.revision > 0 ? `R${rfq.revision} price revision` : 'Price revision'
  return rfq.revision > 0 ? `R${rfq.revision}` : 'Fresh'
}

// When the RFQ arrived at the step it is on now — the clock "waiting N days"
// reads. A price revision starts at estimation with no approval, so its
// raised_at stands in.
export function rfqStepSince(rfq) {
  switch (rfq?.status) {
    case RFQ_STATUS.WITH_TECHNICAL:
      return rfq.raised_at
    case RFQ_STATUS.WITH_ESTIMATION:
      return rfq.approved_at ?? rfq.raised_at
    case RFQ_STATUS.WITH_LIXIL:
      return rfq.lixil_raised_at ?? rfq.approved_at ?? rfq.raised_at
    case RFQ_STATUS.QUOTED:
      return rfq.quote_received_at
    case RFQ_STATUS.SENT_BACK:
      return rfq.sent_back_at
    case RFQ_STATUS.WITHDRAWN:
      return rfq.withdrawn_at
    default:
      return rfq?.raised_at ?? null
  }
}

// "today", "1 day", "4 days". Whole calendar days in the browser's timezone,
// so an RFQ raised at 6 pm and read at 10 am the next morning is "1 day", not
// "0 days". rfqs timestamps are TIMESTAMPTZ (they carry an offset), which
// parseTimestamp passes through untouched.
export function daysAgoLabel(value, now = new Date()) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today - start) / 86400000)
  if (days <= 0) return 'today'
  return days === 1 ? '1 day' : `${days} days`
}

// The one-line summary every surface opens with: "R1 · Technical check · 2 days".
// A waiting step reads its age; a finished one ("Quote in", "Sent back") reads
// when it happened instead ("today" / "3 days ago").
export function rfqHeadline(rfq, now = new Date()) {
  const age = daysAgoLabel(rfqStepSince(rfq), now)
  const when = !age ? null : isRfqOpen(rfq) ? age : age === 'today' ? 'today' : `${age} ago`
  return [revisionLabel(rfq), rfqStatusLabel(rfq?.status), when].filter(Boolean).join(' · ')
}

// "₹4,20,000 · R26-118 · 3 Oct" — a received quote, value without GST.
export function quoteSummary(rfq) {
  if (rfq?.status !== RFQ_STATUS.QUOTED) return null
  const date = rfq.quote_date
    ? new Date(`${rfq.quote_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null
  return [formatCurrency(rfq.quote_value), rfq.quote_ref, date].filter(Boolean).join(' · ')
}

// Newest first: the RFQ an exec is waiting on sits at the top. raised_at, then
// id, so two RFQs logged in one transaction still order deterministically.
export function sortRfqsNewestFirst(rfqs) {
  return [...(rfqs ?? [])].sort((a, b) => {
    const t = (parseTimestamp(b.raised_at)?.getTime() ?? 0) - (parseTimestamp(a.raised_at)?.getTime() ?? 0)
    return t !== 0 ? t : (b.id ?? 0) - (a.id ?? 0)
  })
}

// A queue row's name for its lead (leadName.js's chain, from the queue's
// leads embed). The embed is always there for the desk — RLS reads every lead
// with a desk RFQ — so `Lead #id` is only a fallback.
export function rfqLeadName(rfq) {
  return rfq?.leads ? leadDisplayName(rfq.leads) : `Lead #${rfq?.lead_id}`
}

// Oldest first: a desk queue works the longest-waiting RFQ first
// (RFQ-DESK.md §7). The exact reverse of sortRfqsNewestFirst.
export function sortRfqsOldestFirst(rfqs) {
  return sortRfqsNewestFirst(rfqs).reverse()
}

// Longest wait AT ITS CURRENT STEP first — what estimation's lists sort by: an
// RFQ raised last week but approved this morning has waited for estimation
// only since this morning. Ties by id. (At the technical check the step
// starts when it was raised, so this equals sortRfqsOldestFirst there.)
export function sortRfqsByWait(rfqs) {
  const t = (r) => parseTimestamp(rfqStepSince(r))?.getTime() ?? 0
  return [...(rfqs ?? [])].sort((a, b) => t(a) - t(b) || (a.id ?? 0) - (b.id ?? 0))
}

// ---- How long an RFQ has waited at a desk step ----
//
// "Too long" is counted in WORKING days, and a working day is any day but
// Sunday (owner's ruling, 2026-10-06 — RFQ-DESK.md Q7): an RFQ raised on
// Saturday evening must not open Monday morning in red. A working day has
// passed for each Monday–Saturday midnight crossed since the RFQ arrived, so
// one raised Saturday and read on Monday has waited 1, and one raised on
// Friday has waited 2 by Monday.
export function workingDaysWaited(value, now = new Date()) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  const cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let days = 0
  while (cursor < today) {
    cursor.setDate(cursor.getDate() + 1)
    if (cursor.getDay() !== 0) days++
  }
  return days
}

// Per step: amber from `warn` working days, red from `late` (RFQ-DESK.md Q7,
// owner's rulings 2026-10-06). The technical check and estimation are the
// desk's own work, a day each; Lixil's is 5 / 7 — the sheets' 75th and 90th
// percentile for a whole RFQ → quote trip, so only the slowest quarter turns
// amber. A step with no entry here is never coloured.
export const RFQ_WAIT_LIMITS = {
  [RFQ_STATUS.WITH_TECHNICAL]: { warn: 1, late: 2 },
  [RFQ_STATUS.WITH_ESTIMATION]: { warn: 1, late: 2 },
  [RFQ_STATUS.WITH_LIXIL]: { warn: 5, late: 7 },
}

// 'ok' | 'warn' | 'late', or null for a step with no limits (or no date).
export function rfqWaitLevel(rfq, now = new Date()) {
  const limits = RFQ_WAIT_LIMITS[rfq?.status]
  if (!limits) return null
  const days = workingDaysWaited(rfqStepSince(rfq), now)
  if (days == null) return null
  if (days >= limits.late) return 'late'
  if (days >= limits.warn) return 'warn'
  return 'ok'
}

// "45m" / "3h" / "4d" — an elapsed time, compact (the BDM pool's waitingLabel
// shape, from a duration rather than a start time).
export function durationLabel(ms) {
  if (ms == null || Number.isNaN(ms)) return null
  const minutes = Math.max(0, Math.floor(ms / 60000))
  // "waiting 0m" read as nothing at all.
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

// What a queue row's age says. The same unit as its colour once it has one: a
// working day has passed, so the label counts working days ("1 working day"),
// never a calendar figure that would read "2 days" in amber on one row and in
// red on the next. Before that, how long in hours/minutes — on the first day
// it is the only figure that tells one RFQ from another.
export function rfqWaitLabel(rfq, now = new Date()) {
  const since = parseTimestamp(rfqStepSince(rfq))
  if (!since || Number.isNaN(since.getTime())) return null
  const days = workingDaysWaited(since, now)
  if (days >= 1) return days === 1 ? '1 working day' : `${days} working days`
  return durationLabel(now.getTime() - since.getTime())
}

// Other RFQs of the same lead waiting in the same queue, per RFQ id. A new
// revision logged while the last is still waiting leaves BOTH in the queue
// (owner's ruling, Step 1) — the desk decides which to work, so each row says
// the other is there.
export function otherRevisionsWaiting(queue) {
  const byLead = new Map()
  for (const r of queue ?? []) {
    if (!byLead.has(r.lead_id)) byLead.set(r.lead_id, [])
    byLead.get(r.lead_id).push(r)
  }
  const result = new Map()
  for (const r of queue ?? []) {
    const others = byLead.get(r.lead_id).filter((o) => o.id !== r.id)
    if (others.length) result.set(r.id, others)
  }
  return result
}

// ---- The Production Executive's month (their Today strip, RFQ-DESK.md Q8) ----

function inPeriod(value, since) {
  const d = parseTimestamp(value)
  return Boolean(d && !Number.isNaN(d.getTime()) && d >= since)
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// From the RFQs this person approved or sent back since `since` (and those
// they approved that estimation then bounced):
//   approved  — approved by them in the period
//   sentBack  — sent back by them from the technical check in the period
//   bounced   — approved by them, then sent back FROM ESTIMATION in the period
//               (the miss the owner wanted visible, RFQ-DESK.md §3)
//   medianCheckMs — raised → their decision, over everything they decided in
//               the period; null when they decided nothing
// An approval later bounced counts in both approved and bounced: it was an
// approval, and it was a miss.
export function technicalMonthStats(rows, employeeId, since) {
  const stats = { approved: 0, sentBack: 0, bounced: 0, medianCheckMs: null }
  if (employeeId == null) return stats
  const checkTimes = []
  for (const r of rows ?? []) {
    const raised = parseTimestamp(r.raised_at)
    if (r.approved_by === employeeId && inPeriod(r.approved_at, since)) {
      stats.approved++
      if (raised) checkTimes.push(parseTimestamp(r.approved_at) - raised)
    }
    if (r.sent_back_by === employeeId && r.sent_back_from === 'technical' && inPeriod(r.sent_back_at, since)) {
      stats.sentBack++
      if (raised) checkTimes.push(parseTimestamp(r.sent_back_at) - raised)
    }
    if (r.approved_by === employeeId && r.sent_back_from === 'estimation' && inPeriod(r.sent_back_at, since)) {
      stats.bounced++
    }
  }
  stats.medianCheckMs = median(checkTimes)
  return stats
}

// ---- The Estimation Executive's month (their Today strip, Q8) ----
//
// From the RFQs this person moved since `since`:
//   raised    — raised with Lixil by them in the period
//   quoted    — quotes they recorded in the period
//   sentBack  — sent back by them from estimation in the period
//   medianLixilMs — raised with Lixil → quote recorded, over the quotes they
//               recorded in the period; null when there were none. Lixil's
//               time, not the desk's — the figure Harpreet chases.
export function estimationMonthStats(rows, employeeId, since) {
  const stats = { raised: 0, quoted: 0, sentBack: 0, medianLixilMs: null }
  if (employeeId == null) return stats
  const lixilTimes = []
  for (const r of rows ?? []) {
    if (r.lixil_raised_by === employeeId && inPeriod(r.lixil_raised_at, since)) stats.raised++
    if (r.quote_received_by === employeeId && inPeriod(r.quote_received_at, since)) {
      stats.quoted++
      const from = parseTimestamp(r.lixil_raised_at)
      if (from) lixilTimes.push(parseTimestamp(r.quote_received_at) - from)
    }
    if (r.sent_back_by === employeeId && r.sent_back_from === 'estimation' && inPeriod(r.sent_back_at, since)) {
      stats.sentBack++
    }
  }
  stats.medianLixilMs = median(lixilTimes)
  return stats
}

// ---- Price revision (Lixil changed its prices) ----

// rfq_start_price_revision(): the Estimation Executive or the owner, on a
// lead whose desk RFQs include a quote, while no price revision of it is
// already open (with estimation or with Lixil). The SQL also checks the test
// scope; RLS has already done that for the rows the page holds.
export function canStartPriceRevision(rfqs, role) {
  if (!canEstimateRfqs(role)) return false
  if (!latestDeskQuote(rfqs)) return false
  return !(rfqs ?? []).some(
    (r) => r.kind === 'price_revision' && (r.status === RFQ_STATUS.WITH_ESTIMATION || r.status === RFQ_STATUS.WITH_LIXIL)
  )
}

// ---- Recording a quote ----

// rfq_record_quote()'s own checks, said before the round trip: Lixil's
// reference is required, a value above zero (without GST), and a quote date
// neither in the future nor before the RFQ was raised (Harpreet's sheet had 14
// quotes dated before their RFQ — typing slips). Dates are YYYY-MM-DD strings
// compared as strings (CLAUDE.md, Dates — DATE columns). `today` is the
// browser's date; the team is in IST, which is the date the SQL uses.
// Returns the first problem as a sentence, or null.
export function quoteProblem({ ref, value, date }, rfq, today) {
  if (!ref?.trim()) return "Enter Lixil's quote reference."
  const n = Number(value)
  if (value === '' || value == null || !Number.isFinite(n) || n <= 0) return 'Enter the quote value (without GST).'
  if (n >= 1e12) return 'That value is too large — check the number.'
  if (!date) return 'Enter the quote date.'
  if (date > today) return "The quote date can't be in the future."
  const raisedDay = rfqRaisedDay(rfq)
  if (raisedDay && date < raisedDay) return `The quote date can't be before the RFQ was raised (${raisedDay}).`
  return null
}

// The RFQ's raised day in the browser's timezone, for the date input's min.
export function rfqRaisedDay(rfq) {
  const d = parseTimestamp(rfq?.raised_at)
  return d && !Number.isNaN(d.getTime()) ? toISODate(d) : null
}

// Midnight on the 1st of this month, browser time — "this month" everywhere
// else in the app is a local calendar month too.
export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

// ---- Errors a desk action can return ----

// rfq_lock_for_action / each action raise these when the RFQ moved on before
// the click landed (someone else approved it, the exec withdrew it) or is no
// longer visible: check_violation (23514) and no_data_found (P0002). The
// message already says what happened ("…it is withdrawn"), so the row leaves
// the queue with it rather than offering buttons that can only fail again.
// rfq_send_back's "note is too long" is a check_violation too — unreachable
// from the app, whose note box stops at the same 1,000 characters
// (RFQ_NOTE_MAX).
export const RFQ_NOTE_MAX = 1000

export function isRfqMovedOnError(error) {
  return error?.code === '23514' || error?.code === 'P0002'
}

// ---- Who may do what (mirrors the SQL; the SQL is the boundary) ----

// rfq_withdraw(): the exec it's credited to, whoever logged it, or the owner —
// and only while it is with the technical check or estimation, never once it
// has gone to Lixil (RFQ-DESK.md §3 Step 1 rulings).
export function canWithdrawRfq(rfq, viewer) {
  if (!rfq || !viewer) return false
  if (rfq.status !== RFQ_STATUS.WITH_TECHNICAL && rfq.status !== RFQ_STATUS.WITH_ESTIMATION) return false
  return (
    viewer.role === 'owner' ||
    (viewer.id != null && (viewer.id === rfq.raised_by_employee_id || viewer.id === rfq.logged_by_employee_id))
  )
}

// The quote the desk most recently recorded on this lead, or null. Once one
// exists the lead's quote value is the desk's to set (owner's ruling,
// 2026-10-06: an exec may still type it until the first desk quote lands —
// RFQ-DESK.md Q4), so Sales progress locks the field and shows where the
// figure came from.
export function latestDeskQuote(rfqs) {
  const quoted = (rfqs ?? []).filter((r) => r.status === RFQ_STATUS.QUOTED && r.quote_received_at)
  if (!quoted.length) return null
  return quoted.reduce((best, r) =>
    parseTimestamp(r.quote_received_at) > parseTimestamp(best.quote_received_at) ||
    (r.quote_received_at === best.quote_received_at && r.id > best.id)
      ? r
      : best
  )
}

// ---- Back with the exec (Needs Attention, RFQ-DESK.md Step 6) ----

// Each lead's newest desk RFQ that wasn't withdrawn — newest raised_at, then
// highest id — as a Map lead_id → row. The leads_needing_attention() RPC's
// own `latest_desk` CTE (Schema/migration_rfq_desk_reporting.sql) picks the
// same row, so the client-side fallback and the RPC agree lead for lead. A
// withdrawn price revision leaves the quote before it in charge.
export function latestDeskRfqByLead(rows) {
  const map = new Map()
  for (const r of sortRfqsNewestFirst((rows ?? []).filter((x) => x.status !== RFQ_STATUS.WITHDRAWN))) {
    if (!map.has(r.lead_id)) map.set(r.lead_id, r)
  }
  return map
}

// The calendar day (browser time) a quote reached the CRM.
function quoteInDay(rfq) {
  const d = parseTimestamp(rfq?.quote_received_at)
  return d && !Number.isNaN(d.getTime()) ? toISODate(d) : null
}

// Whether THIS quote has gone to the client: the lead is marked quote sent on
// or after the day it came in. A "sent" date from before it belongs to an
// earlier quote — a revision or a price revision is a new figure the client
// hasn't had yet. Dates are YYYY-MM-DD, compared as strings.
export function quoteSentToClient(lead, rfq) {
  if (!lead?.quote_sent || !lead.quote_sent_at) return false
  const day = quoteInDay(rfq)
  return day == null || lead.quote_sent_at >= day
}

// When a lead's newest desk RFQ is the exec's to act on: { kind, at } —
// 'sent_back' (sent back, nothing re-logged since) or 'quote_in' (Lixil's
// quote recorded, not yet sent to the client) — else null. No age test here:
// attention.js's RFQ_BACK_DAYS decides when it lands on Needs Attention.
export function rfqBackWithExec(deskRfq, lead) {
  if (deskRfq?.status === RFQ_STATUS.SENT_BACK && deskRfq.sent_back_at) {
    return { kind: 'sent_back', at: deskRfq.sent_back_at }
  }
  if (deskRfq?.status === RFQ_STATUS.QUOTED && deskRfq.quote_received_at && !quoteSentToClient(lead, deskRfq)) {
    return { kind: 'quote_in', at: deskRfq.quote_received_at }
  }
  return null
}

// ---- The RFQ Raised target (RFQ-DESK.md Step 6) ----
//
// Once the desk is live an RFQ counts toward the exec's target when it passes
// the technical check — once per lead, credited to whoever raised it, dated by
// the approval — and the database decides which approvals count
// (rfqs.counts_toward_target, frozen at that moment). An RFQ Raised logged
// BEFORE the cutover (rfq_desk_settings.live_from) still counts the old way,
// by the day it was logged. This says which of the two an activity is under:
// true = logged while the desk was live, so its count (if any) comes from the
// approval, not from here. With the desk off (no live_from) nothing is.
export function loggedWhileDeskLive(activity, liveFrom) {
  const from = parseTimestamp(liveFrom)
  if (!from || Number.isNaN(from.getTime())) return false
  const at = parseTimestamp(activity?.created_at)
  return Boolean(at && !Number.isNaN(at.getTime()) && at >= from)
}

// ---- The launch switch ----

// rfq_desk_settings.live_from: NULL = off, a time = on since then. Mirrors
// rfq_desk_is_live() in SQL — the trigger that turns an RFQ Raised into a
// desk RFQ asks the same question, so Log Activity's promise ("goes to the
// technical check") and what the database does can't disagree for long.
export function isDeskLive(settings, now = new Date()) {
  const from = parseTimestamp(settings?.live_from)
  return Boolean(from && !Number.isNaN(from.getTime()) && from <= now)
}
