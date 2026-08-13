/* eslint-disable no-console */
// ===========================================================================
// PHASE 3 — layout audit
//
// Finds the specific defect CLAUDE.md's Design system section calls out as
// recurring and non-negotiable: a CSS grid whose declared track count exceeds
// the number of children it is actually given, so the row ends in visibly
// empty space. The doc says to check this "via computed getBoundingClientRect()
// during build, not just eyeballed" — this is that check, automated, so it
// stays true for screens nobody thought to re-examine.
//
// It found `.vip-dd-kpi-grid` on the Today screen carrying 4 tiles in a 6-track
// grid (396px of an 1180px row blank) on its first run.
//
// Deliberately conservative — it reports only unambiguous single-row gaps:
//   - the grid has children, and they all sit on ONE row, and
//   - the declared track count is greater than the number of children, and
//   - the resulting empty space is wider than a token amount.
// Multi-row / auto-fit grids are reported separately as informational, never
// as failures: a wrapped list with a ragged last row is normal and expected.
// ===========================================================================

export async function auditGrids(page) {
  return page.evaluate(() => {
    const out = { gaps: [], wrapped: [] }

    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue

      const kids = [...el.children].filter((k) => {
        const kcs = getComputedStyle(k)
        return kcs.display !== 'none' && kcs.position !== 'absolute'
      })
      if (!kids.length) continue

      // `grid-template-columns` computes to a resolved px list, so its length
      // is the real track count regardless of repeat()/auto-fit.
      const tracks = cs.gridTemplateColumns.split(/\s+/).filter(Boolean)
      if (tracks.length < 2) continue

      const box = el.getBoundingClientRect()
      if (box.width < 200 || box.height === 0) continue

      const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))
      const singleRow = tops.size === 1

      // Total horizontal space the children actually cover.
      const covered = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0)
      const gapPx = parseFloat(cs.columnGap) || 0
      const expected = covered + gapPx * Math.max(0, kids.length - 1)
      const slack = box.width - expected

      const id =
        (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') ||
        el.tagName.toLowerCase()

      const record = {
        selector: id.slice(0, 160),
        tracks: tracks.length,
        children: kids.length,
        boxWidth: Math.round(box.width),
        childrenWidth: Math.round(covered),
        emptyPx: Math.round(slack),
        firstChildText: (kids[0].innerText || '').split('\n')[0].slice(0, 40),
      }

      if (singleRow && kids.length < tracks.length && slack > 24) {
        out.gaps.push(record)
      } else if (!singleRow && kids.length % tracks.length !== 0) {
        out.wrapped.push(record)
      }
    }
    return out
  })
}

/** Format for the console; returns the number of hard gaps found. */
export function reportGrids(label, result) {
  for (const g of result.gaps) {
    console.log(
      `        GRID GAP  ${label}  ${g.selector}\n` +
        `                  ${g.children} children in ${g.tracks} tracks — ` +
        `${g.emptyPx}px of ${g.boxWidth}px empty (first tile: "${g.firstChildText}")`
    )
  }
  return result.gaps.length
}
