import { supabase } from './supabaseClient'

// Re-authenticates with the current password before allowing the change —
// supabase.auth.updateUser() alone doesn't ask for it (a valid session is
// enough), but this app wants the extra check so a device left unlocked
// can't have its password swapped by whoever's holding it. On success,
// signInWithPassword also refreshes the session, so the updateUser() call
// right after it is never operating on a stale one.
export async function changePassword({ email, currentPassword, newPassword }) {
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) return { error: reauthError }

  return supabase.auth.updateUser({ password: newPassword })
}

// Owner-only: sets a NEW password for another employee, via the
// reset-employee-password Edge Function (service_role; see that file for
// why this can't be a plain client-side update). The function itself
// re-checks that the caller is an active owner, so this is a convenience
// wrapper, not the security boundary.
export async function resetEmployeePassword(employeeId, newPassword) {
  try {
    const { data, error } = await supabase.functions.invoke('reset-employee-password', {
      body: { employeeId, newPassword },
    })
    if (error) {
      // supabase-js surfaces a non-2xx response as a generic FunctionsHttpError
      // with the real message buried in error.context — fall back to that so
      // the owner sees "Only an owner can…" instead of "Edge Function returned
      // a non-2xx status code".
      const detail = await error.context?.json?.().catch(() => null)
      return { error: new Error(detail?.error ?? error.message) }
    }
    if (data?.error) return { error: new Error(data.error) }
    return { data, error: null }
  } catch (err) {
    return { error: err }
  }
}
