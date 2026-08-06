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

// preset is 'week' | 'month' | 'quarter' | 'custom' — returns
// { periodType, periodValue } for the current moment, or null for 'custom'
// (targets are period-keyed, custom ranges aren't) and '15d' (a rolling
// window ending today has no fixed period identity to key a target
// against — deliberately not supported, see CLAUDE.md).
export function periodForPreset(preset, date = new Date()) {
  if (preset === 'week') return { periodType: 'week', periodValue: weekPeriodValue(date) }
  if (preset === 'month') return { periodType: 'month', periodValue: monthPeriodValue(date) }
  if (preset === 'quarter') return { periodType: 'quarter', periodValue: quarterPeriodValue(date) }
  return null
}
