#!/usr/bin/env node
// ============================================================================
// PHASE 9 / PHASE 1 — SIMULATION PLAN VALIDATOR
// ----------------------------------------------------------------------------
// Checks simulation_plan.json for internal consistency BEFORE any database
// write happens. Phase 2 seeds from this file and Phase 6 computes the expected
// ledger from it, so a contradiction in here becomes a false "bug" in Phase 7
// that costs far more to chase than it does to catch now.
//
// This validates the PLAN against itself and against the live schema's
// constraints. It does NOT compute business aggregates — that is Phase 6's job
// and must stay database-blind and plan-only.
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const plan = JSON.parse(readFileSync(join(HERE, '..', 'simulation_plan.json'), 'utf8'))

let failures = 0
let warnings = 0
const fail = (msg) => { failures++; console.log(`  [31mFAIL[0m  ${msg}`) }
const warn = (msg) => { warnings++; console.log(`  [33mWARN[0m  ${msg}`) }
const ok = (msg) => console.log(`  [32m ok [0m  ${msg}`)

function check(label, condition, detail = '') {
  if (condition) ok(label)
  else fail(`${label}${detail ? ` — ${detail}` : ''}`)
}

const REF = new Date(`${plan.meta.reference_date}T00:00:00Z`)
// End of the reference DAY. "Nothing in the future" must be measured against
// this, not against midnight: an activity legitimately logged today carries a
// working-hours timestamp, which is of course later than 00:00 on that date.
const REF_END = new Date(REF.getTime() + 86400000)
const START = new Date(`${plan.meta.window_start}T00:00:00Z`)
const ts = (s) => new Date(`${s}Z`)

// ---------------------------------------------------------------------------
console.log('\n=== 1. Referential integrity (every *_ref resolves) ===')
// ---------------------------------------------------------------------------
const refSets = {
  employee: new Set([plan.owner.ref, ...plan.employees.map((e) => e.ref)]),
  area: new Set(plan.areas.map((a) => a.ref)),
  product: new Set(plan.products.map((p) => p.ref)),
  party: new Set(plan.parties.map((p) => p.ref)),
  site: new Set(plan.sites.map((s) => s.ref)),
  lead: new Set(plan.leads.map((l) => l.ref)),
}

function checkRefs(label, rows, mapping) {
  const bad = []
  for (const row of rows) {
    for (const [field, kind] of Object.entries(mapping)) {
      const v = row[field]
      if (v == null) continue
      if (!refSets[kind].has(v)) bad.push(`${row.ref}.${field}=${v}`)
    }
  }
  check(`${label} (${rows.length} rows)`, bad.length === 0, `dangling: ${bad.slice(0, 5).join(', ')}`)
}

checkRefs('parties', plan.parties, { created_by_ref: 'employee', authored_by: 'employee', area_ref: 'area' })
checkRefs('sites', plan.sites, { discovered_by_ref: 'employee', authored_by: 'employee', area_ref: 'area', primary_contact_party_ref: 'party' })
checkRefs('site_contacts', plan.site_contacts, { site_ref: 'site', party_ref: 'party', authored_by: 'employee' })
checkRefs('leads', plan.leads, {
  site_ref: 'site', party_ref: 'party', product_ref: 'product',
  owner_employee_ref: 'employee', referred_by_party_ref: 'party',
  other_party_ref: 'party', authored_by: 'employee',
})
checkRefs('activities', plan.activities, { employee_ref: 'employee', party_ref: 'party', lead_ref: 'lead', accompanied_by_ref: 'employee', authored_by: 'employee' })
checkRefs('stage_history', plan.stage_history, { lead_ref: 'lead', changed_by_ref: 'employee', authored_by: 'employee' })
checkRefs('follow_ups', plan.follow_ups, { assigned_to_ref: 'employee', created_by_ref: 'employee', party_ref: 'party', lead_ref: 'lead', authored_by: 'employee' })
checkRefs('targets', plan.targets, { employee_ref: 'employee', authored_by: 'employee' })
checkRefs('loss_reasons', plan.loss_reasons, { lead_ref: 'lead', authored_by: 'employee' })
checkRefs('lead_owner_history', plan.lead_owner_history, { lead_ref: 'lead', old_owner_ref: 'employee', new_owner_ref: 'employee', changed_by_ref: 'employee', authored_by: 'employee' })

// ---------------------------------------------------------------------------
console.log('\n=== 2. Database CHECK constraints ===')
// ---------------------------------------------------------------------------
check('lead_needs_an_anchor: every lead has a site or a party',
  plan.leads.every((l) => l.site_ref || l.party_ref))
check('activity_needs_an_anchor: non-office_day activities have an anchor',
  plan.activities.every((a) => a.activity_type === 'office_day' || a.party_ref || a.lead_ref))
check('leads.source_type in CHECK list',
  plan.leads.every((l) => ['scanning','lixil','referral_architect','referral_other','showroom_walkin'].includes(l.source_type)))
check('activities.activity_type in CHECK list (incl. architect_meeting)',
  plan.activities.every((a) => ['site_visit','call','rfq_raised','office_day','booking_update','architect_meeting'].includes(a.activity_type)))
check('parties.party_type in CHECK list (incl. pmc)',
  plan.parties.every((p) => ['client','architect','builder','firm','other','pmc'].includes(p.party_type)))
check('site_contacts.role in CHECK list',
  plan.site_contacts.every((s) => ['owner','architect','builder','project_manager','site_staff','other'].includes(s.role)))
check('follow_ups.activity_type in CHECK list (incl. other)',
  plan.follow_ups.every((f) => f.activity_type == null || ['site_visit','call','rfq_raised','office_day','booking_update','architect_meeting','other'].includes(f.activity_type)))
check('targets.period_type in CHECK list (incl. quarter)',
  plan.targets.every((t) => ['week','month','quarter','year'].includes(t.period_type)))
check('leads.closure_probability between 0 and 100',
  plan.leads.every((l) => l.closure_probability == null || (l.closure_probability >= 0 && l.closure_probability <= 100)))
check('parties.verification_status in CHECK list',
  plan.parties.every((p) => ['unverified','verified'].includes(p.verification_status)))
check('sites.discovered_via in CHECK list',
  plan.sites.every((s) => s.discovered_via == null || ['scanning','lixil','referral_architect','referral_other','showroom_walkin'].includes(s.discovered_via)))

const dupContacts = new Set()
let dupCount = 0
plan.site_contacts.forEach((s) => {
  const k = `${s.site_ref}|${s.party_ref}|${s.role}`
  if (dupContacts.has(k)) dupCount++
  dupContacts.add(k)
})
check('site_contacts UNIQUE(site,party,role) respected', dupCount === 0, `${dupCount} duplicates`)

// ---------------------------------------------------------------------------
console.log('\n=== 3. Business-logic self-consistency ===')
// ---------------------------------------------------------------------------
const badQuote = plan.leads.filter((l) => l.quote_sent && (!l.quote_sent_at || l.quote_value == null))
check('quote_sent implies quote_sent_at AND quote_value', badQuote.length === 0, `${badQuote.length} leads`)
const badQuote2 = plan.leads.filter((l) => !l.quote_sent && (l.quote_sent_at || l.quote_value != null))
check('no quote_value/quote_sent_at when quote_sent is false', badQuote2.length === 0, `${badQuote2.length} leads`)
const badRfq = plan.leads.filter((l) => l.rfq_raised && !l.rfq_raised_at)
check('rfq_raised implies rfq_raised_at', badRfq.length === 0, `${badRfq.length} leads`)
const badFunnel = plan.leads.filter((l) => l.quote_sent && !l.rfq_raised)
check('quote_sent implies rfq_raised (funnel order)', badFunnel.length === 0, `${badFunnel.length} leads`)
// An RFQ dated after the quote it produced is an internal contradiction that
// would read as a CRM bug during reconciliation. Silent-quote leads are exempt:
// their quote is deliberately re-dated after the last touch by a post-pass.
const rfqAfterQuote = plan.leads.filter(
  (l) => l.rfq_raised_at && l.quote_sent_at &&
         l.rfq_raised_at > l.quote_sent_at &&
         !l.exceptions.includes('bucket_silent_quote')
)
check('rfq_raised_at never falls after quote_sent_at', rfqAfterQuote.length === 0,
  `${rfqAfterQuote.length} leads e.g. ${rfqAfterQuote.slice(0, 3).map((l) => `${l.ref} rfq ${l.rfq_raised_at} > quote ${l.quote_sent_at}`).join('; ')}`)
// The stage timeline and the date columns must tell the same story.
const shByLeadEarly = new Map()
plan.stage_history.forEach((s) => {
  if (!shByLeadEarly.has(s.lead_ref)) shByLeadEarly.set(s.lead_ref, [])
  shByLeadEarly.get(s.lead_ref).push(s)
})
const quoteStageMismatch = plan.leads.filter((l) => {
  if (!l.quote_sent_at || l.exceptions.includes('bucket_silent_quote')) return false
  const row = (shByLeadEarly.get(l.ref) ?? []).find((s) => s.stage === 'quote_submission')
  // DATE columns record the IST day; changed_at is stored as naive UTC.
  return row && new Date(new Date(`${row.changed_at}Z`).getTime() + 330 * 60000).toISOString().slice(0, 10) !== l.quote_sent_at
})
check('quote_sent_at matches the quote_submission stage change date',
  quoteStageMismatch.length === 0, `${quoteStageMismatch.length} leads`)
check('no internal helper fields leaked into the plan',
  plan.leads.every((l) => !('_last_touch_date' in l) && !('_won_at' in l)))
// stage_history is emitted in funnel order, so its timestamps must be
// non-decreasing in that same order. A lead cannot reach negotiation before the
// quote submission that preceded it.
const shOrderBad = []
{
  const byLead = new Map()
  plan.stage_history.forEach((s) => {
    if (!byLead.has(s.lead_ref)) byLead.set(s.lead_ref, [])
    byLead.get(s.lead_ref).push(s)
  })
  for (const [leadRef, rows] of byLead) {
    // Reopened leads deliberately go forward, back to 'lost', then forward
    // again — emission order still holds, so a plain sequential check is right.
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].changed_at < rows[k - 1].changed_at) {
        shOrderBad.push(`${leadRef}: ${rows[k - 1].stage}@${rows[k - 1].changed_at} -> ${rows[k].stage}@${rows[k].changed_at}`)
      }
    }
  }
}
check('stage_history timestamps never move backwards along a lead funnel',
  shOrderBad.length === 0, `${shOrderBad.length} e.g. ${shOrderBad.slice(0, 3).join(' | ')}`)

// Windows and doors are a long sale. A lead that ran the full funnel inside a
// day or two is not a plausible record and makes days-in-stage meaningless.
const cycleDays = []
{
  const byLead = new Map()
  plan.stage_history.forEach((s) => {
    if (!byLead.has(s.lead_ref)) byLead.set(s.lead_ref, [])
    byLead.get(s.lead_ref).push(s)
  })
  for (const [leadRef, rows] of byLead) {
    if (rows.length < 4) continue // only judge leads that really ran a funnel
    const lead = plan.leads.find((l) => l.ref === leadRef)
    const span = (ts(rows[rows.length - 1].changed_at) - ts(lead.created_at)) / 86400000
    cycleDays.push({ leadRef, span, steps: rows.length })
  }
}
const tooFast = cycleDays.filter((c) => c.span < 7)
const medianCycle = cycleDays.length
  ? cycleDays.map((c) => c.span).sort((a, b) => a - b)[Math.floor(cycleDays.length / 2)]
  : 0
console.log(`         deep-funnel leads: ${cycleDays.length}, median cycle ${medianCycle.toFixed(0)} days, fastest ${Math.min(...cycleDays.map((c) => c.span)).toFixed(1)} days`)
check('no deep-funnel lead completes in under a week', tooFast.length === 0,
  `${tooFast.length} e.g. ${tooFast.slice(0, 3).map((c) => `${c.leadRef} ${c.span.toFixed(1)}d over ${c.steps} steps`).join('; ')}`)
check('median sales cycle is genuinely multi-week', medianCycle >= 21, `${medianCycle.toFixed(0)} days`)

const wonLeads = plan.leads.filter((l) => l.current_stage === 'won')
const lostLeads = plan.leads.filter((l) => l.current_stage === 'lost')
const shByLead = new Map()
plan.stage_history.forEach((s) => {
  if (!shByLead.has(s.lead_ref)) shByLead.set(s.lead_ref, [])
  shByLead.get(s.lead_ref).push(s)
})
check('every won lead has a stage_history "won" row (won_date is derivable)',
  wonLeads.every((l) => (shByLead.get(l.ref) ?? []).some((s) => s.stage === 'won')))
check('every won lead has an order_value', wonLeads.every((l) => l.order_value != null))
const lossByLead = new Set(plan.loss_reasons.map((r) => r.lead_ref))
check('every lost lead has a loss_reasons row (no skip-for-now escape hatch)',
  lostLeads.every((l) => lossByLead.has(l.ref)))
check('every lost lead has a stage_history "lost" row',
  lostLeads.every((l) => (shByLead.get(l.ref) ?? []).some((s) => s.stage === 'lost')))

const openWithOrder = plan.leads.filter((l) => !['won','lost'].includes(l.current_stage) && l.order_value != null)
check('the open-lead-with-order_value anomaly is present and bounded',
  openWithOrder.length === 3, `found ${openWithOrder.length}, expected exactly 3`)
check('...and each is tagged as a deliberate anomaly',
  openWithOrder.every((l) => l.exceptions.includes('anomaly_open_lead_with_order_value')))

// current_stage values must all be recognised, or chips render as raw text
const STAGES = ['calling','presentation','joinery_follow_up','measurements','design_discussion','rfq','quote_submission','negotiation','on_hold','won','lost']
check('every current_stage is a recognised LEAD_STAGE_OPTIONS value',
  plan.leads.every((l) => STAGES.includes(l.current_stage)))
check('every stage_history.stage is recognised',
  plan.stage_history.every((s) => STAGES.includes(s.stage)))

// ---------------------------------------------------------------------------
console.log('\n=== 4. Chronology ===')
// ---------------------------------------------------------------------------
const leadByRef = new Map(plan.leads.map((l) => [l.ref, l]))
let actBeforeLead = 0, actAfterRef = 0, actBeforeWindow = 0
plan.activities.forEach((a) => {
  const t = ts(a.created_at)
  if (t > REF_END) actAfterRef++
  if (t < START) actBeforeWindow++
  if (a.lead_ref) {
    const l = leadByRef.get(a.lead_ref)
    if (l && t < ts(l.created_at)) actBeforeLead++
  }
})
check('no activity predates its lead', actBeforeLead === 0, `${actBeforeLead}`)
check('no activity after the reference date', actAfterRef === 0, `${actAfterRef}`)
check('no activity before the window start', actBeforeWindow === 0, `${actBeforeWindow}`)

let shBeforeLead = 0, shAfterRef = 0
plan.stage_history.forEach((s) => {
  const t = ts(s.changed_at)
  if (t > REF_END) shAfterRef++
  const l = leadByRef.get(s.lead_ref)
  if (l && t < ts(l.created_at)) shBeforeLead++
})
check('no stage change predates its lead', shBeforeLead === 0, `${shBeforeLead}`)
check('no stage change after the reference date', shAfterRef === 0, `${shAfterRef}`)

const leadsOutOfWindow = plan.leads.filter((l) => ts(l.created_at) < START || ts(l.created_at) > REF_END)
check('every lead created inside the six-month window', leadsOutOfWindow.length === 0, `${leadsOutOfWindow.length}`)

const doneBeforeCreate = plan.follow_ups.filter((f) => f.done_at && ts(f.done_at) < ts(f.created_at))
check('no follow-up completed before it was created', doneBeforeCreate.length === 0, `${doneBeforeCreate.length}`)
check('every is_done follow-up has a done_at',
  plan.follow_ups.every((f) => !f.is_done || f.done_at != null))
check('no not-done follow-up has a done_at',
  plan.follow_ups.every((f) => f.is_done || f.done_at == null))

// ---------------------------------------------------------------------------
console.log('\n=== 5. Seeding identity (RLS + trigger consequences) ===')
// ---------------------------------------------------------------------------
const empByRef = new Map([[plan.owner.ref, plan.owner], ...plan.employees.map((e) => [e.ref, e])])
const roleOf = (ref) => empByRef.get(ref)?.role
const coordOf = (ref) => empByRef.get(ref)?.coordinator_ref ?? null

// enforce_owner_only_stage_change + owner-only stage_history INSERT policy
const badStageAuthor = plan.stage_history.filter((s) => {
  const r = roleOf(s.authored_by)
  return r !== 'owner' && r !== 'sales_coordinator'
})
check('every stage_history row authored by an owner or a coordinator',
  badStageAuthor.length === 0, `${badStageAuthor.length} authored by an exec — would be rejected`)

// An SC may only write stage history for their OWN team
const scStageWrongTeam = plan.stage_history.filter((s) => {
  if (roleOf(s.authored_by) !== 'sales_coordinator') return false
  const lead = leadByRef.get(s.lead_ref)
  // Stage history is written BEFORE any reassignment UPDATE, so team
  // membership is judged against whoever owned the lead at that point.
  return coordOf(lead.original_owner_employee_ref ?? lead.owner_employee_ref) !== s.authored_by
})
check('no coordinator authors stage history for another coordinator team',
  scStageWrongTeam.length === 0, `${scStageWrongTeam.length} cross-team writes would be rejected`)

// Leads/activities authored by an SC must belong to that SC's own team
const scLeadWrongTeam = plan.leads.filter(
  (l) => roleOf(l.authored_by) === 'sales_coordinator' && coordOf(l.owner_employee_ref) !== l.authored_by
)
check('no coordinator inserts a lead for another team', scLeadWrongTeam.length === 0, `${scLeadWrongTeam.length}`)
const scActWrongTeam = plan.activities.filter(
  (a) => roleOf(a.authored_by) === 'sales_coordinator' && coordOf(a.employee_ref) !== a.authored_by
)
check('no coordinator logs an activity for another team', scActWrongTeam.length === 0, `${scActWrongTeam.length}`)

// An exec may only insert their own leads/activities
// A reassigned lead is inserted by its ORIGINAL owner and only then moved, so
// authored_by is compared against original_owner_employee_ref when present.
const execLeadNotOwn = plan.leads.filter(
  (l) => roleOf(l.authored_by) === 'sales_executive' &&
         l.authored_by !== (l.original_owner_employee_ref ?? l.owner_employee_ref)
)
check('no exec inserts a lead they do not own', execLeadNotOwn.length === 0, `${execLeadNotOwn.length}`)
const execActNotOwn = plan.activities.filter(
  (a) => roleOf(a.authored_by) === 'sales_executive' && a.authored_by !== a.employee_ref
)
check('no exec logs an activity credited to someone else', execActNotOwn.length === 0, `${execActNotOwn.length}`)

// entered_by_role must match who writes the row
const badEnteredLead = plan.leads.filter((l) => {
  const expected = roleOf(l.authored_by) === 'sales_executive' ? 'sales_executive' : null
  const touched = l.exceptions.includes('ex7b_exec_took_over_locked')
  return l.expected_entered_by_role !== (touched ? 'sales_executive' : expected)
})
check('leads.expected_entered_by_role follows from the author (+ later exec touch)',
  badEnteredLead.length === 0, `${badEnteredLead.length}`)
const badEnteredAct = plan.activities.filter(
  (a) => a.expected_entered_by_role !== (roleOf(a.authored_by) === 'sales_executive' ? 'sales_executive' : null)
)
check('activities.expected_entered_by_role follows from the author', badEnteredAct.length === 0, `${badEnteredAct.length}`)
const badLoggedBy = plan.activities.filter((a) => a.expected_logged_by_employee_ref !== a.authored_by)
check('activities.expected_logged_by_employee_ref equals the author', badLoggedBy.length === 0, `${badLoggedBy.length}`)

// An SC owns no leads and logs no activities of their own
check('no lead is owned by a coordinator or the owner',
  plan.leads.every((l) => roleOf(l.owner_employee_ref) === 'sales_executive'))
check('no activity is credited to a coordinator or the owner',
  plan.activities.every((a) => roleOf(a.employee_ref) === 'sales_executive'))
check('no follow-up is assigned to a coordinator',
  plan.follow_ups.every((f) => roleOf(f.assigned_to_ref) === 'sales_executive'))

// exec_touches / sc_edits identity
check('every exec_touch is authored by the lead owning exec',
  plan.exec_touches.every((t) => leadByRef.get(t.lead_ref).owner_employee_ref === t.authored_by))
check('every sc_edit is authored by the owning exec coordinator',
  plan.sc_edits.every((e) => coordOf(leadByRef.get(e.lead_ref).owner_employee_ref) === e.authored_by))
check('sc_edits only touch leads that are still unlocked',
  plan.sc_edits.every((e) => leadByRef.get(e.lead_ref).expected_entered_by_role === null))
// Both halves of the SC edit lock need enough rows to be worth testing.
check('enough exec_touches to exercise the lock closing', plan.exec_touches.length >= 3,
  `${plan.exec_touches.length}`)
check('enough sc_edits to exercise the lock still being open', plan.sc_edits.length >= 3,
  `${plan.sc_edits.length}`)

// ---------------------------------------------------------------------------
console.log('\n=== 6. Team structure ===')
// ---------------------------------------------------------------------------
const execs = plan.employees.filter((e) => e.role === 'sales_executive')
const scs = plan.employees.filter((e) => e.role === 'sales_coordinator')
check('exactly 2 coordinators', scs.length === 2, `${scs.length}`)
check('exactly 6 sales executives', execs.length === 6, `${execs.length}`)
const teamSizes = scs.map((sc) => execs.filter((e) => e.coordinator_ref === sc.ref).length)
check('final split is 3/3 across the two coordinators', teamSizes.every((n) => n === 3), JSON.stringify(teamSizes))
check('every exec reports to a coordinator', execs.every((e) => e.coordinator_ref != null))
check('no coordinator has a coordinator_ref (validate_employee_role_assignment)',
  scs.every((s) => s.coordinator_ref == null))
const reassigned = execs.filter((e) => e.coordinator_ref_initial)
check('exactly one exec is reassigned between coordinators mid-period',
  reassigned.length === 1, `${reassigned.length}`)
check('...and their initial and final coordinators genuinely differ',
  reassigned.every((e) => e.coordinator_ref_initial !== e.coordinator_ref))

// ---------------------------------------------------------------------------
console.log('\n=== 7. Exception catalogue coverage (all 12 + extras) ===')
// ---------------------------------------------------------------------------
// EXACT tag match, not startsWith. Prefix matching silently made "ex1" also
// select ex11_long_stall_in_stage and ex12_stage_skip, which reported the
// exception sets as 100% overlapping when they were in fact disjoint.
const tagged = (tag) => plan.leads.filter((l) => l.exceptions.includes(tag))
const expectations = [
  ['ex1_site_anchored_only', 'site-anchored only', (l) => !l.party_ref && l.site_ref],
  ['ex2_party_anchored_only', 'party-anchored only', (l) => !l.site_ref && l.party_ref],
  ['ex4_lost_then_reopened', 'lost then reopened', () => true],
  ['ex5_won', 'won', (l) => l.current_stage === 'won'],
  ['ex7_sc_entered_on_behalf', 'SC-entered on behalf', () => true],
  ['ex11_long_stall_in_stage', 'long stall', () => true],
  ['ex12_stage_skip', 'stage skip', () => true],
  ['bucket_silent_quote', 'quote sent then silence', (l) => l.quote_sent && !['won','lost'].includes(l.current_stage)],
  ['anomaly_open_lead_with_order_value', 'order_value on an open lead', (l) => l.order_value != null && !['won','lost'].includes(l.current_stage)],
]
for (const [tag, label, pred] of expectations) {
  const rows = tagged(tag)
  check(`exception "${label}" present (${rows.length} leads)`, rows.length > 0)
  const bad = rows.filter((l) => !pred(l))
  if (bad.length) fail(`  ...but ${bad.length} tagged rows do not satisfy the predicate`)
}

// Exception overlap: the sets must SPREAD, not stack on one another.
const sets = {
  site_only: new Set(tagged('ex1_site_anchored_only').map((l) => l.ref)),
  party_only: new Set(tagged('ex2_party_anchored_only').map((l) => l.ref)),
  sc_entered: new Set(tagged('ex7_sc_entered_on_behalf').map((l) => l.ref)),
  stage_skip: new Set(tagged('ex12_stage_skip').map((l) => l.ref)),
  reopened: new Set(tagged('ex4_lost_then_reopened').map((l) => l.ref)),
}
const inter = (a, b) => [...a].filter((x) => b.has(x)).length
check('site-only and party-only are disjoint (a lead cannot be both)',
  inter(sets.site_only, sets.party_only) === 0)
const skipOverlap = inter(sets.stage_skip, sets.site_only) + inter(sets.stage_skip, sets.party_only)
if (skipOverlap === sets.stage_skip.size) {
  fail(`stage-skip leads are entirely contained in the anchor-exception sets (${skipOverlap}/${sets.stage_skip.size}) — the exception sets are stacking, not spreading`)
} else ok(`exception sets spread across the population (stage-skip overlap ${skipOverlap}/${sets.stage_skip.size})`)

// Shared mobiles
const mobileCounts = plan.parties.reduce((m, p) => (p.mobile ? ((m[p.mobile] = (m[p.mobile] ?? 0) + 1), m) : m), {})
const sharedClusters = Object.entries(mobileCounts).filter(([, n]) => n > 1)
check('exactly 3 shared-mobile clusters exist', sharedClusters.length === 3,
  `found ${sharedClusters.length}: ${JSON.stringify(sharedClusters)}`)
check('shared clusters cover 7 parties',
  sharedClusters.reduce((s, [, n]) => s + n, 0) === 7,
  `${sharedClusters.reduce((s, [, n]) => s + n, 0)} parties`)

// Targets
const gapKaran = plan.targets.some((t) => t.employee_ref === 'ex_karan' && t.period_value === '2026-08' && t.metric_name === 'call')
check('deliberate target gap: ex_karan has NO 2026-08 call target', !gapKaran)
const periodTypes = new Set(plan.targets.map((t) => t.period_type))
check('targets span week, month AND quarter', ['week','month','quarter'].every((p) => periodTypes.has(p)),
  JSON.stringify([...periodTypes]))
const METRICS = ['site_visit','call','rfq_raised','architect_meeting','order_value','won_count']
check('every target metric is computable by the dashboard (closed METRIC_OPTIONS list)',
  plan.targets.every((t) => METRICS.includes(t.metric_name)),
  JSON.stringify([...new Set(plan.targets.map((t) => t.metric_name))].filter((m) => !METRICS.includes(m))))

// ---------------------------------------------------------------------------
console.log('\n=== 8. Attention / red-flag discriminator bands ===')
// ---------------------------------------------------------------------------
// Recomputed here ONLY to prove the plan will exercise each bucket. These are
// design assertions, not the ledger — Phase 6 derives the real numbers.
const lastActByLead = new Map()
plan.activities.forEach((a) => {
  if (!a.lead_ref) return
  const t = ts(a.created_at).getTime()
  if (!lastActByLead.has(a.lead_ref) || t > lastActByLead.get(a.lead_ref)) lastActByLead.set(a.lead_ref, t)
})
const daysSince = (ms) => Math.floor((REF.getTime() - ms) / 86400000)
const openLeads = plan.leads.filter((l) => !['won','lost'].includes(l.current_stage))
const ages = openLeads.map((l) => daysSince(lastActByLead.get(l.ref) ?? ts(l.created_at).getTime()))
const queued = ages.filter((d) => d >= 14).length
const coolingBand = ages.filter((d) => d >= 7 && d < 14).length
const tenToThirteen = ages.filter((d) => d >= 10 && d < 14).length
console.log(`         open leads: ${openLeads.length}  |  >=14d (queued): ${queued}  |  7-13d (reads stale, not queued): ${coolingBand}`)
check('the stale bucket is non-trivially populated', queued >= 20, `${queued}`)
check('a 7-13 day discriminator band exists (must NOT be queued)', coolingBand >= 4, `${coolingBand}`)
check('a 10-13 day band exists specifically (negative control for the brief 10-day rule)',
  tenToThirteen >= 3, `${tenToThirteen}`)

const silentQuotes = openLeads.filter((l) => {
  if (!l.quote_sent || !l.quote_sent_at) return false
  const qa = daysSince(new Date(`${l.quote_sent_at}T00:00:00Z`).getTime())
  const last = lastActByLead.get(l.ref)
  const touchedSince = last && last > new Date(`${l.quote_sent_at}T00:00:00Z`).getTime()
  return qa >= 5 && !touchedSince
}).length
const overdueOnLead = openLeads.filter((l) => l.next_followup_date && new Date(`${l.next_followup_date}T00:00:00Z`) < REF).length
const slipped = openLeads.filter((l) => l.estimated_close_date && new Date(`${l.estimated_close_date}T00:00:00Z`) < REF).length
const pendingRfq = openLeads.filter((l) => l.rfq_raised && !l.quote_sent && l.rfq_raised_at &&
  daysSince(new Date(`${l.rfq_raised_at}T00:00:00Z`).getTime()) >= 3).length
console.log(`         silent quotes: ${silentQuotes}  |  lead-overdue: ${overdueOnLead}  |  slipped: ${slipped}  |  pending RFQ: ${pendingRfq}`)
check('all five Needs Attention buckets are populated',
  silentQuotes > 0 && overdueOnLead > 0 && slipped > 0 && pendingRfq > 0 && queued > 0)

const missedFu = plan.follow_ups.filter((f) => !f.is_done && new Date(`${f.due_date}T00:00:00Z`) < REF).length
const dueToday = plan.follow_ups.filter((f) => f.due_date === plan.meta.reference_date && !f.is_done).length
const scAssigned = plan.follow_ups.filter((f) => f.created_by_ref !== f.assigned_to_ref).length
console.log(`         follow-ups: ${plan.follow_ups.length} total | missed ${missedFu} | due today ${dueToday} | assigned-by-another ${scAssigned}`)
check('missed follow-ups exist (the second coordinator red flag)', missedFu >= 8, `${missedFu}`)
check('assigned-by-another follow-ups exist (SC assignment feature)', scAssigned >= 20, `${scAssigned}`)
// Not a failure — a standing reminder. These rows are pinned to the reference
// date and silently reclassify as it recedes.
if (dueToday > 0) {
  warn(`${dueToday} follow-ups are due exactly on ${plan.meta.reference_date} and ${plan.follow_ups.filter((f) => f.due_date === new Date(REF.getTime() + 86400000).toISOString().slice(0, 10)).length} tomorrow — they become overdue if the demo slips. Re-date rather than reseed (see time_sensitivity in the plan).`)
}

// ---------------------------------------------------------------------------
console.log('\n=== 9. Performance spread (one clear leader, one clear laggard) ===')
// ---------------------------------------------------------------------------
const perExec = {}
for (const l of plan.leads) {
  perExec[l.owner_employee_ref] ??= { leads: 0, won: 0, lost: 0, acts: 0 }
  perExec[l.owner_employee_ref].leads++
  if (l.current_stage === 'won') perExec[l.owner_employee_ref].won++
  if (l.current_stage === 'lost') perExec[l.owner_employee_ref].lost++
}
for (const a of plan.activities) {
  perExec[a.employee_ref] ??= { leads: 0, won: 0, lost: 0, acts: 0 }
  perExec[a.employee_ref].acts++
}
const rows = Object.entries(perExec).sort((a, b) => b[1].won - a[1].won)
rows.forEach(([k, v]) => console.log(`         ${k.padEnd(11)} leads ${String(v.leads).padStart(3)}  won ${String(v.won).padStart(2)}  lost ${String(v.lost).padStart(2)}  activities ${String(v.acts).padStart(4)}`))
const best = rows[0][1], worst = rows[rows.length - 1][1]
check('a clear top performer exists', best.won >= 6, `top won=${best.won}`)
check('a clear underperformer exists (zero wins)', worst.won === 0, `bottom won=${worst.won}`)
check('the leader logs at least twice the laggard activity', best.acts >= worst.acts * 2,
  `${best.acts} vs ${worst.acts}`)

// ---------------------------------------------------------------------------
console.log('\n=== 10. Weekday / holiday realism ===')
// ---------------------------------------------------------------------------
// created_at is stored as naive UTC shifted back 5h30m from IST, so an early
// IST morning lands on the previous UTC day. Bucket by the IST calendar day.
const istDay = (s) => new Date(new Date(`${s}Z`).getTime() + (5 * 60 + 30) * 60000).getUTCDay()
const dayHist = [0, 0, 0, 0, 0, 0, 0]
plan.activities.forEach((a) => dayHist[istDay(a.created_at)]++)
const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
console.log('         ' + dayHist.map((n, i) => `${names[i]} ${n}`).join('  '))
check('activity thins out on Sundays', dayHist[0] === 0, `${dayHist[0]} Sunday activities`)
const weekdayAvg = (dayHist[1] + dayHist[2] + dayHist[3] + dayHist[4] + dayHist[5]) / 5
check('Saturdays run lighter than weekdays', dayHist[6] < weekdayAvg * 0.8,
  `Sat ${dayHist[6]} vs weekday avg ${weekdayAvg.toFixed(0)}`)

const byMonth = {}
plan.activities.forEach((a) => {
  const k = new Date(new Date(`${a.created_at}Z`).getTime() + (5 * 60 + 30) * 60000).toISOString().slice(0, 7)
  byMonth[k] = (byMonth[k] ?? 0) + 1
})
console.log('         monthly activity: ' + Object.entries(byMonth).sort().map(([k, v]) => `${k}:${v}`).join('  '))
const fullMonths = Object.entries(byMonth).filter(([k]) => !['2026-02','2026-08'].includes(k)).map(([, v]) => v)
const variance = Math.max(...fullMonths) / Math.min(...fullMonths)
check('month-to-month volume genuinely varies (not a flat rate)', variance >= 1.25,
  `max/min = ${variance.toFixed(2)}`)

// ---------------------------------------------------------------------------
console.log('\n=== 11. Backdating coverage ===')
// ---------------------------------------------------------------------------
check('lead_change_log corrections cover every lead creation',
  plan.post_seed_corrections.lead_change_log.filter((r) => r.field === 'created').length === plan.leads.length)
check('lead_change_log corrections cover every quote_value',
  plan.post_seed_corrections.lead_change_log.filter((r) => r.field === 'quote_value').length ===
    plan.leads.filter((l) => l.quote_value != null && l.quote_sent_at).length)

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(64)}`)
if (failures === 0) console.log(`[32mPLAN VALID[0m — 0 failures, ${warnings} warnings`)
else console.log(`[31m${failures} FAILURE(S)[0m, ${warnings} warnings`)
console.log(`${'='.repeat(64)}\n`)
process.exit(failures === 0 ? 0 : 1)
