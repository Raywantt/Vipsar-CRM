// Parsing timestamps that come back from Supabase.
//
// Most timestamp columns in this schema are `TIMESTAMP` — without time zone
// (see Schema/tostem_crm_schema.sql). Postgres fills them from now(), and
// Supabase runs its database in UTC, so what's stored is a UTC wall clock
// with no marker saying so. PostgREST then serialises that as
// "2026-08-10T11:30:00" — no `Z`, no offset.
//
// Handing that string straight to `new Date(...)` is where it goes wrong: per
// the ES spec, a date-time form with no offset is parsed as LOCAL time. So a
// site visit logged at 5:00 pm IST is stored as 11:30 UTC and then re-read as
// 11:30 IST — every timestamp renders 5½ hours early, and reliably in the
// wrong half of the day.
//
// parseTimestamp appends the missing `Z` so a zone-less string is read as the
// UTC instant it actually is. A string that already carries a zone (a real
// timestamptz column like lead_change_log.changed_at, or anything ending in
// `Z`/`+05:30`) is passed through untouched, so this is safe to use on any
// timestamp column regardless of its type.
export function parseTimestamp(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const s = String(value)
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s)
  return new Date(hasZone ? s : `${s.replace(' ', 'T')}Z`)
}

// "9:12 am" — the day sheet's timeline and worked-span format.
export function formatClockTime(value) {
  const d = parseTimestamp(value)
  if (!d || Number.isNaN(d.getTime())) return null
  return d
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
