import { supabase } from './supabaseClient'
import { todayISO } from './followupDates'
import { fetchAllRows } from './fetchAllRows'
import { formatDateShort } from './format'
import { canLogActivity, logsActivityOnBehalf } from './roles'

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
  'parties(name, mobile, party_type), ' +
  'leads(id, current_stage, bdm_employee_id, parties!party_id(name, mobile), sites(nickname, locality, house_no)), ' +
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

// A reminder to meet an architect again (BDM.md Step 7): anchored on an
// architect or architect-firm party with no lead. Read off the party's own
// type, not activity_type — Architect Meeting follow-ups were saved as 'other'
// before 2026-09-15, and they are the same thing.
export function isArchitectFollowUp(f) {
  return !f.lead_id && Boolean(f.party_id) && ['architect', 'firm'].includes(f.parties?.party_type)
}

// Where "Log activity & close" goes — THE one builder; Home, BdmToday,
// FollowUpsCard, My Architects and the architect profile all navigate here.
// A lead reminder pre-picks its lead; an architect reminder pre-picks
// Architect Meeting and the architect. Anything else has no activity to log
// against it, so null (the button isn't offered).
export function logActivityPathFor(f) {
  if (f.lead_id) {
    const params = new URLSearchParams({ lead: String(f.lead_id), followup: String(f.id) })
    if (f.activity_type && f.activity_type !== 'other') params.set('type', f.activity_type)
    return `/activity?${params.toString()}`
  }
  if (isArchitectFollowUp(f)) {
    const params = new URLSearchParams({ type: 'architect_meeting', party: String(f.party_id), followup: String(f.id) })
    return `/activity?${params.toString()}`
  }
  return null
}

// Whether "Log activity & close" is offered to this viewer on this row. The
// activity is credited to whoever logs it, so a viewer may only close a
// reminder that is theirs — except a coordinator, whose Log Activity logs in
// the exec's name. Without the assignee test a manager on the team list
// closed a rep's reminder with an activity credited to the manager.
export function canCloseByLogging(viewer, f) {
  if (!viewer || !canLogActivity(viewer.role)) return false
  return f.assigned_to === viewer.id || logsActivityOnBehalf(viewer.role)
}

// The owner's ruling (2026-09-16): a reminder someone else assigned can't be
// cancelled by the person it was assigned to. The database enforces the same
// rule (Schema/migration_followups_cancel_rules.sql); this only hides the button.
export function isCancelBlockedForViewer(viewerId, f) {
  return viewerId != null && f.assigned_to === viewerId && f.created_by != null && f.created_by !== f.assigned_to
}

// Rule 8.2 — an on-hold lead always carries a live "On hold" reminder, and it
// must never be cancellable: cancelling it would leave a paused lead with no
// working reminder at all and no way back onto anyone's radar. Read off the
// embedded lead's own current_stage, which FOLLOW_UP_SELECT always carries,
// so no caller needs a second query. Same identifying test as LeadDetail's
// own `holdReview` and the cancel_follow_ups_on_lead_close() trigger — change
// one, change all three.
export function isHoldReviewFollowUp(f) {
  return (
    f.leads?.current_stage === 'on_hold' &&
    f.activity_type === 'other' &&
    typeof f.title === 'string' &&
    f.title.startsWith('On hold')
  )
}

// FollowUpList's `lockedIds` prop, built from whatever list a caller already
// has. Was never supplied by any caller — a hold review could be cancelled
// by hand from every follow-up list in the app despite the rule above.
export function lockedFollowUpIds(followUps) {
  return new Set(followUps.filter(isHoldReviewFollowUp).map((f) => f.id))
}

// Open first, then done, then cancelled; soonest due first within each.
const STATUS_RANK = { open: 0, done: 1, cancelled: 2 }
export function compareFollowUps(a, b) {
  const rank = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)
  if (rank !== 0) return rank
  if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  return a.id - b.id
}

// Said after a save by any list that won't show the new row — Today lists only
// what's due now, and a team panel lists none of the assignee's reminders.
export function reminderSavedMessage(row, assigneeName = null) {
  const when = formatDateShort(row.due_date)
  if (assigneeName) return `Reminder assigned to ${assigneeName} for ${when}.`
  if (row.due_date <= todayISO()) return 'Reminder saved.'
  return `Reminder saved for ${when}. It will show here on the day.`
}

// ---------- reads ----------

// Every follow-up assigned to this employee, any status. Callers filter.
//
// status DESCENDING is deliberate: the values sort alphabetically, so
// ascending put cancelled and done ahead of open and buried the live reminders
// behind "+N more". Descending is open → done → cancelled (compareFollowUps).
export function fetchFollowUpsForEmployee(employeeId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('assigned_to', employeeId)
      .order('status', { ascending: false })
      .order('due_date', { ascending: true })
  )
}

// Open, due today or overdue — the rep's "what do I owe right now" list.
export function fetchDueFollowUpsForEmployee(employeeId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('assigned_to', employeeId)
      .eq('status', FOLLOW_UP_OPEN)
      .lte('due_date', todayISO())
      .order('due_date', { ascending: true })
  )
}

// Every open follow-up on a lead. A lead may carry several at once now
// (Rule 3.1), so this replaces the old fetchLatestFollowUpForLead, which
// returned only the single most recent and filtered on is_done — the reason
// completing an on-hold reminder used to erase the lead's hold reason from
// the screen.
export function fetchFollowUpsForLead(leadId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('lead_id', leadId)
      .order('status', { ascending: false })
      .order('due_date', { ascending: true })
  )
}

// Open architect follow-ups assigned to this employee, any due date — the
// agenda on My Architects. The lead-less, party-anchored rows are few, so the
// architect test runs client-side through isArchitectFollowUp rather than an
// !inner embed filter (the same rule the list's own button reads).
export async function fetchOpenArchitectFollowUpsForEmployee(employeeId) {
  const res = await fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('assigned_to', employeeId)
      .eq('status', FOLLOW_UP_OPEN)
      .is('lead_id', null)
      .not('party_id', 'is', null)
      .order('due_date', { ascending: true })
  )
  return { data: (res.data ?? []).filter(isArchitectFollowUp), error: res.error }
}

// Open follow-ups with one architect, whoever they're assigned to — RLS
// decides (own rows; the owner sees everyone's).
export function fetchOpenFollowUpsForParty(partyId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('party_id', partyId)
      .eq('status', FOLLOW_UP_OPEN)
      .is('lead_id', null)
      .order('due_date', { ascending: true })
  )
}

// Rule 5.5 — an assigner can always see the outcome of what they assigned.
// Nothing in the app queried by created_by before this.
export function fetchFollowUpsAssignedBy(employeeId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .eq('created_by', employeeId)
      .neq('assigned_to', employeeId)
      .order('due_date', { ascending: true })
  )
}

// Team-wide, for the owner/coordinator oversight view. RLS does the scoping:
// an owner sees everything, a coordinator sees their own team, a rep sees
// only themselves — so this needs no role branch of its own.
export function fetchFollowUpsInRange(startISO, endISO) {
  return fetchAllRows(() =>
    supabase
      .from('follow_ups')
      .select(FOLLOW_UP_SELECT, { count: 'exact' })
      .gte('due_date', startISO)
      .lte('due_date', endISO)
      .order('due_date', { ascending: true })
  )
}

// The audit trail (Rule 10.2). Read-only — the table is trigger-written and
// has no INSERT/UPDATE/DELETE grant for anyone.
export function fetchFollowUpHistory(followUpId) {
  return fetchAllRows(() =>
    supabase
      .from('follow_up_change_log')
      .select('id, field, old_value, new_value, changed_at, changed_by, employees!changed_by(name)', {
        count: 'exact',
      })
      .eq('follow_up_id', followUpId)
      .order('changed_at', { ascending: false })
  )
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
//
// `onlyIfAssignedTo` makes the close conditional on who holds the reminder;
// it then resolves `data: null` (not an error) when the row belongs to
// someone else, so the caller can say so.
export function markFollowUpDone(id, activityId = null, onlyIfAssignedTo = null) {
  let query = supabase
    .from('follow_ups')
    .update({ status: FOLLOW_UP_DONE, completed_by_activity_id: activityId })
    .eq('id', id)
  if (onlyIfAssignedTo != null) {
    return query.eq('assigned_to', onlyIfAssignedTo).select(FOLLOW_UP_SELECT).maybeSingle()
  }
  return query.select(FOLLOW_UP_SELECT).single()
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
