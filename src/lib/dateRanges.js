function atStartOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function atEndOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function startOfWeek(date) {
  const d = atStartOfDay(date)
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diffToMonday)
  return d
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfQuarter(date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1)
}

// How each preset reads mid-sentence ("Reminders · this week"). Shared by
// Dashboard and the BDM's dashboard so the two can't word a period differently.
export const RANGE_LABELS = {
  today: 'today',
  '15d': 'last 15 days',
  week: 'this week',
  month: 'this month',
  quarter: 'this quarter',
  custom: 'this range',
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// ---- Stepping back through past periods (the ‹ › under the range buttons) ----
//
// Week, 15D, Month and Quarter can be stepped back one WHOLE period at a time,
// the way Today steps back one day. `offset` counts periods back from now: 0 is
// the current period (to date, still running), 1 is the one before it, and so
// on. Today has its own day stepper; Custom already has explicit From/To.
export const STEPPABLE_PRESETS = ['week', '15d', 'month', 'quarter']

export function isSteppablePreset(preset) {
  return STEPPABLE_PRESETS.includes(preset)
}

// What one tap of ‹ moves, for aria-labels and the "Final" stamp.
export const STEP_UNIT_LABELS = { week: 'week', '15d': '15 days', month: 'month', quarter: 'quarter' }

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// "14 – 20 Sep" / "28 Dec – 3 Jan 2026" — a calendar span, local-time. The year
// appears only when the span doesn't end in the current one (or when `withYear`
// asks for it), so a card title stays short.
function spanLabel(start, end, { withYear = false, now = new Date() } = {}) {
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  const showYear = withYear || end.getFullYear() !== now.getFullYear() || start.getFullYear() !== end.getFullYear()
  const tail = showYear ? ` ${end.getFullYear()}` : ''
  if (sameMonth) {
    return start.getDate() === end.getDate()
      ? `${end.getDate()} ${MONTH_SHORT[end.getMonth()]}${tail}`
      : `${start.getDate()} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}${tail}`
  }
  const startYear = start.getFullYear() !== end.getFullYear() ? ` ${start.getFullYear()}` : ''
  return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}${startYear} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]}${tail}`
}

// The whole week / month / quarter a range sits in, or the range itself for
// 15D — what the stepper's middle slot prints. `range` may be a to-date range;
// the label always names the full period so it reads the same all week.
export function periodSpanLabel(preset, range, now = new Date()) {
  if (!range) return ''
  if (preset === 'week') {
    const start = startOfWeek(range.start)
    return spanLabel(start, addDays(start, 6), { now })
  }
  if (preset === 'month') {
    return `${MONTH_LONG[range.start.getMonth()]} ${range.start.getFullYear()}`
  }
  if (preset === 'quarter') {
    return `Q${Math.floor(range.start.getMonth() / 3) + 1} ${range.start.getFullYear()}`
  }
  return spanLabel(range.start, range.end, { now })
}

// How a period reads mid-sentence ("Activity · last week", "None won or lost
// 14 – 20 Sep."). The current one keeps the shared RANGE_LABELS wording; the one
// right before a week/month/quarter is "last …"; anything older, and any 15D
// window, is named by its dates. Never starts with a preposition, because the
// callers drop it after "for", "lost" and "·" alike.
export function rangeLabelFor(preset, offset, range, now = new Date()) {
  if (!offset || !isSteppablePreset(preset) || !range) return RANGE_LABELS[preset]
  if (offset === 1 && preset !== '15d') return `last ${STEP_UNIT_LABELS[preset]}`
  return periodSpanLabel(preset, range, now)
}

// The offset of the period that contains `date` — what the stepper's own date
// picker needs to jump to an arbitrary day. A date in the future is the current
// period (0); there is nothing past it to show.
export function offsetForDate(preset, date, now = new Date()) {
  if (!isSteppablePreset(preset) || !date) return 0
  const DAY = 24 * 60 * 60 * 1000
  const d = atStartOfDay(date)
  const today = atStartOfDay(now)
  if (d >= today) return 0
  if (preset === 'week') {
    return Math.max(0, Math.round((startOfWeek(today) - startOfWeek(d)) / (7 * DAY)))
  }
  if (preset === 'month') {
    return Math.max(0, (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth()))
  }
  if (preset === 'quarter') {
    const q = (x) => x.getFullYear() * 4 + Math.floor(x.getMonth() / 3)
    return Math.max(0, q(today) - q(d))
  }
  // 15D: blocks of 15 days counted back from today (day 0 is today itself).
  return Math.max(0, Math.floor(Math.round((today - d) / DAY) / 15))
}

// The window a period is fairly compared against: `{ range, label }`, or null
// for no range. Week/Month/Quarter compare against the SAME POINT of the
// previous whole period (this week Mon–Wed vs last week Mon–Wed), never the
// equal-length window immediately before — that would set Mon–Wed against
// Fri–Sun, or a month-to-date against the tail of the previous month, and read
// a calendar effect as a trend. A month/quarter that is longer than its
// predecessor is capped at the predecessor's own last day rather than spilling
// into the period after it. Anything without a calendar identity (15D, Custom,
// Today) compares against the equal-length window immediately before it.
//
// `offset` is how far back the range being compared has been stepped (0 = the
// current period). Once it is above 0 the label can no longer say "last week" —
// that would name the very period on screen — so it names the dates instead. A
// stepped-back range is also a WHOLE period, so a month is set against the whole
// month before it, not just its first N days.
export function previousRangeFor(preset, range, offset = 0) {
  if (!range) return null
  const DAY = 24 * 60 * 60 * 1000
  const days = Math.round((atStartOfDay(range.end) - atStartOfDay(range.start)) / DAY) + 1
  const named = (label, previous) => {
    if (!offset) return { range: previous, label }
    return { range: previous, label: periodSpanLabel(preset, previous) }
  }

  if (preset === 'week') {
    return named('last week', { start: addDays(range.start, -7), end: addDays(range.end, -7) })
  }

  if (preset === 'month' || preset === 'quarter') {
    const months = preset === 'month' ? 1 : 3
    const start = new Date(range.start.getFullYear(), range.start.getMonth() - months, 1)
    // Day 0 of the current period's first month is the last day of the period
    // before it, whichever length that one was.
    const periodEnd = atEndOfDay(new Date(range.start.getFullYear(), range.start.getMonth(), 0))
    const sameElapsed = atEndOfDay(addDays(start, days - 1))
    return named(preset === 'month' ? 'last month' : 'last quarter', {
      start,
      end: offset > 0 || sameElapsed > periodEnd ? periodEnd : sameElapsed,
    })
  }

  const previous = { start: atStartOfDay(addDays(range.start, -days)), end: new Date(range.start.getTime() - 1) }
  return offset ? { range: previous, label: periodSpanLabel(preset, previous) } : { range: previous, label: `the ${days} days before` }
}

// Returns { start: Date, end: Date } for the given preset, or null when a
// 'custom' preset is missing one of its bounds.
//
// `offset` (Week/15D/Month/Quarter only) steps that many whole periods back
// from now. At 0 the range runs from the period's start to the end of today,
// exactly as before; above 0 it is the complete past period.
export function rangeForPreset(preset, customStart, customEnd, offset = 0) {
  const now = new Date()
  const back = isSteppablePreset(preset) ? Math.max(0, Math.floor(Number(offset)) || 0) : 0

  // Dashboard's Day Review period. It drives its own date-scoped queries
  // (src/lib/dayReviewQueries.js) rather than this range, but returning a
  // real range keeps 'today' from falling through to the null that means
  // "custom preset with a missing bound" and renders a pick-your-dates prompt.
  if (preset === 'today') {
    return { start: atStartOfDay(now), end: atEndOfDay(now) }
  }

  if (preset === '15d') {
    const end = atEndOfDay(addDays(now, -15 * back))
    return { start: atStartOfDay(addDays(end, -14)), end }
  }

  if (preset === 'week') {
    const start = addDays(startOfWeek(now), -7 * back)
    return { start, end: back === 0 ? atEndOfDay(now) : atEndOfDay(addDays(start, 6)) }
  }

  if (preset === 'month') {
    if (back === 0) return { start: startOfMonth(now), end: atEndOfDay(now) }
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1)
    return { start, end: atEndOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0)) }
  }

  if (preset === 'quarter') {
    if (back === 0) return { start: startOfQuarter(now), end: atEndOfDay(now) }
    const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3 * back, 1)
    return { start, end: atEndOfDay(new Date(start.getFullYear(), start.getMonth() + 3, 0)) }
  }

  if (preset === 'year') {
    return { start: startOfYear(now), end: atEndOfDay(now) }
  }

  if (preset === 'custom') {
    if (!customStart || !customEnd) return null
    let start = atStartOfDay(new Date(customStart))
    let end = atEndOfDay(new Date(customEnd))
    if (start > end) {
      ;[start, end] = [atStartOfDay(new Date(customEnd)), atEndOfDay(new Date(customStart))]
    }
    return { start, end }
  }

  return null
}
