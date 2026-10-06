import { useMemo } from 'react'
import { useCachedQuery } from '../hooks/useCachedQuery'
import { fetchProducts } from '../lib/lookupQueries'

// THE product field — one picker for a lead's products wherever they are
// edited: Lead Detail's Sales progress and the RFQ Raised form (owner's ruling,
// 2026-10-06: "sync the two, make them one column"). Both read and write
// leads.product_ids. Chips, several can be on, in the owner's order
// (products.sort_order, via fetchProducts). `value` is an array of product ids.
//
// `products` may be passed in by a page that already holds the list (Lead
// Detail); otherwise the shared lookup query is read (same key, so it's one
// request either way).
function ProductPicker({ value, onChange, products: given = null, label = 'Products', required = false, hint = null }) {
  const query = useCachedQuery(['lookup', 'products'], fetchProducts, { enabled: !given })
  const products = useMemo(
    () => given ?? (query.result && !query.result.error ? query.result.data ?? [] : []),
    [given, query.result]
  )
  const picked = new Set((value ?? []).map(Number))

  function toggle(id) {
    const next = picked.has(id) ? (value ?? []).filter((v) => Number(v) !== id) : [...(value ?? []), id]
    // Kept in the owner's order, whatever order they were tapped in.
    const order = products.map((p) => p.id)
    onChange(next.map(Number).sort((a, b) => order.indexOf(a) - order.indexOf(b)))
  }

  return (
    <div className="vip-field">
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {products.length === 0 ? (
        <span className="vip-field-hint">Loading products…</span>
      ) : (
        <div className="vip-chip-wrap" role="group" aria-label={label}>
          {products.map((p) => {
            const on = picked.has(p.id)
            return (
              <button
                key={p.id}
                type="button"
                className="vip-chip-select"
                aria-pressed={on}
                style={on ? { color: 'var(--vip-teal)' } : undefined}
                onClick={() => toggle(p.id)}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      )}
      {hint && <span className="vip-field-hint">{hint}</span>}
    </div>
  )
}

export default ProductPicker
