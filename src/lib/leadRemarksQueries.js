import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'

// A running, append-only log of free-text remarks against a lead — separate
// from `activities` (records something that happened, on a date) and
// `lead_change_log` (a value-edit audit trail). A remark is neither: it's
// context one person wants the next person who opens this lead to have,
// with nowhere else in the app to carry it. See
// Schema/migration_lead_remarks_and_lixil_notify.sql. No update/delete
// anywhere — same append-only shape as stage_history/lead_owner_history/
// loss_reasons. A correction is a new remark, not an edit to an old one.

// Append-only with no per-lead cap, so paged like every other multi-row read.
// The `id` tiebreaker runs descending to match the newest-first display:
// remarks sharing a timestamp still list the later-inserted one on top, the
// same order LeadRemarks gives a freshly saved remark by prepending it.
export function fetchRemarksForLead(leadId) {
  return fetchAllRows(
    () =>
      supabase
        .from('lead_remarks')
        .select('id, body, created_at, employee_id, employees(name)', { count: 'exact' })
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
    { ascending: false }
  )
}

// `.select()` on the insert is safe under RLS here (unlike the trap
// CLAUDE.md warns about elsewhere): lead_remarks' own SELECT policy just
// re-checks leads' visibility, and whoever passed the INSERT policy's
// canEdit check could already see the lead.
export function createRemark({ leadId, employeeId, body }) {
  return supabase
    .from('lead_remarks')
    .insert({ lead_id: leadId, employee_id: employeeId, body })
    .select('id, body, created_at, employee_id, employees(name)')
    .single()
}
