import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryClient, scopedKey } from '../lib/queryClient'

// A supabase-js `{ data, error }` result that carried an error. Thrown inside
// the query function so the library never stores an error as good data
// (same rule as queryCache.js: errors are never cached), then unwrapped
// below so callers keep reading the familiar `{ data, error }` shape.
class SupabaseResultError extends Error {
  constructor(result) {
    super(result?.error?.message ?? 'Query failed')
    this.result = result
  }
}

// The screen-side half of "instant open" — see src/lib/queryClient.js.
//
// `key`     — array or string naming the question. Must encode every argument
//             that changes the answer (a date, an employee id), the same rule
//             queryCache.js states. The signed-in user is added automatically.
// `fetchFn` — any existing query function resolving `{ data, error }`
//             (fetchDayReview, fetchLeadsNeedingAttention, …). Nothing in the
//             query layer changes to use this.
//
// Returns `{ result, isLoading, isFetching, updatedAt }`:
//   result    — the `{ data, error }` object, or undefined before anything is
//               known. While a remembered result is being refreshed, `result`
//               stays the remembered one; if that refresh FAILS the last good
//               result stays on screen (and useSyncState reports it) rather
//               than blanking the card.
//   isLoading — nothing to show yet (first ever load, or a new key).
//
// `persist: false` keeps a query in memory only — for a large payload that is
// only ever a fallback (useAttentionBuckets' download-everything path), which
// isn't worth writing to the device.
export function useCachedQuery(key, fetchFn, { enabled = true, staleTime, persist = true } = {}) {
  const query = useQuery({
    queryKey: scopedKey(key),
    queryFn: async () => {
      const result = await fetchFn()
      if (result?.error) throw new SupabaseResultError(result)
      return result
    },
    enabled,
    ...(staleTime != null ? { staleTime } : {}),
    meta: { persist },
  })

  let result
  if (query.data !== undefined) result = query.data
  else if (query.error instanceof SupabaseResultError) result = query.error.result
  else if (query.error) result = { data: null, error: query.error }

  return {
    result,
    isLoading: enabled && query.data === undefined && !query.error,
    isFetching: query.isFetching,
    // When the result on screen was fetched (ms since epoch), remembered or
    // fresh — Day Review's "Updated 3:42 pm".
    updatedAt: query.dataUpdatedAt || null,
    // The LAST fetch's error, even while `result` still shows the remembered
    // answer — so a screen can tell "refresh failed, keep showing the old
    // copy" from "the database now says this doesn't exist" (Lead Detail).
    lastError:
      query.error instanceof SupabaseResultError ? query.error.result.error : (query.error ?? null),
  }
}

// ---------------------------------------------------------------------------
// The header pill's state, across every remembered (hook) query on screen:
//   'updating' — at least one is fetching (a refresh of remembered numbers,
//                or a first load)
//   'stale'    — nothing is fetching, but the last refresh of something on
//                screen failed, so what's shown may be out of date
//   'synced'   — everything on screen is the latest answer
function computeSyncState() {
  const queries = queryClient.getQueryCache().findAll({ predicate: (q) => q.meta?.persist === true })
  let updating = false
  let stale = false
  for (const q of queries) {
    if (!q.getObserversCount()) continue // not on screen
    if (q.state.fetchStatus === 'fetching') updating = true
    else if (q.state.status === 'error' || q.state.errorUpdatedAt > q.state.dataUpdatedAt) stale = true
  }
  return updating ? 'updating' : stale ? 'stale' : 'synced'
}

function subscribe(onChange) {
  return queryClient.getQueryCache().subscribe(onChange)
}

export function useSyncState() {
  return useSyncExternalStore(subscribe, computeSyncState, () => 'synced')
}
