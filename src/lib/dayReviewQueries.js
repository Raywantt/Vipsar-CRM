import { supabase } from './supabaseClient'
import { toISODate } from './followupDates'

// Every query here is bounded to ONE calendar day. Nothing on the Day Review
// aggregates beyond that — see the Dashboard section of CLAUDE.md.
//
// RLS scopes leads/activities/lead_change_log/follow_ups to "own data or owner
// role" already, so the same queries serve both the owner (whole team) and a
// sales exec (just themselves) with no role branching here — the same pattern
// dashboardQueries.js relies on.

// A day runs midnight-to-midnight in the BROWSER's local timezone (IST for
// this app's real users), matching todayISO() and rangeForPreset() rather
// than introducing a second, competing definition of "today".
//
// The returned bounds are UTC instants. activities.created_at and
// leads.created_at are `timestamp without time zone` holding UTC wall clock
// (Postgres now() on a UTC server), and lead_change_log.changed_at is a real
// timestamptz — comparing either against these instants is correct, because
// toISOString() has already converted local midnight into the UTC moment it
// actually happened at.
export function dayBounds(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return { start, end, startISO: start.toISOString(), endISO: end.toISOString() }
}

export function nextDayISO(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + 1))
}

export function prevDayISO(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d - 1))
}

// Naming a lead follows the same client-name → site-nickname → locality
// fallback chain every other lead-naming surface in this app uses, so the
// embeds below all carry the same three fields.
const LEAD_NAME_EMBED = 'leads(id, current_stage, parties!party_id(name), sites(nickname, locality))'

// Every activity logged on D. Feeds three things at once: the Activities/
// Calls/Visits columns, the day sheet's timeline, and the "worked 9:12 am –
// 6:40 pm" span (min/max created_at) — one query rather than three.
export function fetchDayActivities({ startISO, endISO }) {
  return supabase
    .from('activities')
    .select(`id, employee_id, activity_type, notes, created_at, lead_id, party_id, parties!party_id(name), ${LEAD_NAME_EMBED}`)
    .gte('created_at', startISO)
    .lte('created_at', endISO)
    .order('created_at', { ascending: true })
}

// Field-level lead edits on D, from the table Schema/migration_lead_change_log.sql
// adds. `field <> 'created'` is NOT filtered here — the day sheet's timeline
// wants creation rows too; only the team table's Changes column excludes them
// (see dayReview.js), matching the design's own column definition.
export function fetchDayLeadChanges({ startISO, endISO }) {
  return supabase
    .from('lead_change_log')
    .select(`id, lead_id, changed_by, changed_at, field, old_value, new_value, detail, ${LEAD_NAME_EMBED}`)
    .gte('changed_at', startISO)
    .lte('changed_at', endISO)
    .order('changed_at', { ascending: true })
}

// Stage moves on D — including Won and Lost, which are stages in this app
// rather than a separate status field. Deliberately read from stage_history
// instead of duplicating stage changes into lead_change_log: this table
// already has real history going back to the start of the project, so a day
// sheet for a past date shows genuine stage movement rather than nothing.
//
// SELECT is scoped to "own leads or owner role" as of
// Schema/migration_scope_stage_history.sql; the embedded-leads null check in
// dayReview.js is kept as belt-and-braces, same as fetchStageHistoryForFunnel.
export function fetchDayStageChanges({ startISO, endISO }) {
  return supabase
    .from('stage_history')
    .select(
      'id, lead_id, stage, changed_by, changed_at, leads(id, owner_employee_id, order_value, quote_value, parties!party_id(name), sites(nickname, locality))'
    )
    .gte('changed_at', startISO)
    .lte('changed_at', endISO)
    .order('changed_at', { ascending: true })
}

// Leads created on D. created_by_employee_id (added by the same migration,
// stamped by a trigger) is the attribution — NOT owner_employee_id, which
// would re-credit every reassigned lead to whoever holds it now, retroactively
// changing a day sheet for a date before the reassignment happened.
export function fetchDayNewLeads({ startISO, endISO }) {
  return supabase
    .from('leads')
    .select(
      'id, created_by_employee_id, owner_employee_id, source_type, quote_value, order_value, current_stage, created_at, parties!party_id(name), sites(nickname, locality)'
    )
    .gte('created_at', startISO)
    .lte('created_at', endISO)
}

// Follow-ups DUE on a given date — one call serves both the Done/missed
// column (dateISO = D) and the Tomorrow column (dateISO = D + 1).
export function fetchFollowUpsDueOn(dateISO) {
  return supabase
    .from('follow_ups')
    .select(
      `id, assigned_to, created_by, party_id, lead_id, activity_type, title, notes, due_date, due_time, is_done, done_at, parties(name), ${LEAD_NAME_EMBED}`
    )
    .eq('due_date', dateISO)
    .order('due_time', { ascending: true, nullsFirst: false })
}

// Quotes sent on D. There is no `quote` activity type in this schema — a
// quote going out is recorded on the lead itself (quote_sent_at), which is a
// DATE with no time component, so these rows can be counted for the day but
// can't be placed on the day sheet's timeline. Attribution is the lead's
// owner, the only employee reference the column has.
export function fetchDayQuotesSent(dateISO) {
  return supabase
    .from('leads')
    .select('id, owner_employee_id, quote_value, quote_sent_at, parties!party_id(name), sites(nickname, locality)')
    .eq('quote_sent_at', dateISO)
}

// Everything the Day Review needs for one date, in one round of parallel
// requests. Returns the raw rows — all shaping happens in dayReview.js, which
// stays pure and testable.
export async function fetchDayReview(dateISO) {
  const bounds = dayBounds(dateISO)
  const [activities, changes, stageChanges, newLeads, followUps, tomorrowFollowUps, quotesSent] = await Promise.all([
    fetchDayActivities(bounds),
    fetchDayLeadChanges(bounds),
    fetchDayStageChanges(bounds),
    fetchDayNewLeads(bounds),
    fetchFollowUpsDueOn(dateISO),
    fetchFollowUpsDueOn(nextDayISO(dateISO)),
    fetchDayQuotesSent(dateISO),
  ])

  // lead_change_log only exists once its migration has been run. Rather than
  // failing the whole screen, surface that one query's error separately so
  // the rest of the Day Review still renders and the "Changes made to leads"
  // block can show its own honest empty state.
  const changesUnavailable = Boolean(changes.error)
  const firstError = [activities, stageChanges, newLeads, followUps, tomorrowFollowUps, quotesSent].find((r) => r.error)

  // Second round, and only when there's something to look up — the prior
  // stage of a lead that changed stage today can't be known until we know
  // which leads those are.
  const stagedLeadIds = [...new Set((stageChanges.data ?? []).map((r) => r.lead_id))]
  const priorStages = await fetchPriorStages(stagedLeadIds, bounds.startISO)

  return {
    error: firstError?.error ?? null,
    changesUnavailable,
    activities: activities.data ?? [],
    changes: changes.data ?? [],
    stageChanges: stageChanges.data ?? [],
    priorStages: priorStages.data ?? [],
    newLeads: newLeads.data ?? [],
    followUps: followUps.data ?? [],
    tomorrowFollowUps: tomorrowFollowUps.data ?? [],
    quotesSent: quotesSent.data ?? [],
  }
}

// The manager's one action inside a day sheet (decision #16 of the handoff —
// no commenting, no reassigning, no flagging). RLS on follow_ups is "own data
// or owner role", so an owner can move a rep's follow-up and a rep can move
// their own; nothing extra is needed here.
export function rescheduleFollowUp(id, dueDate) {
  return supabase.from('follow_ups').update({ due_date: dueDate }).eq('id', id).select('id, due_date').single()
}

// The stage each of these leads was at BEFORE the day started. stage_history
// only records the destination of a change, so a row saying "moved to
// Quote submission" can't show what it moved from without looking back —
// this fetches that context for the day sheet's `old chip → new chip` diff.
// Bounded to the leads that actually changed stage on D (a handful), and
// skipped entirely when there are none.
export function fetchPriorStages(leadIds, beforeISO) {
  if (!leadIds.length) return Promise.resolve({ data: [], error: null })
  return supabase
    .from('stage_history')
    .select('lead_id, stage, changed_at')
    .in('lead_id', leadIds)
    .lt('changed_at', beforeISO)
    .order('changed_at', { ascending: false })
}

// The earliest change-log row that exists, used for the honest "Change
// history starts <date>" empty state on any day before the audit trail
// shipped — rather than a zero count, which reads as "this rep changed
// nothing". Creation rows are excluded because those were backfilled for
// every pre-existing lead, so they'd wrongly date the trail to the very
// first lead ever created.
export function fetchChangeLogStart() {
  return supabase
    .from('lead_change_log')
    .select('changed_at')
    .neq('field', 'created')
    .order('changed_at', { ascending: true })
    .limit(1)
    .maybeSingle()
}
