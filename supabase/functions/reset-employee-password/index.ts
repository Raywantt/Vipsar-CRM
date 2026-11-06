// Lets an OWNER set a new password for another employee, without ever
// needing (or being able) to see their current one. This exists because
// Supabase Auth hashes every password server-side and never exposes it in
// any readable form — including to this app's own database — so there is
// no "show me their password" feature possible. The real fix for "an
// employee forgot their password" is letting the owner issue a new one.
//
// Uses the service_role key, like send-followup-reminders, because setting
// someone else's Auth password is an Admin API action no RLS policy can
// grant to an ordinary session.
//
// ⚠️ The caller's OWNER-ness is verified here, server-side, from their own
// JWT — never trust a role or employee id sent in the request body. A
// browser call can ask this function to reset any employee's password, so
// without this check anyone signed in could reset anyone else's, including
// the owner's.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

// Same reasoning as send-followup-reminders' CORS_HEADERS: the browser call
// carries an Authorization header, which makes it cross-origin and
// preflighted with OPTIONS. Origin '*' is fine here for the same reason —
// the function independently verifies the caller is an active owner before
// doing anything, so a holder of a valid session can only ever act within
// what that check allows, never as anyone else.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

const MIN_PASSWORD_LENGTH = 6 // matches ChangePasswordForm.jsx's own client-side rule

Deno.serve(async (req) => {
  // Must be answered before any work is done, same rule as the other
  // browser-invoked function — otherwise a preflight would redundantly run
  // the whole check-and-reset path.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return jsonResponse({ error: 'You need to be signed in.' }, 401)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400)
  }

  const employeeId = body?.employeeId
  const newPassword = body?.newPassword
  if (!employeeId || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse(
      { error: `A target employee and a password of at least ${MIN_PASSWORD_LENGTH} characters are required.` },
      400,
    )
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Resolve the CALLER's own identity from their JWT via the Auth server —
  // this cryptographically validates the token rather than trusting
  // whatever the request claims.
  const anon = createClient(supabaseUrl, anonKey)
  const { data: callerAuth, error: callerAuthError } = await anon.auth.getUser(token)
  if (callerAuthError || !callerAuth?.user) {
    return jsonResponse({ error: 'Your session has expired. Sign in again.' }, 401)
  }

  const { data: caller, error: callerError } = await admin
    .from('employees')
    .select('id, role, is_active')
    .eq('auth_user_id', callerAuth.user.id)
    .maybeSingle()

  // current_employee_role()'s own rule, repeated here since this function
  // runs outside RLS entirely: a deactivated owner is not an owner.
  if (callerError || !caller || !caller.is_active || caller.role !== 'owner') {
    return jsonResponse({ error: "Only an owner can reset another employee's password." }, 403)
  }

  const { data: target, error: targetError } = await admin
    .from('employees')
    .select('id, name, auth_user_id')
    .eq('id', employeeId)
    .maybeSingle()

  if (targetError || !target) {
    return jsonResponse({ error: 'Employee not found.' }, 404)
  }
  if (!target.auth_user_id) {
    return jsonResponse(
      { error: `${target.name} has no linked login yet — add one in Supabase Auth first, same as a new employee.` },
      400,
    )
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    password: newPassword,
  })

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 400)
  }

  return jsonResponse({ ok: true, name: target.name })
})
