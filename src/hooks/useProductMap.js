import { useMemo } from 'react'
import { useCachedQuery } from './useCachedQuery'
import { fetchProducts } from '../lib/lookupQueries'
import { productsById } from '../lib/productShares'

// Map(id → product) from the shared products lookup — one remembered request
// for every screen that names a product (the RFQ rows, the RFQ card, the quote
// form, the popups). Empty until it answers; a name that can't be resolved
// simply isn't shown.
export function useProductMap() {
  const query = useCachedQuery(['lookup', 'products'], fetchProducts)
  return useMemo(
    () => productsById(query.result && !query.result.error ? query.result.data : []),
    [query.result]
  )
}
