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
