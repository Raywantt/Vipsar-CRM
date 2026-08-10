import { supabase } from './supabaseClient'
import { toISODate } from './followupDates'

// created_by is embedded via an explicit FK hint — follow_ups has two FKs to
// employees (assigned_to, created_by), same "more than one relationship"
// ambiguity LeadSearchSelect already works around for leads -> parties.
//
// The `leads(...)` embed (one FK, lead_id, so no hint needed on this side —
// but `parties!party_id` inside it still is, since leads has three FKs to
// parties) is what lets FollowUpList name the linked lead. Without it a
// reminder could only ever show its party's name, so one linked to a lead
// with no party row — or created before the form asked for a lead at all —
// rendered with no visible link whatsoever.
// `mobile` rides along on both party embeds so Today's "Still to do" cards
// can offer a real tel: link on an open reminder without a second lookup.
const FOLLOW_UP_SELECT =
  'id, assigned_to, created_by, party_id, lead_id, activity_type, title, notes, due_date, due_time, is_done, done_at, created_at, parties(name, mobile), leads(id, current_stage, parties!party_id(name, mobile), sites(nickname, locality)), created_by_employee:employees!created_by(name)'

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
