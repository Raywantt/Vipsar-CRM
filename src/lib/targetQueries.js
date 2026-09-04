import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'

// RLS scopes targets to "own data or owner role", same as activities/leads —
// a sales exec's query naturally returns only their own target rows.
export function fetchTargetsForPeriod({ periodType, periodValue }) {
  return fetchAllRows(() =>
    supabase
      .from('targets')
      .select('id, employee_id, metric_name, target_value, employees(name)', { count: 'exact' })
      .eq('period_type', periodType)
      .eq('period_value', periodValue)
  )
}

// order_value has no timestamp of its own, so "actual order value achieved
// in a period" is approximated via stage_history: sum order_value for leads
// whose MOST RECENT stage_history row with stage = 'won' falls inside the
// period. Fetched unbounded (not date-filtered at the query level) because
// determining "most recent" for a lead requires seeing all of its won
// transitions, not just the ones inside whatever period happens to be
// selected right now — the period check happens client-side after reducing
// to one row per lead. RLS on the embedded `leads` relation means a sales
// exec only ever sees rows for their own leads (others come back with
// leads: null and get filtered out); an owner sees everyone's.
export function fetchWonStageHistory() {
  return fetchAllRows(() =>
    supabase
      .from('stage_history')
      .select('lead_id, changed_at, leads(owner_employee_id, order_value)', { count: 'exact' })
      .eq('stage', 'won')
      .order('changed_at', { ascending: false }),
    // Tie-break in the SAME direction as the sort above — consumers here
    // take the first row per key and mean the most recent one.
    { ascending: false }
  )
}

// Upsert, not a plain insert — fixed 2026-09-04 after a real reported bug:
// "Set a target" always inserted a fresh row, so re-setting an employee's
// target for a period/metric that already had one didn't replace it, it
// added a SECOND, conflicting row next to it. `targetFor()` (this metric's
// one reader, TargetsVsActualsCard.jsx) takes the first match it finds with
// no tiebreak of its own, so which of the two silently "won" depended on
// query order alone — an owner correcting a mistaken target could end up
// looking at the OLD number with no indication a newer one even existed.
// Reproduced live: employee 33 had three order_value rows for the same week
// (₹25L, ₹5L, ₹50L) from three separate "corrections" that were each meant
// to replace the last. `Schema/migration_targets_unique.sql` cleans up the
// existing duplicates (keeping the highest id — the most recently created —
// per employee/period/metric) and adds the UNIQUE constraint this upsert's
// `onConflict` needs to do its job; until that migration runs, this behaves
// exactly like the old plain insert (Postgres has nothing to conflict with).
export function insertTarget({ employeeId, periodType, periodValue, metricName, targetValue }) {
  return supabase
    .from('targets')
    .upsert(
      {
        employee_id: employeeId,
        period_type: periodType,
        period_value: periodValue,
        metric_name: metricName,
        target_value: targetValue,
      },
      { onConflict: 'employee_id,period_type,period_value,metric_name' }
    )
    .select('id, employee_id, metric_name, target_value, period_type, period_value, employees(name)')
    .single()
}
