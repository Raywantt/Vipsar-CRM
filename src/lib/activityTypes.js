import { OLD_MEETING, NEW_MEETING, PICKABLE_MEETING } from './meetingBucket'

// Canonical list — kept in sync with activities.activity_type's CHECK
// constraint in Schema/tostem_crm_schema.sql. Shared by ActivityLog and the
// dashboard.
//
// This list fans out further than it looks. Adding an entry also adds: a row
// on Dashboard's Activity card, a slice of buildActivitiesAttainPanel's
// contribution breakdown, a tag in the Day Review's day sheet, and a label in
// every activity timeline — which is why a new value needs the activities
// CHECK constraint widened. (It no longer automatically adds a Log Activity
// button or a follow-up chip — those come from LOGGABLE_ACTIVITY_TYPES below,
// and only that list needs the follow_ups CHECK widened too.)
//
// A CLIENT MEETING IS TWO ENTRIES HERE, NOT ONE. Every meeting is stored as
// either an Old Meeting or a New Meeting, bucketed from the lead's stage at
// the moment it was logged — see meetingBucket.js for the rule. Because this
// list is what every meeting-showing surface derives from, that split reaches
// all of them without a single one special-casing it.
//
// Order is the on-screen order of the tap-select (2 columns on a phone, 4 at
// desktop), grouped so field and meeting work sits together and paperwork
// sits together, with the most-used actions in the top rows.
export const ACTIVITY_TYPES = [
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'call', label: 'Call' },
  { value: OLD_MEETING, label: 'Old Meeting' },
  { value: NEW_MEETING, label: 'New Meeting' },
  { value: 'architect_meeting', label: 'Architect Meeting' },
  { value: 'rfq_raised', label: 'RFQ Raised' },
  { value: 'design_sheet', label: 'Design Sheet' },
  { value: 'office_day', label: 'Office Day' },
  { value: 'booking_update', label: 'Booking Update' },
]

// What a person actually PICKS — on Log Activity's tap-select and on
// FollowUpForm's "Type of follow-up" chips. Identical to ACTIVITY_TYPES
// except that the two meeting buckets collapse back into one Client Meeting
// button: the rep says "I met the client" and the CRM decides which umbrella
// that falls under, rather than asking them to classify their own day.
//
// Kept in sync with follow_ups.activity_type's CHECK constraint — a chip that
// can be picked on a reminder has to be storable on one.
export const LOGGABLE_ACTIVITY_TYPES = [
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'call', label: 'Call' },
  { value: PICKABLE_MEETING, label: 'Client Meeting' },
  { value: 'architect_meeting', label: 'Architect Meeting' },
  { value: 'rfq_raised', label: 'RFQ Raised' },
  { value: 'design_sheet', label: 'Design Sheet' },
  { value: 'office_day', label: 'Office Day' },
  { value: 'booking_update', label: 'Booking Update' },
]

// Both lists feed the label map. `client_meeting` is no longer storable on an
// activity, but it is still storable on a follow_up (and still sits on the
// pre-2026-09-07 rows in Schema/import_*_legacy.sql, should one ever be
// re-run), so it must keep rendering as something other than a raw slug.
export const ACTIVITY_LABELS = Object.fromEntries(
  [...ACTIVITY_TYPES, ...LOGGABLE_ACTIVITY_TYPES].map((o) => [o.value, o.label]),
)
