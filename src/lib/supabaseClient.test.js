import { describe, it, expect, afterEach, vi } from 'vitest'
import { storedAccessTokenExpired, AUTH_STORAGE_KEY } from './supabaseClient'

// Guards the reader behind appUpdate's `auth-refresh-pending` rule. The
// important property is that it FAILS OPEN: a wrong `true` would hold every
// future update back forever, which is worse than the bug it prevents.
function setStore(store) {
  vi.stubGlobal('localStorage', {
    getItem: (k) => (k in store ? store[k] : null),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storedAccessTokenExpired', () => {
  it('derives the auth-js default storage key from the project URL', () => {
    expect(AUTH_STORAGE_KEY).toMatch(/^sb-.+-auth-token$/)
  })

  it('is true only for a session whose access token has already expired', () => {
    setStore({ [AUTH_STORAGE_KEY]: JSON.stringify({ expires_at: Math.floor(Date.now() / 1000) - 60 }) })
    expect(storedAccessTokenExpired()).toBe(true)
  })

  it('is false for a session still in date', () => {
    setStore({ [AUTH_STORAGE_KEY]: JSON.stringify({ expires_at: Math.floor(Date.now() / 1000) + 600 }) })
    expect(storedAccessTokenExpired()).toBe(false)
  })

  it('fails open when nothing is stored', () => {
    setStore({})
    expect(storedAccessTokenExpired()).toBe(false)
  })

  it('fails open on unparseable or incomplete stored data', () => {
    setStore({ [AUTH_STORAGE_KEY]: 'not json' })
    expect(storedAccessTokenExpired()).toBe(false)
    setStore({ [AUTH_STORAGE_KEY]: JSON.stringify({ no_expiry: true }) })
    expect(storedAccessTokenExpired()).toBe(false)
  })

  it('fails open when storage itself throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') } })
    expect(storedAccessTokenExpired()).toBe(false)
  })
})
