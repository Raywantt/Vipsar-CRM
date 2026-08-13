#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 4 — responsive / visual sweep.
//
// Every screen, every role, at BOTH breakpoints. Phase 3 ran desktop only;
// this app is mobile-first for reps working from a phone in the field, so the
// 390px pass is the one that matters most and had never been automated.
//
// 1023.98px is the breakpoint. 390px (iPhone 14) and 1440px sit either side.
// ===========================================================================

import { launch, session, MOBILE, realErrors } from './harness.mjs'
import { auditGrids, reportGrids } from './layout-audit.mjs'
import { auditVisual, reportVisual } from './visual-audit.mjs'
import { plan, ids, makeReporter } from '../lib.mjs'

const r = makeReporter('04 RESPONSIVE')
const browser = await launch()

const rohitLead = plan.leads.find((l) => l.owner_employee_ref === 'ex_rohit' && l.party_ref && l.quote_value)
const wonLead = plan.leads.find((l) => l.current_stage === 'won' && l.quote_value && l.order_value)

const ROUTES = {
  emp_owner: [
    ['/', 'today'],
    ['/dashboard', 'dashboard'],
    ['/dashboard?tab=leads', 'all-leads'],
    ['/team', 'my-team'],
    [`/employees/${ids.ex_rohit}`, 'employee-profile'],
    [`/leads/${ids[wonLead.ref]}`, 'lead-detail-won'],
    ['/search', 'search'],
    ['/profile', 'profile'],
  ],
  sc_north: [
    ['/', 'coordinator-today'],
    ['/dashboard', 'dashboard'],
    ['/dashboard?tab=leads', 'all-leads'],
    [`/leads/${ids[rohitLead.ref]}`, 'lead-detail'],
    ['/search', 'search'],
  ],
  ex_rohit: [
    ['/', 'today'],
    ['/dashboard', 'dashboard'],
    ['/dashboard?tab=leads', 'all-leads'],
    ['/activity', 'activity-log'],
    ['/leads/new', 'new-lead'],
    [`/leads/${ids[rohitLead.ref]}`, 'lead-detail'],
    ['/search', 'search'],
    ['/profile', 'profile'],
  ],
}

const VIEWPORTS = [
  { name: 'mobile', viewport: MOBILE, isMobile: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
]

const tally = { overflow: 0, cascade: 0, overlap: 0, clipped: 0, gaps: 0 }

for (const vp of VIEWPORTS) {
  for (const [ref, routes] of Object.entries(ROUTES)) {
    r.section(`--- ${vp.name} · ${ref} ---`)
    const s = await session(browser, ref, { viewport: vp.viewport })

    for (const [path, name] of routes) {
      s.consoleErrors.length = 0
      await s.go(path)
      await s.settle()

      const label = `${vp.name} ${ref} ${name}`

      const v = await auditVisual(s.page, { isMobile: vp.isMobile })
      const grids = await auditGrids(s.page)

      const issues = reportVisual(label, v) + reportGrids(label, grids)
      tally.overflow += v.overflow ? 1 : 0
      tally.cascade += v.cascade.length
      tally.overlap += v.overlap.length
      tally.clipped += v.clipped.length
      tally.gaps += grids.gaps.length

      // Horizontal scroll is the hard failure — a phone that scrolls sideways
      // is broken in a way a user cannot work around.
      r.check(`${label}: no horizontal overflow`, !v.overflow, v.overflow ? `${v.overflow.overflowBy}px` : '')
      r.check(`${label}: no visibility-cascade leak`, v.cascade.length === 0, `${v.cascade.length}`)
      r.check(`${label}: no overlapping text`, v.overlap.length === 0, `${v.overlap.length}`)
      r.check(`${label}: no empty grid tracks`, grids.gaps.length === 0, `${grids.gaps.length}`)

      const errs = realErrors(s.consoleErrors)
      r.check(`${label}: no console errors`, errs.length === 0, errs.slice(0, 2).join(' | '))

      if (issues > 0 || vp.isMobile) await s.shot(`04-${vp.name}-${ref}-${name}`)
    }

    await s.close()
  }
}

console.log(
  `\ntotals — overflow:${tally.overflow} cascade:${tally.cascade} ` +
    `overlap:${tally.overlap} clipped:${tally.clipped} gridGaps:${tally.gaps}`
)
await browser.close()
const { failed } = r.summary()
process.exit(failed ? 1 : 0)
