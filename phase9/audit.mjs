#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 6 — THE AUDITOR
//
// Computes expected_ledger.json from simulation_plan.json ALONE.
//
// TWO RULES MAKE THIS WORTH ANYTHING. Both are firewalls, and breaking either
// turns Phase 7 into a tautology:
//
//   1. NO DATABASE. Nothing here queries Supabase. The ledger is what the data
//      SHOULD say; Phase 7 asks the CRM what it DOES say. If the ledger were
//      derived from the same database, agreement would prove nothing.
//
//   2. NO IMPORTING src/lib. The business rules below are RE-IMPLEMENTED from
//      their documented definitions in CLAUDE.md / DECISIONS.md, deliberately
//      not imported from `pipelineValue.js`, `attention.js`, `dayReview.js` or
//      `targetMetrics.js`. Importing them would bake any bug in those modules
//      into the expectation, and Phase 7 would then confirm the bug rather than
//      catch it. Where this file and the app disagree, that disagreement IS the
//      finding — which is the entire point.
//
// Consequence worth stating plainly: a Phase 7 mismatch is not automatically an
// app bug. It can also be MY misreading of the documented rule. Phase 7 must
// adjudicate each one against the documentation rather than assuming either
// side is right.
//
// SET-VALUED OUTPUT. Every bucket emits the actual lead refs, not just a count.
// A count mismatch tells you something is wrong; a set difference tells you
// which lead, which is what makes a finding actionable.
//
//   node phase9/audit.mjs
// ===========================================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, plan } from './lib.mjs'

// The plan's reference date by default. PHASE9_REF overrides it so Phase 7 can
// re-derive the ledger at the CURRENT date and separate genuine defects from
// ordinary demo drift — every age-based bucket moves as the clock does, and a
// lead ageing past a threshold overnight is not a bug.
const REF = process.env.PHASE9_REF || plan.meta.reference_date

// ---------------------------------------------------------------------------
// time
//
// Plan *_at values are naive UTC wall clock = IST minus 5h30m (see the plan's
// `conventions.timestamps`). Everything a user sees is IST, and the Day Review
// is bounded to an IST calendar day, so bucketing MUST convert back first.
// DATE columns (due_date, lost_at, quote_sent_at, lead_generated_at) are plain
// local dates and are NOT shifted.
// ---------------------------------------------------------------------------
const istDate = (naiveUtc) => {
  if (!naiveUtc) return null
  const d = new Date(naiveUtc + 'Z')
  d.setUTCMinutes(d.getUTCMinutes() + 330)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const daysSince = (date) => (date ? daysBetween(date, REF) : null)

// ---------------------------------------------------------------------------
// business rules, re-implemented from the documentation
// ---------------------------------------------------------------------------

// CLAUDE.md, Needs Attention: "STALE_DAYS (7) and ATTENTION_DAYS (14) are two
// different questions" — 7 is when a lead READS as stale (labels/colour only),
// 14 is when it ENTERS the queue. Re-confirmed by the owner 2026-08-12.
const STALE_DAYS = 7
const ATTENTION_DAYS = 14
// The other Needs Attention thresholds, from attention.js's documented constants.
const QUOTE_SILENT_DAYS = 5
const RFQ_PENDING_DAYS = 3

const OPEN = (l) => l.current_stage !== 'won' && l.current_stage !== 'lost'

// CLAUDE.md, Pipeline/deal value: for an OPEN lead, order_value is ignored even
// if present (it is only written when a deal is booked), so the value is
// quote_value alone. A won/lost lead keeps order_value ?? quote_value.
//
// NOTE — this returns null for "no value known", NOT 0. The documented rule is
// explicit: "never a fabricated 0 — a lead with neither value renders '—'".
// The app's own dealValueFor() coerces to 0 instead; that disagreement is
// finding F-P4-2 and is deliberately NOT mirrored here.
const dealValue = (l) => {
  const v = OPEN(l) ? l.quote_value : (l.order_value ?? l.quote_value)
  return v == null ? null : Number(v)
}
const sumValue = (leads) => leads.reduce((s, l) => s + (dealValue(l) ?? 0), 0)

// ---------------------------------------------------------------------------
// derived indexes
// ---------------------------------------------------------------------------
const EXECS = plan.employees.filter((e) => e.role === 'sales_executive').map((e) => e.ref)
const COORDS = plan.employees.filter((e) => e.role === 'sales_coordinator').map((e) => e.ref)

// Q-P1-2 ruling: team aggregates come from FINAL coordinator_id only. History
// follows the person — an exec's whole past moves with them, retroactively.
const TEAM = Object.fromEntries(
  COORDS.map((c) => [c, plan.employees.filter((e) => e.coordinator_ref === c).map((e) => e.ref)])
)

// exec_touches / sc_edits are the LAST write, so they define final state.
const patched = new Map()
for (const t of [...plan.exec_touches, ...plan.sc_edits]) {
  patched.set(t.lead_ref, { ...(patched.get(t.lead_ref) ?? {}), ...t.patch })
}
const leads = plan.leads.map((l) => ({ ...l, ...(patched.get(l.ref) ?? {}) }))
const leadByRef = new Map(leads.map((l) => [l.ref, l]))

// Last activity per lead, as an IST date.
const lastActivity = new Map()
for (const a of plan.activities) {
  if (!a.lead_ref) continue
  const d = istDate(a.created_at)
  const cur = lastActivity.get(a.lead_ref)
  if (!cur || d > cur) lastActivity.set(a.lead_ref, d)
}

// A lead's "last touch" falls back to its creation date when nothing is logged.
const lastTouch = (l) => lastActivity.get(l.ref) ?? istDate(l.created_at)
const silentDays = (l) => daysSince(lastTouch(l))

// stage_history won date, the only place a won date is derivable.
const wonAt = new Map()
for (const s of plan.stage_history) {
  if (s.stage !== 'won') continue
  const d = istDate(s.changed_at)
  const cur = wonAt.get(s.lead_ref)
  if (!cur || d > cur) wonAt.set(s.lead_ref, d)
}

// ---------------------------------------------------------------------------
// Needs Attention — five buckets, emitting refs not just counts
// ---------------------------------------------------------------------------
const openLeads = leads.filter(OPEN)

const buckets = {
  stale: openLeads.filter((l) => silentDays(l) >= ATTENTION_DAYS),
  silent_quotes: openLeads.filter(
    (l) => l.quote_sent && l.quote_sent_at && daysSince(l.quote_sent_at) >= QUOTE_SILENT_DAYS &&
      (lastActivity.get(l.ref) ?? '0000-00-00') <= l.quote_sent_at
  ),
  followups_overdue: openLeads.filter((l) => l.next_followup_date && l.next_followup_date < REF),
  slipped: openLeads.filter((l) => l.estimated_close_date && l.estimated_close_date < REF),
  pending_rfq: openLeads.filter(
    (l) => l.rfq_raised && l.rfq_raised_at && !l.quote_sent && daysSince(l.rfq_raised_at) >= RFQ_PENDING_DAYS
  ),
}

// The negative control (Phase 1, Q-P1-1): leads in the 9–12 day band read as
// stale but must NOT appear in any queue. If Phase 7 finds one in a queue,
// either the constants were collapsed or a 10-day rule crept back in.
const coolingBand = openLeads.filter((l) => {
  const d = silentDays(l)
  return d >= STALE_DAYS && d < ATTENTION_DAYS
})

// ---------------------------------------------------------------------------
// per-employee
// ---------------------------------------------------------------------------
const ACTIVITY_TYPES = ['site_visit', 'call', 'rfq_raised', 'office_day', 'booking_update', 'architect_meeting']

const perEmployee = {}
for (const ref of EXECS) {
  const owned = leads.filter((l) => l.owner_employee_ref === ref)
  const open = owned.filter(OPEN)
  const won = owned.filter((l) => l.current_stage === 'won')
  const lost = owned.filter((l) => l.current_stage === 'lost')

  // Exception 3b: activity credit follows activities.employee_id, lead credit
  // follows the FINAL owner. For the two cross-team reassigned leads these
  // deliberately diverge — activities logged before the handover stay with the
  // original exec while the lead itself counts for the new one. Both are
  // emitted separately so Phase 7 can check each on its own terms.
  const acts = plan.activities.filter((a) => a.employee_ref === ref)
  const byType = Object.fromEntries(
    ACTIVITY_TYPES.map((t) => [t, acts.filter((a) => a.activity_type === t).length])
  )

  const created = leads.filter((l) => l.expected_created_by_employee_ref === ref)
  const fus = plan.follow_ups.filter((f) => f.assigned_to_ref === ref)

  perEmployee[ref] = {
    leads_owned: owned.length,
    open_leads: open.length,
    open_pipeline_value: sumValue(open),
    won_count: won.length,
    won_value: won.reduce((s, l) => s + (dealValue(l) ?? 0), 0),
    lost_count: lost.length,
    leads_created: created.length,
    activities_total: acts.length,
    activities_by_type: byType,
    follow_ups_assigned: fus.length,
    follow_ups_done: fus.filter((f) => f.is_done).length,
    follow_ups_open_overdue: fus.filter((f) => !f.is_done && f.due_date < REF).length,
    attention: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, v.filter((l) => l.owner_employee_ref === ref).length])
    ),
    // win rate over decided leads only — an open lead is not a loss.
    win_rate_pct: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
  }
}

// ---------------------------------------------------------------------------
// per coordinator team (final coordinator_id — Q-P1-2)
// ---------------------------------------------------------------------------
const perTeam = {}
for (const c of COORDS) {
  const members = TEAM[c]
  const owned = leads.filter((l) => members.includes(l.owner_employee_ref))
  const acts = plan.activities.filter((a) => members.includes(a.employee_ref))
  perTeam[c] = {
    members,
    leads_owned: owned.length,
    open_leads: owned.filter(OPEN).length,
    open_pipeline_value: sumValue(owned.filter(OPEN)),
    won_count: owned.filter((l) => l.current_stage === 'won').length,
    activities_total: acts.length,
    attention_total: Object.values(buckets).reduce(
      (s, v) => s + v.filter((l) => members.includes(l.owner_employee_ref)).length,
      0
    ),
  }
}

// ---------------------------------------------------------------------------
// company-wide breakdowns
// ---------------------------------------------------------------------------
const groupCount = (rows, key) => {
  const m = {}
  for (const r of rows) {
    const k = key(r) ?? 'Not set'
    m[k] ??= { count: 0, value: 0 }
    m[k].count++
    m[k].value += dealValue(r) ?? 0
  }
  return m
}

const areaByRef = Object.fromEntries(plan.areas.map((a) => [a.ref, a.area_name]))
const productByRef = Object.fromEntries(plan.products.map((p) => [p.ref, p.name]))
const siteByRef = Object.fromEntries(plan.sites.map((s) => [s.ref, s]))

// Q-P1-3 ruling: BOTH readings must be emitted and MUST NOT be collapsed.
const lossByReasonEvents = {}
const lossByReasonCurrent = {}
for (const lr of plan.loss_reasons) {
  lossByReasonEvents[lr.reason] = (lossByReasonEvents[lr.reason] ?? 0) + 1
  if (leadByRef.get(lr.lead_ref)?.current_stage === 'lost') {
    lossByReasonCurrent[lr.reason] = (lossByReasonCurrent[lr.reason] ?? 0) + 1
  }
}

// ---------------------------------------------------------------------------
// Day Review for the reference date (IST-bounded)
// ---------------------------------------------------------------------------
const dayFor = (dateISO) => {
  const out = {}
  for (const ref of EXECS) {
    const acts = plan.activities.filter((a) => a.employee_ref === ref && istDate(a.created_at) === dateISO)
    const touched = new Set(acts.map((a) => a.lead_ref).filter(Boolean))
    const created = leads.filter(
      (l) => l.expected_created_by_employee_ref === ref && istDate(l.created_at) === dateISO
    )
    const due = plan.follow_ups.filter((f) => f.assigned_to_ref === ref && f.due_date === dateISO)
    const tomorrow = plan.follow_ups.filter(
      (f) => f.assigned_to_ref === ref && f.due_date === new Date(Date.parse(dateISO) + 86400000).toISOString().slice(0, 10)
    )
    // Changes come from lead_change_log, whose corrected timestamps are the
    // plan's post_seed_corrections. Attribution is the lead's creator for
    // 'created' rows and the value-updating author otherwise — both are the
    // lead's own author in this plan.
    const changes = plan.post_seed_corrections.lead_change_log.filter((c) => {
      if (istDate(c.intended_changed_at) !== dateISO) return false
      const l = leadByRef.get(c.lead_ref)
      return l && (l.authored_by === ref || l.expected_created_by_employee_ref === ref)
    })
    out[ref] = {
      activities: acts.length,
      calls: acts.filter((a) => a.activity_type === 'call').length,
      visits: acts.filter((a) => a.activity_type === 'site_visit').length,
      leads_touched: touched.size,
      leads_created: created.length,
      changes: changes.length,
      quotes_sent: leads.filter((l) => l.owner_employee_ref === ref && l.quote_sent_at === dateISO).length,
      followups_due: due.length,
      followups_done: due.filter((f) => f.is_done).length,
      followups_tomorrow: tomorrow.length,
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
const ledger = {
  _readme:
    'PHASE 9 EXPECTED LEDGER — computed from simulation_plan.json ALONE by phase9/audit.mjs. ' +
    'No database was queried and no src/lib module was imported; every business rule is re-implemented ' +
    'from its documented definition so that a Phase 7 mismatch is a real signal rather than a tautology. ' +
    'A mismatch may be an app bug OR a misreading of the documented rule here — Phase 7 adjudicates.',
  meta: {
    generated_by: 'phase9/audit.mjs',
    reference_date: REF,
    plan_prng_seed: plan.meta.prng_seed,
    rules: {
      deal_value:
        'open lead -> quote_value only (order_value ignored even if present); won/lost -> order_value ?? quote_value. NULL when neither is set — never 0.',
      staleness: `STALE_DAYS=${STALE_DAYS} (reads as stale), ATTENTION_DAYS=${ATTENTION_DAYS} (enters the queue). No 10-day rule exists.`,
      coordinator_teams: 'final coordinator_id only (Q-P1-2) — history follows the person, retroactively.',
      loss_reasons: 'BOTH readings emitted (Q-P1-3): loss EVENTS and CURRENTLY-lost leads. Never collapsed.',
      timestamps: 'plan *_at are naive UTC = IST-5h30m; bucketed by IST calendar day. DATE columns unshifted.',
    },
  },

  company: {
    leads_total: leads.length,
    open_leads: openLeads.length,
    won_count: leads.filter((l) => l.current_stage === 'won').length,
    lost_count: leads.filter((l) => l.current_stage === 'lost').length,
    open_pipeline_value: sumValue(openLeads),
    leads_with_no_value: openLeads.filter((l) => dealValue(l) === null).length,
    activities_total: plan.activities.length,
    activities_by_type: Object.fromEntries(
      ACTIVITY_TYPES.map((t) => [t, plan.activities.filter((a) => a.activity_type === t).length])
    ),
    by_stage: groupCount(leads, (l) => l.current_stage),
    by_source: groupCount(leads, (l) => l.source_type),
    by_area: groupCount(leads, (l) => (l.site_ref ? areaByRef[siteByRef[l.site_ref]?.area_ref] : 'No site')),
    by_product: groupCount(leads, (l) => (l.product_ref ? productByRef[l.product_ref] : 'Not specified')),
    by_site_stage: groupCount(leads, (l) => (l.site_ref ? (siteByRef[l.site_ref]?.site_stage ?? 'Not set') : 'No site')),
    follow_ups: {
      total: plan.follow_ups.length,
      done: plan.follow_ups.filter((f) => f.is_done).length,
      open_overdue: plan.follow_ups.filter((f) => !f.is_done && f.due_date < REF).length,
      due_today: plan.follow_ups.filter((f) => !f.is_done && f.due_date === REF).length,
      assigned_by_another: plan.follow_ups.filter((f) => f.assigned_to_ref !== f.created_by_ref).length,
    },
  },

  needs_attention: Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [
      k,
      { count: v.length, value: sumValue(v), lead_refs: v.map((l) => l.ref).sort() },
    ])
  ),

  negative_control_cooling_band: {
    _why:
      'These leads are past STALE_DAYS but short of ATTENTION_DAYS. They must READ as stale on the lead itself ' +
      'and must NOT appear in the SILENCE-driven queue. One showing up there in Phase 7 means either the two ' +
      'constants were collapsed back together or a 10-day rule crept in from the brief.',
    _scope_correction:
      'SCOPED TO THE `stale` BUCKET ONLY — this was initially written as "must not appear in ANY queue", which ' +
      'is wrong and would have produced a false finding in Phase 7. The other four buckets key off unrelated ' +
      'conditions: an overdue next_followup_date, a slipped estimated_close_date, a silent quote, a pending RFQ. ' +
      'A lead can legitimately be 10 days silent AND carry an overdue reminder — those are independent facts, and ' +
      `${coolingBand.filter((l) => l.next_followup_date && l.next_followup_date < REF).length} of these leads genuinely are. ` +
      'Only presence in `stale` disproves the threshold split.',
    count: coolingBand.length,
    lead_refs: coolingBand.map((l) => l.ref).sort(),
    must_be_absent_from: ['needs_attention.stale'],
    may_legitimately_appear_in: ['followups_overdue', 'slipped', 'silent_quotes', 'pending_rfq'],
    silent_days_each: Object.fromEntries(coolingBand.map((l) => [l.ref, silentDays(l)])),
  },

  per_employee: perEmployee,
  per_coordinator_team: perTeam,

  loss_reasons: {
    _ruling: 'Q-P1-3 is DEFERRED to Phase 7. Both counts are emitted and must not be collapsed.',
    a_loss_events: { total: plan.loss_reasons.length, by_reason: lossByReasonEvents },
    b_currently_lost: {
      total: plan.loss_reasons.filter((lr) => leadByRef.get(lr.lead_ref)?.current_stage === 'lost').length,
      by_reason: lossByReasonCurrent,
    },
    expected_visible_symptom:
      'The "Why we lose" card totals higher than the `lost` count on Pipeline by stage. Both figures are correct ' +
      'under their own reading; this is NOT a mismatch to report until the owner chooses.',
  },

  day_review: { [REF]: dayFor(REF) },

  closure_forecast: leads
    .filter((l) => OPEN(l) && (l.quote_sent || l.closure_probability != null))
    .map((l) => ({
      ref: l.ref,
      owner: l.owner_employee_ref,
      value: dealValue(l),
      probability: l.closure_probability,
      estimated_close_date: l.estimated_close_date,
      slipped: !!(l.estimated_close_date && l.estimated_close_date < REF),
    }))
    .sort((a, b) => String(a.estimated_close_date).localeCompare(String(b.estimated_close_date))),

  cross_team_reassignment: {
    _why:
      'Exception 3b. Activity credit follows activities.employee_id; lead credit follows the FINAL owner. These ' +
      'deliberately diverge for these leads — Phase 7 must check each metric on its own terms rather than expecting ' +
      'one answer.',
    leads: plan.lead_owner_history.map((h) => ({
      lead_ref: h.lead_ref,
      original_owner: h.old_owner_ref,
      final_owner: h.new_owner_ref,
      activities_still_credited_to_original: plan.activities.filter(
        (a) => a.lead_ref === h.lead_ref && a.employee_ref === h.old_owner_ref
      ).length,
    })),
  },
}

// The canonical ledger keeps the plan's reference date. An override writes a
// separate, clearly-named file so Phase 6's deliverable is never overwritten by
// a drift-adjusted re-derivation.
const out = join(ROOT, process.env.PHASE9_REF ? `expected_ledger_at_${REF}.json` : 'expected_ledger.json')
writeFileSync(out, JSON.stringify(ledger, null, 2) + '\n')

// --- console summary (structure only — figures live in the file) -----------
console.log('PHASE 6 — AUDITOR')
console.log(`reference date ${REF}, computed from simulation_plan.json alone\n`)
console.log(`  company metrics          ${Object.keys(ledger.company).length}`)
console.log(`  needs-attention buckets  ${Object.keys(ledger.needs_attention).length}`)
console.log(`  negative-control leads   ${ledger.negative_control_cooling_band.count}`)
console.log(`  per-employee blocks      ${Object.keys(perEmployee).length}`)
console.log(`  per-team blocks          ${Object.keys(perTeam).length}`)
console.log(`  closure-forecast rows    ${ledger.closure_forecast.length}`)
console.log(`  day-review execs         ${Object.keys(ledger.day_review[REF]).length}`)
console.log(`\nwrote ${out.replace(ROOT, '.')} (${(readFileSync(out).length / 1024).toFixed(1)} KB)`)
