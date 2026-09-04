import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cachedQuery, invalidateAllQueries, clearQueryCacheOnSignOut, _cacheSize } from './queryCache'

const ok = (data) => ({ data, error: null })

describe('queryCache', () => {
  beforeEach(() => {
    invalidateAllQueries()
    vi.useRealTimers()
  })

  it('serves a second read from cache without re-running the query', async () => {
    const fn = vi.fn().mockResolvedValue(ok([1, 2, 3]))
    const a = await cachedQuery('k', fn)
    const b = await cachedQuery('k', fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(b).toBe(a)
  })

  // The reason this module exists: React StrictMode double-invokes every
  // effect in dev, and separate screens ask for the same data at the same
  // moment. Both must collapse into ONE request.
  it('de-duplicates identical requests fired before the first resolves', async () => {
    let resolve
    const fn = vi.fn(() => new Promise((r) => { resolve = r }))
    const p1 = cachedQuery('k', fn)
    const p2 = cachedQuery('k', fn)
    expect(fn).toHaveBeenCalledTimes(1)
    resolve(ok(['x']))
    expect(await p1).toEqual(await p2)
  })

  it('keeps different keys separate', async () => {
    const fn = vi.fn().mockResolvedValueOnce(ok('a')).mockResolvedValueOnce(ok('b'))
    expect((await cachedQuery('k1', fn)).data).toBe('a')
    expect((await cachedQuery('k2', fn)).data).toBe('b')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('re-fetches once the entry is older than staleTime', async () => {
    const fn = vi.fn().mockResolvedValue(ok('v'))
    await cachedQuery('k', fn, { staleTime: 0 })
    await cachedQuery('k', fn, { staleTime: 0 })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // A failed read must not be replayed to every later caller — the next call
  // has to genuinely retry, or one dropped connection poisons the screen for
  // the whole stale window.
  it('never caches a supabase-style error result', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce(ok('recovered'))
    expect((await cachedQuery('k', fn)).error.message).toBe('boom')
    expect((await cachedQuery('k', fn)).data).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('never caches a thrown error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(ok('recovered'))
    await expect(cachedQuery('k', fn)).rejects.toThrow('Load failed')
    expect((await cachedQuery('k', fn)).data).toBe('recovered')
  })

  it('invalidateAllQueries forces the next read to hit the network', async () => {
    const fn = vi.fn().mockResolvedValue(ok('v'))
    await cachedQuery('k', fn)
    invalidateAllQueries()
    await cachedQuery('k', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // Shared office machines: the next person to log in must never be handed
  // the previous employee's cached company-wide figures.
  it('clears everything on sign-out', async () => {
    await cachedQuery('a', () => Promise.resolve(ok(1)))
    await cachedQuery('b', () => Promise.resolve(ok(2)))
    expect(_cacheSize()).toBe(2)
    clearQueryCacheOnSignOut()
    expect(_cacheSize()).toBe(0)
  })
})
