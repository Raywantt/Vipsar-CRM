import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { requestAssignmentPush } from './notificationQueries'

// lead_owner_history is append-only, same shape/RLS as stage_history (see
// Schema/tostem_crm_schema.sql and Schema/rls_policies.sql).
export function fetchLeadOwnerHistory(leadId) {
  return fetchAllRows(() =>
    supabase
      .from('lead_owner_history')
      .select(
        'id, lead_id, old_owner_id, new_owner_id, changed_at, changed_by, old:employees!old_owner_id(name), new:employees!new_owner_id(name), changed_by_employee:employees!changed_by(name)',
        { count: 'exact' }
      )
      .eq('lead_id', leadId)
      .order('changed_at', { ascending: true })
  )
}

export function insertLeadOwnerHistory({ leadId, oldOwnerId, newOwnerId, changedBy }) {
  return supabase
    .from('lead_owner_history')
    .insert({ lead_id: leadId, old_owner_id: oldOwnerId ?? null, new_owner_id: newOwnerId, changed_by: changedBy ?? null })
    .select('id, lead_id, old_owner_id, new_owner_id, changed_at, changed_by, old:employees!old_owner_id(name), new:employees!new_owner_id(name), changed_by_employee:employees!changed_by(name)')
    .single()
}

// THE one write for "this lead now belongs to someone else" — Lead Detail's
// Reassign owner and the owner's BDM pool card both call it, so the two can't
// drift into different rules (the same drift that once cost a coordinator
// their desktop nav). Three steps, in this order:
//
//   1. UPDATE leads.owner_employee_id, with .select().single() — an
//      RLS-refused UPDATE matches zero rows and would otherwise "succeed"
//      silently; .single() turns that into a real error.
//   2. Ask the push sender to flush now (never awaited — the database
//      triggers already wrote every notification inside step 1: the new
//      owner's 'lead_assigned', and for a pool lead the BDM's
//      'bdm_lead_assigned'; the cron is the guarantee, this is the speed-up).
//   3. Append lead_owner_history. Independent of step 1: a failed history
//      row still leaves the lead reassigned, and comes back as historyError
//      for the caller to warn about rather than roll back.
//
// `requireUnassigned` (the pool card): only write if the lead is still
// ownerless. Two owners looking at the same pool is normal here (three are
// active), and without it the second click would silently re-assign a lead
// the first owner had just handed out — with a history row claiming it came
// from nobody. The guarded UPDATE matches zero rows instead, and .single()
// reports that as PGRST116 (see ALREADY_ASSIGNED_CODE).
//
// Returns { data: updatedLead, historyRow, historyError } or { error }.
export const ALREADY_ASSIGNED_CODE = 'PGRST116'

export async function assignLeadOwner({
  leadId,
  oldOwnerId,
  newOwnerId,
  changedBy,
  select = 'id, owner_employee_id',
  requireUnassigned = false,
}) {
  let query = supabase.from('leads').update({ owner_employee_id: newOwnerId }).eq('id', leadId)
  if (requireUnassigned) query = query.is('owner_employee_id', null)
  const { data: updatedLead, error } = await query.select(select).single()
  if (error) return { error }

  requestAssignmentPush()

  const { data: historyRow, error: historyError } = await insertLeadOwnerHistory({
    leadId,
    oldOwnerId,
    newOwnerId,
    changedBy,
  })
  return { data: updatedLead, historyRow: historyError ? null : historyRow, historyError: historyError ?? null }
}
