import { ACTIVITY_TYPES } from './activityTypes'

// The targets table's metric_name is free text (no CHECK constraint), but
// this dashboard only knows how to compute an "actual" for metrics that map
// directly onto something measurable. Not every ACTIVITY_TYPES entry is
// targetable — Office Day and Booking Update are process-tracking entries
// rather than something a rep gets a quota for, so they're excluded here
// (2026-08-09, per the owner) even though they're still loggable in
// Activity Log. "Offers Sent" (quote_sent) was dropped from this list at
// the same time — its computeQuoteSentActuals function stays exported for
// the Sales Exec Profile's own "Offers sent" tile, which isn't driven by
// this list. Bookings (won_count, see computeWonCountActuals in
// TargetsVsActualsCard.jsx) is unaffected and stays.
// Deliberately a closed list, not "suggested options + Other…" like
// current_stage/site_stage — an arbitrary free-text metric here would have a
// target but no computable actual, which defeats the point of this section.
// Built from ACTIVITY_TYPES rather than redeclared so it can't drift out of
// sync.
const TARGETABLE_ACTIVITY_VALUES = ['site_visit', 'call', 'rfq_raised', 'architect_meeting']

// Activity-type-shaped targetable metrics only (excludes order_value/
// won_count, which are computed differently) — shared by DashboardHeatmap's
// columns and buildOverallAttainPanel's blended-attainment calc
// (drilldownBuilders.js) so the heatmap's inline "Overall %" and the panel
// its cell opens can't drift into two different numbers for the same thing.
export const ACTIVITY_METRIC_OPTIONS = ACTIVITY_TYPES.filter((a) => TARGETABLE_ACTIVITY_VALUES.includes(a.value))

export const METRIC_OPTIONS = [
  ...ACTIVITY_METRIC_OPTIONS,
  { value: 'order_value', label: 'Order Value' },
  { value: 'won_count', label: 'Bookings' },
]

export const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map((o) => [o.value, o.label]))
