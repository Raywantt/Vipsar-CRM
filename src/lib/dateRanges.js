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

// Returns { start: Date, end: Date } for the given preset, or null when a
// 'custom' preset is missing one of its bounds.
export function rangeForPreset(preset, customStart, customEnd) {
  const now = new Date()

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
