// Canonical list — kept in sync with activities.activity_type's CHECK
// constraint in Schema/tostem_crm_schema.sql. Shared by ActivityLog and the
// dashboard.
//
// This list fans out further than it looks. Adding an entry also adds: a
// button on Log Activity, a row on Dashboard's Activity card, a slice of
// buildActivitiesAttainPanel's contribution breakdown, and a chip on
// FollowUpForm's "Type of follow-up" picker — which is why a new value needs
// BOTH the activities and follow_ups CHECK constraints widened, not just the
// obvious one. See Schema/migration_client_meeting_design_sheet.sql.
//
// Order is the on-screen order of the tap-select (2 columns on a phone, 4 at
// desktop), grouped so field and meeting work sits together and paperwork
// sits together, with the most-used actions in the top rows.
export const ACTIVITY_TYPES = [
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'call', label: 'Call' },
  { value: 'client_meeting', label: 'Client Meeting' },
  { value: 'architect_meeting', label: 'Architect Meeting' },
  { value: 'rfq_raised', label: 'RFQ Raised' },
  { value: 'design_sheet', label: 'Design Sheet' },
  { value: 'office_day', label: 'Office Day' },
  { value: 'booking_update', label: 'Booking Update' },
]

export const ACTIVITY_LABELS = Object.fromEntries(ACTIVITY_TYPES.map((o) => [o.value, o.label]))
