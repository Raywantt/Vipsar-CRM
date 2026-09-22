// "INSTANT OPEN" (Phase 2 of the 2026-09-21 speed work) — the app remembers
// the last numbers each screen showed and paints them the moment it opens,
// then refreshes quietly in the background, the way WhatsApp or Gmail open.
// The owner chose to mark that window with a small "Updating…" label
// (useSyncState in src/hooks/useCachedQuery.js → the Today header's sync
// pill) rather than swap numbers silently.
//
// WHY TANSTACK QUERY. src/lib/queryCache.js was written as a deliberately
// small copy of this library's vocabulary with an explicit note: once the app
// needs background refetching and persistence, adopt the real thing rather
// than growing that file. This is that point. queryCache.js is kept, unchanged,
// for every imperative `fetchX().then(...)` call site; screens move to
// useCachedQuery (src/hooks/useCachedQuery.js) one at a time, and only those
// hook queries are remembered on the device.
//
// WHAT IS STORED, WHERE, AND FOR WHOM.
//   * IndexedDB (not localStorage — a leads payload alone is hundreds of KB,
//     and localStorage caps at ~5 MB per site and blocks the page while it
//     writes).
//   * Every hook query key starts with the signed-in auth user's id
//     (setQueryUser, called by AuthContext), so one person's remembered data
//     can never answer another person's question on a shared device — and on
//     top of that the whole store is wiped on sign-out (clearQueryData).
//     These are shared office machines; both guards are deliberate.
//   * Stamped with the SHAPE of the data (`buster`), not the build. A deploy
//     that changes how a remembered query fetches or shapes its answer changes
//     the stamp, and data saved under the old shape is thrown away rather than
//     rendered by code that expects a different one. Every other deploy keeps
//     it, so an update no longer makes everyone's next open the slow one
//     (it did until 2026-09-21, when the stamp was the build time). The stamp
//     is a hash of the query files (scripts/dataShape.mjs); screens may only
//     fetch through them (src/lib/cachedQueryShape.test.js).
//   * Kept for a day at most (PERSIST_MAX_AGE_MS). Yesterday's numbers are
//     still worth painting while today's load; last week's are not.
//
// REFRESHING. A remembered result older than staleTime (90s) is refreshed the
// moment a screen shows it, and again whenever the app comes back to the
// foreground after that long. Results are shared structurally: if the fresh
// answer is identical, nothing re-renders. A successful write anywhere drops everything as before
// (supabaseFetch.js → invalidateAllQueries), which now also re-fetches the
// hook queries on screen, so a screen reflects the viewer's own change.
import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'

export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

// Stamped at build time by vite.config.js from scripts/dataShape.mjs. Falls
// back to a constant so tests (and any tool that imports this without Vite's
// define) still load it.
/* global __DATA_SHAPE_ID__ */
export const DATA_SHAPE_ID = typeof __DATA_SHAPE_ID__ !== 'undefined' ? __DATA_SHAPE_ID__ : 'dev'

// Bump by hand when a screen starts READING something its query files don't
// show changing — the one case the hash can't see. Example: a migration adds
// a column to an RPC's output and a card starts reading it, while the
// `supabase.rpc(...)` call itself stays the same. (This file is part of the
// hash, so changing this number discards saved data on its own.)
export const CACHE_SHAPE_VERSION = 1

const STORE_KEY = 'vipsar-query-cache'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Same freshness window the imperative cache uses.
      staleTime: 90_000,
      // Must outlive the persisted copy, or a remembered result would be
      // garbage-collected before the screen that wants it mounts.
      gcTime: PERSIST_MAX_AGE_MS,
      // supabaseFetch.js already retries IMMEDIATELY at the transport, with
      // rules about which failures are safe to repeat. This adds exactly ONE
      // more try, 4 seconds later — enough for a screen whose first load hit
      // a momentary server error (seen live: a manager's Today stuck on
      // "loading…" after one 500) to fill itself in, without piling repeats
      // onto a struggling database, the exact shape of the 25P02 outage.
      retry: 1,
      retryDelay: 4000,
      // Coming back to the app refreshes what is on screen (if older than
      // staleTime) — the "reopen the phone and see today's numbers" case.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

// idb-keyval can throw where IndexedDB is unavailable (some private modes).
// Every failure here just means "nothing remembered" — the app then behaves
// exactly as it did before instant open existed.
// Guarded twice: idb-keyval rejects when the store misbehaves, but THROWS
// synchronously where `indexedDB` doesn't exist at all (caught by the
// test suite, which runs without one).
function safely(run, fallback) {
  try {
    return run().catch(() => fallback)
  } catch {
    return Promise.resolve(fallback)
  }
}

const safeStorage = {
  getItem: (key) => safely(() => get(key), undefined),
  setItem: (key, value) => safely(() => set(key, value), undefined),
  removeItem: (key) => safely(() => del(key), undefined),
}

export const queryPersister = createAsyncStoragePersister({
  storage: safeStorage,
  key: STORE_KEY,
  throttleTime: 1000,
})

export const persistOptions = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster: `${CACHE_SHAPE_VERSION}:${DATA_SHAPE_ID}`,
  dehydrateOptions: {
    // Only hook queries that opted in, and only successful ones.
    shouldDehydrateQuery: (query) => query.meta?.persist === true && query.state.status === 'success',
  },
}

// ---------------------------------------------------------------------------
// Whose data is this? Set by AuthContext as soon as a session is known.
let currentUserId = null

export function setQueryUser(userId) {
  currentUserId = userId ?? null
}

export function scopedKey(key) {
  return ['u', currentUserId ?? 'anon', ...(Array.isArray(key) ? key : [key])]
}

// Wipes the in-memory copies AND the device copy. Sign-out, and any session
// that ends on its own (expired token → SIGNED_OUT).
export function clearQueryData() {
  queryClient.clear()
  return safeStorage.removeItem(STORE_KEY)
}
