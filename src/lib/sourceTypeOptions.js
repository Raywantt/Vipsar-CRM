// Canonical list — kept in sync with leads.source_type's CHECK constraint in
// Schema/tostem_crm_schema.sql. LeadQuickCapture only surfaces a 3-value subset
// (scanning/lixil/referral_architect) deliberately; the dashboard needs all 5
// since referral_other/showroom_walkin leads can still exist in the data.
export const SOURCE_TYPE_OPTIONS = [
  { value: 'scanning', label: 'Scanning' },
  { value: 'lixil', label: 'Lixil' },
  { value: 'referral_architect', label: 'Referral (Architect)' },
  { value: 'referral_other', label: 'Referral (Other)' },
  { value: 'showroom_walkin', label: 'Showroom Walk-in' },
]

export const SOURCE_TYPE_LABELS = Object.fromEntries(SOURCE_TYPE_OPTIONS.map((o) => [o.value, o.label]))
