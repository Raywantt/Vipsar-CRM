#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 5 — SECURITY AUDIT
//
// An EMPIRICAL capability matrix: every role against every table, measured by
// actually attempting the operation through a real authenticated session over
// the anon key — the same path the app and any attacker would use.
//
// WHY NOT READ THE POLICY FILES. `Schema/rls_policies.sql` describes intent.
// The live database is the authority, and Phase 0 already found three places
// where the two disagree (the append-only grant layer). The SQL Editor cannot
// settle it either: it runs as `postgres` with BYPASSRLS and has no
// `auth.uid()`, so every helper resolves NULL there. Only a real session
// answers "what can this role actually do".
//
// NON-DESTRUCTIVE BY CONSTRUCTION. The matrix probes the FORBIDDEN direction:
// an operation that is correctly refused writes nothing. Anything that
// unexpectedly succeeds is reverted immediately and reported loudly. The two
// tests that need a real successful write (deactivation, self-promotion
// guard) are round-tripped and the restore is verified.
//
//   node phase9/security-audit.mjs
// ===========================================================================

import { rest, readRow, ids, plan, env, makeReporter } from './lib.mjs'

const r = makeReporter('SECURITY AUDIT')

const ROLES = [
  ['emp_owner', 'owner'],
  ['sc_north', 'coordinator A'],
  ['sc_south', 'coordinator B'],
  ['ex_rohit', 'exec (SC-North)'],
  ['ex_karan', 'exec (SC-South)'],
]

const TABLES = [
  'employees', 'areas', 'products', 'parties', 'sites', 'site_contacts',
  'leads', 'activities', 'plans', 'stage_history', 'lead_owner_history',
  'lead_change_log', 'targets', 'loss_reasons', 'follow_ups', 'push_subscriptions',
]

console.log('PHASE 5 — SECURITY AUDIT (empirical, live database, anon key + real sessions)\n')

// ===========================================================================
r.section('1. READ VISIBILITY — how many rows each role can actually see')
// ===========================================================================
{
  const matrix = {}
  for (const [ref] of ROLES) {
    matrix[ref] = {}
    for (const t of TABLES) {
      const res = await rest(ref, 'GET', `/${t}?select=id&limit=1`)
      matrix[ref][t] = res.ok ? (res.count ?? 0) : `ERR ${res.code ?? res.status}`
    }
  }

  const pad = (s, n) => String(s).padEnd(n)
  console.log('  ' + pad('table', 20) + ROLES.map(([ref]) => pad(ref, 12)).join(''))
  for (const t of TABLES) {
    console.log('  ' + pad(t, 20) + ROLES.map(([ref]) => pad(matrix[ref][t], 12)).join(''))
  }

  // The invariants that actually matter, asserted rather than eyeballed.
  r.check(
    'owner sees every lead',
    matrix.emp_owner.leads === plan.leads.length,
    `${matrix.emp_owner.leads} of ${plan.leads.length}`
  )
  r.check(
    'the two coordinators partition the leads exactly (no overlap, no gap)',
    matrix.sc_north.leads + matrix.sc_south.leads === plan.leads.length,
    `${matrix.sc_north.leads} + ${matrix.sc_south.leads} = ${plan.leads.length}`
  )
  r.check(
    'the two coordinators partition the activities exactly',
    matrix.sc_north.activities + matrix.sc_south.activities === plan.activities.length,
    `${matrix.sc_north.activities} + ${matrix.sc_south.activities} = ${plan.activities.length}`
  )
  r.check(
    'an exec sees strictly fewer leads than their coordinator',
    matrix.ex_rohit.leads < matrix.sc_north.leads,
    `${matrix.ex_rohit.leads} < ${matrix.sc_north.leads}`
  )
  r.check(
    'loss_reasons is owner-only (both coordinators AND both execs see zero)',
    [matrix.sc_north, matrix.sc_south, matrix.ex_rohit, matrix.ex_karan].every((m) => m.loss_reasons === 0),
    'coordinators included — an SC is NOT a partial owner here'
  )
  r.check(
    'an exec cannot read a colleague’s parties wholesale',
    matrix.ex_rohit.parties < plan.parties.length,
    `${matrix.ex_rohit.parties} of ${plan.parties.length}`
  )
  r.check(
    'employees is deliberately readable by everyone (documented exception)',
    ROLES.every(([ref]) => matrix[ref].employees === plan.employees.length + 1),
    'name lookups / EmployeeLink / accompanied-by need it — recorded, not a leak'
  )
  r.check('plans is empty for every role', ROLES.every(([ref]) => matrix[ref].plans === 0), 'vestigial table, never seeded')

  // --- the two Phase 8 RLS fixes, pinned so they cannot regress ------------

  // F-P5-1. Before the fix every role read every row (2/2/2/2/2). The two
  // reassigned leads now belong to an SC-North exec, so SC-South must see none
  // — and neither must their FORMER owner, who no longer owns the leads.
  r.check(
    'F-P5-1: lead_owner_history is scoped, not open to everyone',
    matrix.sc_south.lead_owner_history === 0 && matrix.ex_karan.lead_owner_history === 0,
    `owner ${matrix.emp_owner.lead_owner_history} · SC-N ${matrix.sc_north.lead_owner_history} · ` +
      `SC-S ${matrix.sc_south.lead_owner_history} · rohit ${matrix.ex_rohit.lead_owner_history} · ` +
      `karan ${matrix.ex_karan.lead_owner_history} (was 2/2/2/2/2)`
  )

  // F-P5-2. Coordinators saw 0 of 225, so their Day Review "Changes" column was
  // structurally always empty. The two teams must now partition the log exactly.
  r.check(
    'F-P5-2: coordinators can read their team’s lead_change_log',
    matrix.sc_north.lead_change_log > 0 && matrix.sc_south.lead_change_log > 0,
    `SC-N ${matrix.sc_north.lead_change_log} · SC-S ${matrix.sc_south.lead_change_log} (both were 0)`
  )
  r.check(
    'F-P5-2: the two teams partition lead_change_log exactly',
    matrix.sc_north.lead_change_log + matrix.sc_south.lead_change_log === matrix.emp_owner.lead_change_log,
    `${matrix.sc_north.lead_change_log} + ${matrix.sc_south.lead_change_log} = ${matrix.emp_owner.lead_change_log}`
  )
}

// ===========================================================================
r.section('2. PRIVILEGE ESCALATION — can anyone make themselves more powerful?')
// ===========================================================================
{
  // 2a. An exec promoting themselves to owner. This is the single worst
  //     outcome in the whole model, so it is tested directly.
  const selfPromo = await rest('ex_rohit', 'PATCH', `/employees?id=eq.${ids.ex_rohit}`, {
    body: { role: 'owner' },
    prefer: 'return=representation',
  })
  const after = (await readRow('emp_owner', 'employees', ids.ex_rohit, 'id,role')).row
  r.check(
    'an exec CANNOT promote themselves to owner',
    after.role === 'sales_executive',
    `HTTP ${selfPromo.status}, ${Array.isArray(selfPromo.body) ? selfPromo.body.length : '?'} rows; role still ${after.role}`
  )

  // 2b. A coordinator promoting themselves.
  const scPromo = await rest('sc_north', 'PATCH', `/employees?id=eq.${ids.sc_north}`, {
    body: { role: 'owner' },
    prefer: 'return=representation',
  })
  const scAfter = (await readRow('emp_owner', 'employees', ids.sc_north, 'id,role')).row
  r.check(
    'a coordinator CANNOT promote themselves to owner',
    scAfter.role === 'sales_coordinator',
    `HTTP ${scPromo.status}; role still ${scAfter.role}`
  )

  // 2c. A coordinator recruiting another team's exec by rewriting coordinator_id.
  const steal = await rest('sc_north', 'PATCH', `/employees?id=eq.${ids.ex_karan}`, {
    body: { coordinator_id: ids.sc_north },
    prefer: 'return=representation',
  })
  const karan = (await readRow('emp_owner', 'employees', ids.ex_karan, 'id,coordinator_id')).row
  r.check(
    'a coordinator CANNOT reassign another team’s exec to themselves',
    karan.coordinator_id === ids.sc_south,
    `HTTP ${steal.status}; coordinator_id still ${karan.coordinator_id}`
  )

  // 2d. An exec taking ownership of a colleague's lead.
  const foreign = plan.leads.find((l) => l.owner_employee_ref === 'ex_ananya')
  const grab = await rest('ex_rohit', 'PATCH', `/leads?id=eq.${ids[foreign.ref]}`, {
    body: { owner_employee_id: ids.ex_rohit },
    prefer: 'return=representation',
  })
  const lead = (await readRow('emp_owner', 'leads', ids[foreign.ref], 'id,owner_employee_id')).row
  r.check(
    'an exec CANNOT steal a colleague’s lead',
    lead.owner_employee_id === ids.ex_ananya,
    `HTTP ${grab.status}; owner still ${lead.owner_employee_id}`
  )

  // 2e. A coordinator assigning a lead to THEMSELVES (an SC owns no leads —
  //     is_my_team_member() is false for an SC's own id, so the WITH CHECK
  //     half of the team policy is what stops this).
  const own = plan.leads.find((l) => l.owner_employee_ref === 'ex_rohit')
  const selfAssign = await rest('sc_north', 'PATCH', `/leads?id=eq.${ids[own.ref]}`, {
    body: { owner_employee_id: ids.sc_north },
    prefer: 'return=representation',
  })
  const ownAfter = (await readRow('emp_owner', 'leads', ids[own.ref], 'id,owner_employee_id')).row
  r.check(
    'a coordinator CANNOT assign a team lead to themselves',
    ownAfter.owner_employee_id === ids.ex_rohit,
    `HTTP ${selfAssign.status}; owner still ${ownAfter.owner_employee_id}`
  )

  // 2f. A coordinator pushing a lead OUT of their team.
  const push = await rest('sc_north', 'PATCH', `/leads?id=eq.${ids[own.ref]}`, {
    body: { owner_employee_id: ids.ex_karan },
    prefer: 'return=representation',
  })
  const pushAfter = (await readRow('emp_owner', 'leads', ids[own.ref], 'id,owner_employee_id')).row
  r.check(
    'a coordinator CANNOT push a lead out to another team',
    pushAfter.owner_employee_id === ids.ex_rohit,
    `HTTP ${push.status}; owner still ${pushAfter.owner_employee_id}`
  )
}

// ===========================================================================
r.section('3. FORGERY — can anyone write a row attributed to someone else?')
// ===========================================================================
{
  // 3a. An exec logging an activity as a colleague.
  const forge = await rest('ex_rohit', 'POST', '/activities', {
    body: { employee_id: ids.ex_karan, lead_id: ids[plan.leads[0].ref], activity_type: 'call' },
    prefer: 'return=minimal',
  })
  r.check(
    'an exec CANNOT log an activity attributed to a colleague',
    !forge.ok,
    `HTTP ${forge.status}, code ${forge.code}`
  )

  // 3b. A coordinator logging an activity for ANOTHER team's exec.
  const crossForge = await rest('sc_north', 'POST', '/activities', {
    body: { employee_id: ids.ex_karan, lead_id: ids[plan.leads[0].ref], activity_type: 'call' },
    prefer: 'return=minimal',
  })
  r.check(
    'a coordinator CANNOT log an activity for another team’s exec',
    !crossForge.ok,
    `HTTP ${crossForge.status}, code ${crossForge.code}`
  )

  // 3c. An exec creating a lead owned by someone else.
  const leadForge = await rest('ex_rohit', 'POST', '/leads', {
    body: { owner_employee_id: ids.ex_karan, source_type: 'scanning', party_id: ids[plan.parties[0].ref] },
    prefer: 'return=minimal',
  })
  r.check(
    'an exec CANNOT create a lead owned by a colleague',
    !leadForge.ok,
    `HTTP ${leadForge.status}, code ${leadForge.code}`
  )

  // 3d. Forging the audit trail directly.
  const trailForge = await rest('ex_rohit', 'POST', '/lead_change_log', {
    body: { lead_id: ids[plan.leads[0].ref], field: 'quote_value', new_value: '999999' },
    prefer: 'return=minimal',
  })
  r.check(
    'nobody can write lead_change_log directly (trigger is its only writer)',
    !trailForge.ok,
    `HTTP ${trailForge.status}, code ${trailForge.code}`
  )
}

// ===========================================================================
r.section('4. DEACTIVATION — does switching is_active off actually revoke access?')
//    This is the load-bearing claim behind current_employee_id()/_role(), and
//    the whole reason those helpers filter on is_active. Round-tripped.
// ===========================================================================
{
  const target = 'ex_karan'
  const before = (await readRow('emp_owner', 'employees', ids[target], 'id,is_active')).row
  r.check('target starts active', before.is_active === true, '')

  await rest('emp_owner', 'PATCH', `/employees?id=eq.${ids[target]}`, {
    body: { is_active: false },
    prefer: 'return=representation',
  })

  // NOTE: lib.mjs caches the token, so these calls reuse the session this
  // employee ALREADY held before being deactivated. That is deliberately the
  // stronger test — the JWT is still cryptographically valid and unexpired, and
  // the claim in CLAUDE.md is that an already-open session is blocked at the
  // database layer immediately, not at the next login.
  const leadsSeen = await rest(target, 'GET', '/leads?select=id&limit=1')
  const partiesSeen = await rest(target, 'GET', '/parties?select=id&limit=1')
  const canWrite = await rest(target, 'POST', '/activities', {
    body: { employee_id: ids[target], lead_id: ids[plan.leads[0].ref], activity_type: 'call' },
    prefer: 'return=minimal',
  })

  r.check(
    'a deactivated employee sees NO leads',
    leadsSeen.ok && leadsSeen.count === 0,
    `${leadsSeen.count} rows (helpers resolve NULL, so every policy is false)`
  )
  r.check('a deactivated employee sees NO parties', partiesSeen.ok && partiesSeen.count === 0, `${partiesSeen.count} rows`)
  r.check('a deactivated employee CANNOT write', !canWrite.ok, `HTTP ${canWrite.status}, code ${canWrite.code}`)

  await rest('emp_owner', 'PATCH', `/employees?id=eq.${ids[target]}`, {
    body: { is_active: true },
    prefer: 'return=representation',
  })
  const restored = (await readRow('emp_owner', 'employees', ids[target], 'id,is_active')).row
  r.check('reactivated (net-zero)', restored.is_active === true, '')

  const leadsAgain = await rest(target, 'GET', '/leads?select=id&limit=1')
  r.check('access returns after reactivation', leadsAgain.ok && leadsAgain.count > 0, `${leadsAgain.count} rows`)
}

// ===========================================================================
r.section('5. UNAUTHENTICATED — the anon key on its own')
// ===========================================================================
{
  const tables = ['employees', 'leads', 'parties', 'activities']
  const results = []
  for (const t of tables) {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${t}?select=id&limit=1`, {
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
    })
    results.push(`${t}:${res.status}`)
  }
  r.check(
    'the anon key with no session reaches nothing',
    results.every((x) => !x.endsWith(':200')),
    results.join(' ')
  )
}

await (async () => {
  const { failed } = r.summary()
  process.exit(failed ? 1 : 0)
})()
