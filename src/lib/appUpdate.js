// The app's auto-update engine — what makes a deployed build reach the nine
// people using this CRM without anyone being told to clear a cache.
//
// WHY THIS EXISTS. A deploy used to reach an employee only if they happened to
// fully reload, and there was no reliable way for them to do that: refreshing
// was answered by the service worker's stored copy of the app and never
// reached the network (measured on a live tab: workerStart 1006ms,
// transferSize 0), so "clear your site data" had become the standing advice.
// That stored copy is gone as of 2026-09-07 (see src/sw.js), which fixes the
// refresh. This module fixes the other half: a tab that is ALREADY OPEN keeps
// running the JavaScript it loaded at open time, however stale, because a
// React SPA navigates without ever fetching a document again. Nothing told it
// a new build existed. This does, and then reloads it.
//
// HOW IT DETECTS A NEW BUILD. It fetches the app's own HTML and compares the
// hashed /assets/… filenames in it against the ones this page actually loaded.
// Vite renames those on every build whose output differs, so a mismatch IS a
// new deploy — nothing to configure, and no version file anyone has to
// remember to bump.
//
// It deliberately does NOT key off the service worker any more. It used to
// listen for controllerchange, which was right while sw.js carried a precache
// manifest that changed every build. sw.js is now 618 bytes of push handlers
// and is byte-identical between deploys, so that event would never fire again.
// The HTML check also reacts far quicker: the old path could not reload until
// a new worker had downloaded and precached the whole app shell, measured at
// between 6 and 29 seconds after a real tab switch. This takes one round trip.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not reload out from under someone
// mid-sentence. See decideReload() for the exact rule.
//
// TESTABILITY. Every judgement lives in a pure function — decideReload() and
// isNewBuild() — because vitest runs in the `node` environment here (see
// vitest.config.js) and has no DOM to inspect. DOM and network reading is
// confined to readEnvironment()/checkForUpdate(), which are glue.
import { pendingWriteCount } from './supabaseFetch'
import { storedAccessTokenExpired } from './supabaseClient'

// How often a VISIBLE tab asks whether a new build exists. One conditional
// request for the app's HTML (~1.2KB, answered 304 while unchanged because
// Vercel serves it must-revalidate), so a few hundred bytes in the normal case.
//
// Five minutes rather than one is a deliberate cost choice, and it loses very
// little: the checks that matter are the event-driven ones below (regaining
// focus, reconnecting), which fire exactly when a rep picks their phone back
// up. The timer is only a backstop for a desktop tab left staring at one
// screen, and it does not run at all while the tab is hidden.
export const UPDATE_POLL_MS = 5 * 60 * 1000

// Several signals can arrive together — a phone waking fires visibilitychange
// and focus, and often `online` too. Without this floor that is three network
// checks for one event.
export const CHECK_THROTTLE_MS = 20 * 1000

// While a reload is being held back, how often to re-test whether it has
// become safe. Ten seconds is short enough that finishing a form feels like it
// updates "right after", and cheap because the test is pure DOM reading with
// no network involved.
export const DEFERRED_RECHECK_MS = 10 * 1000

// How long after the last keystroke a page still counts as being worked on.
// Pairs with hasUnsavedInput: three minutes of not typing while a half-filled
// form sits on screen is treated as abandoned rather than in progress.
export const TYPING_IDLE_MS = 3 * 60 * 1000

// A reload loop would be far worse than a stale build — it would make the CRM
// unusable rather than merely out of date. If an auto-reload happened within
// this window, the next one defers to the banner instead, so any unforeseen
// "still looks new after reloading" condition degrades into one visible button
// rather than a spinning page. Session-scoped: a genuine second deploy an hour
// later is unaffected.
export const RELOAD_COOLDOWN_MS = 30 * 1000

const RELOAD_MARK_KEY = 'vip-last-auto-reload'

// Fetching '/' rather than '/index.html' on purpose: vercel.json rewrites every
// path to the app's HTML, so this is correct without assuming anything about
// the built file layout.
const VERSION_PROBE_URL = '/'

// Field types where a non-empty value is not work in progress worth
// protecting. A search/filter box in particular is very often left with text
// in it — blocking every update on one would mean an employee who types a
// filter once and leaves it there never updates again.
const IGNORED_INPUT_TYPES = new Set([
  'hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image',
  'search', 'range', 'color',
])

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// ---------------------------------------------------------------------------
// The decision. Pure, and ordered most-severe-first so the reason it returns
// is the real one rather than whichever test happened to run last.
// ---------------------------------------------------------------------------
export function decideReload({
  pendingWrites = 0,
  documentHidden = false,
  authTokenExpired = false,
  editingFieldFocused = false,
  msSinceLastInput = Infinity,
  hasUnsavedInput = false,
  msSinceLastAutoReload = Infinity,
} = {}) {
  // Reloading mid-write is the one case that can cost committed data rather
  // than typing: the request is cancelled at the network layer, and for a POST
  // the row may or may not already have been written server-side. Never guess.
  if (pendingWrites > 0) return { reload: false, reason: 'save-in-flight' }

  // NEVER RELOAD A HIDDEN PAGE. This looks like the safest possible moment —
  // nobody is watching — and it is in fact the most dangerous one, which is
  // why it gets its own rule rather than a comment.
  //
  // A phone that has just been pocketed freezes or discards the page shortly
  // after it goes hidden. A reload issued into that window starts a fresh
  // load which immediately asks auth-js to rotate an expired refresh token;
  // the rotation reaches Supabase, the response never gets persisted because
  // the page is suspended mid-flight, and the employee is signed out on their
  // next open — the token they still hold has been consumed, and auth-js
  // treats "Already Used" as a dead session. Reported 2026-09-07 as "after
  // every update the app logs the user out".
  //
  // The pendingWrites guard above cannot see this: the dangerous request
  // belongs to the NEXT page load, not this one. So the rule is simply not to
  // start a load nobody is around to finish. The update is not lost — the
  // visibilitychange handler applies it the moment the app is opened again,
  // before the rep has touched anything.
  if (documentHidden) return { reload: false, reason: 'page-hidden' }

  // The same failure, reached without ever being hidden: if the stored access
  // token has ALREADY expired, a fresh load has no choice but to rotate the
  // refresh token before it can do anything, and any interruption of that
  // rotation ends in a forced logout. Waiting lets auth-js rotate it here, on
  // a live page, where the new token actually gets written to storage. It
  // fails open (see storedAccessTokenExpired), and auto-refresh resolves it
  // within seconds, so this defers an update rather than blocking one.
  if (authTokenExpired) return { reload: false, reason: 'auth-refresh-pending' }

  // The cursor is in a field on a focused window — someone is typing this
  // instant. Note the caller pairs this with document.hasFocus(), so a field
  // left focused on a window the rep walked away from does NOT hold an update
  // back; that case falls through to the content test below.
  if (editingFieldFocused) return { reload: false, reason: 'field-focused' }

  // A part-filled form that was typed into recently. Either half alone is not
  // enough: content with no recent typing is an abandoned form, and recent
  // typing with nothing left on screen was a search box or a form that has
  // since been saved and reset — neither is worth delaying an update for.
  if (hasUnsavedInput && msSinceLastInput < TYPING_IDLE_MS) {
    return { reload: false, reason: 'recent-typing' }
  }

  if (msSinceLastAutoReload < RELOAD_COOLDOWN_MS) {
    return { reload: false, reason: 'cooldown' }
  }

  return { reload: true, reason: 'safe' }
}

// ---------------------------------------------------------------------------
// Build identity. Also pure — the network call that feeds it is separate.
// ---------------------------------------------------------------------------

// Every hashed build artifact referenced by a page of HTML, deduped and sorted
// so two sets compare regardless of the order Vite emitted them in.
export function assetsFromHtml(html) {
  const found = String(html ?? '').match(/\/assets\/[A-Za-z0-9._-]+/g) ?? []
  return [...new Set(found)].sort()
}

/**
 * Whether the deployed build differs from the one this page is running.
 *
 * Returns false whenever either side is empty, and that is the important half:
 * a failed or truncated fetch, an HTML error page, or a DOM we could not read
 * must never be mistaken for "a new build exists". Missing a check costs a few
 * minutes and the next one corrects it; a false positive reloads a working
 * page — potentially repeatedly — for no reason at all.
 */
export function isNewBuild(currentAssets, deployedAssets) {
  if (!currentAssets?.length || !deployedAssets?.length) return false
  if (currentAssets.length !== deployedAssets.length) return true
  return currentAssets.some((asset, i) => asset !== deployedAssets[i])
}

// What this page actually loaded, read off the document rather than assumed.
// Covers the stylesheet as well as the script, so a CSS-only deploy is caught.
export function currentPageAssets(doc) {
  const nodes = doc?.querySelectorAll?.('script[src], link[href]') ?? []
  const urls = []
  for (const node of nodes) {
    const raw = node.getAttribute?.('src') ?? node.getAttribute?.('href') ?? ''
    if (raw.includes('/assets/')) urls.push(raw)
  }
  return assetsFromHtml(urls.join(' '))
}

// ---------------------------------------------------------------------------
// DOM reading for the "is anyone mid-entry" test.
// ---------------------------------------------------------------------------
export function isEditableElement(el) {
  if (!el) return false
  if (el.isContentEditable) return true
  if (!EDITABLE_TAGS.has(el.tagName)) return false
  if (el.disabled || el.readOnly) return false
  if (el.tagName === 'INPUT' && IGNORED_INPUT_TYPES.has(String(el.type ?? '').toLowerCase())) {
    return false
  }
  return true
}

export function documentHasUnsavedInput(doc) {
  const fields = doc?.querySelectorAll?.('input, textarea') ?? []
  for (const field of fields) {
    if (isEditableElement(field) && String(field.value ?? '').trim() !== '') return true
  }
  return false
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

/**
 * Wires up update detection for the life of the page.
 *
 * @param {object} options
 * @param {(deferred: boolean) => void} [options.onDeferredChange] Called with
 *   true when a ready update is being held back (show the banner) and false
 *   when it stops being. Never called at all in the ordinary case, because
 *   that path reloads rather than rendering anything.
 * @returns {() => void} cleanup
 */
export function initAppUpdate({ onDeferredChange } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  // Captured once, at load. This is the build this page is running, and it
  // cannot change without a reload — which is the whole point.
  const loadedAssets = currentPageAssets(document)

  let updateReady = false
  let deferred = false
  let lastInputAt = 0
  let lastCheckAt = 0
  let pollTimer = null
  let recheckTimer = null
  let disposed = false

  function setDeferred(next) {
    if (deferred === next) return
    deferred = next
    onDeferredChange?.(next)
  }

  function readLastAutoReloadAge() {
    try {
      const raw = window.sessionStorage?.getItem(RELOAD_MARK_KEY)
      if (!raw) return Infinity
      const age = Date.now() - Number(raw)
      return Number.isFinite(age) ? age : Infinity
    } catch {
      // Private mode / storage disabled. Losing the loop guard is acceptable;
      // failing to update is not.
      return Infinity
    }
  }

  function readEnvironment() {
    return {
      pendingWrites: pendingWriteCount(),
      documentHidden: document.visibilityState === 'hidden',
      authTokenExpired: storedAccessTokenExpired(),
      editingFieldFocused:
        document.hasFocus() && isEditableElement(document.activeElement),
      msSinceLastInput: lastInputAt === 0 ? Infinity : Date.now() - lastInputAt,
      hasUnsavedInput: documentHasUnsavedInput(document),
      msSinceLastAutoReload: readLastAutoReloadAge(),
    }
  }

  function reloadNow() {
    try {
      window.sessionStorage?.setItem(RELOAD_MARK_KEY, String(Date.now()))
    } catch { /* see readLastAutoReloadAge */ }
    window.location.reload()
  }

  // Re-evaluated on every signal that could plausibly have changed the answer:
  // a save finishing, the rep walking away, the recheck timer.
  function tryReload() {
    if (disposed || !updateReady) return
    clearTimeout(recheckTimer)

    const { reload } = decideReload(readEnvironment())
    if (reload) {
      reloadNow()
      return
    }

    setDeferred(true)
    recheckTimer = setTimeout(tryReload, DEFERRED_RECHECK_MS)
  }

  async function checkForUpdate({ force = false } = {}) {
    // Once an update is known, stop asking — the answer cannot change back,
    // and tryReload() is already retrying on its own timer.
    if (disposed || updateReady) return
    const now = Date.now()
    if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return
    lastCheckAt = now

    try {
      // 'no-cache' rather than 'no-store': it must revalidate every time (a
      // stored copy would defeat the whole check) but may still be answered
      // 304, which keeps a routine check to a few hundred bytes.
      const response = await fetch(VERSION_PROBE_URL, {
        cache: 'no-cache',
        credentials: 'same-origin',
      })
      if (!response.ok) return
      if (disposed) return

      const deployed = assetsFromHtml(await response.text())
      if (!isNewBuild(loadedAssets, deployed)) return

      updateReady = true
      tryReload()
    } catch {
      // Offline, or a deploy mid-flight. A missed check is a non-event; the
      // next signal asks again.
    }
  }

  function syncPolling() {
    clearInterval(pollTimer)
    pollTimer = null
    if (document.visibilityState === 'visible') {
      pollTimer = setInterval(() => checkForUpdate(), UPDATE_POLL_MS)
    }
  }

  function handleVisibilityChange() {
    syncPolling()
    if (document.visibilityState === 'visible') {
      // Coming back is the single most valuable moment to ask: a rep who
      // pocketed their phone during a deploy gets the new build before they
      // touch anything.
      checkForUpdate()
      tryReload()
    }
    // There is deliberately no `else` branch applying the update on the way
    // out. Reloading a page that is being backgrounded is what was signing
    // employees out — see the `page-hidden` rule in decideReload(). A pending
    // update simply waits for the next time the app is opened.
  }

  function handleInput() {
    lastInputAt = Date.now()
  }

  function handleOnline() {
    checkForUpdate({ force: true })
  }

  function handleFocus() {
    checkForUpdate()
    tryReload()
  }

  // Capture phase so it still sees the event when a component stops
  // propagation on its own field.
  document.addEventListener('input', handleInput, true)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleOnline)
  window.addEventListener('focus', handleFocus)
  // Blur is NOT wired to tryReload for the same reason the hidden branch
  // above is gone: on a phone, losing focus is the first half of being
  // backgrounded, so reloading here would reopen the very window that strands
  // a token rotation. It is only ever a few seconds until the rep looks at
  // the app again, and `focus` picks it up then.

  syncPolling()
  checkForUpdate({ force: true })

  if (import.meta.env?.DEV) {
    // Under `npm run dev` there is no hashed /assets/ bundle to compare
    // against, so the real detection cannot fire. This lets the
    // deferred-banner half be driven by hand without a production build.
    window.__vipAppUpdate = {
      simulateUpdate: () => { updateReady = true; tryReload() },
      inspect: () => ({ updateReady, deferred, loadedAssets, ...readEnvironment() }),
    }
  }

  return function dispose() {
    disposed = true
    clearInterval(pollTimer)
    clearTimeout(recheckTimer)
    document.removeEventListener('input', handleInput, true)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('focus', handleFocus)
  }
}

// Used by the banner's own button, where the employee has explicitly asked for
// the update and any half-typed form is theirs to lose.
export function applyUpdateNow() {
  try {
    window.sessionStorage?.setItem(RELOAD_MARK_KEY, String(Date.now()))
  } catch { /* ignore */ }
  window.location.reload()
}
