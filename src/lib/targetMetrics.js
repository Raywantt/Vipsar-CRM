import { ACTIVITY_TYPES } from './activityTypes'
import { OLD_MEETING, NEW_MEETING } from './meetingBucket'

// The targets table's metric_name is free text (no CHECK constraint), but
// this dashboard only knows how to compute an "actual" for metrics that map
// directly onto something measurable. Deliberately a closed list, not
// "suggested options + Other…" like current_stage/site_stage — an arbitrary
// free-text metric here would have a target but no computable actual, which
// defeats the point of this section.
//
// History: REPLACED WHOLESALE 2026-09-08 (owner) down to six — Scanning
// Leads, Old/New Meeting, Call, RFQ Raised, Order Value; Site Visit,
// Architect Meeting and Bookings (won_count) were dropped then. WIDENED
// 2026-10-19 (owner, ahead of setting the H2 targets) to the H2 targets
// workbook's per-person plan, in three groups: Site Visit and Architect
// Meeting came back, plus New quotes sent and Architect / Client referral
// leads. Orders won (won_count) was in that list for an afternoon and taken
// out the same day ("not significant", owner) — it is not a target for any
// period. Order value is not a WEEKLY target either (`notWeekly`, below).
//
// Every metric names the ONE rule that counts it (`kind`), and every rule
// already existed and is shared, so a target here can't read a different
// number from the screen beside it:
//   order_value  computeOrderValueActuals — won in the period, current owner
//   quotes       computeQuoteSentActuals  — quote sent to the client in the
//                                            period ("Offers sent", same key)
//   activity     computeActivityActuals   — activities logged (RFQ Raised:
//                                            fresh only, the desk's approval rule)
//   source       computeSourceLeadsActuals — new leads of one source, current
//                                            owner, day created (the Team
//                                            Report's Scanning / Architect /
//                                            Referral leads)
// `source` gives a source metric's leads.source_type. `short` is the heatmap
// column header.
//
// The metric_name of an activity metric IS the activity type, and site_visit /
// quote_sent are keys the Sales Exec Profile's tiles already read — so a
// target set here shows there too. An activity metric's label is
// looked up in ACTIVITY_TYPES rather than typed, so it can't drift from the
// activities CHECK constraint.
const activityMetric = (value, short) => ({ ...ACTIVITY_TYPES.find((a) => a.value === value), short, group: 'activity', kind: 'activity' })

export const METRIC_GROUPS = [
  { key: 'results', label: 'Results' },
  { key: 'activity', label: 'Activity' },
  { key: 'leads', label: 'Leads' },
]

// Order is the order everywhere a target is listed — the heatmap's columns,
// the Set a target dropdown, a person's list on a phone and the exec's own.
export const METRIC_OPTIONS = [
  // Not a weekly target (owner, 2026-10-19): one order can be a month's
  // bookings, so a week's figure says nothing. Month and quarter only.
  { value: 'order_value', label: 'Order Value Booked', short: 'Order value', group: 'results', kind: 'order_value', notWeekly: true },
  { value: 'quote_sent', label: 'New Quotes Sent', short: 'Quotes', group: 'results', kind: 'quotes' },
  { ...ACTIVITY_TYPES.find((a) => a.value === 'rfq_raised'), short: 'RFQs', group: 'results', kind: 'activity' },
  activityMetric(NEW_MEETING, 'New mtgs'),
  activityMetric(OLD_MEETING, 'Old mtgs'),
  activityMetric('site_visit', 'Site visits'),
  activityMetric('architect_meeting', 'Arch. mtgs'),
  activityMetric('call', 'Calls'),
  { value: 'scanning_leads', label: 'Scanning Leads', short: 'Scanning', group: 'leads', kind: 'source', source: 'scanning' },
  { value: 'architect_leads', label: 'Architect Referral Leads', short: 'Architect', group: 'leads', kind: 'source', source: 'referral_architect' },
  { value: 'referral_leads', label: 'Client Referral Leads', short: 'Referral', group: 'leads', kind: 'source', source: 'referral_other' },
]

// The activity-type metrics (RFQ Raised, both meeting buckets, Site Visit,
// Architect Meeting, Call) — the ones computeActivityActuals tallies.
export const ACTIVITY_METRIC_OPTIONS = METRIC_OPTIONS.filter((m) => m.kind === 'activity')

// The new-lead metrics, by source.
export const SOURCE_METRIC_OPTIONS = METRIC_OPTIONS.filter((m) => m.kind === 'source')

export const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map((o) => [o.value, o.label]))

// The metrics that are a target for one kind of period ('week' | 'month' |
// 'quarter'): every metric, less the `notWeekly` ones for a week. The ONE list
// the heatmap, the target lists, Overall and the Set a target dropdown all
// read for the period on screen, so a week can never show or blend a metric
// that isn't a weekly target.
export function metricsForPeriod(periodType) {
  return periodType === 'week' ? METRIC_OPTIONS.filter((m) => !m.notWeekly) : METRIC_OPTIONS
}

// The business development manager's own three targets (BDM.md §3), a
// separate list on purpose: a BDM carries none of the exec metrics, and a
// BDM's architect meetings (bdm_architect_meetings) are not an exec's
// architect_meeting target (back on the exec list since 2026-10-19). Actuals: computeBdmTargetActuals (src/lib/bdmDashboard.js).
//
// The `bdm_` prefix keeps these apart from any metric_name an exec target has
// ever used — targets.metric_name is free text, and a legacy exec row keyed
// 'architect_meeting' must never be read as a BDM's target.
export const BDM_METRIC_OPTIONS = [
  { value: 'bdm_architect_meetings', label: 'Architect meetings' },
  { value: 'bdm_joineries_received', label: 'Joineries received' },
  { value: 'bdm_leads_generated', label: 'Leads generated' },
]
