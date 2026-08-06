// Runs on a schedule (see the Cron Jobs setup in the deploy hand-off) —
// checks for follow_ups that are due, not done, and not yet notified, and
// pushes a real notification to every device the assignee has subscribed.
// Uses the service_role key so it bypasses RLS entirely: this is the one
// place in the app that's allowed to read/write across every employee's
// rows, since a cron job has no auth.uid() of its own to satisfy the
// "own data or owner role" policies everything else in this app uses.
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
const DEFAULT_DUE_TIME = '09:00:00'

function isDue(followUp, now) {
  const timePart = followUp.due_time ?? DEFAULT_DUE_TIME
  const dueInstant = new Date(`${followUp.due_date}T${timePart}${IST_OFFSET}`)
  return dueInstant <= now
}

Deno.serve(async () => {
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: candidates, error: fetchError } = await supabase
    .from('follow_ups')
    .select('id, assigned_to, title, due_date, due_time, lead_id, parties(name)')
    .eq('is_done', false)
    .is('notified_at', null)

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  const now = new Date()
  const due = (candidates ?? []).filter((f) => isDue(f, now))
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
    // No device subscribed yet — leave notified_at null so the next run
    // retries once this employee subscribes, instead of silently dropping it.
    if (!subscriptions.length) continue

    const payload = JSON.stringify({
      title: f.title,
      body: f.parties?.name ? `Re: ${f.parties.name}` : 'Follow-up reminder',
      url: f.lead_id ? `/leads/${f.lead_id}` : '/',
    })

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        sentCount++
      } catch (err) {
        // 404/410 = the subscription is dead (browser data cleared, device
        // unsubscribed elsewhere, etc.) — prune it so future runs stop
        // wasting a request on it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          deadEndpoints.push(sub.endpoint)
        }
      }
    }
    notifiedIds.push(f.id)
  }

  if (notifiedIds.length) {
    await supabase.from('follow_ups').update({ notified_at: new Date().toISOString() }).in('id', notifiedIds)
  }
  if (deadEndpoints.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', deadEndpoints)
  }

  return new Response(JSON.stringify({ sent: sentCount, processed: due.length }), { status: 200 })
})
