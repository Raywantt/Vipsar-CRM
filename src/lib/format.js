import { parseTimestamp } from './dbTime'

export function formatCurrency(value, options) {
  if (value == null) return '—'
  return `₹${Number(value).toLocaleString('en-IN', options)}`
}

// Compact form — for bars and board/list cards only (per the design
// handoff's non-negotiables), never for a value that stands alone as the
// single figure of record (facts grids, forms still use formatCurrency).
// A dealership talks in lakhs and crores, not just lakhs — a flat /100000
// made a ₹10,000 lead read as "₹0.1L" and a ₹1.4Cr pipeline read as
// "₹142.2L", both the wrong unit for their own scale. Scale the unit to the
// value instead: plain rupees below ₹1L, lakhs from ₹1L up to ₹1Cr, crores
// from ₹1Cr up.
export function formatCurrencyCompact(value) {
  if (value == null) return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs < 100000) return `₹${n.toLocaleString('en-IN')}`
  if (abs < 10000000) return `₹${(n / 100000).toFixed(1)}L`
  return `₹${(n / 10000000).toFixed(2)}Cr`
}

// A TIME column ('09:30:00') rendered as a readable clock time. TIME carries
// no date and no zone, so there is nothing to parse and nothing to shift —
// read the numbers straight off the string rather than round-tripping through
// a Date, which would attach today's date and re-introduce exactly the naive-
// timestamp hazard src/lib/dbTime.js exists to fix.
export function formatClockTime(value) {
  if (!value) return null
  const [h, m] = String(value).split(':')
  const hour = Number(h)
  if (Number.isNaN(hour)) return String(value)
  const suffix = hour < 12 ? 'am' : 'pm'
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m ?? '00'} ${suffix}`
}

// "9:30 am – 6:00 pm" for Office Day's From/Till pair, degrading to whichever
// end is set. Returns null when neither is, so callers can render it
// conditionally — every Office Day logged before that field existed has both
// columns NULL.
export function formatTimeRange(start, end) {
  const from = formatClockTime(start)
  const till = formatClockTime(end)
  if (from && till) return `${from} – ${till}`
  return from ?? till ?? null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "5 Sep 2026", from either kind of date column in this schema.
//
// A DATE ('2026-09-05') is read straight off the string — no Date is
// constructed, because `new Date('2026-09-05')` is UTC midnight and would
// render as the previous day for any viewer west of UTC. A naive TIMESTAMP
// goes through parseTimestamp first, for the reason dbTime.js exists.
export function formatDateShort(value) {
  if (!value) return null
  const s = String(value)

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`
  }

  const parsed = parseTimestamp(s)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`
}
