#!/usr/bin/env node
/* eslint-disable no-console */
// ===========================================================================
// PHASE 3 — run the whole suite.
//
//   node phase9/e2e/run-all.mjs
//
// Needs a dev server on http://localhost:5173 (override with E2E_BASE) and
// the credentials in .env.phase9. Every suite is re-runnable and net-zero:
// each write is round-tripped and restored, so this can be run repeatedly
// without drifting the seeded data away from simulation_plan.json.
//
// Finishes by re-running the field-by-field seed verification, because "the
// tests passed" is worth nothing if the tests themselves moved the data
// Phase 6 and Phase 7 are going to reconcile against.
// ===========================================================================

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from '../lib.mjs'

const STEPS = [
  ['guard-rail probes', join(ROOT, 'phase9', 'probes.mjs')],
  ['01 login + landing', join(ROOT, 'phase9', 'e2e', '01-login-and-landing.mjs')],
  ['02 screens', join(ROOT, 'phase9', 'e2e', '02-screens.mjs')],
  ['03 phase 8 items', join(ROOT, 'phase9', 'e2e', '03-phase8-items.mjs')],
  ['seed still plan-exact', join(ROOT, 'phase9', 'verify_seed.mjs')],
]

const results = []
for (const [name, file] of STEPS) {
  console.log(`\n${'='.repeat(74)}\n${name}\n${'='.repeat(74)}`)
  const res = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  results.push({ name, code: res.status })
}

console.log(`\n${'='.repeat(74)}\nSUMMARY\n${'='.repeat(74)}`)
for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}`)
process.exit(results.some((r) => r.code !== 0) ? 1 : 0)
