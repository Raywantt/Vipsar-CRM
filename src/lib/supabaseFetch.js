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
        return await baseFetch(input, { ...init, signal: controller.signal })
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
