import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import { fetchAccountTheme, setTheme } from '../lib/theme'
import { clearQueryCacheOnSignOut } from '../lib/queryCache'
import { setQueryUser, clearQueryData } from '../lib/queryClient'

const AuthContext = createContext(undefined)

// How long to wait before re-trying the employee lookup when the server
// answers with an ERROR (never when it answers "no such employee" — that is a
// real answer). One extra round only: supabaseFetch.js already re-sends a
// refused request up to three times, so this covers a failure that outlasts
// those ~1s of transport retries without piling more requests onto a
// database that is already struggling.
const EMPLOYEE_RETRY_DELAYS_MS = [2000]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// INSTANT OPEN for the account itself (2026-09-21). Every screen waits for
// the employee row before drawing anything, and that lookup is a full round
// trip (~0.4–0.8s on a phone) on every single open. The last row this device
// loaded is remembered here, keyed to the auth user, so a returning employee
// sees their screen at once while the lookup re-confirms it in the
// background. It holds no more than the app already shows (name, role,
// mobile); every query is still enforced by RLS on the server, so a stale
// copy can at worst show yesterday's role for the half-second before the
// lookup corrects it. Cleared on sign-out, and replaced the moment the
// database says anything different — including "no such employee".
const REMEMBERED_EMPLOYEE_KEY = 'vip-employee'

function readRememberedEmployee(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBERED_EMPLOYEE_KEY))
    return saved?.userId === userId && saved.employee?.id ? saved.employee : null
  } catch {
    return null
  }
}

function rememberEmployee(userId, employee) {
  try {
    if (employee) localStorage.setItem(REMEMBERED_EMPLOYEE_KEY, JSON.stringify({ userId, employee }))
    else localStorage.removeItem(REMEMBERED_EMPLOYEE_KEY)
  } catch {
    // Storage unavailable (private mode): just no instant open.
  }
}

function sameEmployee(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------------------------------------------------------------------------
// WHY THIS IS SHAPED THE WAY IT IS — the 2026-09-21 "Account not linked"
// outage. Every employee saw "Account not linked" with the database error
// "current transaction is aborted…" under it, and the app looked dead.
//
// Nobody's account was unlinked. Three things in the old version combined:
//
// 1. auth-js fires SIGNED_IN every time the app comes back to the foreground
//    (its visibilitychange handler re-runs session recovery), and TOKEN_REFRESHED
//    every hour. The old listener re-queried `employees` on EVERY one of those,
//    so a rep unlocking their phone re-ran the lookup each time.
// 2. On ANY error it set employee = null — throwing away a perfectly good
//    record it had loaded a minute earlier.
// 3. The route guard shows "Account not linked" for employee = null, so a
//    one-request server hiccup replaced the whole app with a message telling
//    the rep their login was broken.
//
// So now:
//   * the lookup runs once per signed-in user, not once per auth event;
//   * a lookup that ERRORS is retried, and if it still fails the status is
//     'error' (the guard says "couldn't load your account" with a Retry
//     button), never 'unlinked';
//   * 'unlinked' is reserved for the database genuinely answering "no
//     employee row for this login";
//   * a failure never discards an employee that is already loaded.
// ---------------------------------------------------------------------------

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [employeeError, setEmployeeError] = useState(null)
  // 'idle' (signed out) | 'loading' | 'ready' | 'unlinked' | 'error'
  const [employeeStatus, setEmployeeStatus] = useState('idle')
  const [loading, setLoading] = useState(true)

  // The auth user id whose employee row is currently in state, and the one
  // lookup in flight (so init + INITIAL_SESSION + SIGNED_IN at startup share a
  // single request instead of firing three).
  const loadedUserIdRef = useRef(null)
  const inflightRef = useRef(null)
  const activeRef = useRef(true)

  const runLookup = useCallback(async (userId) => {
    let lastError = null
    for (let attempt = 0; attempt <= EMPLOYEE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(EMPLOYEE_RETRY_DELAYS_MS[attempt - 1])
      if (!activeRef.current) return

      const { data, error } = await supabase
        .from('employees')
        .select('id, name, mobile, role, is_active')
        .eq('auth_user_id', userId)
        .maybeSingle()

      if (!activeRef.current) return
      if (!error) {
        if (data) {
          loadedUserIdRef.current = userId
          rememberEmployee(userId, data)
          // Keep the same object when nothing changed, so a background
          // re-confirmation doesn't re-render every screen for nothing.
          setEmployee((prev) => (prev && sameEmployee(prev, data) ? prev : data))
          setEmployeeError(null)
          setEmployeeStatus('ready')
          // Fire-and-forget: pulls this employee's saved appearance choice
          // in from their account and applies it (syncing localStorage too,
          // so the next load's pre-paint script in index.html already has
          // it). Not awaited — a slow/failed request should never delay
          // login, and fetchAccountTheme already swallows its own errors
          // (including the migration not having been run yet), returning
          // null rather than throwing.
          fetchAccountTheme(data.id).then((theme) => {
            if (activeRef.current && theme) setTheme(theme)
          })
        } else {
          // The database answered, and the answer is "no employee row is
          // linked to this login" (or RLS hid it — a deactivated employee
          // resolves to nothing, see rls_policies.sql). A real answer, so
          // no retry.
          loadedUserIdRef.current = null
          rememberEmployee(userId, null)
          setEmployee(null)
          setEmployeeError(null)
          setEmployeeStatus('unlinked')
        }
        return
      }
      lastError = error
    }

    // Every attempt errored. Keep whatever is already loaded for this same
    // user — it was right a minute ago and nothing here says otherwise.
    if (loadedUserIdRef.current === userId) return
    setEmployee(null)
    setEmployeeError(errorMessage(lastError))
    setEmployeeStatus('error')
  }, [])

  const ensureEmployee = useCallback(
    (userId, { force = false } = {}) => {
      if (!force && loadedUserIdRef.current === userId) return Promise.resolve()
      if (inflightRef.current?.userId === userId) return inflightRef.current.promise
      if (loadedUserIdRef.current !== userId) setEmployeeStatus('loading')
      const promise = runLookup(userId).finally(() => {
        if (inflightRef.current?.promise === promise) inflightRef.current = null
      })
      inflightRef.current = { userId, promise }
      return promise
    },
    [runLookup]
  )

  useEffect(() => {
    activeRef.current = true

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!activeRef.current) return
      // Before any screen mounts: remembered screen data is keyed by this id
      // (src/lib/queryClient.js), so it must be set before a query runs.
      setQueryUser(session?.user?.id)
      setSession(session)
      if (session?.user) {
        const remembered = readRememberedEmployee(session.user.id)
        if (remembered) {
          // Draw now from the remembered row; confirm it in the background.
          loadedUserIdRef.current = session.user.id
          setEmployee(remembered)
          setEmployeeStatus('ready')
          setLoading(false)
          ensureEmployee(session.user.id, { force: true })
          return
        }
        await ensureEmployee(session.user.id)
      }
      if (activeRef.current) setLoading(false)
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!activeRef.current) return
      setQueryUser(newSession?.user?.id)
      setSession(newSession)
      if (newSession?.user) {
        // Not awaited: auth-js awaits every listener before it finishes its
        // own work (session recovery, the refresh ticker), and supabase-js
        // documents that a listener should kick async work off rather than
        // hold the auth pipeline open. For the same, already-loaded user this
        // is a no-op — see the note at the top of this file.
        ensureEmployee(newSession.user.id)
      } else {
        // Any session ending — Log out, or a token that expired on its own —
        // wipes what this device remembered for that person.
        clearQueryCacheOnSignOut()
        clearQueryData()
        rememberEmployee(null, null)
        loadedUserIdRef.current = null
        inflightRef.current = null
        setEmployee(null)
        setEmployeeError(null)
        setEmployeeStatus('idle')
      }
    })

    return () => {
      activeRef.current = false
      subscription.unsubscribe()
    }
  }, [ensureEmployee])

  const value = {
    session,
    user: session?.user ?? null,
    employee,
    employeeError,
    employeeStatus,
    loading,
    // The "Couldn't load your account" screen's Retry button.
    retryEmployee: () => {
      const userId = session?.user?.id
      if (userId) ensureEmployee(userId, { force: true })
    },
    // Clear the read caches BEFORE ending the session — the in-memory one
    // (src/lib/queryCache.js) and the on-device one behind "instant open"
    // (src/lib/queryClient.js). Both hold company data, and these are shared office
    // machines — the next person to log in on this device must not be handed
    // the previous employee's cached figures, which RLS would never have
    // shown them. Cleared first, not after, so a slow signOut round trip
    // can't leave that window open.
    signOut: () => {
      clearQueryCacheOnSignOut()
      clearQueryData()
      rememberEmployee(null, null)
      return supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
