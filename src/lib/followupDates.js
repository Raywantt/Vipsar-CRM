// Shared "when" quick-pick used by both LeadQuickActions' Set follow-up
// action and FollowUpForm, so the two can't drift into different date math.
export const FOLLOWUP_OPTIONS = ['Tomorrow', 'In 3 days', 'Next Monday', 'In 2 weeks', 'Custom date']

export function toISODate(d) {
  return d.toISOString().slice(0, 10)
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
