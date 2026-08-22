// Runs on a schedule (see the Cron Jobs setup in the deploy hand-off) —
// checks for follow_ups that are due and still open, and pushes a real
// notification to every device the assignee has subscribed.
// Uses the service_role key so it bypasses RLS entirely: this is the one
// place in the app that's allowed to read/write across every employee's
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

Deno.serve(async () => {
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const now = new Date()

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

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  const due = (candidates ?? []).filter((f) => isDue(f, now) && !alreadyNotifiedToday(f, now))
  if (!due.length) {
    return new Response(JSON.stringify({ sent: 0, processed: 0 }), { status: 200 })
  }

  const employeeIds = [...new Set(due.map((f) => f.assigned_to))]
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, employee_id, endpoint, p256dh, auth')
    .in('employee_id', employeeIds)

  const subsByEmployee = new Map()
  for (const s of subs ?? []) {
    if (!subsByEmployee.has(s.employee_id)) subsByEmployee.set(s.employee_id, [])
    subsByEmployee.get(s.employee_id).push(s)
  }

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

    let anySent = false
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        sentCount++
        anySent = true
      } catch (err) {
        // 404/410 = the subscription is dead (browser data cleared, device
        // unsubscribed elsewhere, etc.) — prune it so future runs stop
        // wasting a request on it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          deadEndpoints.push(sub.endpoint)
        }
      }
    }

    // Only stamp when something actually went out. This push() used to sit
    // outside the try/catch and ran unconditionally, so ANY transient failure
    // — a 500 from FCM, a network blip, an expired VAPID JWT — permanently
    // marked the reminder notified with nothing sent, and the old
    // `notified_at IS NULL` filter meant it could never be retried. The
    // function still returned HTTP 200. Worse in combination: an employee
    // whose endpoints had all died got them pruned AND the row stamped, so
    // the reminder died at exactly the moment they needed to re-subscribe.
    if (anySent) notifiedIds.push(f.id)
  }

  if (notifiedIds.length) {
    await supabase.from('follow_ups').update({ notified_at: new Date().toISOString() }).in('id', notifiedIds)
  }
  if (deadEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  return new Response(JSON.stringify({ sent: sentCount, processed: due.length }), { status: 200 })
})
