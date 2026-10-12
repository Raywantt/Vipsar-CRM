import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'
import { withoutPoolLeadRows } from './poolLeads'
import { fetchCountedRfqs, fetchRfqDeskSettings } from './rfqQueries'
import { NEW_MEETING, OLD_MEETING } from './meetingBucket'

// The Team Report's reads (src/lib/teamReport.js, TeamReport.jsx). RLS scopes
// every one of them exactly as it scopes the Dashboard — the owner reads the
// company, a coordinator their team, a manager themselves plus their reports —
// so nothing here filters by person. The screen narrows to the people it lists.
//
// ONE read covers every period the screen OFFERS (the whole list, not just the
// ticked ones), so ticking and unticking never fetches; only "Show older" or a
// different period type does. Each is as narrow as the figures allow — the
// columns the rules read and nothing else — because a Year list spans the
// whole table.

// The activity types the report counts. Office days, design sheets and booking
// updates are left out at the query, not after it.
const REPORT_ACTIVITY_TYPES = ['call', 'site_visit', NEW_MEETING, OLD_MEETING, 'architect_meeting', 'rfq_raised']

export function fetchReportActivities(span) {
  return fetchAllRows(() =>
    supabase
      .from('activities')
      .select('activity_type, employee_id, rfq_kind, created_at', { count: 'exact' })
      .in('activity_type', REPORT_ACTIVITY_TYPES)
      .gte('created_at', span.start.toISOString())
      .lte('created_at', span.end.toISOString())
  )
}

// The leads created in the span from the three sources the report counts.
// Pool leads are deliberately NOT excluded: a BDM's row counts the leads that
// BDM brought in, waiting in the pool or not (the BDM's own Leads generated
// target counts them the same way), and a pool lead has no owner, so it can't
// reach a salesperson's row. external_reference_id is for the import-date
// footnote (hasImportDate).
export function fetchReportLeads(span) {
  return fetchAllRows(() =>
    supabase
      .from('leads')
      .select('id, source_type, owner_employee_id, bdm_employee_id, created_at, external_reference_id', { count: 'exact' })
      .in('source_type', ['scanning', 'referral_other', 'referral_architect'])
      .gte('created_at', span.start.toISOString())
      .lte('created_at', span.end.toISOString())
  )
}

// Every 'won' row, newest first — fetchWonStageHistory's read (targetQueries.js)
// with the lead's external_reference_id added for the import-date footnote.
// Unbounded for the same reason as that one: "the lead's most recent win" needs
// all of its wins, not just the ones inside the span.
export function fetchReportWonHistory() {
  return fetchAllRows(
    () =>
      supabase
        .from('stage_history')
        .select('lead_id, changed_at, leads(owner_employee_id, bdm_employee_id, order_value, external_reference_id)', {
          count: 'exact',
        })
        .eq('stage', 'won')
        .order('changed_at', { ascending: false }),
    // Tie-break in the SAME direction as the sort — the rule takes the first
    // row per lead and means the most recent one.
    { ascending: false }
  ).then(withoutPoolLeadRows)
}

// Every target set for these periods of one type — one request for the whole
// list rather than one per period. A year has no target period, so no read.
export function fetchReportTargets(periodType, periodValues) {
  if (!periodValues.length || periodType === 'year') return Promise.resolve({ data: [], error: null })
  return fetchAllRows(() =>
    supabase
      .from('targets')
      .select('id, employee_id, metric_name, target_value, period_type, period_value', { count: 'exact' })
      .eq('period_type', periodType)
      .in('period_value', periodValues)
  )
}

// The screen's one remembered answer. Plain values in (the span as ISO strings,
// so the remembered-query key can carry them), plain rows out — nothing here
// survives JSON badly. A failed read fails the whole answer: half the rows
// would be figures that look right and aren't.
export async function fetchTeamReportData(periodType, spanStartISO, spanEndISO, periodValues) {
  const span = { start: new Date(spanStartISO), end: new Date(spanEndISO) }
  const [activitiesRes, leadsRes, wonRes, countedRes, settingsRes, targetsRes] = await Promise.all([
    fetchReportActivities(span),
    fetchReportLeads(span),
    fetchReportWonHistory(),
    fetchCountedRfqs(span),
    fetchRfqDeskSettings(),
    fetchReportTargets(periodType, periodValues),
  ])
  const error =
    activitiesRes.error ?? leadsRes.error ?? wonRes.error ?? countedRes.error ?? settingsRes.error ?? targetsRes.error ?? null
  if (error) return { data: null, error }
  return {
    data: {
      activities: activitiesRes.data ?? [],
      leads: leadsRes.data ?? [],
      won: wonRes.data ?? [],
      counted: countedRes.data ?? [],
      liveFrom: settingsRes.data?.live_from ?? null,
      targets: targetsRes.data ?? [],
    },
    error: null,
  }
}
