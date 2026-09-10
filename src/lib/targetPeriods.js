function pad2(n) {
  return String(n).padStart(2, '0')
}

export function monthPeriodValue(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
}

// ISO 8601 week (Monday-start, week 1 = week containing the year's first
// Thursday) — matches the Monday-start week already used by dateRanges.js,
// so a target set for "this week" always lines up with what the dashboard
// looks up.
export function weekPeriodValue(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`
}

// Calendar quarter (Jan–Mar/Apr–Jun/Jul–Sep/Oct–Dec) — matches
// dateRanges.js's startOfQuarter, so a target set for "this quarter" always
// lines up with what the dashboard looks up.
export function quarterPeriodValue(date = new Date()) {
  return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`
}

// periodType is 'week' | 'month' | 'quarter' — the periodValue for whatever
// date falls in it. Extracted out of periodForPreset so the Set-a-target UI
// can compute a periodValue for an arbitrary picked date, not just "now".
export function periodValueForDate(periodType, date = new Date()) {
  if (periodType === 'week') return weekPeriodValue(date)
  if (periodType === 'month') return monthPeriodValue(date)
  if (periodType === 'quarter') return quarterPeriodValue(date)
  return null
}

// preset is 'week' | 'month' | 'quarter' | 'custom' — returns
// { periodType, periodValue } for the current moment, or null for 'custom'
// (targets are period-keyed, custom ranges aren't) and '15d' (a rolling
// window ending today has no fixed period identity to key a target
// against — deliberately not supported, see CLAUDE.md).
export function periodForPreset(preset, date = new Date()) {
  if (preset !== 'week' && preset !== 'month' && preset !== 'quarter') return null
  return { periodType: preset, periodValue: periodValueForDate(preset, date) }
}

// ---- Readable ranges + stepping, for the Set-a-target UI ----
//
// period_value stays exactly what it always was on the wire ("2026-W38",
// "2026-09", "2026-Q3") — nothing here changes the schema or what's stored.
// This is purely a display/navigation layer so a human picks a real
// calendar period instead of typing an ISO week/quarter code by hand, which
// is both unreadable ("2026-W37" means nothing at a glance) and easy to get
// subtly wrong in a way that saves silently under the WRONG period (e.g. a
// slip of one digit lands on this week instead of next week) with nothing
// on screen to catch it.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// The Monday of the ISO week a period_value like "2026-W38" names — the
// inverse of weekPeriodValue, built the same UTC way so the two round-trip:
// weekPeriodValue(localDateFromUTC(weekRangeForValue(v).start)) === v.
function weekStartForValue(periodValue) {
  const m = /^(\d{4})-W(\d{2})$/.exec(periodValue)
  if (!m) return null
  const year = Number(m[1])
  const week = Number(m[2])
  // ISO week 1 is the week containing the year's first Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1)
  const start = new Date(week1Monday)
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  return start
}

// { start, end } as UTC-midnight Dates spanning the full calendar period a
// period_value names (Monday–Sunday for a week, 1st–last day for a month,
// Jan–Mar/etc for a quarter) — always the WHOLE period, unlike
// dateRanges.js's rangeForPreset('week'/'month'/'quarter'), which is a
// week/month/quarter-TO-DATE range for reporting on "so far". Those answer
// different questions and are deliberately not shared: this one is for
// showing/planning a period that may not have started yet.
export function rangeForPeriodValue(periodType, periodValue) {
  if (periodType === 'week') {
    const start = weekStartForValue(periodValue)
    if (!start) return null
    const end = new Date(start)
    end.setUTCDate(start.getUTCDate() + 6)
    return { start, end }
  }
  if (periodType === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(periodValue)
    if (!m) return null
    const year = Number(m[1])
    const month = Number(m[2])
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) }
  }
  if (periodType === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(periodValue)
    if (!m) return null
    const year = Number(m[1])
    const startMonth = (Number(m[2]) - 1) * 3
    return { start: new Date(Date.UTC(year, startMonth, 1)), end: new Date(Date.UTC(year, startMonth + 3, 0)) }
  }
  return null
}

// A UTC-midnight Date reinterpreted as the equivalent LOCAL calendar date —
// weekPeriodValue/monthPeriodValue/quarterPeriodValue all read their input
// via local getters, so an anchor built this way lands on the calendar day
// the caller actually means regardless of the viewer's own timezone offset.
function localDateFromUTC(date) {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

// "14 – 20 Sep 2026" / "September 2026" / "1 Jul – 30 Sep 2026 (Q3)" — the
// calendar span a period_value covers, for display next to the raw value
// wherever one is being set or shown.
export function periodRangeLabel(periodType, periodValue) {
  const range = rangeForPeriodValue(periodType, periodValue)
  if (!range) return ''

  if (periodType === 'month') {
    return `${MONTH_LONG[range.start.getUTCMonth()]} ${range.start.getUTCFullYear()}`
  }

  const s = { d: range.start.getUTCDate(), m: MONTH_SHORT[range.start.getUTCMonth()], y: range.start.getUTCFullYear() }
  const e = { d: range.end.getUTCDate(), m: MONTH_SHORT[range.end.getUTCMonth()], y: range.end.getUTCFullYear() }
  const base =
    s.y !== e.y
      ? `${s.d} ${s.m} ${s.y} – ${e.d} ${e.m} ${e.y}`
      : s.m !== e.m
        ? `${s.d} ${s.m} – ${e.d} ${e.m} ${s.y}`
        : `${s.d} – ${e.d} ${s.m} ${s.y}`

  if (periodType === 'quarter') {
    return `${base} (Q${periodValue.split('-Q')[1]})`
  }
  return base
}

// Shifts a period_value by `delta` whole periods of its own type (-1/+1 for
// the Set-a-target UI's ‹ Prev / Next › controls). Always derived from the
// period_value's OWN start date, never from "today", so repeated clicks walk
// one real calendar step at a time regardless of which period is on screen.
export function shiftPeriodValue(periodType, periodValue, delta) {
  const range = rangeForPeriodValue(periodType, periodValue)
  if (!range) return periodValue
  const anchor = localDateFromUTC(range.start)
  if (periodType === 'week') {
    anchor.setDate(anchor.getDate() + delta * 7)
  } else if (periodType === 'month') {
    anchor.setMonth(anchor.getMonth() + delta, 1)
  } else if (periodType === 'quarter') {
    anchor.setMonth(anchor.getMonth() + delta * 3, 1)
  } else {
    return periodValue
  }
  return periodValueForDate(periodType, anchor)
}
