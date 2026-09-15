// The push sender. Runs on a schedule (see the Cron Jobs setup in the deploy
// hand-off) and does two independent jobs:
//
//   1. FOLLOW-UP REMINDERS — follow_ups that are due and still open.
//   2. LEAD ASSIGNMENTS — notifications rows the lead_assignment_notification
//      trigger wrote when a lead changed hands (2026-09-12). See
//      Schema/migration_lead_assignment_notifications.sql.
//
// ⚠️ THE NAME IS NOW WRONG AND THAT IS DELIBERATE. This function is really
// "send-notifications", but renaming it changes the invoke URL, which would
// silently break the already-configured cron job — a scheduled POST to a
// 404 fails quietly and reminders simply stop. One function also means the
// assignment feature needed NO new cron schedule set up. Read the name as
// historical.
//
// Uses the service_role key so it bypasses RLS entirely: this is the one
// place in the app that is allowed to read/write across every employee's
// rows, since a cron job has no auth.uid() of its own to satisfy the
// "own data or owner role" policies everything else in this app uses.
//
// ⚠️ REDEPLOY THIS after running Schema/migration_followups_rebuild.sql.
// It now filters on status='open' rather than is_done=false, because a
// CANCELLED follow-up has is_done=false too (cancelled never counts as done —
// FOLLOWUPS.md Rule 2.2) and the old filter would have kept notifying about
// reminders that were explicitly called off.
//
// Three bugs were fixed here in the 2026-08-21 rebuild; see the comments at
// each site: the failed-send stamp, the unbounded fetch, and the
// once-only-forever notification.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT')

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

// due_date/due_time have no timezone (same as every other date column in
// this schema) — VIPSAR is an India-based dealership (the app's own date
// formatting is en-IN throughout), so due instants are computed as IST
// (UTC+5:30) explicitly. A follow-up with no due_time defaults to 09:00 IST.
const IST_OFFSET = '+05:30'
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DEFAULT_DUE_TIME = '09:00:00'

// One run never sends more than this many assignment pushes. A bulk
// reassignment done without SET LOCAL app.skip_assignment_notifications
// (see the migration) would otherwise fire one push per lead in a single
// burst; the cap turns that into a slow trickle somebody can notice and
// stop, rather than a phone that will not stop buzzing.
const ASSIGNMENT_BATCH_LIMIT = 50

// BDM pool (BDM.md Step 3). A lead a business development manager sent to the
// owner that is still unassigned after this long gets ONE extra push to every
// active owner (owner's ruling: a push, not a red label on the card). Must
// match POOL_NUDGE_HOURS in src/lib/poolLeads.js, which this runtime can't
// import.
const POOL_NUDGE_HOURS = 24

// Every kind the assignment drain pushes. The four bdm_* kinds are written by
// bdm_leads_after_write() (Schema/migration_bdm_role.sql); bdm_pool_nudge by
// queuePoolNudges() below.
const ASSIGNMENT_KINDS = [
  'lead_assigned',
  'lixil_lead_created',
  'bdm_pool_lead',
  'bdm_pool_nudge',
  'bdm_lead_assigned',
  'bdm_lead_won',
  'bdm_lead_lost',
]
const POOL_KINDS = new Set(['bdm_pool_lead', 'bdm_pool_nudge'])

// src/lib/lossReasonOptions.js's labels, for a "your lead was lost" push.
const LOSS_REASON_LABELS = {
  price: 'Price',
  competitor: 'Lost to a competitor',
  timeline: 'Timeline',
  budget_cut: 'Budget cut',
  site_delay: 'Site delayed',
  other: 'Other',
}

// CORS. The cron calls this server-to-server and never needed it, but the
// browser does: LeadQuickActions invokes this straight after a reassignment
// to make the new owner's phone buzz immediately, and supabase-js sends an
// Authorization header, which makes that a cross-origin request the browser
// PREFLIGHTS with OPTIONS first. Without these headers the preflight is
// rejected and the call never happens — found live, as
// "Response to preflight request doesn't pass access control check".
//
// It failed safe, which is the design working: the instant path is only a
// speed-up, so the scheduled run still delivered everything a few minutes
// later. That is why this was a delay rather than a lost notification.
//
// Origin '*' is deliberate and not a hole. The function verifies a JWT, so a
// random page cannot call it, and even a caller holding one can only ask it
// to flush notifications that a database trigger already decided to create —
// there is no way to make it send anything of the caller's choosing. The
// alternative, pinning an allow-list, would mean editing this file for every
// dev port and preview URL the app is ever served from.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function isDue(followUp, now) {
  const timePart = followUp.due_time ?? DEFAULT_DUE_TIME
  const dueInstant = new Date(`${followUp.due_date}T${timePart}${IST_OFFSET}`)
  return dueInstant <= now
}

// Today's date in IST as YYYY-MM-DD. Used both to bound the fetch and to
// decide whether a reminder has already been nagged about *today*.
function istToday(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

// FOLLOWUPS.md Rule: an overdue reminder nags every morning until it is
// dealt with. So the question is no longer "has this ever been notified?"
// but "has it been notified since IST midnight today?".
//
// This also structurally fixes the worst bug the audit found. The old filter
// was `.is('notified_at', null)`, and rescheduling only wrote due_date — so
// moving an already-fired reminder to a future date removed it from the push
// pipeline PERMANENTLY while it still looked live on every screen. Comparing
// against today instead of null means a rescheduled reminder simply becomes
// eligible again when its new date arrives. (The database trigger also clears
// notified_at on any due_date change, so this is belt and braces.)
function alreadyNotifiedToday(followUp, now) {
  if (!followUp.notified_at) return false
  // notified_at is a naive TIMESTAMP holding a UTC wall clock — the schema's
  // documented shape. Append Z so it isn't parsed as local time.
  const stamped = new Date(`${followUp.notified_at.replace(' ', 'T')}Z`)
  return new Date(stamped.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) === istToday(now)
}

// Group subscriptions by employee, so one employee with three devices is one
// lookup rather than three.
function groupSubscriptions(subs) {
  const byEmployee = new Map()
  for (const s of subs ?? []) {
    if (!byEmployee.has(s.employee_id)) byEmployee.set(s.employee_id, [])
    byEmployee.get(s.employee_id).push(s)
  }
  return byEmployee
}

async function fetchSubscriptionsFor(supabase, employeeIds) {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('id, employee_id, endpoint, p256dh, auth')
    .in('employee_id', employeeIds)
  return groupSubscriptions(data)
}

// Returns how many devices accepted the push (0 = nothing went out, which is
// what the caller tests before stamping notified_at). Dead endpoints
// (404/410) are collected into deadEndpoints for the caller to prune.
async function pushToDevices(subscriptions, payload, deadEndpoints) {
  let sent = 0
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      sent++
    } catch (err) {
      // 404/410 = the subscription is dead (browser data cleared, device
      // unsubscribed elsewhere, etc.) — prune it so future runs stop
      // wasting a request on it.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(sub.endpoint)
      }
    }
  }
  return sent
}

async function pruneDeadEndpoints(supabase, deadEndpoints) {
  if (deadEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }
}

// The same client-name -> site-nickname -> locality fallback chain every
// lead-naming surface in the app uses, so a push says the same thing the
// screen it links to says.
function leadName(lead) {
  return (
    lead?.parties?.name ||
    lead?.sites?.nickname ||
    lead?.sites?.locality ||
    (lead?.id ? `Lead #${lead.id}` : 'a lead')
  )
}

// ---------------------------------------------------------------------------
// JOB 1: follow-up reminders (unchanged behaviour)
// ---------------------------------------------------------------------------
async function drainFollowUps(supabase, now) {
  // Bounded and ordered. The old query had no due_date predicate and no
  // .order(), so every run downloaded every open unnotified follow-up
  // including ones due months out — and PostgREST's max_rows = 1000 would
  // eventually truncate it, arbitrarily, with reminders silently vanishing
  // and no error anywhere. `lte(due_date, today IST)` also lets the partial
  // index actually serve a seek rather than only its WHERE clause helping.
  const { data: candidates, error: fetchError } = await supabase
    .from('follow_ups')
    .select('id, assigned_to, title, notes, due_date, due_time, notified_at, lead_id, parties(name)')
    .eq('status', 'open')
    .lte('due_date', istToday(now))
    .order('due_date', { ascending: true })

  if (fetchError) return { sent: 0, processed: 0, error: fetchError.message }

  const due = (candidates ?? []).filter((f) => isDue(f, now) && !alreadyNotifiedToday(f, now))
  if (!due.length) return { sent: 0, processed: 0 }

  const subsByEmployee = await fetchSubscriptionsFor(supabase, [...new Set(due.map((f) => f.assigned_to))])

  let sentCount = 0
  const notifiedIds = []
  const deadEndpoints = []

  for (const f of due) {
    const subscriptions = subsByEmployee.get(f.assigned_to) ?? []
    // No device subscribed yet — leave notified_at alone so the next run
    // retries once this employee subscribes, instead of silently dropping it.
    if (!subscriptions.length) continue

    const overdueBy = Math.floor(
      (new Date(`${istToday(now)}T00:00:00Z`).getTime() - new Date(`${f.due_date}T00:00:00Z`).getTime()) / 86400000
    )
    const payload = JSON.stringify({
      title: overdueBy > 0 ? `${overdueBy}d overdue: ${f.title}` : f.title,
      // The notes are the actual instruction. Showing them here matters more
      // than usual, because the reminder's own notes were until recently
      // unreadable on every screen in the app.
      body: f.notes || (f.parties?.name ? `Re: ${f.parties.name}` : 'Follow-up reminder'),
      url: f.lead_id ? `/leads/${f.lead_id}` : '/',
    })

    const justSent = await pushToDevices(subscriptions, payload, deadEndpoints)

    // Only stamp when something actually went out. This push() used to sit
    // outside the try/catch and ran unconditionally, so ANY transient failure
    // — a 500 from FCM, a network blip, an expired VAPID JWT — permanently
    // marked the reminder notified with nothing sent, and the old
    // `notified_at IS NULL` filter meant it could never be retried. The
    // function still returned HTTP 200. Worse in combination: an employee
    // whose endpoints had all died got them pruned AND the row stamped, so
    // the reminder died at exactly the moment they needed to re-subscribe.
    if (justSent) {
      notifiedIds.push(f.id)
      sentCount += justSent
    }
  }

  if (notifiedIds.length) {
    await supabase.from('follow_ups').update({ notified_at: new Date().toISOString() }).in('id', notifiedIds)
  }
  await pruneDeadEndpoints(supabase, deadEndpoints)

  return { sent: sentCount, processed: due.length }
}

// ---------------------------------------------------------------------------
// JOB 2: lead assignments
//
// The rows are written by Postgres triggers, never by app code — see the
// migrations for why. This drain is idempotent and ordered oldest-first, so
// an instant call from the browser and the 5-minute cron racing each other
// is harmless: whichever gets there first stamps notified_at, and the other
// finds nothing to do.
//
// Every kind in ASSIGNMENT_KINDS shares this one drain: 'lead_assigned'
// (reassignment), 'lixil_lead_created' (a coordinator's Lixil entry-on-behalf
// — see Schema/migration_lead_remarks_and_lixil_notify.sql), and the BDM kinds
// (BDM.md Step 3). Same fetch, same send/stamp/prune loop; only the payload
// text (assignmentPayload) branches on `n.kind`.
// ---------------------------------------------------------------------------
// The push text for one notifications row. Lead-assignment kinds are as they
// always were; the BDM kinds (BDM.md Step 3) follow.
function assignmentPayload(n, lossReasonByLead) {
  const who = n.actor?.name
  const name = leadName(n.leads)

  if (n.kind === 'bdm_pool_lead' || n.kind === 'bdm_pool_nudge') {
    // To an owner. Opens Today, where the pool card is — assigning happens
    // there, not on the lead. Both kinds share one tag, so the 24-hour
    // reminder replaces the original banner rather than stacking under it.
    const isNudge = n.kind === 'bdm_pool_nudge'
    return {
      title: isNudge ? `Still waiting to be assigned (${POOL_NUDGE_HOURS}h+)` : 'New lead to assign',
      body: who ? `${name} — from ${who}` : name,
      url: '/',
      tag: `bdm-pool-${n.lead_id ?? n.id}`,
      requireInteraction: true,
    }
  }

  if (n.kind === 'bdm_lead_assigned' || n.kind === 'bdm_lead_won' || n.kind === 'bdm_lead_lost') {
    // To the BDM who brought the lead in. Informational, so no
    // requireInteraction — nothing here waits on them.
    const owner = n.leads?.owner?.name
    const title =
      n.kind === 'bdm_lead_assigned' ? 'Your lead was assigned' : n.kind === 'bdm_lead_won' ? 'Your lead was won' : 'Your lead was lost'
    let detail = null
    if (n.kind === 'bdm_lead_assigned') detail = owner ? `now with ${owner}` : null
    if (n.kind === 'bdm_lead_won' && n.leads?.order_value != null) {
      detail = `₹${Number(n.leads.order_value).toLocaleString('en-IN')} booked`
    }
    if (n.kind === 'bdm_lead_lost') {
      const reason = lossReasonByLead.get(n.lead_id)
      detail = reason ? LOSS_REASON_LABELS[reason] ?? reason : null
    }
    return {
      title,
      body: detail ? `${name} — ${detail}` : name,
      url: n.lead_id ? `/leads/${n.lead_id}` : '/',
      tag: `bdm-update-${n.lead_id ?? n.id}`,
    }
  }

  const isLixilCreated = n.kind === 'lixil_lead_created'
  return {
    title: isLixilCreated ? 'New Lixil lead assigned to you' : 'New lead assigned to you',
    body: isLixilCreated
      ? who
        ? `${name} — from ${who}'s call`
        : name
      : who
        ? `${name} — assigned by ${who}`
        : name,
    url: n.lead_id ? `/leads/${n.lead_id}` : '/',
    // One notification per lead: re-assigning (or, for a Lixil lead,
    // re-creating — which can't happen twice for the same row, but keeps
    // the two kinds in separate tag namespaces on principle) replaces the
    // previous banner instead of stacking a second one.
    tag: `${isLixilCreated ? 'lead-created' : 'lead-assigned'}-${n.lead_id ?? n.id}`,
    // This is the "very clear" part. On Android the banner stays until the
    // rep actually acts on it rather than auto-dismissing after a few
    // seconds while the phone is in a pocket. iOS ignores the flag, which
    // is exactly why the in-app card exists as well.
    requireInteraction: true,
  }
}

// JOB 3 (scheduled runs only): the 24-hour pool nudge. Finds BDM pool leads
// older than POOL_NUDGE_HOURS that have never been nudged, and writes one
// 'bdm_pool_nudge' row per active owner — which drainAssignments then pushes
// in this same run. "Never nudged" is the idempotency: a lead gets this once,
// however many runs see it waiting.
//
// leads.created_at is a naive TIMESTAMP holding a UTC wall clock, so the
// cutoff is compared as a UTC ISO string (Postgres drops the zone when
// casting to timestamp without time zone — which is exactly the UTC reading).
async function queuePoolNudges(supabase, now) {
  const cutoff = new Date(now.getTime() - POOL_NUDGE_HOURS * 60 * 60 * 1000)
  const { data: waiting, error } = await supabase
    .from('leads')
    .select('id, bdm_employee_id')
    .is('owner_employee_id', null)
    .not('bdm_employee_id', 'is', null)
    .lte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: true })
    .limit(ASSIGNMENT_BATCH_LIMIT)
  if (error) return { queued: 0, error: error.message }
  if (!waiting?.length) return { queued: 0 }

  const { data: already, error: alreadyError } = await supabase
    .from('notifications')
    .select('lead_id')
    .eq('kind', 'bdm_pool_nudge')
    .in('lead_id', waiting.map((l) => l.id))
  if (alreadyError) return { queued: 0, error: alreadyError.message }
  const nudged = new Set((already ?? []).map((r) => r.lead_id))
  const due = waiting.filter((l) => !nudged.has(l.id))
  if (!due.length) return { queued: 0 }

  const { data: owners, error: ownersError } = await supabase
    .from('employees')
    .select('id')
    .eq('role', 'owner')
    .eq('is_active', true)
  if (ownersError) return { queued: 0, error: ownersError.message }
  if (!owners?.length) return { queued: 0 }

  const rows = due.flatMap((l) =>
    owners.map((o) => ({ employee_id: o.id, kind: 'bdm_pool_nudge', lead_id: l.id, actor_employee_id: l.bdm_employee_id }))
  )
  const { error: insertError } = await supabase.from('notifications').insert(rows)
  if (insertError) return { queued: 0, error: insertError.message }
  return { queued: rows.length }
}

async function drainAssignments(supabase) {
  const { data: pending, error: fetchError } = await supabase
    .from('notifications')
    .select(
      'id, kind, employee_id, lead_id, actor_employee_id, actor:employees!actor_employee_id(name), leads(id, owner_employee_id, order_value, parties!party_id(name), sites(nickname, locality), owner:employees!owner_employee_id(name))'
    )
    .in('kind', ASSIGNMENT_KINDS)
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(ASSIGNMENT_BATCH_LIMIT)

  if (fetchError) return { sent: 0, processed: 0, error: fetchError.message }
  if (!pending?.length) return { sent: 0, processed: 0 }

  // Why a lost lead was lost, for the BDM's push — one bounded query.
  const lostLeadIds = [...new Set(pending.filter((n) => n.kind === 'bdm_lead_lost' && n.lead_id).map((n) => n.lead_id))]
  const lossReasonByLead = new Map()
  if (lostLeadIds.length) {
    const { data: lossRows } = await supabase
      .from('loss_reasons')
      .select('lead_id, reason, lost_at')
      .in('lead_id', lostLeadIds)
      .order('lost_at', { ascending: false })
    for (const r of lossRows ?? []) {
      if (!lossReasonByLead.has(r.lead_id)) lossReasonByLead.set(r.lead_id, r.reason)
    }
  }

  const subsByEmployee = await fetchSubscriptionsFor(supabase, [...new Set(pending.map((n) => n.employee_id))])

  let sentCount = 0
  const notifiedIds = []
  const deadEndpoints = []

  for (const n of pending) {
    // A pool push about a lead some owner has ALREADY assigned would send an
    // owner to a card that no longer has it. Stamp it as handled without
    // sending, so it never retries.
    if (POOL_KINDS.has(n.kind) && n.leads?.owner_employee_id != null) {
      notifiedIds.push(n.id)
      continue
    }

    const subscriptions = subsByEmployee.get(n.employee_id) ?? []
    // Same rule as follow-ups: an employee with no subscribed device yet is
    // left unstamped so this retries once they subscribe. They are not left
    // in the dark meanwhile — the in-app card on their Today screen reads
    // the same row and does not care about notified_at.
    if (!subscriptions.length) continue

    const payload = JSON.stringify(assignmentPayload(n, lossReasonByLead))

    const justSent = await pushToDevices(subscriptions, payload, deadEndpoints)
    if (justSent) {
      notifiedIds.push(n.id)
      sentCount += justSent
    }
  }

  if (notifiedIds.length) {
    await supabase.from('notifications').update({ notified_at: new Date().toISOString() }).in('id', notifiedIds)
  }
  await pruneDeadEndpoints(supabase, deadEndpoints)

  return { sent: sentCount, processed: pending.length }
}

Deno.serve(async (req) => {
  // The preflight must be answered before any work is done — and must NOT
  // run the drain, or a browser would trigger two full passes per call.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const now = new Date()

  // An optional body narrows the run. The cron sends nothing at all (and may
  // send a GET), so req.json() has to be allowed to fail — an unparseable or
  // absent body means "do everything", which is the scheduled behaviour and
  // must never depend on a body being present.
  //
  // `only: 'assignments'` is what LeadQuickActions calls right after a
  // successful reassignment, so the new owner's phone buzzes in about a
  // second instead of waiting out the cron interval. It deliberately does
  // NOT run the follow-up sweep: that is a scheduled, once-a-morning job and
  // a reassignment is no reason to re-examine every reminder in the company.
  let only = null
  try {
    only = (await req.json())?.only ?? null
  } catch {
    only = null
  }

  const results = {}
  if (only !== 'assignments') results.followUps = await drainFollowUps(supabase, now)
  // The 24-hour pool nudge is a scheduled job, like the reminder sweep — an
  // instant call after a save is no reason to look for day-old pool leads.
  // Queued BEFORE the drain, so its pushes go out in this same run.
  if (only === null) results.poolNudges = await queuePoolNudges(supabase, now)
  if (only !== 'followups') results.assignments = await drainAssignments(supabase)

  const sent = (results.followUps?.sent ?? 0) + (results.assignments?.sent ?? 0)
  const processed = (results.followUps?.processed ?? 0) + (results.assignments?.processed ?? 0)
  const error = results.followUps?.error ?? results.assignments?.error ?? results.poolNudges?.error ?? null

  // A fetch failure in one job is reported but does not fail the whole run —
  // the other job's pushes have already gone out and a 500 here would tell
  // the cron to retry them.
  return new Response(JSON.stringify({ sent, processed, ...results }), {
    status: error && !sent ? 500 : 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})
