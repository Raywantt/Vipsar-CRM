// Screenshot sweep across every route in scripts/routes.json, for all three
// roles, at desktop + mobile widths. Two modes:
//
//   node scripts/shoot.mjs --login <role>
//     Opens a real, visible Chromium window and waits for a human to log in
//     by hand (Claude never enters credentials). Press Enter in this
//     terminal once you're logged in; the session is saved to
//     scripts/.auth/<role>.json for reuse by the capture run. Run this once
//     per role, e.g.:
//       node scripts/shoot.mjs --login owner
//       node scripts/shoot.mjs --login coordinator
//       node scripts/shoot.mjs --login exec
//
//   node scripts/shoot.mjs
//     Runs the full capture using whichever scripts/.auth/<role>.json files
//     already exist. Screenshots land in scripts/screenshots/<role>/<mobile|
//     desktop>/<route-slug>.png, plus scripts/screenshots/_shared for the two
//     routes that aren't role-specific (Login, 404). Prints a pass/fail
//     summary at the end and writes it to scripts/screenshots/report.json.

import { chromium } from 'playwright'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ROUTES_PATH = join(__dirname, 'routes.json')
const AUTH_DIR = join(__dirname, '.auth')
const SHOTS_DIR = join(__dirname, 'screenshots')

const BASE_URL = process.env.SHOOT_BASE_URL ?? 'http://localhost:5181'

const ROLES = ['owner', 'coordinator', 'exec']

// Routes that aren't role-specific — captured once, unauthenticated.
const GLOBAL_ROUTE_NAMES = new Set(['Login', 'Not Found (404)'])

// Route names each role can't reach (ProtectedRoute would redirect them away
// — see App.jsx's allowedRoles). Skipped rather than captured, so a redirect
// to Home never gets mislabeled as a screenshot of the real page.
const SKIP_FOR_ROLE = {
  owner: ['Log Activity'],
  coordinator: ['My Team'],
  exec: ['My Team'],
}

// "Sales Exec Profile" is self-view-only for a non-owner (EmployeeProfile.jsx:
// allowed = isOwner || isSelf). routes.json's default id (26) is the real
// "exec" test employee, so it's correct as-is for owner (viewing exec) and
// for exec (viewing themselves) — only coordinator needs an override to their
// own id (25) or they'd be redirected to /dashboard.
const PATH_OVERRIDE_FOR_ROLE = {
  coordinator: { 'Sales Exec Profile': '/employees/25' },
}

const BREAKPOINTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 812 },
]

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function loadRoutes() {
  return JSON.parse(readFileSync(ROUTES_PATH, 'utf-8'))
}

async function loginFlow(role) {
  if (!role) {
    console.error('Usage: node scripts/shoot.mjs --login <role>   (role: owner | coordinator | exec)')
    process.exit(1)
  }
  mkdirSync(AUTH_DIR, { recursive: true })
  const authPath = join(AUTH_DIR, `${role}.json`)

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(new URL('/login', BASE_URL).toString())

  console.log(`\nA browser window is open at ${BASE_URL}/login.`)
  console.log(`Log in by hand as the "${role}" account, then come back here.`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await rl.question('Press Enter once you are logged in and see the app... ')
  rl.close()

  try {
    await page.waitForSelector('.vip-app', { timeout: 5000 })
  } catch {
    console.warn('Warning: never saw the app shell (.vip-app) render — saving the session anyway, but double-check it actually logged in.')
  }

  await context.storageState({ path: authPath })
  await browser.close()
  console.log(`Saved session to ${authPath}`)
}

async function captureRoute(page, { url, outPath }) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  // Every goto() is a hard reload, so AuthContext's session-restore +
  // employee lookup re-runs from scratch each time, not just once per
  // login — a fixed short wait intermittently caught the page still on its
  // "Loading…" splash. Wait for that text to actually clear instead.
  await page
    .waitForFunction(() => !document.body.innerText.includes('Loading…'), { timeout: 15000 })
    .catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: outPath, fullPage: true })
}

async function runCaptures() {
  const routes = loadRoutes()
  const results = []

  const browser = await chromium.launch({ headless: true })

  // Global, unauthenticated routes — once each, no role folder.
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height })
      for (const route of routes.filter((r) => GLOBAL_ROUTE_NAMES.has(r.name))) {
        const outDir = join(SHOTS_DIR, '_shared', bp.name)
        mkdirSync(outDir, { recursive: true })
        const outPath = join(outDir, `${slug(route.name)}.png`)
        const url = new URL(route.path, BASE_URL).toString()
        try {
          await captureRoute(page, { url, outPath })
          results.push({ role: '_shared', breakpoint: bp.name, route: route.name, path: route.path, ok: true })
        } catch (err) {
          results.push({ role: '_shared', breakpoint: bp.name, route: route.name, path: route.path, ok: false, error: String(err.message ?? err) })
        }
      }
    }
    await context.close()
  }

  // Role-specific routes.
  for (const role of ROLES) {
    const authPath = join(AUTH_DIR, `${role}.json`)
    if (!existsSync(authPath)) {
      console.warn(`Skipping role "${role}" — no saved session at ${authPath}. Run: node scripts/shoot.mjs --login ${role}`)
      results.push({ role, breakpoint: '-', route: '(all)', path: '-', ok: false, error: 'no saved session' })
      continue
    }

    const context = await browser.newContext({ storageState: authPath })
    const page = await context.newPage()

    const roleRoutes = routes
      .filter((r) => !GLOBAL_ROUTE_NAMES.has(r.name))
      .filter((r) => !(SKIP_FOR_ROLE[role] ?? []).includes(r.name))

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height })
      for (const route of roleRoutes) {
        const overridePath = PATH_OVERRIDE_FOR_ROLE[role]?.[route.name]
        const effectivePath = overridePath ?? route.path
        const outDir = join(SHOTS_DIR, role, bp.name)
        mkdirSync(outDir, { recursive: true })
        const outPath = join(outDir, `${slug(route.name)}.png`)
        const url = new URL(effectivePath, BASE_URL).toString()
        try {
          await captureRoute(page, { url, outPath })
          results.push({ role, breakpoint: bp.name, route: route.name, path: effectivePath, ok: true })
        } catch (err) {
          results.push({ role, breakpoint: bp.name, route: route.name, path: effectivePath, ok: false, error: String(err.message ?? err) })
        }
      }
    }

    await context.close()
  }

  await browser.close()

  mkdirSync(SHOTS_DIR, { recursive: true })
  writeFileSync(join(SHOTS_DIR, 'report.json'), JSON.stringify(results, null, 2))

  const failed = results.filter((r) => !r.ok)
  const passed = results.filter((r) => r.ok)
  console.log(`\n${passed.length} captured, ${failed.length} failed.`)
  if (failed.length) {
    console.log('\nFailures:')
    for (const f of failed) {
      console.log(`  [${f.role}/${f.breakpoint}] ${f.route} (${f.path}) — ${f.error}`)
    }
  }
  console.log(`\nFull report: ${join(SHOTS_DIR, 'report.json')}`)
}

const args = process.argv.slice(2)
if (args[0] === '--login') {
  await loginFlow(args[1])
} else {
  await runCaptures()
}
