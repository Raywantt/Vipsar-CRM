// The dealership's four offices, plus 'others' for a lead that doesn't
// belong to any of them (added 2026-08-19, Schema/migration_territory_others.sql).
// Canonical list — kept in sync with leads.office_territory's CHECK
// constraint (Schema/migration_office_territory.sql, widened by the
// migration above).
//
// A closed list with a real CHECK, deliberately — same treatment as
// leads.source_type, which is the closest analogue (also a tap-select on the
// New Lead form, also a fixed business fact rather than something a rep types).
// This is NOT the "suggested options + Other…" pattern used for
// current_stage/site_stage: 'others' is itself one of the five real, closed
// values here, not a free-text escape hatch — a lead still belongs to one of
// exactly five recognized buckets or the territory reporting this field
// exists for stops meaning anything.
//
// Adding a sixth office needs the CHECK altered too — see the "adding a
// territory later" note at the bottom of migration_office_territory.sql.
export const TERRITORY_OPTIONS = [
  { value: 'ludhiana', label: 'Ludhiana' },
  { value: 'amritsar', label: 'Amritsar' },
  { value: 'jalandhar', label: 'Jalandhar' },
  { value: 'patiala', label: 'Patiala' },
  { value: 'others', label: 'Others' },
]

export const TERRITORY_LABELS = Object.fromEntries(TERRITORY_OPTIONS.map((o) => [o.value, o.label]))

// Falls back to the raw stored value, same as stageLabel()/partyTypeLabel() —
// the column is nullable (every lead created before this field existed has no
// territory), so callers should handle null themselves rather than rely on this.
export function territoryLabel(value) {
  return TERRITORY_LABELS[value] ?? value
}
