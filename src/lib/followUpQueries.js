import { supabase } from './supabaseClient'
import { toISODate } from './followupDates'

// created_by is embedded via an explicit FK hint — follow_ups has two FKs to
// employees (assigned_to, created_by), same "more than one relationship"
// ambiguity LeadSearchSelect already works around for leads -> parties.
const FOLLOW_UP_SELECT =
  'id, assigned_to, created_by, party_id, lead_id, activity_type, title, notes, due_date, due_time, is_done, done_at, created_at, parties(name), created_by_employee:employees!created_by(name)'

// Every follow-up assigned to this employee, done or not — used by
// EmployeeProfile's Follow-ups card, which reviews the full history.
export function fetchFollowUpsForEmployee(employeeId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('assigned_to', employeeId)
    .order('is_done', { ascending: true })
    .order('due_date', { ascending: true })
}

// Not-done, due today or overdue — used by Home's "Your reminders" card.
export function fetchDueFollowUpsForEmployee(employeeId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('assigned_to', employeeId)
    .eq('is_done', false)
    .lte('due_date', toISODate(new Date()))
    .order('due_date', { ascending: true })
}

// Most recent not-done follow-up tied to this lead — used by LeadDetail to
// surface an On Hold action's reason (stored as this row's notes) without
// waiting for the push reminder to fire.
export function fetchLatestFollowUpForLead(leadId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('lead_id', leadId)
    .eq('is_done', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
}

export function createFollowUp({ assignedTo, createdBy, partyId, leadId, activityType, title, notes, dueDate, dueTime }) {
  return supabase
    .from('follow_ups')
    .insert({
      assigned_to: assignedTo,
      created_by: createdBy,
      party_id: partyId || null,
      lead_id: leadId || null,
      activity_type: activityType || null,
      title,
      notes: notes || null,
      due_date: dueDate,
      due_time: dueTime || null,
    })
    .select(FOLLOW_UP_SELECT)
    .single()
}

export function markFollowUpDone(id) {
  return supabase
    .from('follow_ups')
    .update({ is_done: true, done_at: new Date().toISOString() })
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
}
