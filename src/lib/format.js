export function formatCurrency(value, options) {
  if (value == null) return '—'
  return `₹${Number(value).toLocaleString('en-IN', options)}`
}

// Compact form — for bars and board/list cards only (per the design
// handoff's non-negotiables), never for a value that stands alone as the
// single figure of record (facts grids, forms still use formatCurrency).
// A dealership talks in lakhs and crores, not just lakhs — a flat /100000
// made a ₹10,000 lead read as "₹0.1L" and a ₹1.4Cr pipeline read as
// "₹142.2L", both the wrong unit for their own scale. Scale the unit to the
// value instead: plain rupees below ₹1L, lakhs from ₹1L up to ₹1Cr, crores
// from ₹1Cr up.
export function formatCurrencyCompact(value) {
  if (value == null) return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs < 100000) return `₹${n.toLocaleString('en-IN')}`
  if (abs < 10000000) return `₹${(n / 100000).toFixed(1)}L`
  return `₹${(n / 10000000).toFixed(2)}Cr`
}
