// The owner's RFQ Desk (/rfq-desk, RFQ-DESK.md Step 7) — every figure on the
// page, shaped from rows rfqQueries.js already fetched. Pure: no network, no
// React, the same division of labour as drilldownBuilders.js.
//
// Owner's rulings, 2026-10-06: one page — the live lanes (technical check,
// estimation, With Lixil) and "sent back, waiting on the exec" on top, then
// the Dashboard's date range and the period figures under it; turnaround as
// the median and the slowest 1 in 10, in WORKING days with Sundays out (the
// clock that colours the lanes); send-backs as every exec who raised an RFQ,
// with a rate. View only — acting stays on Lead Detail and the desk's Today.
//
// Built on the launch day, before any real RFQ existed, so every figure is a
// count, a median or a short table rather than a chart: the plan's rule is to
// choose chart forms from real numbers (UI-DESIGN.md), and there were none.
import { parseTimestamp } from './dbTime'
import { RFQ_STATUS, latestDeskRfqByLead, sortRfqsByWait } from './rfqDesk'

const DAY_MS = 86400000
const HOUR_MS = 3600000

const isPriceRevision = (r) => r?.kind === 'price_revision'

function instant(value) {
  const d = parseTimestamp(value)
  return d && !Number.isNaN(d.getTime()) ? d : null
}

// Inside the period on screen, both ends included (rangeForPreset's ranges
// end at 23:59:59.999 of their last day).
export function inRange(value, range) {
  const d = instant(value)
  return Boolean(d && range && d >= range.start && d <= range.end)
}

// ---- The live lanes ----------------------------------------------------------

// The three steps an RFQ can be waiting at, in the order it passes them.
export const RFQ_LANES = [
  { key: RFQ_STATUS.WITH_TECHNICAL, title: 'Technical check' },
  { key: RFQ_STATUS.WITH_ESTIMATION, title: 'Estimation' },
  { key: RFQ_STATUS.WITH_LIXIL, title: 'With Lixil' },
]

// Rows by lane, each longest-wait-AT-ITS-STEP first (the desk's own order).
export function buildRfqLanes(rows) {
  const lanes = {}
  for (const lane of RFQ_LANES) {
    lanes[lane.key] = sortRfqsByWait((rows ?? []).filter((r) => r.status === lane.key))
  }
  return lanes
}

// The RFQs sent back and not yet answered: the lead's NEWEST desk RFQ that
// wasn't withdrawn is the sent-back one — the same pick Needs Attention's
// "RFQs back with the exec" makes (latestDeskRfqByLead). A sent-back RFQ whose
// lead has a newer revision is answered, whatever happened to that revision.
// `rows` = the sent-back RFQs (full rows); `laterRows` = every other
// non-withdrawn RFQ on those leads ({ id, lead_id, status, raised_at } is
// enough). Longest waiting first.
export function waitingOnExec(rows, laterRows = []) {
  const sentBack = (rows ?? []).filter((r) => r.status === RFQ_STATUS.SENT_BACK)
  const newest = latestDeskRfqByLead([...sentBack, ...(laterRows ?? [])])
  const waiting = sentBack.filter((r) => newest.get(r.lead_id)?.id === r.id)
  return waiting.sort((a, b) => (instant(a.sent_back_at)?.getTime() ?? 0) - (instant(b.sent_back_at)?.getTime() ?? 0))
}

// ---- Turnaround ---------------------------------------------------------------

// Elapsed time between two moments with every Sunday taken out (browser
// time) — the working-day clock the lanes colour by (RFQ-DESK.md Q7). An RFQ
// raised on Saturday evening and checked on Monday morning took a few hours
// of working time, not a day and a half.
export function workingMs(start, end) {
  const s = instant(start)
  const e = instant(end)
  if (!s || !e) return null
  if (e <= s) return 0
  let total = e - s
  const cursor = new Date(s.getFullYear(), s.getMonth(), s.getDate())
  while (cursor < e) {
    const next = new Date(cursor)
    next.setDate(next.getDate() + 1)
    if (cursor.getDay() === 0) total -= Math.max(0, Math.min(next, e) - Math.max(cursor, s))
    cursor.setTime(next.getTime())
  }
  return total
}

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// "The slowest 1 in 10": the nearest-rank 90th percentile — always a real
// RFQ's time, never one interpolated between two. With fewer than ten RFQs it
// is the slowest one.
export function slowestTenth(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(0.9 * sorted.length) - 1)]
}

// "<1h", "5h", "1.4 days", "12 days" — working time. Under a day in hours
// (the owner's ruling); a day or more in working days, one decimal under ten.
export function turnaroundLabel(ms) {
  if (ms == null || Number.isNaN(ms)) return '—'
  if (ms < HOUR_MS) return '<1h'
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)}h`
  const days = ms / DAY_MS
  const shown = days < 10 ? Math.round(days * 10) / 10 : Math.round(days)
  return `${shown} ${shown === 1 ? 'day' : 'days'}`
}

// One row per step, counting each RFQ in the period its step ENDED in:
//   technical  — raised → approved, or → sent back by the technical check
//   estimation — approved (a price revision: started) → raised with Lixil, or
//                → sent back by estimation
//   lixil      — raised with Lixil → quote recorded
//   endToEnd   — raised → quote recorded (an exec's RFQ; a price revision is
//                the desk's own and has no technical step)
// Withdrawals end no step: nobody finished the work.
export const TURNAROUND_STEPS = [
  { key: 'technical', label: 'Technical check', span: 'raised → approved or sent back' },
  { key: 'estimation', label: 'Estimation', span: 'approved → raised with Lixil or sent back' },
  { key: 'lixil', label: 'With Lixil', span: 'raised with Lixil → quote recorded' },
  { key: 'endToEnd', label: 'End to end', span: 'RFQ raised → quote recorded' },
]

// [start, end] of one step for one RFQ, or null when it didn't finish that
// step — exported for the RFQ popups (rfqDeskPanels.js), which list the RFQs
// behind each turnaround figure.
export function stepSpan(r, key) {
  switch (key) {
    case 'technical':
      if (isPriceRevision(r)) return null
      if (r.approved_at) return [r.raised_at, r.approved_at]
      return r.sent_back_from === 'technical' && r.sent_back_at ? [r.raised_at, r.sent_back_at] : null
    case 'estimation': {
      const from = isPriceRevision(r) ? r.raised_at : r.approved_at
      if (!from) return null
      if (r.lixil_raised_at) return [from, r.lixil_raised_at]
      return r.sent_back_from === 'estimation' && r.sent_back_at ? [from, r.sent_back_at] : null
    }
    case 'lixil':
      return r.lixil_raised_at && r.quote_received_at ? [r.lixil_raised_at, r.quote_received_at] : null
    case 'endToEnd':
      return !isPriceRevision(r) && r.quote_received_at ? [r.raised_at, r.quote_received_at] : null
    default:
      return null
  }
}

export function turnaroundByStep(rows, range) {
  return TURNAROUND_STEPS.map((step) => {
    const times = []
    for (const r of rows ?? []) {
      const span = stepSpan(r, step.key)
      if (!span || !inRange(span[1], range)) continue
      const ms = workingMs(span[0], span[1])
      if (ms != null) times.push(ms)
    }
    return { ...step, count: times.length, medianMs: median(times), slowMs: slowestTenth(times) }
  })
}

// ---- Volume -------------------------------------------------------------------

// RFQs raised in the period, by kind, plus the quotes that came in. "Raised"
// counts what was logged, withdrawn ones included — they were raised.
export function rfqVolume(rows, range) {
  const v = { raised: 0, fresh: 0, revised: 0, priceRevisions: 0, withdrawn: 0, quotes: 0 }
  for (const r of rows ?? []) {
    if (inRange(r.quote_received_at, range)) v.quotes++
    if (!inRange(r.raised_at, range)) continue
    if (isPriceRevision(r)) {
      v.priceRevisions++
      continue
    }
    v.raised++
    if (r.kind === 'revised') v.revised++
    else v.fresh++
    if (r.status === RFQ_STATUS.WITHDRAWN) v.withdrawn++
  }
  return v
}

// ---- Send-backs by exec ---------------------------------------------------------

// Every exec who raised an RFQ in the period: how many, how many of THOSE were
// sent back (by the technical check / by estimation), and the share. A cohort,
// not a count of send-backs in the period, so the share is honest — an RFQ
// still with the desk may yet be sent back, which the card says. Highest share
// first; an exec with none sent back sinks to the bottom and stays there, a
// finding rather than noise.
export function sendBacksByExec(rows, range) {
  const byExec = new Map()
  for (const r of rows ?? []) {
    if (isPriceRevision(r) || !inRange(r.raised_at, range)) continue
    const id = r.raised_by_employee_id ?? null
    if (!byExec.has(id)) {
      byExec.set(id, { id, name: r.raised_by?.name?.trim() || 'Unknown', raised: 0, technical: 0, estimation: 0 })
    }
    const row = byExec.get(id)
    row.raised++
    if (r.status === RFQ_STATUS.SENT_BACK && r.sent_back_from === 'technical') row.technical++
    if (r.status === RFQ_STATUS.SENT_BACK && r.sent_back_from === 'estimation') row.estimation++
  }
  return [...byExec.values()]
    .map((row) => ({ ...row, sentBack: row.technical + row.estimation, share: (row.technical + row.estimation) / row.raised }))
    .sort((a, b) => b.share - a.share || b.raised - a.raised || a.name.localeCompare(b.name))
}

// ---- Sent back by estimation after the technical check approved it ------------

// The technical check's misses (RFQ-DESK.md §3): approved, then sent back by
// estimation, counted in the period of the send-back. `approved` is every
// approval in the period, so the card can say "N of M".
export function bouncedAfterApproval(rows, range) {
  const list = (rows ?? []).filter(
    (r) => r.sent_back_from === 'estimation' && r.approved_at && inRange(r.sent_back_at, range)
  )
  list.sort((a, b) => (instant(b.sent_back_at)?.getTime() ?? 0) - (instant(a.sent_back_at)?.getTime() ?? 0))
  const approved = (rows ?? []).filter((r) => inRange(r.approved_at, range)).length
  return { list, approved }
}

// ---- Price revisions -------------------------------------------------------------

// Re-quotes Lixil's price changes forced, started in the period, and where
// each is now.
export function priceRevisionSummary(rows, range) {
  const s = { started: 0, quoted: 0, withdrawn: 0, open: 0 }
  for (const r of rows ?? []) {
    if (!isPriceRevision(r) || !inRange(r.raised_at, range)) continue
    s.started++
    if (r.status === RFQ_STATUS.QUOTED) s.quoted++
    else if (r.status === RFQ_STATUS.WITHDRAWN) s.withdrawn++
    else s.open++
  }
  return s
}

// "40%" — a share for a table cell; "—" when there is nothing to divide.
export function shareLabel(part, whole) {
  if (!whole) return '—'
  return `${Math.round((part / whole) * 100)}%`
}
