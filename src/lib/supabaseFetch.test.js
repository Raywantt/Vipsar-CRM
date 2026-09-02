import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSupabaseFetch } from './supabaseFetch'

// WebKit's wording for a request that never reached the server — the exact
// failure the iOS PWA hit on every first Save (see supabaseFetch.js).
const networkError = () => new TypeError('Load failed')

const ok = (body = 'ok') => new Response(body, { status: 200 })

// A request that never answers. Real fetch rejects with an AbortError when its
// signal fires, and the wrapper's timeout works by firing that signal — so a
// mock that ignored it would hang forever and prove nothing.
const hangs = () => (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })

// The wrapper sleeps between attempts and arms a 20s timeout, so every test
// that expects a retry has to drive the clock. Kicking the timers forward in
// a loop (rather than by a fixed amount) lets one helper serve both the
// 250ms backoff and the 20s timeout without each test knowing which it needs.
async function settle(promise) {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  )
  for (let i = 0; i < 40; i++) {
    await vi.advanceTimersByTimeAsync(1000)
  }
  return result
}

describe('createSupabaseFetch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('passes a successful request straight through, with no retry', async () => {
    const base = vi.fn().mockResolvedValue(ok('hello'))
    const { value } = await settle(createSupabaseFetch(base)('/leads', { method: 'PATCH' }))

    expect(base).toHaveBeenCalledTimes(1)
    expect(await value.text()).toBe('hello')
  })

  // The bug itself: a PATCH is what saving a lead's Sales progress, stage or
  // any other edit sends, and postgrest-js re-throws these on the first
  // network failure rather than retrying. Recovering here is what turns the
  // rep's manual second tap into something they never have to do.
  it('retries a PATCH that fails with a network error, and succeeds', async () => {
    const base = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok())
    const { value, error } = await settle(createSupabaseFetch(base)('/leads', { method: 'PATCH' }))

    expect(error).toBeUndefined()
    expect(base).toHaveBeenCalledTimes(2)
    expect(value.status).toBe(200)
  })

  it('retries an idempotent request up to three attempts, then gives up', async () => {
    const base = vi.fn().mockRejectedValue(networkError())
    const { error } = await settle(createSupabaseFetch(base)('/leads', { method: 'DELETE' }))

    expect(base).toHaveBeenCalledTimes(3)
    expect(error.message).toBe('Load failed')
  })

  it('retries a POST once on a network error — the rep does this by hand today', async () => {
    const base = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok())
    const { value, error } = await settle(createSupabaseFetch(base)('/activities', { method: 'POST' }))

    expect(error).toBeUndefined()
    expect(base).toHaveBeenCalledTimes(2)
    expect(value.status).toBe(200)
  })

  it('never retries a POST more than once, so a failing insert cannot fan out', async () => {
    const base = vi.fn().mockRejectedValue(networkError())
    const { error } = await settle(createSupabaseFetch(base)('/activities', { method: 'POST' }))

    expect(base).toHaveBeenCalledTimes(2)
    expect(error.message).toBe('Load failed')
  })

  // The duplicate-write guard. A rejection means the request was never
  // delivered; a TIMEOUT leaves open whether the server already ran it, so a
  // POST that times out must be reported, never re-sent.
  it('does not retry a POST that times out', async () => {
    const base = vi.fn().mockImplementation(hangs())
    const { error } = await settle(createSupabaseFetch(base)('/activities', { method: 'POST' }))

    expect(base).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(TypeError)
    expect(error.message).toMatch(/timed out/i)
  })

  it('does retry an idempotent request that times out', async () => {
    const base = vi
      .fn()
      .mockImplementationOnce(hangs())
      .mockResolvedValue(ok())
    const { value, error } = await settle(createSupabaseFetch(base)('/leads', { method: 'PATCH' }))

    expect(error).toBeUndefined()
    expect(base).toHaveBeenCalledTimes(2)
    expect(value.status).toBe(200)
  })

  // A superseded navigation or an unmounting component cancels its own
  // request on purpose. Reissuing it would resurrect work that was
  // deliberately abandoned.
  it('never retries a request the caller aborted', async () => {
    const controller = new AbortController()
    const base = vi.fn().mockImplementation(hangs())

    const promise = createSupabaseFetch(base)('/leads', { method: 'GET', signal: controller.signal })
    controller.abort()
    const { error } = await settle(promise)

    expect(base).toHaveBeenCalledTimes(1)
    expect(error.name).toBe('AbortError')
  })

  it('leaves an HTTP error response alone — a 500 is the server answering, not a dropped connection', async () => {
    const base = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }))
    const { value } = await settle(createSupabaseFetch(base)('/leads', { method: 'PATCH' }))

    expect(base).toHaveBeenCalledTimes(1)
    expect(value.status).toBe(500)
  })

  it('defaults to GET when no method is given', async () => {
    const base = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue(ok())
    const { value } = await settle(createSupabaseFetch(base)('/leads'))

    expect(base).toHaveBeenCalledTimes(2)
    expect(value.status).toBe(200)
  })
})
