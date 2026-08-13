/* eslint-disable no-console */
// ===========================================================================
// PHASE 4 — visual / responsive detectors
//
// Each one targets a defect class this codebase has ACTUALLY shipped, per
// CLAUDE.md's own record — not a generic lint. That is why they are worth
// automating: every one of these has been found by hand at least once, and
// hand-checking does not survive the next screen nobody thought to re-examine.
//
//   overflow  — the page body must never scroll horizontally. This is a
//               mobile-first field app; a sideways scroll on a phone is a bug.
//   cascadeTrap — `.vip-only-mobile` / `.vip-only-desktop` are single-class
//               rules, so ANY unguarded `display` declared on the same element
//               in a later section wins at equal specificity and leaks the
//               hidden half through. CLAUDE.md records this biting twice
//               (`.vip-leads-layout`, `.vip-daycards`). This catches the third.
//   overlap   — text boxes physically overlapping. This is what the
//               Quotes & orders grid did at 390px: fixed columns wider than the
//               track, so Scope computed to 0 and printed on top of Value.
//   clipped   — text cut off by a fixed-size container.
// ===========================================================================

export async function auditVisual(page, { isMobile }) {
  return page.evaluate((mobile) => {
    const out = { overflow: null, cascade: [], overlap: [], clipped: [] }

    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth + 1) {
      // Find what is actually sticking out, rather than just reporting that
      // something is — "the page scrolls sideways" is not actionable on its own.
      const culprits = []
      for (const el of document.querySelectorAll('*')) {
        const b = el.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) continue
        if (b.right > de.clientWidth + 1) {
          culprits.push({
            selector: (typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).join('.')
              : el.tagName.toLowerCase()
            ).slice(0, 120),
            right: Math.round(b.right),
            width: Math.round(b.width),
            text: (el.innerText || '').split('\n')[0].slice(0, 40),
          })
        }
      }
      // Keep the widest few; a single overflowing child reports its ancestors too.
      culprits.sort((a, b) => b.right - a.right)
      out.overflow = {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        overflowBy: de.scrollWidth - de.clientWidth,
        culprits: culprits.slice(0, 5),
      }
    }

    // The cascade trap: an element carrying a visibility utility that is
    // rendering anyway at the breakpoint that utility is meant to hide it at.
    const wrongClass = mobile ? 'vip-only-desktop' : 'vip-only-mobile'
    for (const el of document.querySelectorAll(`.${wrongClass}`)) {
      const cs = getComputedStyle(el)
      const b = el.getBoundingClientRect()
      if (cs.display !== 'none' && b.width > 0 && b.height > 0) {
        out.cascade.push({
          selector: ('.' + String(el.className).trim().split(/\s+/).join('.')).slice(0, 140),
          display: cs.display,
          box: `${Math.round(b.width)}x${Math.round(b.height)}`,
          text: (el.innerText || '').split('\n')[0].slice(0, 40),
        })
      }
    }

    // Overlapping text among leaf elements that actually carry text.
    //
    // MUST be positioning-aware. This app's chrome is `position: fixed` — the
    // bottom nav / mobile tab bar, the header, and Lead Detail's sticky action
    // bar all float ABOVE scrolling content by design. Comparing their boxes
    // against page content reports dozens of overlaps that are the intended
    // layout, which is exactly what this detector did on its first run (39
    // hits, nearly all of them chrome-over-content). Only elements sharing a
    // positioning context can meaningfully overlap.
    const fixedRoot = (el) => {
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const p = getComputedStyle(n).position
        if (p === 'fixed' || p === 'sticky') return n
      }
      return null
    }

    // An element inside an `overflow: hidden` ancestor is visually CLIPPED to
    // that ancestor, but its own rect ignores the clip and can extend well past
    // it. Comparing raw rects therefore reports overlaps that nobody can see.
    const clippedBy = (el) => {
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.overflow === 'hidden' || cs.overflowX === 'hidden') return n
      }
      return null
    }

    const leaves = [...document.querySelectorAll('span, td, div, p, a, strong')]
      .filter((el) => {
        if (el.children.length) return false
        const t = (el.textContent || '').trim()
        if (!t) return false
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute') return false
        // A wrapped INLINE element's getBoundingClientRect() is the UNION of
        // its line boxes, so a two-line name reports a box spanning the full
        // container width and appears to overlap every sibling on its first
        // line. getClientRects() gives the per-line boxes; anything with more
        // than one is wrapped and must be compared line by line — or, here,
        // skipped, since a wrapped inline is laid out by the browser and is not
        // the fixed-width collision this detector is looking for.
        if (el.getClientRects().length > 1) return false
        const b = el.getBoundingClientRect()
        return b.width > 4 && b.height > 4
      })
      .map((el) => ({ el, box: el.getBoundingClientRect(), root: fixedRoot(el), clip: clippedBy(el) }))

    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        // Different positioning contexts: one is floating chrome, the other is
        // page content underneath it. Not an overlap defect.
        if (leaves[i].root !== leaves[j].root) continue
        const a = leaves[i].box
        const b = leaves[j].box
        if (Math.abs(a.top - b.top) > 6) continue // only same-line pairs
        // Intersect each box with its clipping ancestor before comparing — what
        // matters is the region actually painted, not the element's nominal box.
        const visible = (item, box) => {
          if (!item.clip) return box
          const c = item.clip.getBoundingClientRect()
          return { left: Math.max(box.left, c.left), right: Math.min(box.right, c.right), top: box.top }
        }
        const va = visible(leaves[i], a)
        const vb = visible(leaves[j], b)
        if (va.right <= va.left || vb.right <= vb.left) continue // fully clipped
        const ox = Math.min(va.right, vb.right) - Math.max(va.left, vb.left)
        if (ox > 4) {
          out.overlap.push({
            a: (leaves[i].el.textContent || '').trim().slice(0, 28),
            b: (leaves[j].el.textContent || '').trim().slice(0, 28),
            overlapPx: Math.round(ox),
          })
        }
      }
    }

    // Text clipped by its container (not a deliberate ellipsis).
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length) continue
      const t = (el.textContent || '').trim()
      if (!t) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      if (cs.textOverflow === 'ellipsis' || cs.overflow === 'auto' || cs.overflow === 'scroll') continue
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        out.clipped.push({
          text: t.slice(0, 34),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })
      }
    }

    return out
  }, isMobile)
}

export function reportVisual(label, v) {
  let n = 0
  if (v.overflow) {
    n++
    console.log(
      `        OVERFLOW  ${label}  page scrolls ${v.overflow.overflowBy}px sideways ` +
        `(${v.overflow.scrollWidth} > ${v.overflow.clientWidth})`
    )
    for (const c of v.overflow.culprits) {
      console.log(`                  right=${c.right} w=${c.width} ${c.selector}  "${c.text}"`)
    }
  }
  for (const c of v.cascade) {
    n++
    console.log(`        CASCADE   ${label}  ${c.selector} is display:${c.display} (${c.box}) "${c.text}"`)
  }
  // Overlap is noisy by nature; report a capped sample.
  for (const o of v.overlap.slice(0, 4)) {
    n++
    console.log(`        OVERLAP   ${label}  "${o.a}" over "${o.b}" by ${o.overlapPx}px`)
  }
  for (const c of v.clipped.slice(0, 4)) {
    n++
    console.log(`        CLIPPED   ${label}  "${c.text}" (${c.scrollWidth} > ${c.clientWidth})`)
  }
  return n
}
