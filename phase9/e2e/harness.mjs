/* eslint-disable no-console */
// ===========================================================================
// PHASE 9 / PHASE 3 — multi-role E2E harness
//
// One Chromium, one dev server, N ISOLATED browser contexts. Contexts have
// separate storage, which is the only way to hold nine Supabase sessions at
// once — tabs on one origin share a single login, which is exactly the trap
// `CLAUDE.md` warns about under "Local environment notes" (a login for one
// manual test silently carrying into a later "logged out" check).
//
// Phase 0 originally planned nine dev-server ports for this. Contexts make
// that unnecessary; `.claude/launch.json` stays at three, per the user.
//
// Sign-in goes THROUGH THE REAL LOGIN FORM rather than by injecting a token
// into localStorage. Slower, and deliberate: it means every run also proves
// that nine real accounts can actually log in, which is itself a Phase 3
// requirement and the first thing a pilot would hit.
// ===========================================================================

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { credentialsFor, ROOT } from '../lib.mjs'

export const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'
export const SHOTS = join(ROOT, 'phase9', 'e2e', 'screenshots')
mkdirSync(SHOTS, { recursive: true })

// Desktop by default. The mobile breakpoint is 1023.98px, so 1440 exercises the
// sidebar/wide-grid half of every screen; the responsive pass overrides this.
const DESKTOP = { width: 1440, height: 900 }
export const MOBILE = { width: 390, height: 844 }

export async function launch() {
  const browser = await chromium.launch()
  return browser
}

/**
 * A logged-in page for one identity, in its own storage-isolated context.
 * Console errors and failed requests are collected per-session so a screen can
 * be asserted clean rather than merely "looked right in a screenshot".
 */
export async function session(browser, ref, { viewport = DESKTOP } = {}) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  const consoleErrors = []
  const failedRequests = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`)
  })

  const { email, password } = credentialsFor(ref)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('button[type="submit"]').click()

  // The app lands on `/` after login. Wait for the shell rather than a fixed
  // timeout — a slow first Supabase round-trip is normal on a cold dev server.
  await page.waitForSelector('.vip-app', { timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

  return {
    ref,
    page,
    context,
    consoleErrors,
    failedRequests,
    /** Navigate within the SPA and settle. */
    async go(path) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.vip-app', { timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    },
    /**
     * Viewport screenshot by default, NOT fullPage.
     *
     * `fullPage: true` resizes the viewport to capture, which smears this
     * app's `position: fixed` sidebar and header across the whole image — it
     * renders as a giant dark overlay covering the content and reads exactly
     * like a catastrophic layout bug. It is a capture artifact, confirmed by
     * comparing against a viewport shot and the element's own box. Pass
     * `{ full: true }` only when you actually need the whole scroll height,
     * and read the result knowing the fixed chrome is unreliable in it.
     */
    async shot(name, { full = false } = {}) {
      const file = join(SHOTS, `${name}.png`)
      // Park the pointer off the sidebar: it hover-expands by pure CSS, so a
      // shot taken with the pointer at the default 0,0 captures it open.
      await page.mouse.move(viewport.width - 40, Math.floor(viewport.height / 2))
      await page.screenshot({ path: file, fullPage: full })
      return file
    },
    /** Visible text of the whole app shell — cheap way to assert content. */
    text() {
      return page.locator('.vip-app').innerText()
    },
    /**
     * Wait until no in-app loading placeholder is left on screen.
     *
     * `networkidle` is NOT enough for anything triggered by a click: the
     * Day Review fires seven parallel day-bounded fetches AFTER the previous
     * load has already settled, so networkidle resolves against the old quiet
     * period and the assertion runs against a "Loading…" screen. That produced
     * three false failures on this suite's first run.
     *
     * Note the character: the app renders U+2026 ("Loading…"), not three ASCII
     * dots. Matching "Loading..." silently never fires.
     */
    async settle({ timeout = 30_000 } = {}) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const t = await page.locator('.vip-app').innerText()
        if (!/Loading[….]/.test(t)) return true
        await page.waitForTimeout(250)
      }
      return false
    },
    async close() {
      await context.close()
    },
  }
}

/**
 * Console noise that is not a defect in this app.
 * Kept explicit and short: anything not listed here is reported, so the filter
 * can never quietly swallow a real error.
 */
const BENIGN = [
  /Download the React DevTools/i,
  /\[vite\] connect/i,
  /Failed to load resource.*favicon/i,
]

export function realErrors(list) {
  return list.filter((e) => !BENIGN.some((re) => re.test(e)))
}

/**
 * Failed HTTP the app makes on purpose. Supabase returns 400 on a bad login
 * attempt, and the app deliberately probes some endpoints that RLS empties.
 */
export function realFailures(list) {
  return list.filter((f) => !/auth\/v1\/token/.test(f))
}
