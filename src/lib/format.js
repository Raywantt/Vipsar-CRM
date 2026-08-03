export function formatCurrency(value) {
  if (value == null) return '—'
  return `₹${Number(value).toLocaleString('en-IN')}`
}

// Compact ₹12.4L form — for bars and board/list cards only (per the design
// handoff's non-negotiables), never for a value that stands alone as the
// single figure of record (facts grids, forms still use formatCurrency).
export function formatCurrencyCompact(value) {
  if (!value) return '—'
  return `₹${(Number(value) / 100000).toFixed(1)}L`
}
