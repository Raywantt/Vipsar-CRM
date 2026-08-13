#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 3 E2E — 02: every screen, as every role.
//
// For each (role, route) pair: navigate, assert the seeded data is actually on
// screen, assert no console errors and no failed requests, run the grid layout
// audit, and capture a screenshot.
//
// Route access is asserted in BOTH directions — a role reaching a screen it
// should not is a defect, and so is a role being bounced off one it should
// reach. `ProtectedRoute` redirects to `/` on a role mismatch, so a denied
// route is detected by landing somewhere else, not by an error.
// ===========================================================================

import { launch, session, realErrors, realFailures } from './harness.mjs'
import { auditGrids, reportGrids } from './layout-audit.mjs'
import { plan, ids, makeReporter } from '../lib.mjs'

const r = makeReporter('02 SCREENS')
const browser = await launch()

// A lead each role can legitimately open.
const rohitLead = plan.leads.find((l) => l.owner_employee_ref === 'ex_rohit' && l.party_ref && l.quote_value)

const ROUTES = {
  emp_owner: [
    { path: '/', name: 'today', expect: [/Good (morning|afternoon|evening)|Hello/] },
    { path: '/dashboard', name: 'dashboard-reports', expect: [/Needs Attention/i, /pipeline/i] },
    { path: '/dashboard?tab=leads', name: 'all-leads', expect: [/leads/i] },
    { path: '/team', name: 'my-team', expect: [/Rohit Sharma/, /Karan Bhatia/] },
    { path: `/employees/${ids.ex_rohit}`, name: 'employee-profile', expect: [/Rohit Sharma/] },
    { path: `/leads/${ids[rohitLead.ref]}`, name: 'lead-detail', expect: [/Deal|stage|Activity/i] },
    { path: '/search', name: 'search', expect: [/Parties|Leads|Sites/i] },
    { path: '/profile', name: 'profile', expect: [/Raywant/, /Notifications/i, /Appearance/i] },
  ],
  sc_north: [
    { path: '/', name: 'coordinator-today', expect: [/team/i] },
    { path: '/dashboard', name: 'dashboard-reports', expect: [/Needs Attention/i] },
    { path: '/dashboard?tab=leads', name: 'all-leads', expect: [/leads/i] },
    { path: `/leads/${ids[rohitLead.ref]}`, name: 'lead-detail', expect: [/Activity|stage/i] },
    { path: '/search', name: 'search', expect: [/Parties|Leads|Sites/i] },
    { path: '/profile', name: 'profile', expect: [/Neha Malhotra/] },
  ],
  ex_rohit: [
    { path: '/', name: 'today', expect: [/Done today/i, /Still to do/i] },
    { path: '/dashboard', name: 'dashboard-reports', expect: [/Needs Attention/i] },
    { path: '/dashboard?tab=leads', name: 'all-leads', expect: [/leads/i] },
    { path: '/activity', name: 'activity-log', expect: [/Site Visit|Call|Office Day/i] },
    { path: '/leads/new', name: 'new-lead', expect: [/Scanning|Lixil|Referral/i] },
    { path: `/leads/${ids[rohitLead.ref]}`, name: 'lead-detail', expect: [/Activity|stage/i] },
    { path: `/employees/${ids.ex_rohit}`, name: 'own-profile', expect: [/Rohit Sharma/] },
    { path: '/search', name: 'search', expect: [/Parties|Leads|Sites/i] },
    { path: '/profile', name: 'profile', expect: [/Rohit Sharma/] },
  ],
}

// Routes a role must NOT reach — asserted by where they end up instead.
const DENIED = {
  sc_north: [{ path: '/team', name: 'my-team is owner-only' }],
  ex_rohit: [
    { path: '/team', name: 'my-team is owner-only' },
    { path: `/employees/${ids.ex_priya}`, name: "a colleague's profile" },
  ],
  emp_owner: [{ path: '/activity', name: 'activity log is sales_executive-only' }],
}

let totalGaps = 0

for (const [ref, routes] of Object.entries(ROUTES)) {
  r.section(`--- ${ref} ---`)
  const s = await session(browser, ref)

  for (const route of routes) {
    s.consoleErrors.length = 0
    s.failedRequests.length = 0

    await s.go(route.path)
    const text = await s.text()

    for (const re of route.expect) {
      r.check(`${ref} ${route.name}: content matches ${re}`, re.test(text), text.slice(0, 90).replace(/\n/g, ' | '))
    }

    const errs = realErrors(s.consoleErrors)
    const fails = realFailures(s.failedRequests)
    r.check(`${ref} ${route.name}: no console errors`, errs.length === 0, errs.slice(0, 2).join(' | '))
    r.check(`${ref} ${route.name}: no failed requests`, fails.length === 0, fails.slice(0, 2).join(' | '))

    const grids = await auditGrids(s.page)
    totalGaps += reportGrids(`${ref} ${route.name}`, grids)
    r.check(`${ref} ${route.name}: no empty grid tracks`, grids.gaps.length === 0, `${grids.gaps.length} gap(s)`)

    await s.shot(`02-${ref}-${route.name}`)
  }

  for (const d of DENIED[ref] ?? []) {
    await s.go(d.path)
    const url = s.page.url()
    r.check(
      `${ref} is redirected away from ${d.name}`,
      !url.includes(d.path.split('?')[0]) || url.endsWith('/'),
      `landed on ${url}`
    )
  }

  await s.close()
}

console.log(`\ngrid gaps found across all screens: ${totalGaps}`)
const { failed } = r.summary()
process.exit(failed ? 1 : 0)
