// Canonical "how much is this lead worth" figure, shared by every card that
// sums or displays a pipeline/deal value — the single source of truth this
// app was missing (see DECISIONS.md-style reasoning inline): order_value is
// only ever written once a deal is actually booked (ActivityLog.jsx's
// Booking Update activity), so for a lead that's still open, order_value
// can at best be a partial/advance figure — the real number is always its
// latest quote. A won or lost lead keeps the order_value-first fallback
// (falling back to quote_value if order_value was never entered).
const CLOSED_STAGES = ['won', 'lost']

export function isOpenLead(lead) {
  return !CLOSED_STAGES.includes(lead.current_stage ?? 'calling')
}

export function dealValueFor(lead) {
  if (isOpenLead(lead)) return Number(lead.quote_value ?? 0)
  return Number(lead.order_value ?? lead.quote_value ?? 0)
}

export function sumOpenPipelineValue(leads) {
  return leads.filter(isOpenLead).reduce((s, l) => s + dealValueFor(l), 0)
}
