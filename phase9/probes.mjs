#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 3 — GUARD-RAIL PROBES
//
// The writes from `simulation_plan.json → verification_probes`: operations that
// must be ATTEMPTED and must FAIL, proving the guard rails are real rather than
// assumed. Plus the two that must SUCCEED, because a lock that blocks
// everything is not a lock, it is an outage.
//
// EVERY PROBE RE-READS THE ROW. An RLS-rejected UPDATE returns
// `{data: null, error: null}` with 0 rows matched and no exception (Phase 0
// finding), so "no error came back" proves nothing at all. A probe that only
// checked the response would report a passing guard rail on a database that
// had silently accepted the write.
//
// NET-ZERO BY CONSTRUCTION. Failing probes write nothing by definition. The two
// that succeed are round-tripped — the value is restored and the restore is
// itself verified — so the database still matches simulation_plan.json when
// this finishes. `current_stage` is safe to round-trip because the app writes
// stage_history separately (a direct PATCH adds no history row) and `stage` is
// deliberately absent from lead_change_log. Confirmed by re-running
// verify_seed.mjs afterwards.
//
//   node phase9/probes.mjs
// ===========================================================================

import { rest, readRow, ids, plan, makeReporter } from './lib.mjs'

const r = makeReporter('GUARD-RAIL PROBES')

// --------------------------------------------------------------------------
// pick concrete targets out of the plan
// --------------------------------------------------------------------------
const TEAM = {
  sc_north: ['ex_rohit', 'ex_priya', 'ex_imran'],
  sc_south: ['ex_ananya', 'ex_karan', 'ex_sunita'],
}

// A locked lead (entered_by_role = 'sales_executive') owned by an SC-North exec.
const lockedNorth = plan.leads.find(
  (l) => l.expected_entered_by_role === 'sales_executive' && TEAM.sc_north.includes(l.owner_employee_ref)
)
// Any lead owned by an SC-South exec — the cross-team target.
const southLead = plan.leads.find((l) => TEAM.sc_south.includes(l.owner_employee_ref))
const southActivity = plan.activities.find((a) => TEAM.sc_south.includes(a.employee_ref))
const southFollowUp = plan.follow_ups.find((f) => TEAM.sc_south.includes(f.assigned_to_ref))

const lockedId = ids[lockedNorth.ref]
const southLeadId = ids[southLead.ref]

console.log('PHASE 3 — GUARD-RAIL PROBES')
console.log(`locked SC-North lead: ${lockedNorth.ref} (id ${lockedId}, owner ${lockedNorth.owner_employee_ref})`)
console.log(`cross-team target:    ${southLead.ref} (id ${southLeadId}, owner ${southLead.owner_employee_ref})`)

// ===========================================================================
r.section('1. A sales executive CANNOT change a lead stage (enforce_owner_only_stage_change)')
// ===========================================================================
{
  const exec = lockedNorth.owner_employee_ref
  const before = (await readRow(exec, 'leads', lockedId, 'id,current_stage')).row
  const attempt = await rest(exec, 'PATCH', `/leads?id=eq.${lockedId}`, {
    body: { current_stage: before.current_stage === 'won' ? 'lost' : 'won' },
    prefer: 'return=representation',
  })
  const after = (await readRow(exec, 'leads', lockedId, 'id,current_stage')).row

  r.check(
    'exec stage change is refused with check_violation',
    !attempt.ok && attempt.code === '23514',
    `HTTP ${attempt.status}, code ${attempt.code} — "${attempt.message}"`
  )
  r.check(
    'exec stage change did not take effect (re-read)',
    after.current_stage === before.current_stage,
    `still "${after.current_stage}"`
  )
}

// ===========================================================================
r.section('2. A sales executive CANNOT insert stage_history (owner-only INSERT policy)')
// ===========================================================================
{
  const exec = lockedNorth.owner_employee_ref
  const countBefore = (await rest(exec, 'GET', `/stage_history?select=id&lead_id=eq.${lockedId}`)).count
  const attempt = await rest(exec, 'POST', '/stage_history', {
    body: { lead_id: lockedId, stage: 'won', changed_by: ids[exec] },
    prefer: 'return=minimal',
  })
  const countAfter = (await rest(exec, 'GET', `/stage_history?select=id&lead_id=eq.${lockedId}`)).count

  r.check(
    'exec stage_history insert is refused by RLS',
    !attempt.ok && attempt.code === '42501',
    `HTTP ${attempt.status}, code ${attempt.code}`
  )
  r.check('no stage_history row was added (re-read)', countAfter === countBefore, `${countBefore} -> ${countAfter}`)
}

// ===========================================================================
r.section('3. A coordinator CANNOT edit a locked lead’s other columns (enforce_coordinator_lock)')
// ===========================================================================
{
  const before = (await readRow('sc_north', 'leads', lockedId, 'id,quote_value,entered_by_role')).row
  r.check(
    'target lead really is locked',
    before.entered_by_role === 'sales_executive',
    `entered_by_role = ${before.entered_by_role}`
  )
  const attempt = await rest('sc_north', 'PATCH', `/leads?id=eq.${lockedId}`, {
    body: { quote_value: 12345 },
    prefer: 'return=representation',
  })
  const after = (await readRow('sc_north', 'leads', lockedId, 'id,quote_value')).row

  r.check(
    'coordinator edit of quote_value is refused with check_violation',
    !attempt.ok && attempt.code === '23514',
    `HTTP ${attempt.status}, code ${attempt.code}`
  )
  r.check(
    'quote_value unchanged (re-read)',
    String(after.quote_value) === String(before.quote_value),
    `still ${after.quote_value}`
  )
}

// ===========================================================================
r.section('4. A coordinator CAN still change that same locked lead’s stage')
//    The grant and the lock are a deliberate pair — CLAUDE.md: "removing
//    either silently guts the other". Round-tripped and restored.
// ===========================================================================
{
  const before = (await readRow('sc_north', 'leads', lockedId, 'id,current_stage')).row
  const probeStage = before.current_stage === 'negotiation' ? 'quote_submission' : 'negotiation'

  const attempt = await rest('sc_north', 'PATCH', `/leads?id=eq.${lockedId}`, {
    body: { current_stage: probeStage },
    prefer: 'return=representation',
  })
  const during = (await readRow('sc_north', 'leads', lockedId, 'id,current_stage')).row
  r.check(
    'coordinator stage change succeeds on a locked lead',
    attempt.ok && Array.isArray(attempt.body) && attempt.body.length === 1 && during.current_stage === probeStage,
    `HTTP ${attempt.status}, stage now "${during.current_stage}"`
  )

  // restore, and verify the restore
  await rest('sc_north', 'PATCH', `/leads?id=eq.${lockedId}`, {
    body: { current_stage: before.current_stage },
    prefer: 'return=representation',
  })
  const restored = (await readRow('sc_north', 'leads', lockedId, 'id,current_stage')).row
  r.check(
    'stage restored to its seeded value (net-zero)',
    restored.current_stage === before.current_stage,
    `back to "${restored.current_stage}"`
  )
}

// ===========================================================================
r.section('5. Cross-team isolation — SC-North against SC-South data')
//    NOTE the deliberate asymmetry: leads/activities/follow_ups are
//    team-scoped, but parties/sites SELECT is company-wide for ANY
//    coordinator by design (migration_sales_coordinator STEP 6:
//    `current_employee_role() IN ('owner','sales_coordinator')`). Asserting a
//    blanket "sees nothing" would manufacture a false finding, so both
//    directions are asserted explicitly.
// ===========================================================================
{
  const leadRead = await rest('sc_north', 'GET', `/leads?select=id&id=eq.${southLeadId}`)
  r.check("SC-North cannot read an SC-South lead", leadRead.ok && leadRead.body.length === 0, `${leadRead.body.length} rows`)

  const actRead = await rest('sc_north', 'GET', `/activities?select=id&id=eq.${ids[southActivity.ref]}`)
  r.check("SC-North cannot read an SC-South activity", actRead.ok && actRead.body.length === 0, `${actRead.body.length} rows`)

  const fuRead = await rest('sc_north', 'GET', `/follow_ups?select=id&id=eq.${ids[southFollowUp.ref]}`)
  r.check("SC-North cannot read an SC-South follow-up", fuRead.ok && fuRead.body.length === 0, `${fuRead.body.length} rows`)

  // write attempts
  const before = (await readRow('emp_owner', 'leads', southLeadId, 'id,next_followup_date')).row
  const upd = await rest('sc_north', 'PATCH', `/leads?id=eq.${southLeadId}`, {
    body: { next_followup_date: '2027-01-01' },
    prefer: 'return=representation',
  })
  const afterUpd = (await readRow('emp_owner', 'leads', southLeadId, 'id,next_followup_date')).row
  r.check(
    'SC-North UPDATE of an SC-South lead affects 0 rows',
    upd.ok && Array.isArray(upd.body) && upd.body.length === 0,
    `HTTP ${upd.status}, ${Array.isArray(upd.body) ? upd.body.length : '?'} rows returned — this is the silent-no-op case`
  )
  r.check(
    'the SC-South lead is genuinely unchanged (re-read as owner)',
    String(afterUpd.next_followup_date) === String(before.next_followup_date),
    `still ${afterUpd.next_followup_date}`
  )

  const del = await rest('sc_north', 'DELETE', `/leads?id=eq.${southLeadId}`, { prefer: 'return=representation' })
  const afterDel = await rest('emp_owner', 'GET', `/leads?select=id&id=eq.${southLeadId}`)
  r.check(
    'SC-North DELETE of an SC-South lead removes nothing',
    afterDel.body.length === 1,
    `HTTP ${del.status}; lead still present`
  )

  // the intended asymmetry, asserted so it reads as a decision not a hole
  const partyRead = await rest('sc_north', 'GET', '/parties?select=id&limit=1')
  r.check(
    'a coordinator DOES see every party (documented company-wide read)',
    partyRead.ok && partyRead.count === plan.parties.length,
    `${partyRead.count} of ${plan.parties.length} — by design, not a leak`
  )
}

// ===========================================================================
r.section('6. Append-only tables — the grant layer permits, only policy blocks')
//    Phase 0 finding: `authenticated` holds UPDATE on stage_history and DELETE
//    on lead_owner_history through ALTER DEFAULT PRIVILEGES. The defence is one
//    layer thin. Phase 0 required this be tested empirically once data existed,
//    rather than reasoned from the policy list. This is that test.
// ===========================================================================
{
  const shId = ids[plan.stage_history[0].ref]
  const shBefore = (await readRow('emp_owner', 'stage_history', shId, 'id,stage')).row
  const shUpd = await rest('emp_owner', 'PATCH', `/stage_history?id=eq.${shId}`, {
    body: { stage: 'tampered' },
    prefer: 'return=representation',
  })
  const shAfter = (await readRow('emp_owner', 'stage_history', shId, 'id,stage')).row
  r.check(
    'owner UPDATE of stage_history affects 0 rows',
    Array.isArray(shUpd.body) ? shUpd.body.length === 0 : !shUpd.ok,
    `HTTP ${shUpd.status}, code ${shUpd.code ?? 'none'}`
  )
  r.check('stage_history row is genuinely unchanged (re-read)', shAfter.stage === shBefore.stage, `still "${shAfter.stage}"`)

  const lohId = ids[plan.lead_owner_history[0].ref]
  const lohDel = await rest('emp_owner', 'DELETE', `/lead_owner_history?id=eq.${lohId}`, {
    prefer: 'return=representation',
  })
  const lohAfter = await rest('emp_owner', 'GET', `/lead_owner_history?select=id&id=eq.${lohId}`)
  r.check(
    'owner DELETE of lead_owner_history removes nothing',
    lohAfter.body.length === 1,
    `HTTP ${lohDel.status}, code ${lohDel.code ?? 'none'}; row still present`
  )

  const lclDel = await rest('emp_owner', 'DELETE', `/lead_change_log?id=eq.1`, { prefer: 'return=representation' })
  r.check(
    'owner DELETE of lead_change_log is refused outright',
    !lclDel.ok,
    `HTTP ${lclDel.status}, code ${lclDel.code ?? 'none'} — explicit REVOKE, not just a missing policy`
  )
}

// ===========================================================================
r.section('7. An exec sees only their own data')
// ===========================================================================
{
  const exec = 'ex_karan'
  const own = plan.leads.filter((l) => l.owner_employee_ref === exec).length
  const seen = (await rest(exec, 'GET', '/leads?select=id&limit=1')).count
  r.check(`${exec} sees exactly their own leads`, seen === own, `${seen} visible, ${own} owned`)

  const foreign = plan.leads.find((l) => l.owner_employee_ref === 'ex_rohit')
  const peek = await rest(exec, 'GET', `/leads?select=id&id=eq.${ids[foreign.ref]}`)
  r.check("an exec cannot read a colleague's lead by direct id", peek.ok && peek.body.length === 0, `${peek.body.length} rows`)

  const lossPeek = await rest(exec, 'GET', '/loss_reasons?select=id&limit=1')
  r.check(
    'an exec sees no loss_reasons at all (owner-only SELECT)',
    lossPeek.ok && lossPeek.count === 0,
    `${lossPeek.count} rows`
  )
}

const { failed } = r.summary()
process.exit(failed ? 1 : 0)
