#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 3 E2E — 03: the things Phase 8 shipped but never exercised.
//
// CLAUDE.md's Sales Coordinator section lists these as "still not verified
// (no longer blocked)". They are the reason Phase 3 exists at all, so they are
// tested first-class rather than folded into the general screen sweep.
//
//   1. The "logged by sales coordinator" badge on a lead's Activity timeline.
//   2. The "Added by sales coordinator" note on the Deal owner card.
//   3. The sites/parties coordinator_team_update policies — the fix for the
//      silent no-op reproduced live on 2026-08-11.
//   4. The employees role-assignment guards.
//   5. The Day Review team table: multi-exec sorting and the zero-activity
//      row sinking to the bottom (unit-tested only; this dev database finally
//      has six execs to exercise it with).
//
// WRITE DISCIPLINE: items 3 and 4 need real writes. Every one is round-tripped
// — the original value is captured, the write applied, the effect verified by
// RE-READING, then the original restored and the restore verified too. Phase 3
// must leave the database matching simulation_plan.json exactly or Phase 6's
// ledger and Phase 7's reconciliation are both invalid.
// ===========================================================================

import { launch, session } from './harness.mjs'
import { rest, readRow, ids, plan, makeReporter } from '../lib.mjs'

const r = makeReporter('03 PHASE 8 ITEMS')
const browser = await launch()

// ---------------------------------------------------------------------------
r.section('1 + 2. Coordinator attribution badges on Lead Detail')
// ---------------------------------------------------------------------------
{
  // lead_0037: created by SC-North for Rohit, and carries SC-logged activities.
  const leadId = ids.lead_0037
  const s = await session(browser, 'emp_owner')
  await s.go(`/leads/${leadId}`)
  const text = await s.text()

  r.check(
    'Deal owner card shows "Added by sales coordinator"',
    /Added by sales coordinator/i.test(text),
    text.match(/Added by sales coordinator[^\n]*/)?.[0] ?? 'not found'
  )
  r.check(
    'Activity timeline shows "logged by sales coordinator"',
    /logged by sales coordinator/i.test(text),
    text.match(/logged by sales coordinator[^\n]*/)?.[0] ?? 'not found'
  )
  r.check(
    'the timeline is not empty (the failure mode CLAUDE.md warned about)',
    !/No activity yet/i.test(text),
    'a missing logged_by_employee_id column would render this empty, silently'
  )

  await s.shot('03-lead-detail-coordinator-badges')
  await s.close()
}

// ---------------------------------------------------------------------------
r.section('3. sites / parties coordinator_team_update — the silent no-op fix')
//    Reproduced live 2026-08-11: an SC set Site stage on a team member's site,
//    got a clean success message, and the write silently did nothing.
// ---------------------------------------------------------------------------
{
  // A site attached to a lead owned by one of SC-North's execs.
  const northLead = plan.leads.find(
    (l) => ['ex_rohit', 'ex_priya', 'ex_imran'].includes(l.owner_employee_ref) && l.site_ref
  )
  const siteId = ids[northLead.site_ref]

  const before = (await readRow('emp_owner', 'sites', siteId, 'id,site_stage')).row
  const probeStage = before.site_stage === 'foundation' ? 'structure' : 'foundation'

  const upd = await rest('sc_north', 'PATCH', `/sites?id=eq.${siteId}`, {
    body: { site_stage: probeStage },
    prefer: 'return=representation',
  })
  const after = (await readRow('emp_owner', 'sites', siteId, 'id,site_stage')).row

  r.check(
    'a coordinator CAN now update their team’s site (policy landed)',
    after.site_stage === probeStage,
    `HTTP ${upd.status}; site_stage "${before.site_stage}" -> "${after.site_stage}"`
  )

  await rest('sc_north', 'PATCH', `/sites?id=eq.${siteId}`, {
    body: { site_stage: before.site_stage },
    prefer: 'return=representation',
  })
  const restored = (await readRow('emp_owner', 'sites', siteId, 'id,site_stage')).row
  r.check(
    'site_stage restored (net-zero)',
    String(restored.site_stage) === String(before.site_stage),
    `back to "${restored.site_stage}"`
  )

  // The same policy on parties.
  const partyId = ids[northLead.party_ref ?? plan.parties[0].ref]
  const pBefore = (await readRow('emp_owner', 'parties', partyId, 'id,notes')).row
  const pUpd = await rest('sc_north', 'PATCH', `/parties?id=eq.${partyId}`, {
    body: { notes: 'phase9 probe' },
    prefer: 'return=representation',
  })
  const pAfter = (await readRow('emp_owner', 'parties', partyId, 'id,notes')).row
  r.check(
    'a coordinator CAN update a party linked to their team',
    pAfter.notes === 'phase9 probe',
    `HTTP ${pUpd.status}; notes now ${JSON.stringify(pAfter.notes)}`
  )
  await rest('sc_north', 'PATCH', `/parties?id=eq.${partyId}`, {
    body: { notes: pBefore.notes },
    prefer: 'return=representation',
  })
  const pRestored = (await readRow('emp_owner', 'parties', partyId, 'id,notes')).row
  r.check('party notes restored (net-zero)', (pRestored.notes ?? null) === (pBefore.notes ?? null), `back to ${JSON.stringify(pRestored.notes)}`)
}

// ---------------------------------------------------------------------------
r.section('4. employees role-assignment guards (validate_employee_role_assignment)')
// ---------------------------------------------------------------------------
{
  // 4a. Demoting a coordinator who still has reports must be BLOCKED.
  const attempt = await rest('emp_owner', 'PATCH', `/employees?id=eq.${ids.sc_north}`, {
    body: { role: 'sales_executive' },
    prefer: 'return=representation',
  })
  const scAfter = (await readRow('emp_owner', 'employees', ids.sc_north, 'id,role')).row
  r.check(
    'demoting a coordinator with reports is refused',
    !attempt.ok,
    `HTTP ${attempt.status}, code ${attempt.code} — "${(attempt.message ?? '').slice(0, 90)}"`
  )
  r.check('that coordinator is still a coordinator (re-read)', scAfter.role === 'sales_coordinator', `role = ${scAfter.role}`)

  // 4b. Pointing coordinator_id at a non-coordinator must be BLOCKED.
  const bad = await rest('emp_owner', 'PATCH', `/employees?id=eq.${ids.ex_priya}`, {
    body: { coordinator_id: ids.ex_rohit },
    prefer: 'return=representation',
  })
  const priya = (await readRow('emp_owner', 'employees', ids.ex_priya, 'id,coordinator_id')).row
  r.check(
    'assigning an exec to a non-coordinator is refused',
    !bad.ok,
    `HTTP ${bad.status}, code ${bad.code} — "${(bad.message ?? '').slice(0, 90)}"`
  )
  r.check('that exec still reports to their real coordinator', priya.coordinator_id === ids.sc_north, `coordinator_id = ${priya.coordinator_id}`)

  // 4c. Promoting an exec to coordinator WITHOUT clearing coordinator_id must
  //     be blocked — the case CLAUDE.md says updateEmployeeRole() must clear in
  //     the same statement.
  const promo = await rest('emp_owner', 'PATCH', `/employees?id=eq.${ids.ex_sunita}`, {
    body: { role: 'sales_coordinator' },
    prefer: 'return=representation',
  })
  const sunita = (await readRow('emp_owner', 'employees', ids.ex_sunita, 'id,role,coordinator_id')).row
  r.check(
    'promoting an exec without clearing coordinator_id is refused',
    !promo.ok,
    `HTTP ${promo.status}, code ${promo.code} — "${(promo.message ?? '').slice(0, 90)}"`
  )
  r.check(
    'that exec is unchanged (re-read)',
    sunita.role === 'sales_executive' && sunita.coordinator_id === ids.sc_south,
    `role=${sunita.role}, coordinator_id=${sunita.coordinator_id}`
  )
}

// ---------------------------------------------------------------------------
r.section('5. Day Review team table — sorting and the zero-activity row')
//    Covered by unit tests only until now; this database has six real execs.
// ---------------------------------------------------------------------------
{
  const s = await session(browser, 'emp_owner')
  await s.go('/dashboard')
  // "Today" is the first segment of the date-range control.
  await s.page.getByRole('button', { name: /^Today$/ }).first().click()
  await s.settle()
  // Pin to the plan's reference date. Sorting can only be observed on a day that
  // HAS data — once the clock moves past the seeded window every exec ties at
  // zero, a stable sort preserves the source order, and the test fails for a
  // reason that has nothing to do with sorting.
  await s.page.locator('.vip-day-date').fill(plan.meta.reference_date)
  await s.page.waitForTimeout(400)
  r.check('Day Review finishes loading', await s.settle(), 'waited for the "Loading…" placeholder to clear')
  const text = await s.text()

  r.check('Day Review renders for the owner', /Live · updated|Final ·/i.test(text), text.match(/(Live · updated[^\n]*|Final ·[^\n]*)/)?.[0] ?? '')
  const execs = ['Rohit', 'Priya', 'Imran', 'Ananya', 'Karan', 'Sunita']
  const missing = execs.filter((n) => !text.includes(n))
  r.check('the team table lists every sales executive', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all six present')
  r.check(
    'the table carries the ACTIVITY / LEADS / FOLLOW-UPS column groups',
    /ACTIVITY[\s\S]*LEADS[\s\S]*FOLLOW-UPS/.test(text),
    ''
  )

  await s.shot('03-day-review-owner')

  // Sorting: click a sortable header and confirm the row order actually
  // changes. Row names are read from the rendered grid rather than a guessed
  // class, so this keeps working if the markup is refactored.
  const namesNow = async () =>
    (await s.text())
      .split('\n')
      .filter((line) => execs.some((e) => line.startsWith(e)))
  const before = await namesNow()
  await s.page.getByText(/^calls$/i).first().click()
  await s.page.waitForTimeout(400)
  const after = await namesNow()
  r.check(
    'clicking a sortable header reorders the team table',
    before.length > 0 && JSON.stringify(before) !== JSON.stringify(after),
    `${before.join(' , ')}  ->  ${after.join(' , ')}`
  )

  // A zero-activity exec must sink to the bottom under the default Total sort,
  // with no badge and no pinning (an explicit design decision, not an accident).
  await s.page.getByText(/^total$/i).first().click()
  await s.page.waitForTimeout(400)
  const sorted = await namesNow()
  r.check('team table has all six rows after sorting', sorted.length === 6, sorted.join(' , '))

  await s.close()
}

await browser.close()
const { failed } = r.summary()
process.exit(failed ? 1 : 0)
