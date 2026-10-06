import { describe, it, expect } from 'vitest'
import {
  NOT_SPECIFIED,
  NOT_SPLIT,
  leadProductIds,
  productCategoryEntries,
  productNames,
  productShares,
  productsById,
} from './productShares'

const BY_ID = productsById([
  { id: 12, name: 'Tostem', sort_order: 1 },
  { id: 22, name: 'IN16', sort_order: 2 },
  { id: 25, name: 'GIESTA', sort_order: 3 },
])

// The same rule as leads_category_breakdown()'s 'product' rows
// (Schema/migration_lead_products.sql) — keep the two in step.
describe("a lead's products and its value by product", () => {
  it('reads product_ids, falling back to a remembered row that only has product_id', () => {
    expect(leadProductIds({ product_ids: [22, 12] })).toEqual([22, 12])
    expect(leadProductIds({ product_ids: [], product_id: 12 })).toEqual([12])
    expect(leadProductIds({})).toEqual([])
  })

  it('names them in the owner\'s order, blank when there are none', () => {
    expect(productNames([22, 12], BY_ID)).toBe('Tostem + IN16')
    expect(productNames([], BY_ID)).toBeNull()
  })

  it('gives one product the whole value', () => {
    expect(productShares({ product_ids: [12] }, 500000)).toEqual({ shares: [{ productId: 12, value: 500000 }], unsplit: 0 })
  })

  it("splits several by the latest quote, scaled to the lead's value (an order split in the quote's proportions)", () => {
    const lead = { product_ids: [12, 22], quote_lines: [{ product_id: 12, value: 600000 }, { product_id: 22, value: 400000 }] }
    expect(productShares(lead, 1000000).shares.map((s) => s.value)).toEqual([600000, 400000])
    expect(productShares(lead, 900000).shares.map((s) => s.value)).toEqual([540000, 360000])
  })

  it('never guesses: no split leaves the value "not split yet", a product with no line gets 0', () => {
    expect(productShares({ product_ids: [12, 22] }, 1000000)).toEqual({
      shares: [{ productId: 12, value: 0 }, { productId: 22, value: 0 }],
      unsplit: 1000000,
    })
    const partial = productShares({ product_ids: [12, 25], quote_lines: [{ product_id: 12, value: 300000 }, { product_id: 22, value: 700000 }] }, 1000000)
    expect(partial.shares).toEqual([{ productId: 12, value: 300000 }, { productId: 25, value: 0 }])
    expect(partial.unsplit).toBe(700000)
  })

  it('groups a lead under each product for Leads by product', () => {
    const open = { current_stage: 'rfq', quote_value: 1000000, product_ids: [12, 22], quote_lines: [{ product_id: 12, value: 600000 }, { product_id: 22, value: 400000 }] }
    expect(productCategoryEntries(open, BY_ID)).toEqual([
      { category: 'Tostem', value: 600000 },
      { category: 'IN16', value: 400000 },
    ])
    expect(productCategoryEntries({ current_stage: 'rfq', quote_value: 200000 }, BY_ID)).toEqual([{ category: NOT_SPECIFIED, value: 200000 }])
    expect(productCategoryEntries({ current_stage: 'rfq', quote_value: 200000, product_ids: [12, 22] }, BY_ID)).toEqual([
      { category: 'Tostem', value: 0 },
      { category: 'IN16', value: 0 },
      { category: NOT_SPLIT, value: 200000 },
    ])
  })
})
