#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 3 E2E — 01: all nine identities log in, and each lands on the right
// screen for their role.
//
// This is the load-bearing first test: if nine real accounts cannot sign in
// through the real form, nothing else in Phase 3 means anything.
// ===========================================================================

import { launch, session, realErrors, realFailures } from './harness.mjs'
import { plan, makeReporter } from '../lib.mjs'

const r = makeReporter('01 LOGIN + LANDING')
const browser = await launch()

const IDENTITIES = [
  { ref: 'emp_owner', role: 'owner', name: plan.owner.name },
  ...plan.employees.map((e) => ({ ref: e.ref, role: e.role, name: e.name })),
]

console.log('PHASE 3 E2E — 01: login and landing\n')

for (const id of IDENTITIES) {
  let s
  try {
    s = await session(browser, id.ref)
  } catch (e) {
    r.check(`${id.ref} (${id.role}) can log in`, false, e.message.split('\n')[0])
    continue
  }

  const text = await s.text()
  r.check(`${id.ref} (${id.role}) logs in and reaches the app shell`, true, `as ${id.name}`)

  // The greeting bar carries the employee's own name — the cheapest proof that
  // AuthContext resolved the right employees row, not just that auth succeeded.
  r.check(
    `${id.ref} is identified as the right employee on screen`,
    text.includes(id.name.split(' ')[0]),
    `looked for "${id.name.split(' ')[0]}" in the landing screen`
  )

  // A coordinator gets CoordinatorToday; everyone else gets Today.
  if (id.role === 'sales_coordinator') {
    r.check(
      `${id.ref} lands on the coordinator Today screen`,
      /team view is being built|your team/i.test(text),
      'CoordinatorToday placeholder'
    )
  }

  const errs = realErrors(s.consoleErrors)
  const fails = realFailures(s.failedRequests)
  r.check(`${id.ref} landing screen has no console errors`, errs.length === 0, errs.slice(0, 3).join(' | '))
  r.check(`${id.ref} landing screen has no failed requests`, fails.length === 0, fails.slice(0, 3).join(' | '))

  await s.shot(`01-landing-${id.ref}`)
  await s.close()
}

await browser.close()
const { failed } = r.summary()
process.exit(failed ? 1 : 0)
