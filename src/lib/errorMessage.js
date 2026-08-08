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

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return ''
  console.error(error)
  return CODE_MESSAGES[error.code] ?? error.message ?? fallback
}
