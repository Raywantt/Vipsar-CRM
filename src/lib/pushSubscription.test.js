import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// subscribeToPush / unsubscribeFromPush must always RETURN, never throw or hang.
// Profile's tick box stays greyed out for as long as the call is pending, so a
// browser that rejects subscribe() (or a service worker that never starts) used
// to leave it disabled with no message at all.

const FAKE_VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

async function loadModule() {
  vi.resetModules()
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', FAKE_VAPID_KEY)
  return await import('./pushSubscription.js')
}

function stubBrowser({ permission = 'granted', ready } = {}) {
  const notification = { requestPermission: vi.fn().mockResolvedValue(permission), permission }
  vi.stubGlobal('navigator', { serviceWorker: { ready } })
  vi.stubGlobal('window', { PushManager: class {}, Notification: notification, atob })
  vi.stubGlobal('Notification', notification)
}

describe('subscribeToPush', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reports a push service that will not answer instead of throwing', async () => {
    const abort = Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' })
    stubBrowser({ ready: Promise.resolve({ pushManager: { subscribe: vi.fn().mockRejectedValue(abort) } }) })
    const { subscribeToPush } = await loadModule()

    const { data, error } = await subscribeToPush(7)

    expect(data).toBeNull()
    expect(error.message).toContain("couldn't reach its push service")
    expect(error.message).toContain('AbortError')
  })

  it('gives up on a service worker that never starts, rather than hanging', async () => {
    vi.useFakeTimers()
    stubBrowser({ ready: new Promise(() => {}) })
    const { subscribeToPush } = await loadModule()

    const pending = subscribeToPush(7)
    await vi.advanceTimersByTimeAsync(8001)
    const { error } = await pending

    expect(error.message).toContain('Close and reopen the CRM')
    expect(error.message).toContain('ServiceWorkerTimeout')
  })

  it('says so when the browser refuses permission at subscribe time', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    stubBrowser({ ready: Promise.resolve({ pushManager: { subscribe: vi.fn().mockRejectedValue(denied) } }) })
    const { subscribeToPush } = await loadModule()

    const { error } = await subscribeToPush(7)

    expect(error.message).toContain('blocked for this app')
  })

  it('still returns the plain "not granted" message when the prompt is dismissed', async () => {
    stubBrowser({ permission: 'default', ready: new Promise(() => {}) })
    const { subscribeToPush } = await loadModule()

    const { error } = await subscribeToPush(7)

    expect(error.message).toBe('Notification permission was not granted.')
  })
})

describe('unsubscribeFromPush', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns an error instead of hanging when the service worker never starts', async () => {
    vi.useFakeTimers()
    stubBrowser({ ready: new Promise(() => {}) })
    const { unsubscribeFromPush } = await loadModule()

    const pending = unsubscribeFromPush(7)
    await vi.advanceTimersByTimeAsync(8001)
    const { error } = await pending

    expect(error.message).toContain('ServiceWorkerTimeout')
  })

  it('has nothing to do when this device was never subscribed', async () => {
    stubBrowser({ ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }) })
    const { unsubscribeFromPush } = await loadModule()

    expect(await unsubscribeFromPush(7)).toEqual({ error: null })
  })
})
