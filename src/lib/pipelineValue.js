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

export function isOnHoldLead(lead) {
  return (lead.current_stage ?? 'calling') === 'on_hold'
}

// The raw figure a lead contributes to a SUM. Coerces an unknown value to 0,
// which is correct for adding up — a lead nobody has quoted contributes
// nothing to the pipeline total.
//
// DO NOT use this to DISPLAY a single lead's value. Use dealValueOrNull below.
export function dealValueFor(lead) {
  if (isOpenLead(lead)) return Number(lead.quote_value ?? 0)
  return Number(lead.order_value ?? lead.quote_value ?? 0)
}

// The same rule, but honest about "not known yet": returns null instead of 0
// when the lead carries no value at all.
//
// The two exist separately on purpose. Summing needs 0; displaying needs to
// distinguish "this deal is worth nothing" from "nobody has priced this yet",
// and rendering the second as ₹0 is a factual claim the data does not support.
// The canonical rule has always been explicit — "never a fabricated 0; a lead
// with neither value renders —" — but every per-lead display site read
// dealValueFor() and printed ₹0, which on real pilot data meant the great
// majority of rows in All Leads. (Phase 9 finding F-P4-2.)
//
// Changing dealValueFor() itself to return null was the obvious-looking fix and
// is the wrong one: sumOpenPipelineValue and the four category-breakdown cards
// all add its result, and null would silently poison every total.
export function dealValueOrNull(lead) {
  const raw = isOpenLead(lead) ? lead.quote_value : (lead.order_value ?? lead.quote_value)
  return raw == null || raw === '' ? null : Number(raw)
}

// Dashboard's "Open pipeline" KPI tile means leads actively being worked —
// an on-hold lead is paused, so its value is reported separately via
// sumOnHoldValue rather than folded into this total (owner's call,
// 2026-08-20). This function has exactly one caller today (that tile), so
// narrowing it here is deliberately scoped to that one figure — every stage
// breakdown/drill-down that sums leads via dealValueFor() directly still
// counts an on-hold lead as open pipeline, unchanged, per the Lead stage
// taxonomy section's "still open, just paused" rule in CLAUDE.md.
export function sumOpenPipelineValue(leads) {
  return leads.filter((l) => isOpenLead(l) && !isOnHoldLead(l)).reduce((s, l) => s + dealValueFor(l), 0)
}

export function sumOnHoldValue(leads) {
  return leads.filter(isOnHoldLead).reduce((s, l) => s + dealValueFor(l), 0)
}
