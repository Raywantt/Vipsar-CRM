// Shared day-arithmetic for the Needs Attention pipeline. Accepts anything
// `new Date()` can parse — an ISO date string, a naive timestamp, or a raw
// ms-since-epoch number (attention.js's queueAge/notBefore pass the latter)
// — and returns whole days elapsed since then. Null or unparseable input
// returns null: an unknown date means "don't judge this lead", not zero days.
export function daysSince(dateLike) {
  if (!dateLike) return null
  const t = new Date(dateLike).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
