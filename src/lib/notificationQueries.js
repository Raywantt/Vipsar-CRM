import { supabase } from './supabaseClient'

// The `notifications` table (Schema/migration_lead_assignment_notifications.sql)
// is written by a Postgres trigger and nothing else — there is deliberately no
// INSERT policy and no insert helper here. This module only ever reads its own
// rows, marks them seen, and asks the Edge Function to flush pending pushes.

// How many unseen assignments the Today card will show at once. A rep who has
// been handed a batch sees the first few plus a count of the rest, rather than
// a card that can grow without limit at the top of their day.
export const ASSIGNED_CARD_LIMIT = 20

// Own rows only under RLS, so there is no employee_id filter to add here —
// but it is passed anyway and used as the cache/effect key, and to avoid
// firing at all before AuthContext has resolved who is logged in.
//
// The lead embed carries the same fields every lead-naming surface in this app
// falls back through (client name -> site nickname -> locality). It can come
// back null: if the lead was handed on again afterwards, `leads` SELECT no
// longer matches for this employee, and the card names it "Lead #id" rather
// than dropping a real notification because its subject moved.
export function fetchUnseenAssignments(employeeId) {
  if (!employeeId) return Promise.resolve({ data: [], error: null })
  return supabase
    .from('notifications')
    .select(
      'id, kind, lead_id, created_at, actor_employee_id, actor:employees!actor_employee_id(name), leads(id, current_stage, parties!party_id(name), sites(nickname, locality))'
    )
    .eq('kind', 'lead_assigned')
    .is('seen_at', null)
    .order('created_at', { ascending: false })
    .limit(ASSIGNED_CARD_LIMIT)
}

// Marking seen is separate from notified_at on purpose: a rep who has denied
// notification permission never gets a notified_at, and must still be able to
// clear the card. The two columns answer different questions.
export function markNotificationsSeen(ids) {
  if (!ids?.length) return Promise.resolve({ error: null })
  return supabase.from('notifications').update({ seen_at: new Date().toISOString() }).in('id', ids)
}

// Ask the push sender to flush pending assignment notifications RIGHT NOW,
// instead of waiting out the cron interval. Called immediately after a
// successful reassignment so the new owner's phone buzzes in about a second.
//
// THIS MUST NEVER BE ALLOWED TO FAIL A REASSIGNMENT. The lead has already
// changed hands by the time this runs; the cron is the guarantee and this is
// only the speed-up, so every failure path here is swallowed deliberately.
// The function itself is idempotent and ordered — it stamps notified_at on
// whatever it sends — so this racing the scheduled run is harmless: whichever
// arrives first does the work and the other finds nothing pending.
//
// `only: 'assignments'` keeps this from re-running the whole follow-up
// reminder sweep. A lead changing hands is no reason to re-examine every
// reminder in the company.
export async function requestAssignmentPush() {
  try {
    const { error } = await supabase.functions.invoke('send-followup-reminders', {
      body: { only: 'assignments' },
    })
    return { error: error ?? null }
  } catch (err) {
    return { error: err }
  }
}
