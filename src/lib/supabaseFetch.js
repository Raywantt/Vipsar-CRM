// The one fetch every Supabase request in this app goes through, wired in via
// createClient's `global.fetch` (supabaseClient.js) so it covers PostgREST and
// Auth, reads and writes alike, with no call site having to opt in.
//
// WHY IT EXISTS — the iOS PWA "Load Failed on the first Save" bug, reported
// 2026-09-02: on an installed iPhone PWA, saving a change to a lead sat for
// several seconds and then failed with "Load failed", while pressing Save a
// second time saved instantly, every time. Desktop never showed it, on the
// same wifi.
//
// The cause is not this app's queries and not the network's speed. iOS reaps
// idle HTTPS connections aggressively, and a request sent on a connection the
// OS has already torn down rejects at the network layer — WebKit's wording for
// that is exactly `TypeError: Load failed` (Chrome says "Failed to fetch").
// The retry succeeds because it opens a fresh connection.
//
// The reason only SAVES failed is a rule inside postgrest-js: it retries
// idempotent requests (GET/HEAD/OPTIONS) up to 3 times with 1s/2s/4s backoff,
// and deliberately re-throws immediately for every other method
// (PostgrestBuilder's `if (!RETRYABLE_METHODS.includes(this.method)) throw`).
// So the identical connection drop was invisible on a page load — it just made
// it slow, which is the other half of what was reported — and fatal on a Save.
//
// Desktop browsers mask the same drop by retrying a dead keep-alive connection
// internally; iOS surfaces it to the page. That is the whole of the difference
// between the two, and why this belongs in the transport, not in any screen.
// NOTE ON DOUBLE RETRIES. For a GET this now sits inside postgrest-js's own
// 3-attempt loop, so a read that is genuinely unreachable can be tried up to
// nine times before failing (~10s, against ~7s before). That is the intended
// trade: the common case — one dropped connection — recovers here in 250ms
// instead of waiting out postgrest's 1s first backoff, and the nine-attempt
// worst case only happens when the server really is unreachable, where taking
// three extra seconds to say so costs nothing. Writes are unaffected: this is
// their only retry, since postgrest-js has none for them.
//
// Bodies are re-sent as-is on a retry. supabase-js only ever sends strings
// here, and this app uses no Supabase Storage, so there is no single-use
// ReadableStream body that a second attempt could find already consumed.
import { invalidateAllQueries } from './queryCache'

const TIMEOUT_MS = 20000

// A dropped connection is re-established on the next attempt, so these delays
// only need to let the socket close — they are not congestion backoff, and
// keeping them short is what makes a recovered Save still feel instant to the
// rep rather than merely eventually working.
const BACKOFF_MS = [250, 750]

// HTTP-idempotent methods: re-sending one cannot create a second row or apply
// an edit twice, so they are safe to retry however the attempt failed.
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'])

// Marker on our own timeout aborts, so they can be told apart from a caller's
// abort (a superseded page navigation, which must never be retried).
const TIMEOUT = Symbol('supabase-fetch-timeout')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A fetch rejection is a network-layer failure — the request never completed,
// so there is no status to inspect. Every other outcome, including a 4xx/5xx,
// resolves normally and is left for postgrest-js/auth-js to interpret.
// Deliberately matched on shape rather than on message text: the wording is
// per-engine ("Load failed" on WebKit, "Failed to fetch" on Chromium,
// "NetworkError when attempting to fetch resource" on Gecko) and matching a
// string would silently stop covering whichever engine changed its copy.
function isNetworkError(error) {
  return error?.name === 'TypeError'
}

// ---------------------------------------------------------------------------
// DEV-ONLY GUARDRAIL for the row-cap bug fixed 2026-09-04 (see fetchAllRows.js
// and CLAUDE.md's Conventions entry) — a query with no .limit()/.range() does
// not mean "every row"; PostgREST silently caps the response at the project's
// max-rows setting (1,000 here) and says nothing when it does. That shipped
// once already: leads had grown past the cap, and every screen reading it
// unpaged reported a truncated company as if it were the whole one.
//
// This does NOT replace fetchAllRows.js or the fetchAllRows.test.js static
// review it wants for every new "give me everything" query — it's the second,
// independent layer: a runtime tripwire for the day someone (a future screen,
// a future contributor) writes a fresh unbounded query and forgets. It fires
// in dev only, on the exact request that would have silently lost rows, so
// the fix lands before the query ever reaches production data.
//
// The signal: supabase-js sets an explicit `limit` query param for BOTH
// .limit() and .range() (see PostgrestTransformBuilder — .range() computes
// limit=to-from+1). fetchAllRows always calls .range() internally, so every
// legitimately paged request carries that param. A request with NO `limit`
// param is one that asked for "everything" — and if PostgREST's own
// Content-Range response header then shows fewer rows came back than exist
// (or, when the total isn't known because the caller didn't request an exact
// count, exactly the server's cap came back), the request was silently
// truncated. Reading only response HEADERS here, never the body, so this
// can never consume a stream the real caller still needs.
const KNOWN_MAX_ROWS = 1000

function warnIfSilentlyTruncated(input, init, response) {
  try {
    if (!import.meta.env?.DEV) return
    if (response.status !== 200 && response.status !== 206) return

    const url = typeof input === 'string' ? input : input?.url
    if (!url || !url.includes('/rest/v1/')) return

    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return

    const params = new URL(url, globalThis.location?.origin ?? 'http://x').searchParams
    if (params.has('limit') || params.has('offset')) return // an explicit page was asked for — fetchAllRows or a deliberate .limit()

    const contentRange = response.headers.get('content-range')
    if (!contentRange) return
    const m = /^(\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange)
    if (!m) return

    const returned = Number(m[2]) - Number(m[1]) + 1
    const total = m[3] === '*' ? null : Number(m[3])
    const truncated = total != null ? returned < total : returned === KNOWN_MAX_ROWS

    if (truncated) {
      const table = url.split('/rest/v1/')[1]?.split('?')[0] ?? url
      // eslint-disable-next-line no-console
      console.warn(
        `[fetchAllRows guardrail] An unpaged query against "${table}" returned ` +
          `${returned}${total != null ? ` of ${total}` : ''} rows — PostgREST's ` +
          `max-rows cap (${KNOWN_MAX_ROWS}) silently truncated the response. ` +
          `Wrap this query in fetchAllRows() (src/lib/fetchAllRows.js) instead ` +
          `of calling it unpaged. Request: ${url}`
      )
    }
  } catch {
    // Never let the guardrail itself break a real request.
  }
}

// ---------------------------------------------------------------------------
// CACHE INVALIDATION LIVES HERE ON PURPOSE — read this before moving it.
//
// src/lib/queryCache.js caches read results for a short window so switching
// screens is instant. Anything cached must be dropped the moment the data
// behind it changes, or the app confidently shows figures that are already
// wrong — a far worse failure than being slow.
//
// The obvious implementation is to call invalidateAllQueries() after each
// write, at each call site. That is exactly the pattern this codebase has
// been bitten by twice before: `lead_change_log` and `entered_by_role` are
// both written by Postgres TRIGGERS rather than app code, precisely because
// there is no single lead-update service here and "remember to call the
// helper" fails the first time someone adds a new write path (see CLAUDE.md
// on both). Leads alone are written from four LeadDetail sections,
// LeadStageSection, LeadQuickActions and three side-effect paths in
// ActivityLog.
//
// So invalidation is done ONCE, here, at the transport every Supabase call
// already funnels through: any non-GET that actually succeeded drops the
// cache. A write path added years from now is covered automatically, with
// nothing to remember. This is the same reasoning as the trigger-written
// audit trail, applied to the client.
//
// Only 2xx invalidates: a rejected write (RLS refusal, constraint violation)
// changed nothing, and throwing away good cached reads over it would just
// make a failed save slow as well as failed.
function invalidateCacheAfterWrite(input, method, response) {
  try {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    if (!response.ok) return

    const url = typeof input === 'string' ? input : input?.url
    // A POST to /rest/v1/rpc/... is a read in this app (see
    // fetchCategoryBreakdown) — PostgREST requires POST for function calls,
    // so method alone would misread those as writes and defeat the cache on
    // every single Dashboard load.
    if (url && url.includes('/rest/v1/rpc/')) return

    invalidateAllQueries()
  } catch {
    // Never let invalidation break a request that already succeeded. The
    // cost of a missed invalidation is a stale read for <90s; the cost of
    // throwing here would be a failed save the user has to redo.
  }
}

export function createSupabaseFetch(baseFetch = globalThis.fetch.bind(globalThis)) {
  return async function supabaseFetch(input, init = {}) {
    const method = (init.method ?? 'GET').toUpperCase()
    const idempotent = IDEMPOTENT_METHODS.has(method)
    const callerSignal = init.signal ?? null

    // POST is the one method where re-sending can duplicate real data — a
    // logged activity, a follow-up, a new lead. It still gets ONE retry,
    // but only for an outright network rejection, never for a timeout:
    // a rejection means the request was never delivered (which is why the
    // rep's own second tap has never produced a duplicate), whereas a
    // timeout leaves genuinely open whether the server processed it, and
    // guessing wrong there writes a row nobody asked for.
    const maxAttempts = idempotent ? 3 : 2

    let attempt = 0
    for (;;) {
      if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException('Aborted', 'AbortError')
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1])

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(TIMEOUT), TIMEOUT_MS)
      // AbortSignal.any would say this in one line, but it only landed in
      // Safari 17.4 and this app's whole reason for existing is phones in the
      // field — forwarding the caller's abort by hand costs three lines and
      // works everywhere.
      const forwardAbort = () => controller.abort(callerSignal.reason)
      callerSignal?.addEventListener('abort', forwardAbort)

      try {
        const response = await baseFetch(input, { ...init, signal: controller.signal })
        warnIfSilentlyTruncated(input, init, response)
        invalidateCacheAfterWrite(input, method, response)
        return response
      } catch (error) {
        // The caller gave up on this request (a superseded navigation, a
        // component unmounting). Nothing to recover — reissuing it would
        // resurrect work that was deliberately cancelled.
        if (callerSignal?.aborted) throw error

        const timedOut = controller.signal.aborted && controller.signal.reason === TIMEOUT
        const retryable = timedOut ? idempotent : isNetworkError(error)

        if (!retryable || attempt >= maxAttempts - 1) {
          // Give the timeout an honest message. An AbortError reads as if
          // something cancelled the request on purpose, which sends whoever
          // reads the console looking in the wrong place entirely.
          if (timedOut) throw new TypeError(`Request timed out after ${TIMEOUT_MS / 1000}s`)
          throw error
        }
        attempt++
      } finally {
        clearTimeout(timer)
        callerSignal?.removeEventListener('abort', forwardAbort)
      }
    }
  }
}
