// The order every product picker shows VIPSAR's portfolio in (owner's pick,
// 2026-10-06): alphabetical, with Others last. fetchProducts
// (lookupQueries.js) sorts by it — PostgREST can't order by an expression, so
// the "Others last" half is done here. Listed in scripts/dataShape.mjs because
// it decides what a remembered products query returns.
export function compareProducts(a, b) {
  const aOther = /^others?$/i.test(a?.name?.trim() ?? '')
  const bOther = /^others?$/i.test(b?.name?.trim() ?? '')
  if (aOther !== bOther) return aOther ? 1 : -1
  return (a?.name ?? '').localeCompare(b?.name ?? '', 'en', { sensitivity: 'base' })
}
