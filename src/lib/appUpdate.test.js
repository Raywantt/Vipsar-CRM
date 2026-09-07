import { describe, expect, it } from 'vitest'
import {
  RELOAD_COOLDOWN_MS,
  TYPING_IDLE_MS,
  assetsFromHtml,
  currentPageAssets,
  decideReload,
  documentHasUnsavedInput,
  isEditableElement,
  isNewBuild,
} from './appUpdate'

// These pin the rule that decides whether a new build may reload the page out
// from under whoever is using it. Getting it wrong in one direction loses a
// rep's half-typed lead; in the other, it reintroduces the whole problem this
// feature exists to solve (an employee stuck on an old build until told to
// clear their cache). vitest runs in the `node` environment here, so the DOM
// helpers are exercised against stubs shaped like real elements.

function input(overrides = {}) {
  return { tagName: 'INPUT', type: 'text', value: '', disabled: false, readOnly: false, ...overrides }
}

function docWith(fields) {
  return { querySelectorAll: () => fields }
}

describe('decideReload', () => {
  it('reloads when nothing is in progress', () => {
    expect(decideReload()).toEqual({ reload: true, reason: 'safe' })
  })

  it('never reloads while a write is on the wire', () => {
    // The one case that can cost committed data rather than typing: a reload
    // cancels the request, and for a POST it is unknowable whether the row
    // already landed server-side.
    expect(decideReload({ pendingWrites: 1 })).toEqual({
      reload: false,
      reason: 'save-in-flight',
    })
  })

  it('a save in flight outranks every other consideration', () => {
    expect(
      decideReload({ pendingWrites: 2, editingFieldFocused: true, hasUnsavedInput: true }).reason
    ).toBe('save-in-flight')
  })

  it('holds off while the cursor is in a field on a focused window', () => {
    expect(decideReload({ editingFieldFocused: true })).toEqual({
      reload: false,
      reason: 'field-focused',
    })
  })

  it('holds off on a part-filled form that was typed into recently', () => {
    expect(
      decideReload({ hasUnsavedInput: true, msSinceLastInput: 30 * 1000 })
    ).toEqual({ reload: false, reason: 'recent-typing' })
  })

  it('reloads through a part-filled form nobody has touched for a while', () => {
    // An abandoned form — a rep who opened New Lead, typed a name, then went
    // to do something else. Waiting on it forever would mean never updating.
    expect(
      decideReload({ hasUnsavedInput: true, msSinceLastInput: TYPING_IDLE_MS + 1 }).reload
    ).toBe(true)
  })

  it('reloads through recent typing that left nothing on screen', () => {
    // A search box, or a form that has since been saved and reset. Recent
    // typing alone is not evidence of work in progress.
    expect(decideReload({ hasUnsavedInput: false, msSinceLastInput: 1000 }).reload).toBe(true)
  })

  it('defers rather than reloading twice in quick succession', () => {
    // The loop guard: a stale build is bad, a page that reloads forever is
    // unusable. Degrade to the banner, never to a spin.
    expect(decideReload({ msSinceLastAutoReload: 1000 })).toEqual({
      reload: false,
      reason: 'cooldown',
    })
  })

  it('allows a genuine second deploy once the cooldown has passed', () => {
    expect(decideReload({ msSinceLastAutoReload: RELOAD_COOLDOWN_MS + 1 }).reload).toBe(true)
  })
})

describe('isEditableElement', () => {
  it('treats a text input and a textarea as editable', () => {
    expect(isEditableElement(input())).toBe(true)
    expect(isEditableElement({ tagName: 'TEXTAREA', value: '' })).toBe(true)
  })

  it('treats contenteditable as editable whatever the tag', () => {
    expect(isEditableElement({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('ignores a search box', () => {
    // Deliberate: a filter left with text in it is extremely common in this
    // app (All Leads, Search, Manage employees). Blocking on one would mean an
    // employee who types a filter once and leaves it never updates again.
    expect(isEditableElement(input({ type: 'search', value: 'jain' }))).toBe(false)
  })

  it('ignores checkboxes, radios and hidden fields', () => {
    for (const type of ['checkbox', 'radio', 'hidden', 'submit', 'button']) {
      expect(isEditableElement(input({ type }))).toBe(false)
    }
  })

  it('ignores disabled and readonly fields', () => {
    expect(isEditableElement(input({ disabled: true }))).toBe(false)
    expect(isEditableElement(input({ readOnly: true }))).toBe(false)
  })

  it('is safe on null', () => {
    expect(isEditableElement(null)).toBe(false)
  })
})

describe('documentHasUnsavedInput', () => {
  it('is false for an empty page', () => {
    expect(documentHasUnsavedInput(docWith([]))).toBe(false)
  })

  it('is false when every field is blank', () => {
    expect(documentHasUnsavedInput(docWith([input(), input()]))).toBe(false)
  })

  it('is false for whitespace only', () => {
    expect(documentHasUnsavedInput(docWith([input({ value: '   ' })]))).toBe(false)
  })

  it('is true when a real field has been filled in', () => {
    expect(documentHasUnsavedInput(docWith([input(), input({ value: 'Bhuvnesh' })]))).toBe(true)
  })

  it('does not count a filled search box as unsaved work', () => {
    expect(documentHasUnsavedInput(docWith([input({ type: 'search', value: 'jain' })]))).toBe(false)
  })

  it('is safe when handed nothing', () => {
    expect(documentHasUnsavedInput(undefined)).toBe(false)
  })
})

// A realistic slice of this app's built index.html.
const HTML_BUILD_A = `<!doctype html><html><head>
  <script type="module" crossorigin src="/assets/index-DNuCaPOh.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-CA2_jOzu.css">
  <link rel="manifest" href="/manifest.webmanifest">
</head><body><div id="root"></div></body></html>`

const HTML_BUILD_B = HTML_BUILD_A.replace('index-DNuCaPOh.js', 'index-BMN271gK.js')

function docWithAssets(urls) {
  return {
    querySelectorAll: () =>
      urls.map((u) => ({ getAttribute: (attr) => (attr === 'src' ? u : null) })),
  }
}

describe('assetsFromHtml', () => {
  it('pulls the hashed build artifacts out of a page of HTML', () => {
    expect(assetsFromHtml(HTML_BUILD_A)).toEqual([
      '/assets/index-CA2_jOzu.css',
      '/assets/index-DNuCaPOh.js',
    ])
  })

  it('ignores non-hashed references like the manifest', () => {
    expect(assetsFromHtml(HTML_BUILD_A)).not.toContain('/manifest.webmanifest')
  })

  it('sorts, so emit order can never look like a new build', () => {
    const swapped = `<link href="/assets/b.css"><script src="/assets/a.js">`
    expect(assetsFromHtml(swapped)).toEqual(['/assets/a.js', '/assets/b.css'])
  })

  it('dedupes a file referenced twice (preload + tag)', () => {
    const twice = `<link href="/assets/x.js"><script src="/assets/x.js">`
    expect(assetsFromHtml(twice)).toEqual(['/assets/x.js'])
  })

  it('is safe on empty or missing input', () => {
    expect(assetsFromHtml('')).toEqual([])
    expect(assetsFromHtml(undefined)).toEqual([])
  })
})

describe('isNewBuild', () => {
  it('is false when the deployed build matches what is loaded', () => {
    expect(isNewBuild(assetsFromHtml(HTML_BUILD_A), assetsFromHtml(HTML_BUILD_A))).toBe(false)
  })

  it('is true when the JS bundle hash changed', () => {
    expect(isNewBuild(assetsFromHtml(HTML_BUILD_A), assetsFromHtml(HTML_BUILD_B))).toBe(true)
  })

  it('catches a CSS-only deploy', () => {
    // Why currentPageAssets reads <link> as well as <script>: a styling-only
    // change leaves the JS hash untouched.
    const cssOnly = HTML_BUILD_A.replace('index-CA2_jOzu.css', 'index-ZZZZZZZZ.css')
    expect(isNewBuild(assetsFromHtml(HTML_BUILD_A), assetsFromHtml(cssOnly))).toBe(true)
  })

  it('never reports a new build when the fetch produced nothing usable', () => {
    // THE important guard. A dropped connection, a captive-portal login page,
    // an error page, a truncated body — none of these may be mistaken for a
    // deploy, or a working page reloads itself for no reason, possibly on a
    // loop. Missing a check merely delays the update until the next one.
    const loaded = assetsFromHtml(HTML_BUILD_A)
    expect(isNewBuild(loaded, [])).toBe(false)
    expect(isNewBuild(loaded, undefined)).toBe(false)
    expect(isNewBuild(loaded, assetsFromHtml('<html>502 Bad Gateway</html>'))).toBe(false)
  })

  it('never reports a new build when the current page could not be read', () => {
    expect(isNewBuild([], assetsFromHtml(HTML_BUILD_B))).toBe(false)
    expect(isNewBuild(undefined, assetsFromHtml(HTML_BUILD_B))).toBe(false)
  })

  it('notices a build that added or dropped a file', () => {
    expect(isNewBuild(['/assets/a.js'], ['/assets/a.js', '/assets/b.js'])).toBe(true)
  })
})

describe('currentPageAssets', () => {
  it('reads what the live document actually loaded', () => {
    const doc = docWithAssets(['/assets/index-DNuCaPOh.js', '/favicon.svg'])
    expect(currentPageAssets(doc)).toEqual(['/assets/index-DNuCaPOh.js'])
  })

  it('round-trips against the HTML it was built from', () => {
    // The two sides of the comparison must agree, or every check is a false
    // positive and the app reload-loops.
    const doc = docWithAssets(['/assets/index-DNuCaPOh.js', '/assets/index-CA2_jOzu.css'])
    expect(isNewBuild(currentPageAssets(doc), assetsFromHtml(HTML_BUILD_A))).toBe(false)
  })

  it('is safe when handed nothing', () => {
    expect(currentPageAssets(undefined)).toEqual([])
  })
})
