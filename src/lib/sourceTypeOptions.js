// Canonical list — kept in sync with leads.source_type's CHECK constraint in
// Schema/tostem_crm_schema.sql, and the one place a source's display text is
// defined (LeadDetail imports these rather than keeping its own copy).
//
// All five are pickable at capture. showroom_walkin used to be filtered out of
// that screen — it exists in older data and on the dashboard, but nothing
// wrote it — and was reinstated as "Walk-in" when the owner asked for a
// walk-in source, rather than adding a sixth value that would have meant the
// same thing and split the reporting in two.
//
// The two referral values are a real split, not a naming detail: a referral
// that comes from an architect is tracked separately from every other kind
// (a client sending a neighbour, a builder passing a job along), because the
// architect relationship is worth reporting on by itself. referral_architect
// additionally captures the architect's firm — see LeadQuickCapture.
export const SOURCE_TYPE_OPTIONS = [
  { value: 'scanning', label: 'Scanning' },
  { value: 'lixil', label: 'Lixil' },
  { value: 'referral_other', label: 'Referral' },
  { value: 'referral_architect', label: 'Architect referral' },
  { value: 'showroom_walkin', label: 'Walk-in' },
]

export const SOURCE_TYPE_LABELS = Object.fromEntries(SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]))
