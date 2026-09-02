// Maps a Supabase/PostgREST error to a message safe to show an end user.
// Known codes get a plain-language translation; anything else (including
// Supabase Auth errors like "Invalid login credentials", which are already
// human-readable) falls through to error.message. The raw error is always
// logged to the console — that's the "details" a developer can reach via
// devtools, without putting a raw Postgres string in front of a sales exec.
const CODE_MESSAGES = {
  // .single() throws this when a query returns zero rows — either the row
  // genuinely doesn't exist, or RLS silently filtered it out. Can't tell
  // those apart from here, so the message covers both.
  PGRST116: 'Not found or not yours.',
  // foreign_key_violation — some other row (a lead, activity, etc.) still
  // points at the thing being deleted.
  '23503': "Still linked to other records — can't be deleted yet.",
  // insufficient_privilege — an RLS policy rejected the request.
  '42501': "You don't have access to do that.",
}

// A network-layer failure that survived supabaseFetch.js's retries. The rep
// saw "Load failed" for this — WebKit's own wording for a request that never
// reached the server, surfaced verbatim because it arrives with no error code
// to translate. It reads like a bug in the app; it means the phone lost the
// connection. Say that instead, and say what to do about it.
//
// Matched on message text only because that is all supabase-js leaves us:
// postgrest-js reports a network rejection as `TypeError: <engine wording>`
// with code:'' (it reserves code/hint for real PostgREST errors), and auth-js
// re-throws the bare message. The engine wordings are stable and few, and the
// last entry is supabaseFetch.js's own timeout, which we control.
const NETWORK_ERROR_PATTERNS = [
  'load failed', // WebKit — iOS Safari and every iOS browser, incl. the PWA
  'failed to fetch', // Chromium
  'networkerror when attempting to fetch resource', // Gecko
  'network request failed',
  'request timed out', // supabaseFetch.js's own timeout
]

function isNetworkError(error) {
  const message = (error?.message ?? '').toLowerCase()
  // A real PostgREST/Postgres error always carries a code; a client-side
  // network failure never does. Checking that first keeps a genuine database
  // error whose text happens to contain one of these phrases from being
  // relabelled as a connection problem.
  if (error?.code) return false
  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return ''
  console.error(error)
  if (isNetworkError(error)) {
    // Deliberately does NOT promise "nothing was saved". A retried write that
    // ran out of attempts, or a POST that timed out, leaves it genuinely
    // unknown whether the server processed the request — see supabaseFetch.js
    // on why a timed-out POST is never retried. Telling a rep their change
    // definitely didn't land, and being wrong, is worse than asking them to
    // look.
    return "Couldn't reach the server. Check your connection and try again."
  }
  return CODE_MESSAGES[error.code] ?? error.message ?? fallback
}
