export function formatCurrency(value) {
  if (value == null) return '—'
  return `₹${Number(value).toLocaleString('en-IN')}`
}
