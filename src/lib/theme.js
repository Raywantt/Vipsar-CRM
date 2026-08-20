import { supabase } from './supabaseClient'

// Manual light/dark override, layered on top of the @media
// (prefers-color-scheme: dark) default in vipsar-theme.css. 'system' means
// "no override" — just delete the attribute and let the media query decide.
// index.html has its own tiny inline copy of the storage key/read logic
// (applied before any CSS loads, to avoid a flash of the wrong theme) —
// keep the two in sync if this key ever changes.
const STORAGE_KEY = 'vip-theme'
const VALID = ['light', 'dark', 'system']

export function getStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return VALID.includes(stored) ? stored : 'system'
}

export function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

// Account-level persistence (employee_preferences — see
// Schema/migration_employee_theme_preference.sql) on top of the
// localStorage functions above, so the choice follows an employee to any
// device/browser they log into instead of only the one they set it on.
// Both are wrapped to fail quietly: until the migration is run, or on any
// network hiccup, the existing device-local behavior above is unaffected —
// this is a sync layer on top of it, not a replacement.

// Returns null (not an error) when there's no saved preference yet, or the
// migration hasn't run, or the request fails for any reason — callers treat
// null as "nothing to sync, leave the current local/default theme alone".
export async function fetchAccountTheme(employeeId) {
  try {
    const { data, error } = await supabase
      .from('employee_preferences')
      .select('theme')
      .eq('employee_id', employeeId)
      .maybeSingle()
    if (error || !data) return null
    return data.theme
  } catch {
    return null
  }
}

export function saveAccountTheme(employeeId, theme) {
  return supabase
    .from('employee_preferences')
    .upsert({ employee_id: employeeId, theme }, { onConflict: 'employee_id' })
}
