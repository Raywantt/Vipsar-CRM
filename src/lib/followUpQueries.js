import { supabase } from './supabaseClient'
import { todayISO } from './followupDates'

// THE one module that reads or writes follow_ups. See FOLLOWUPS.md (repo
// root) for the rules this implements; rule numbers below refer to it.
//
// Two things changed shape in the 2026-08-21 rebuild and are worth knowing
// before editing anything here:
//
//   * `status` ('open' | 'done' | 'cancelled') replaced the is_done boolean
//     as the source of truth (Rule 2.1). `is_done` still exists as a column
//     but is now DERIVED from status by a database trigger — never write it,
//     and prefer reading `status` so a cancelled row can't be mistaken for a
//     completed one (Rule 2.2: cancelled NEVER counts as done).
//
//   * `leads.next_followup_date` is now strictly derived (Rule 1.2) — the
//     earliest due date among a lead's OPEN follow-ups, maintained by a
//     trigger. NOTHING here writes it, and nothing anywhere else may either.
//     Hand-syncing that column from app code is exactly what produced the
//     78% orphan rate this rebuild exists to fix.
//
// created_by is embedded via an explicit FK hint — follow_ups has two FKs to
// employees (assigned_to, created_by), the same "more than one relationship"
// ambiguity LeadSearchSelect already works around for leads -> parties.
//
// The `leads(...)` embed (one FK, lead_id, so no hint needed on this side —
// but `parties!party_id` inside it still is, since leads has three FKs to
// parties) is what lets a row name the linked lead. `mobile` rides along on
// both party embeds so a reminder can offer a real tel: link without a
// second lookup.
//
// ⚠️ RLS caveat, verified live: a rep's parties/sites SELECT is scoped to
// their own leads, so a reminder assigned to them on a lead they do NOT own
// resolves these embeds to null — PostgREST returns null for an unreadable
// embed rather than erroring. Callers must tolerate a null `leads`/`parties`
// on a row that legitimately has a lead_id. Don't "fix" it by dropping the
// embed; the fallback chain in followUpLabel handles it.
const FOLLOW_UP_SELECT =
  'id, assigned_to, created_by, party_id, lead_id, activity_type, title, notes, ' +
  'due_date, due_time, status, is_done, done_at, cancelled_at, cancel_reason, ' +
  'completed_by_activity_id, created_at, ' +
  'parties(name, mobile), ' +
  'leads(id, current_stage, parties!party_id(name, mobile), sites(nickname, locality)), ' +
  'created_by_employee:employees!created_by(name), ' +
  'assigned_to_employee:employees!assigned_to(name)'

export const FOLLOW_UP_OPEN = 'open'
export const FOLLOW_UP_DONE = 'done'
export const FOLLOW_UP_CANCELLED = 'cancelled'

// Rule 2.3 — "missed" is derived, never stored: past its due date and still
// open. Rule 2.4 — a reminder due TODAY is pending, not missed, until the day
// is over.
//
// Compared as YYYY-MM-DD strings on both sides. due_date is a DATE column and
// `new Date(col) < Date.now()` parses it as UTC midnight = 05:30 IST, which
// reported anything due today as overdue for ~18 hours a day (Phase 9's
// F-P7-1). String order is date order and there is no timezone to get wrong.
export function isMissed(f) {
  return f.status === FOLLOW_UP_OPEN && f.due_date < todayISO()
}

export function isDueToday(f) {
  return f.status === FOLLOW_UP_OPEN && f.due_date === todayISO()
}

// ---------- reads ----------

// Every follow-up assigned to this employee, any status. Callers filter.
export function fetchFollowUpsForEmployee(employeeId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('assigned_to', employeeId)
    .order('status', { ascending: true })
    .order('due_date', { ascending: true })
}

// Open, due today or overdue — the rep's "what do I owe right now" list.
export function fetchDueFollowUpsForEmployee(employeeId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('assigned_to', employeeId)
    .eq('status', FOLLOW_UP_OPEN)
    .lte('due_date', todayISO())
    .order('due_date', { ascending: true })
}

// Every open follow-up on a lead. A lead may carry several at once now
// (Rule 3.1), so this replaces the old fetchLatestFollowUpForLead, which
// returned only the single most recent and filtered on is_done — the reason
// completing an on-hold reminder used to erase the lead's hold reason from
// the screen.
export function fetchFollowUpsForLead(leadId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('lead_id', leadId)
    .order('status', { ascending: true })
    .order('due_date', { ascending: true })
}

// Rule 5.5 — an assigner can always see the outcome of what they assigned.
// Nothing in the app queried by created_by before this.
export function fetchFollowUpsAssignedBy(employeeId) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('created_by', employeeId)
    .neq('assigned_to', employeeId)
    .order('due_date', { ascending: true })
}

// Team-wide, for the owner/coordinator oversight view. RLS does the scoping:
// an owner sees everything, a coordinator sees their own team, a rep sees
// only themselves — so this needs no role branch of its own.
export function fetchFollowUpsInRange(startISO, endISO) {
  return supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .gte('due_date', startISO)
    .lte('due_date', endISO)
    .order('due_date', { ascending: true })
}

// The audit trail (Rule 10.2). Read-only — the table is trigger-written and
// has no INSERT/UPDATE/DELETE grant for anyone.
export function fetchFollowUpHistory(followUpId) {
  return supabase
    .from('follow_up_change_log')
    .select('id, field, old_value, new_value, changed_at, changed_by, employees!changed_by(name)')
    .eq('follow_up_id', followUpId)
    .order('changed_at', { ascending: false })
}

// ---------- writes ----------

// The ONLY way a follow-up is created. Every entry point in the app routes
// here — there is no second mechanism, and no caller may stamp
// leads.next_followup_date alongside it (Rule 1.2; the trigger does that).
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
      status: FOLLOW_UP_OPEN,
    })
    .select(FOLLOW_UP_SELECT)
    .single()
}

// Rule 4.2 — `activityId` records WHICH activity closed this follow-up, which
// is what makes "did they actually do it?" answerable. Rule 4.4 allows
// closing without one (the visible "just mark done" shortcut), so it stays
// optional — but pass it whenever an activity was logged.
//
// done_at is stamped by the database trigger, not here, so it can never
// disagree with the status it describes.
export function markFollowUpDone(id, activityId = null) {
  return supabase
    .from('follow_ups')
    .update({ status: FOLLOW_UP_DONE, completed_by_activity_id: activityId })
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
}

// Rule 2.1 — the third state. A reason is REQUIRED, enforced by a CHECK
// constraint as well as here, so an empty one fails at the database rather
// than quietly recording a cancellation nobody can explain later.
export function cancelFollowUp(id, reason) {
  return supabase
    .from('follow_ups')
    .update({ status: FOLLOW_UP_CANCELLED, cancel_reason: reason })
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
}

// Reopen a closed follow-up. The trigger clears done_at / cancelled_at /
// cancel_reason / completed_by_activity_id on the way, so a reopened row
// carries no stale proof of a completion that was undone.
export function reopenFollowUp(id) {
  return supabase
    .from('follow_ups')
    .update({ status: FOLLOW_UP_OPEN })
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
}

// Moved here from dayReviewQueries.js — a reschedule is a follow-up
// operation, and having it live next to the Day Review's fetches is how it
// ended up as the one write path nobody kept in step with anything else.
//
// It no longer needs to clear notified_at itself: the database trigger does
// that on any due_date change, so every reschedule path is covered including
// ones not written yet. Before the rebuild this was THE worst bug in the
// feature — moving an already-notified reminder forward removed it from the
// push pipeline permanently, while it still looked live on every screen.
export function rescheduleFollowUp(id, dueDate) {
  return supabase
    .from('follow_ups')
    .update({ due_date: dueDate })
    .eq('id', id)
    .select(FOLLOW_UP_SELECT)
    .single()
}

// Rule 5.3 — the assignee may change date and notes; the assigner may change
// anything while it is open. The split is enforced by the caller (it needs to
// know who is looking), not here: RLS is row-level, not column-level, so the
// database cannot express "this person may edit only these fields".
export function updateFollowUp(id, fields) {
  const patch = {}
  if ('title' in fields) patch.title = fields.title
  if ('notes' in fields) patch.notes = fields.notes || null
  if ('dueDate' in fields) patch.due_date = fields.dueDate
  if ('dueTime' in fields) patch.due_time = fields.dueTime || null
  if ('activityType' in fields) patch.activity_type = fields.activityType || null
  return supabase.from('follow_ups').update(patch).eq('id', id).select(FOLLOW_UP_SELECT).single()
}
