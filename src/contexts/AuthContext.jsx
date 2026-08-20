import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { errorMessage } from '../lib/errorMessage'
import { fetchAccountTheme, setTheme } from '../lib/theme'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [employee, setEmployee] = useState(null)
  const [employeeError, setEmployeeError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function loadEmployee(userId) {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, mobile, role, is_active')
        .eq('auth_user_id', userId)
        .single()

      if (!active) return
      if (error) {
        setEmployee(null)
        setEmployeeError(errorMessage(error))
      } else {
        setEmployee(data)
        setEmployeeError(null)
        // Fire-and-forget: pulls this employee's saved appearance choice
        // in from their account and applies it (syncing localStorage too,
        // so the next load's pre-paint script in index.html already has
        // it). Not awaited — a slow/failed request should never delay
        // login, and fetchAccountTheme already swallows its own errors
        // (including the migration not having been run yet), returning
        // null rather than throwing.
        fetchAccountTheme(data.id).then((theme) => {
          if (active && theme) setTheme(theme)
        })
      }
    }

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!active) return
      setSession(session)
      if (session?.user) {
        await loadEmployee(session.user.id)
      }
      if (active) setLoading(false)
    }

    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!active) return
      setSession(newSession)
      if (newSession?.user) {
        await loadEmployee(newSession.user.id)
      } else {
        setEmployee(null)
        setEmployeeError(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    employee,
    employeeError,
    loading,
    signOut: () => supabase.auth.signOut(),
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
