import { ACTIVITY_TYPES } from './activityTypes'

// The targets table's metric_name is free text (no CHECK constraint), but
// this dashboard only knows how to compute an "actual" for metrics that map
// directly onto something measurable: the five activity types (a straight
// count in the period) plus order_value (see targetQueries.js), plus
// quote_sent/won_count (see computeQuoteSentActuals/computeWonCountActuals
// in TargetsVsActualsCard.jsx — added for the Sales Exec Profile's "Offers
// sent"/"Bookings" tiles, computed from leads.quote_sent_at and stage_history
// 'won' rows rather than the activities tally every other metric here uses).
// Deliberately a closed list, not "suggested options + Other…" like
// current_stage/site_stage — an arbitrary free-text metric here would have a
// target but no computable actual, which defeats the point of this section.
// Built from ACTIVITY_TYPES rather than redeclared so it can't drift out of
// sync.
export const METRIC_OPTIONS = [
  ...ACTIVITY_TYPES,
  { value: 'order_value', label: 'Order Value' },
  { value: 'quote_sent', label: 'Offers Sent' },
  { value: 'won_count', label: 'Bookings' },
]

export const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map((o) => [o.value, o.label]))
