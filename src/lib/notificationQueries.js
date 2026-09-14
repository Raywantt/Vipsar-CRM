import { supabase } from './supabaseClient'

// The `notifications` table (Schema/migration_lead_assignment_notifications.sql,
// widened by migration_lead_remarks_and_lixil_notify.sql) is written by
// Postgres triggers and nothing else — there is deliberately no INSERT
// policy and no insert helper here. This module only ever reads its own
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
//
// Two kinds share this one card (AssignedLeadsCard): 'lead_assigned'
// (reassignment) and 'lixil_lead_created' (a coordinator's Lixil
// entry-on-behalf — see Schema/migration_lead_remarks_and_lixil_notify.sql).
// They read from the same table and render in the same list; only the
// per-row wording and the remark lookup below differ by kind.
export async function fetchUnseenAssignments(employeeId) {
  if (!employeeId) return { data: [], error: null }

  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, kind, lead_id, created_at, actor_employee_id, actor:employees!actor_employee_id(name), leads(id, current_stage, parties!party_id(name), sites(nickname, locality, house_no))'
    )
    .in('kind', ['lead_assigned', 'lixil_lead_created'])
    .is('seen_at', null)
    .order('created_at', { ascending: false })
    .limit(ASSIGNED_CARD_LIMIT)

  if (error || !data?.length) return { data: data ?? [], error }

  // A 'lixil_lead_created' row carries no context of its own (same
  // no-pre-baked-text rule as the rest of this table) — the coordinator's
  // call notes live as this lead's first lead_remarks row instead. Fetched
  // here as a second, bounded query rather than an embed: lead_remarks has
  // no FK notifications can traverse (it points at leads, not at this
  // table), so there is nothing to embed in the first place. Oldest-first
  // + first-per-lead-wins is this codebase's standard way to pick "the
  // earliest one" out of a set sharing a lead_id — see fetchAllRows's own
  // notes on the same reduction.
  const lixilLeadIds = data.filter((n) => n.kind === 'lixil_lead_created' && n.lead_id).map((n) => n.lead_id)
  if (!lixilLeadIds.length) return { data, error: null }

  const { data: remarkRows } = await supabase
    .from('lead_remarks')
    .select('lead_id, body, created_at')
    .in('lead_id', lixilLeadIds)
    .order('created_at', { ascending: true })

  const firstRemarkByLead = new Map()
  for (const r of remarkRows ?? []) {
    if (!firstRemarkByLead.has(r.lead_id)) firstRemarkByLead.set(r.lead_id, r.body)
  }

  return {
    data: data.map((n) => ({ ...n, remark: firstRemarkByLead.get(n.lead_id) ?? null })),
    error: null,
  }
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
// successful reassignment (LeadQuickActions) or a Lixil entry-on-behalf save
// (LeadQuickCapture) so the new owner's phone buzzes in about a second — the
// Edge Function's drainAssignments() already handles both kinds it can find
// pending, so no `kind` needs passing through here.
//
// THIS MUST NEVER BE ALLOWED TO FAIL THE SAVE IT FOLLOWS. The lead has
// already been created/reassigned by the time this runs; the cron is the
// guarantee and this is only the speed-up, so every failure path here is
// swallowed deliberately.
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
