import { ACTIVITY_TYPES } from './activityTypes'
import { OLD_MEETING, NEW_MEETING } from './meetingBucket'

// The targets table's metric_name is free text (no CHECK constraint), but
// this dashboard only knows how to compute an "actual" for metrics that map
// directly onto something measurable. Deliberately a closed list, not
// "suggested options + Other…" like current_stage/site_stage — an arbitrary
// free-text metric here would have a target but no computable actual, which
// defeats the point of this section.
//
// REPLACED WHOLESALE 2026-09-08, per the owner — the prior six-metric list
// (Site Visit/Call/Old Meeting/New Meeting/RFQ Raised/Architect Meeting +
// Order Value + Bookings) is gone; this is the new set. Site Visit,
// Architect Meeting and Bookings (won_count) were dropped; Scanning Leads
// is new. computeWonCountActuals/computeQuoteSentActuals
// (TargetsVsActualsCard.jsx) stay exported — the Sales Exec Profile's own
// hardcoded 6-tile grid (Order value/Site visits/Calls made/RFQs raised/
// Offers sent/Bookings) is a separate list, unaffected by this one.
//
// TARGETABLE_ACTIVITY_VALUES sets both membership AND order (ACTIVITY_TYPES'
// own order puts Call ahead of the meeting buckets; this list wants the
// meetings first) — ACTIVITY_METRIC_OPTIONS is built by looking each value
// up in ACTIVITY_TYPES rather than filtering it, so a value/label typo here
// still can't drift out of sync with the activities CHECK constraint.
const TARGETABLE_ACTIVITY_VALUES = [OLD_MEETING, NEW_MEETING, 'call', 'rfq_raised']

// Activity-type-shaped targetable metrics only (excludes scanning_leads/
// order_value, which are computed from leads, not activities) — shared by
// DashboardHeatmap's columns and buildOverallAttainPanel's blended-
// attainment calc (drilldownBuilders.js) so the heatmap's inline "Overall %"
// and the panel its cell opens can't drift into two different numbers for
// the same thing.
export const ACTIVITY_METRIC_OPTIONS = TARGETABLE_ACTIVITY_VALUES.map((v) => ACTIVITY_TYPES.find((a) => a.value === v))

// Scanning Leads is the one metric here that isn't an activity at all — it
// counts NEW LEADS (not activities logged against a lead) whose source is
// Scanning, attributed to the lead's owner and dated by creation.
// computeScanningLeadsActuals (TargetsVsActualsCard.jsx) reads it off
// breakdownLeads, the same array computeQuoteSentActuals already reduces for
// the Sales Exec Profile's "Offers sent" tile — no new query.
export const METRIC_OPTIONS = [
  { value: 'scanning_leads', label: 'Scanning Leads' },
  ...ACTIVITY_METRIC_OPTIONS,
  { value: 'order_value', label: 'Order Value Booked' },
]

export const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map((o) => [o.value, o.label]))
