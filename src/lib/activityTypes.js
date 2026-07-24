// Canonical list — kept in sync with activities.activity_type's CHECK constraint
// in Schema/tostem_crm_schema.sql. Shared by ActivityLog and the dashboard.
export const ACTIVITY_TYPES = [
  { value: 'site_visit', label: 'Site Visit' },
  { value: 'call', label: 'Call' },
  { value: 'rfq_raised', label: 'RFQ Raised' },
  { value: 'office_day', label: 'Office Day' },
  { value: 'booking_update', label: 'Booking Update' },
]

export const ACTIVITY_LABELS = Object.fromEntries(ACTIVITY_TYPES.map((o) => [o.value, o.label]))
