// Shared "when" quick-pick used by both LeadQuickActions' Set follow-up
// action and FollowUpForm, so the two can't drift into different date math.
export const FOLLOWUP_OPTIONS = ['Tomorrow', 'In 3 days', 'Next Monday', 'In 2 weeks', 'Custom date']

// Local calendar date, not UTC — d.toISOString() shifts to UTC and returns
// the wrong day between midnight and 05:30 IST (India has no runtime that
// puts UTC and IST on the same calendar day at that hour).
export function toISODate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO() {
  return toISODate(new Date())
}

export function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function nextMonday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 1 ? 7 : ((8 - day) % 7) || 7
  d.setDate(d.getDate() + diff)
  return toISODate(d)
}

export function followupDateFor(label, customDate) {
  if (label === 'Tomorrow') return addDays(1)
  if (label === 'In 3 days') return addDays(3)
  if (label === 'Next Monday') return nextMonday()
  if (label === 'In 2 weeks') return addDays(14)
  if (label === 'Custom date') return customDate || null
  return null
}
