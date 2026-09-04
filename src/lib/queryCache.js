// A session-scoped read cache with in-flight request de-duplication.
//
// WHY THIS EXISTS — measured, not assumed (2026-09-04). Loading Dashboard
// fired 32 concurrent Supabase requests. Timed individually those same
// queries are fast (the 1,209-row `leads` fetch with 4 joins: 868ms alone,
// 5,143ms during the real page load; `stage_history`: 467ms alone, 4,477ms
// during the load). Nothing was slow on its own — they were choking each
// other, competing for browser connections, Supabase's connection pool and
// Postgres CPU all at once. The fix is therefore not "make each query
// faster", it is "stop issuing so many of them".
//
// Two separate sources of duplication this removes:
//
//   1. THE SAME QUERY, FIRED TWICE AT ONCE. React's StrictMode double-
//      invokes every effect in development, so every fetch on the page ran
//      twice simultaneously. Beyond dev, several screens legitimately want
//      the same data at the same moment. De-duplicating in-flight requests
//      by key collapses those into ONE network call, with both callers
//      awaiting the same promise.
//
//   2. THE SAME QUERY, RE-FIRED ON EVERY VISIT. Dashboard, Today, My Team
//      and the Sales Exec Profile each independently call
//      fetchLeadsForBreakdown() on mount, so navigating between them
//      re-downloaded the whole company every time. Caching by key for a
//      short window makes the second and later visits instant — the
//      "switching screens should be immediate" behaviour this was asked
//      for, without the cost of eagerly prefetching screens nobody opens.
//
// THE API IS DELIBERATELY SHAPED LIKE TANSTACK QUERY (queryKey / staleTime /
// invalidate). This is a deliberately small, dependency-free version of what
// React Query does. If this app keeps growing — more screens, more shared
// data, a need for background refetching, retries or devtools — the honest
// upgrade path is to adopt TanStack Query rather than to keep growing this
// file, and keeping the same vocabulary here makes that a mechanical swap
// instead of a rewrite. Do not add features to this module speculatively;
// reach for the real library at that point.
//
// WHAT THIS IS NOT. It is not a store, not a source of truth, and nothing
// should read from it directly. It sits behind the existing fetch functions
// so call sites are unchanged and can never accidentally depend on cache
// internals.

// How long a cached result is served without re-fetching. Deliberately
// short: correctness for figures OTHER people are changing (an owner
// watching a dashboard while reps log activity) matters more here than
// shaving another request. The viewer's OWN writes don't wait for this at
// all — they invalidate immediately, see invalidateAllQueries below.
export const DEFAULT_STALE_TIME_MS = 90_000

const cache = new Map()

// Exposed for tests and for the dev-time sanity check in the browser.
export function _cacheSize() {
  return cache.size
}

// The one way to read through the cache.
//
// `key` must be stable and must encode every argument that changes the
// result — a query scoped to a date range or an employee needs those in its
// key, or two different questions will share one answer. `fn` returns the
// promise that actually performs the fetch.
//
// The resolved value is passed through untouched, including the
// `{ data, error }` shape every query function in this app returns.
//
// ERRORS ARE NEVER CACHED. A failed fetch (offline, a dropped connection,
// an RLS rejection) must not be replayed to every later caller for the next
// 90 seconds — the next call retries for real. This also means a caller
// that checks `error` behaves exactly as it did before this cache existed.
//
// NOTE ON SHARED REFERENCES: callers receive the SAME array/object instance
// on a cache hit, so a consumer that sorts or mutates the result in place
// would corrupt it for everyone else. Nothing in this app does (attention.js
// copies with [...rows] before sorting, and every dashboard consumer derives
// new arrays) — but if you add one, copy at the call site, and do not
// "fix" it here by cloning 1,200 rows on every read.
export function cachedQuery(key, fn, { staleTime = DEFAULT_STALE_TIME_MS } = {}) {
  const entry = cache.get(key)

  // Already in flight — join it rather than opening a second identical
  // request. This is what collapses StrictMode's double-fetch and two
  // screens asking the same question at the same moment.
  if (entry?.promise) return entry.promise

  if (entry && Date.now() - entry.at < staleTime) {
    return Promise.resolve(entry.result)
  }

  const promise = fn()
    .then((result) => {
      // Only a successful result is worth remembering. `result.error` is the
      // supabase-js convention; a thrown error is handled by the catch below.
      if (result?.error) {
        cache.delete(key)
      } else {
        cache.set(key, { at: Date.now(), result })
      }
      return result
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })

  cache.set(key, { ...(entry ?? {}), promise })
  return promise
}

// Drop everything. Called automatically after any write (see
// supabaseFetch.js) and on sign-out.
//
// Deliberately a blunt clear-all rather than per-table invalidation. Almost
// every aggregate in this app is derived from `leads` joined to something
// else, so "which cached figures could this write have changed?" is very
// nearly "all of them" — and a stale dashboard number is a correctness bug,
// while a redundant refetch is only a cost. Writes are rare compared to
// reads here, so the blunt version is both safer and cheap.
export function invalidateAllQueries() {
  cache.clear()
}

// Sign-out must not leave one employee's data readable by whoever logs in
// next on the same device — a real concern here, since these are shared
// office machines and the cached payloads are whole-company aggregates.
export function clearQueryCacheOnSignOut() {
  cache.clear()
}
