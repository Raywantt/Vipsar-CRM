// Won orders keyed in from the owner's "Order Value without GST" sheet
// (2026-10-05, Schema/migration_import_won_orders_2026_10.sql). Marked by an
// external_reference_id of 'won-import-<order no>' — deliberately NOT the
// 'legacy-' prefix, which attention.js reads as "history missing, clamp the
// stale clock". These leads carry no such gap, so they must not inherit it.
export const WON_IMPORT_PREFIX = 'won-import-'

export function isWonImportLead(lead) {
  return typeof lead?.external_reference_id === 'string' && lead.external_reference_id.startsWith(WON_IMPORT_PREFIX)
}
