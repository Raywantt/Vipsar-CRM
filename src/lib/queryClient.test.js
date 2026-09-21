import { describe, it, expect, afterEach } from 'vitest'
import { queryClient, scopedKey, setQueryUser, persistOptions, clearQueryData, PERSIST_MAX_AGE_MS } from './queryClient'

const shouldPersist = persistOptions.dehydrateOptions.shouldDehydrateQuery

function fakeQuery({ persist, status }) {
  return { meta: persist === undefined ? undefined : { persist }, state: { status } }
}

describe('queryClient — instant open', () => {
  afterEach(() => {
    setQueryUser(null)
    queryClient.clear()
  })

  // Shared office devices: one person's remembered numbers must never answer
  // another person's question, even before the sign-out wipe runs.
  it('puts the signed-in user into every key', () => {
    setQueryUser('user-a')
    const a = scopedKey(['today', 'day-review', '2026-09-21'])
    setQueryUser('user-b')
    const b = scopedKey(['today', 'day-review', '2026-09-21'])
    expect(a).toEqual(['u', 'user-a', 'today', 'day-review', '2026-09-21'])
    expect(b).not.toEqual(a)
  })

  it('accepts a plain string key too', () => {
    setQueryUser('user-a')
    expect(scopedKey('attention')).toEqual(['u', 'user-a', 'attention'])
  })

  it('never keys a query to a blank user', () => {
    setQueryUser(null)
    expect(scopedKey(['x'])[1]).toBe('anon')
  })

  it('stores only screen queries that opted in, and only successful ones', () => {
    expect(shouldPersist(fakeQuery({ persist: true, status: 'success' }))).toBe(true)
    expect(shouldPersist(fakeQuery({ persist: true, status: 'error' }))).toBe(false)
    expect(shouldPersist(fakeQuery({ persist: true, status: 'pending' }))).toBe(false)
    // The large fallback download and every imperative cachedQuery read.
    expect(shouldPersist(fakeQuery({ persist: false, status: 'success' }))).toBe(false)
    expect(shouldPersist(fakeQuery({ persist: undefined, status: 'success' }))).toBe(false)
  })

  it('discards remembered data saved by a different build', () => {
    expect(persistOptions.buster).toBeTruthy()
  })

  it('keeps remembered data no longer than a day, and in memory at least that long', () => {
    expect(persistOptions.maxAge).toBe(PERSIST_MAX_AGE_MS)
    expect(queryClient.getDefaultOptions().queries.gcTime).toBeGreaterThanOrEqual(PERSIST_MAX_AGE_MS)
  })

  it('clearQueryData empties the in-memory cache (the device copy is removed alongside)', async () => {
    queryClient.setQueryData(scopedKey(['k']), { data: [1], error: null })
    expect(queryClient.getQueryCache().findAll().length).toBe(1)
    await clearQueryData()
    expect(queryClient.getQueryCache().findAll().length).toBe(0)
  })
})
