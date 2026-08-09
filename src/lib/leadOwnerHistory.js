import { supabase } from './supabaseClient'

// lead_owner_history is append-only, same shape/RLS as stage_history (see
// Schema/tostem_crm_schema.sql and Schema/rls_policies.sql).
export function fetchLeadOwnerHistory(leadId) {
  return supabase
    .from('lead_owner_history')
    .select('id, lead_id, old_owner_id, new_owner_id, changed_at, changed_by, old:employees!old_owner_id(name), new:employees!new_owner_id(name), changed_by_employee:employees!changed_by(name)')
    .eq('lead_id', leadId)
    .order('changed_at', { ascending: true })
}

export function insertLeadOwnerHistory({ leadId, oldOwnerId, newOwnerId, changedBy }) {
  return supabase
    .from('lead_owner_history')
    .insert({ lead_id: leadId, old_owner_id: oldOwnerId ?? null, new_owner_id: newOwnerId, changed_by: changedBy ?? null })
    .select('id, lead_id, old_owner_id, new_owner_id, changed_at, changed_by, old:employees!old_owner_id(name), new:employees!new_owner_id(name), changed_by_employee:employees!changed_by(name)')
    .single()
}
