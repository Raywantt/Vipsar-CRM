// "▲ 12% vs last week". Shared by the popups that set one period against the
// previous one (Activities logged, Orders booked). Lives in its own file so a
// pure data module can use it without importing drilldownBuilders.js, which
// imports those modules in turn.
//
// `previous` null means the comparison hasn't loaded (or couldn't), which
// reads as no comparison at all rather than as a zero.
export function changeVs(current, previous, label) {
  if (previous == null) return null
  if (previous === 0) return current === 0 ? { text: `none in ${label} either`, up: null } : { text: `new — none in ${label}`, up: true }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { text: `level with ${label}`, up: null }
  // Capped for reading: against a near-empty previous period (a month that had
  // one call in it) the true figure is "▲ 52300%", which is arithmetic, not
  // information — "999%+" says the same thing.
  const shown = Math.abs(pct) > 999 ? '999%+' : `${Math.abs(pct)}%`
  return { text: `${pct > 0 ? '▲' : '▼'} ${shown} vs ${label}`, up: pct > 0 }
}
