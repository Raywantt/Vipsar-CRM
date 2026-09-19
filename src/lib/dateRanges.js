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

// The window a period is fairly compared against: `{ range, label }`, or null
// for no range. Week/Month/Quarter compare against the SAME POINT of the
// previous whole period (this week Mon–Wed vs last week Mon–Wed), never the
// equal-length window immediately before — that would set Mon–Wed against
// Fri–Sun, or a month-to-date against the tail of the previous month, and read
// a calendar effect as a trend. A month/quarter that is longer than its
// predecessor is capped at the predecessor's own last day rather than spilling
// into the period after it. Anything without a calendar identity (15D, Custom,
// Today) compares against the equal-length window immediately before it.
export function previousRangeFor(preset, range) {
  if (!range) return null
  const DAY = 24 * 60 * 60 * 1000
  const days = Math.round((atStartOfDay(range.end) - atStartOfDay(range.start)) / DAY) + 1

  if (preset === 'week') {
    return { range: { start: addDays(range.start, -7), end: addDays(range.end, -7) }, label: 'last week' }
  }

  if (preset === 'month' || preset === 'quarter') {
    const months = preset === 'month' ? 1 : 3
    const start = new Date(range.start.getFullYear(), range.start.getMonth() - months, 1)
    // Day 0 of the current period's first month is the last day of the period
    // before it, whichever length that one was.
    const periodEnd = atEndOfDay(new Date(range.start.getFullYear(), range.start.getMonth(), 0))
    const sameElapsed = atEndOfDay(addDays(start, days - 1))
    return {
      range: { start, end: sameElapsed > periodEnd ? periodEnd : sameElapsed },
      label: preset === 'month' ? 'last month' : 'last quarter',
    }
  }

  return {
    range: { start: atStartOfDay(addDays(range.start, -days)), end: new Date(range.start.getTime() - 1) },
    label: `the ${days} days before`,
  }
}

// Returns { start: Date, end: Date } for the given preset, or null when a
// 'custom' preset is missing one of its bounds.
export function rangeForPreset(preset, customStart, customEnd) {
  const now = new Date()

  // Dashboard's Day Review period. It drives its own date-scoped queries
  // (src/lib/dayReviewQueries.js) rather than this range, but returning a
  // real range keeps 'today' from falling through to the null that means
  // "custom preset with a missing bound" and renders a pick-your-dates prompt.
  if (preset === 'today') {
    return { start: atStartOfDay(now), end: atEndOfDay(now) }
  }

  if (preset === '15d') {
    const start = atStartOfDay(now)
    start.setDate(start.getDate() - 14)
    return { start, end: atEndOfDay(now) }
  }

  if (preset === 'week') {
    return { start: startOfWeek(now), end: atEndOfDay(now) }
  }

  if (preset === 'month') {
    return { start: startOfMonth(now), end: atEndOfDay(now) }
  }

  if (preset === 'quarter') {
    return { start: startOfQuarter(now), end: atEndOfDay(now) }
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
