import { createClient } from '@supabase/supabase-js'
import { createSupabaseFetch } from './supabaseFetch'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// `global.fetch` is handed to both the PostgREST and the Auth client inside
// createClient, so this one line is what puts every query, write and token
// refresh in the app behind the retry/timeout wrapper. See supabaseFetch.js
// for the iOS-PWA connection drop it exists to survive — the short version is
// that postgrest-js retries reads and never retries writes, so a dropped
// connection was invisible on a page load and fatal on a Save.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createSupabaseFetch() },
})

// ---------------------------------------------------------------------------
// STORED SESSION EXPIRY — read by src/lib/appUpdate.js before it reloads the
// page to apply a new build. See that file's `auth-refresh-pending` rule.
//
// WHY THIS EXISTS. auth-js destroys the session outright — `_removeSession()`,
// which lands the employee on the login screen — when a refresh-token call
// fails non-retryably AND the stored access token has already expired
// (GoTrueClient's `_callRefreshToken`: it only preserves a session when the
// access token is still valid). Refresh tokens are single-use and rotate, so
// a rotation that reaches the server but whose response never gets persisted
// leaves the stored token already-consumed; the next attempt is answered
// "Invalid Refresh Token: Already Used", which is exactly that non-retryable
// case. Reloading the page is one way to strand a rotation like that.
//
// So the update engine must not hand a brand-new page load a session it is
// forced to rotate immediately. Reading the expiry here lets it wait the few
// seconds for auth-js to rotate the token on the CURRENT page instead, where
// the response will actually be saved.
//
// The key format is auth-js's own default: `sb-<project ref>-auth-token`,
// where the ref is the first label of the Supabase hostname (see
// SupabaseClient's `defaultStorageKey`). We derive rather than hardcode it so
// it follows the configured project.
export const AUTH_STORAGE_KEY = (() => {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
})()

/**
 * True only when we can positively confirm the stored access token has already
 * expired.
 *
 * FAILS OPEN, deliberately, in every other case — no session, unreadable
 * storage, unparseable JSON, no expires_at. A wrong `true` would hold updates
 * back forever, which is the failure this whole module exists to prevent; a
 * wrong `false` costs at most the pre-existing behaviour.
 */
export function storedAccessTokenExpired() {
  try {
    if (!AUTH_STORAGE_KEY) return false
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY)
    if (!raw) return false
    const expiresAt = JSON.parse(raw)?.expires_at
    if (!Number.isFinite(expiresAt)) return false
    return expiresAt * 1000 <= Date.now()
  } catch {
    return false
  }
}
