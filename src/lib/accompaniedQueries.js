import { supabase } from './supabaseClient'

// Meetings a colleague went along to on someone else's lead (or architect).
// The lead's owner logs the activity once and tags them in "Accompanied by"
// (activities.accompanied_by); this is how the colleague then sees it.
//
// THE OWNER'S RULINGS (2026-09-18), all load-bearing:
//   * SHOWN, NEVER COUNTED. These rows are kept in their own `accompanied`
//     array and merged only into display lists (Today's recap, a day sheet,
//     the Sales Exec Profile's Activity log) — never into anything that
//     counts, so a meeting is still one meeting in every total and target.
//   * NAME ONLY. The colleague sees which lead or architect it was, not a
//     link — they still can't open a lead they don't own. `leadId` is
//     deliberately absent from the shaped row for that reason.
//
// Read through the accompanied_activities() RPC, never plain `activities`
// SELECT — see Schema/migration_accompanied_activities.sql for why an RLS
// policy would have leaked these rows into every existing count.
//
// FAILS SOFT: until that migration runs the RPC doesn't exist, and every
// caller treats an error as "none", so nothing else on the screen breaks.

// One RPC row → the same shape an `activities` row with its `leads(...)` and
// `parties!party_id(name)` embeds has, so dayReview.js's leadName() and
// leadName.js's chain name it with no second definition of lead naming.
export function shapeAccompaniedRow(row) {
  return {
    id: row.id,
    activity_type: row.activity_type,
    created_at: row.created_at,
    employee_id: row.employee_id,
    accompanied_by: row.accompanied_by,
    // Who the colleague went WITH — the person who logged it and owns the lead.
    withName: row.employee_name ?? null,
    leads: row.lead_id
      ? {
          id: row.lead_id,
          parties: row.lead_party_name ? { name: row.lead_party_name } : null,
          sites: { nickname: row.site_nickname, locality: row.site_locality, house_no: row.site_house_no },
        }
      : null,
    parties: row.party_name ? { name: row.party_name } : null,
    accompanied: true,
  }
}

// Bounds are UTC instants (dayBounds()/a Date's toISOString()), same as every
// other activities query. companionId narrows to one colleague; without it,
// every row the viewer is allowed to see comes back (their own, or their
// team's for a coordinator/manager, or everyone's for an owner).
export async function fetchAccompaniedActivities({ startISO, endISO, companionId = null }) {
  const { data, error } = await supabase.rpc('accompanied_activities', {
    p_from: startISO,
    p_to: endISO,
    p_companion_id: companionId,
  })
  if (error) return { data: [], error }
  return { data: (data ?? []).map(shapeAccompaniedRow), error: null }
}
