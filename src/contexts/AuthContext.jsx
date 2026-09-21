import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import { fetchAccountTheme, setTheme } from '../lib/theme'
import { clearQueryCacheOnSignOut } from '../lib/queryCache'

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
          setEmployee(data)
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
      setSession(session)
      if (session?.user) {
        await ensureEmployee(session.user.id)
      }
      if (activeRef.current) setLoading(false)
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!activeRef.current) return
      setSession(newSession)
      if (newSession?.user) {
        // Not awaited: auth-js awaits every listener before it finishes its
        // own work (session recovery, the refresh ticker), and supabase-js
        // documents that a listener should kick async work off rather than
        // hold the auth pipeline open. For the same, already-loaded user this
        // is a no-op — see the note at the top of this file.
        ensureEmployee(newSession.user.id)
      } else {
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
    // Clear the read cache BEFORE ending the session. src/lib/queryCache.js
    // holds whole-company aggregates in memory, and these are shared office
    // machines — the next person to log in on this device must not be handed
    // the previous employee's cached figures, which RLS would never have
    // shown them. Cleared first, not after, so a slow signOut round trip
    // can't leave that window open.
    signOut: () => {
      clearQueryCacheOnSignOut()
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
