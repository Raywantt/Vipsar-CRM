import { supabase } from './supabaseClient'

// RLS scopes targets to "own data or owner role", same as activities/leads —
// a sales exec's query naturally returns only their own target rows.
export function fetchTargetsForPeriod({ periodType, periodValue }) {
  return supabase
    .from('targets')
    .select('id, employee_id, metric_name, target_value, employees(name)')
    .eq('period_type', periodType)
    .eq('period_value', periodValue)
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
  return supabase
    .from('stage_history')
    .select('lead_id, changed_at, leads(owner_employee_id, order_value)')
    .eq('stage', 'won')
    .order('changed_at', { ascending: false })
}

export function insertTarget({ employeeId, periodType, periodValue, metricName, targetValue }) {
  return supabase
    .from('targets')
    .insert({
      employee_id: employeeId,
      period_type: periodType,
      period_value: periodValue,
      metric_name: metricName,
      target_value: targetValue,
    })
    .select('id, employee_id, metric_name, target_value, period_type, period_value, employees(name)')
    .single()
}
