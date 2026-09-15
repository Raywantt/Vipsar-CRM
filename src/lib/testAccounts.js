import { supabase } from './supabaseClient'

// The owner's "Show test accounts" switch (Schema/migration_hide_test_accounts.sql).
// The hiding itself is a database rule — restrictive RLS policies keyed on
// employees.is_test_account — so this module only reads and writes the one
// preference that rule consults. No screen filters test data itself.
//
// Stored on employee_preferences next to the theme, so it follows the account
// across devices. The upsert names only its own column, so it never resets a
// saved theme (and saveAccountTheme never resets this).

export async function fetchShowTestAccounts(employeeId) {
  const { data, error } = await supabase
    .from('employee_preferences')
    .select('show_test_accounts')
    .eq('employee_id', employeeId)
    .maybeSingle()
  return { data: Boolean(data?.show_test_accounts), error }
}

// A write through supabaseFetch drops queryCache, so the next screen opened
// refetches with the new visibility — nothing else needs invalidating.
export function saveShowTestAccounts(employeeId, show) {
  return supabase
    .from('employee_preferences')
    .upsert({ employee_id: employeeId, show_test_accounts: show }, { onConflict: 'employee_id' })
    .select('show_test_accounts')
    .single()
}
