// The order every product picker shows VIPSAR's portfolio in: the owner's own
// order (2026-10-06 — Tostem, IN16, GIESTA, Noki, Sky Light, Wrapping Bars,
// StoneLam, VOX, PremiAL, Others), kept in products.sort_order
// (Schema/migration_products_order.sql), so it's data, not a list in code. A
// product with no position yet (one added later by hand) goes after the
// numbered ones, by name. fetchProducts (lookupQueries.js) sorts by this.
// Listed in scripts/dataShape.mjs because it decides what a remembered
// products query returns.
export function compareProducts(a, b) {
  const pa = Number.isFinite(a?.sort_order) ? a.sort_order : Infinity
  const pb = Number.isFinite(b?.sort_order) ? b.sort_order : Infinity
  if (pa !== pb) return pa - pb
  return (a?.name ?? '').localeCompare(b?.name ?? '', 'en', { sensitivity: 'base' })
}
