// Where a Client Meeting happened. Canonical list — kept in sync with
// activities.meeting_location's CHECK constraint
// (Schema/migration_activity_office_day_meeting.sql).
//
// A closed list with a real CHECK, same treatment as leads.source_type and
// leads.office_territory: a fixed business fact picked from a tap-select, not
// something a rep types. Deliberately NOT the "suggested options + Other…"
// pattern current_stage/site_stage get — a meeting was at the site or at the
// office, and a third free-typed value would only blur the one distinction
// this field exists to make.
//
// Only ever set for 'client_meeting' activities. A Site Visit is already at a
// site by definition, and an Architect Meeting is anchored on a party rather
// than a place, so neither asks.
export const MEETING_LOCATION_OPTIONS = [
  { value: 'site', label: 'Site' },
  { value: 'office', label: 'Office' },
]

export const MEETING_LOCATION_LABELS = Object.fromEntries(
  MEETING_LOCATION_OPTIONS.map((o) => [o.value, o.label])
)

// Falls back to the raw stored value, same as territoryLabel()/stageLabel().
// The column is nullable (every client meeting logged before this field
// existed has no location), so callers handle null themselves.
export function meetingLocationLabel(value) {
  return MEETING_LOCATION_LABELS[value] ?? value
}
