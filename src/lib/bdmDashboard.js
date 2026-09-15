// Pure rules for the business development manager's Dashboard (BDM.md Step 5):
// targets vs actuals, Pipeline closed and Top 5 architects. No network —
// src/lib/bdmQueries.js fetches, src/pages/BdmDashboard.jsx renders.
//
// Every rule reads the lead's frozen BDM tag (leads.bdm_employee_id), never
// who happens to own the lead now — BDM.md §3.

import { parseTimestamp } from './dbTime'
import { sourcingArchitect } from './poolLeads'
import { sumOpenPipelineValue } from './pipelineValue'

// Top 5 architects is a top five (owner's plan, BDM.md §8 Step 5).
export const TOP_ARCHITECTS_LIMIT = 5

// Does a naive TIMESTAMP string fall inside a Dashboard range? parseTimestamp
// reads it as the UTC wall clock it is; the range's bounds are real instants
// (local midnight to local end of day), so the comparison is exact rather than
// 5½ hours out.
export function inRange(value, range) {
  if (!value || !range) return false
  const at = parseTimestamp(value)
  if (!at || Number.isNaN(at.getTime())) return false
  return at >= range.start && at <= range.end
}

// The three BDM target actuals for one period, keyed by BDM_METRIC_OPTIONS
// value (src/lib/targetMetrics.js):
//   bdm_architect_meetings — Architect Meeting activities this BDM logged
//   bdm_joineries_received — this BDM's leads created in the period with
//                            joinery_received = true
//   bdm_leads_generated    — this BDM's leads created in the period, pool and
//                            their own alike
export function computeBdmTargetActuals({ leads, meetings, range, bdmId }) {
  const generated = (leads ?? []).filter((l) => l.bdm_employee_id === bdmId && inRange(l.created_at, range))
  return {
    bdm_architect_meetings: (meetings ?? []).filter(
      (m) => m.activity_type === 'architect_meeting' && m.employee_id === bdmId && inRange(m.created_at, range)
    ).length,
    bdm_joineries_received: generated.filter((l) => l.joinery_received === true).length,
    bdm_leads_generated: generated.length,
  }
}

// "Pipeline closed" (owner's ruling at Step 5: won, plus lost and win rate).
// Reduces the SAME rows the Closed card lists (buildClosedRows), so the figure
// and the list beside it can't disagree about which leads closed.
//
// A won lead with no order_value on file counts as won and adds nothing — the
// Closed card shows it with no figure rather than ₹0. Win rate is null until
// something closed: a 0% that means "nothing decided yet" would read as failure.
export function summariseClosedRows(rows) {
  const list = rows ?? []
  const won = list.filter((r) => r.outcome === 'won')
  const lostCount = list.filter((r) => r.outcome === 'lost').length
  const decided = won.length + lostCount
  return {
    wonCount: won.length,
    wonValue: won.reduce((s, r) => s + Number(r.value ?? 0), 0),
    lostCount,
    winRate: decided ? Math.round((won.length / decided) * 100) : null,
  }
}

// Top 5 architects for the chosen period. Ranked by joineries received in the
// period (the owner's rule), then meetings in the period, then open pipeline,
// then name, so the order is stable.
//
// - Joineries: this BDM's leads created in the period with joinery received,
//   credited to the architect Lead Detail's "via Architect" names
//   (sourcingArchitect — the referrer when an architect, else the other party).
// - Meetings ("Meetings" column, owner's ruling at Step 5): this BDM's
//   Architect Meetings with that architect in the period. A meeting logged
//   against a firm credits no architect.
// - Open pipeline: a snapshot, not the period — every open lead of this BDM's
//   that came through the architect, summed the Dashboard's way
//   (sumOpenPipelineValue, on hold left out).
//
// Only architects with a joinery or a meeting in the period qualify: an
// architect whose only link to the period is old pipeline didn't do anything
// in it. Leads must embed `referrer`/`other` as { id, name, party_type };
// meetings embed `parties` the same way.
//
// One BDM (`bdmId`, their own Dashboard) or several (`bdmIds`, the owner's
// Architect Network, Step 6) — the same rule either way, so the owner's
// company-wide Top 5 can't rank an architect differently from how their BDM's
// own card does. An exec's Architect Meeting never counts: only a BDM's.
export function topArchitects({ leads, meetings, range, bdmId, bdmIds, limit = TOP_ARCHITECTS_LIMIT }) {
  const ids = new Set(bdmIds ?? [bdmId])
  const byId = new Map()
  const entry = (party) => {
    if (!byId.has(party.id)) {
      byId.set(party.id, { architectId: party.id, name: party.name ?? null, joineries: 0, meetings: 0, leads: [] })
    }
    const e = byId.get(party.id)
    if (!e.name && party.name) e.name = party.name
    return e
  }

  for (const l of leads ?? []) {
    if (!ids.has(l.bdm_employee_id)) continue
    const architect = sourcingArchitect(l.referrer, l.other)
    if (!architect?.id) continue
    const e = entry(architect)
    e.leads.push(l)
    if (l.joinery_received === true && inRange(l.created_at, range)) e.joineries += 1
  }

  for (const m of meetings ?? []) {
    if (m.activity_type !== 'architect_meeting' || !ids.has(m.employee_id)) continue
    if (m.parties?.party_type !== 'architect' || !m.parties.id) continue
    if (!inRange(m.created_at, range)) continue
    entry(m.parties).meetings += 1
  }

  return [...byId.values()]
    .filter((e) => e.joineries > 0 || e.meetings > 0)
    .map(({ leads: architectLeads, ...e }) => ({ ...e, openValue: sumOpenPipelineValue(architectLeads) }))
    .sort(
      (a, b) =>
        b.joineries - a.joineries ||
        b.meetings - a.meetings ||
        b.openValue - a.openValue ||
        (a.name ?? '').localeCompare(b.name ?? '')
    )
    .slice(0, limit)
}
