// A lead's products and how its value divides between them (owner's rulings,
// 2026-10-06 — Schema/migration_lead_products.sql).
//
// A lead has a LIST of products (leads.product_ids), edited from Lead Detail
// and the RFQ Raised form with the same picker. The Estimation Executive
// quotes each product separately; the latest desk quote's split is on the
// lead as leads.quote_lines ([{ product_id, value }]). Every by-product figure
// — Leads by product, Orders booked, Lead Detail's Products in scope, the
// export — reads THIS file, and leads_category_breakdown() in SQL is the same
// rule, line for line:
//   * no product          → nothing to split ("Not specified" in reports)
//   * one product         → the whole value is that product's
//   * several products    → each gets its line of the latest quote, scaled to
//                           the lead's value (so a won lead's ORDER value is
//                           split in the quote's proportions — owner's ruling);
//                           a product with no line gets 0, and whatever the
//                           split can't place is `unsplit` ("Not split yet"),
//                           never guessed.
import { compareProducts } from './productOrder'
import { dealValueFor } from './pipelineValue'

// The lead's product ids. product_ids is the column; a row from before it
// existed (a remembered copy) still has product_id.
export function leadProductIds(lead) {
  if (Array.isArray(lead?.product_ids) && lead.product_ids.length) return lead.product_ids
  return lead?.product_id != null ? [lead.product_id] : []
}

function lineTotal(lines) {
  return (lines ?? []).reduce((s, l) => s + (Number(l?.value) || 0), 0)
}

// { shares: [{ productId, value }], unsplit } for a lead worth `dealValue`
// (pipelineValue.js's dealValueFor — the caller decides open vs won).
export function productShares(lead, dealValue) {
  const ids = leadProductIds(lead)
  const value = Number(dealValue) || 0
  if (ids.length === 0) return { shares: [], unsplit: 0 }
  if (ids.length === 1) return { shares: [{ productId: ids[0], value }], unsplit: 0 }
  const lines = Array.isArray(lead?.quote_lines) ? lead.quote_lines : []
  const total = lineTotal(lines)
  const shares = ids.map((id) => {
    const line = lines.find((l) => Number(l?.product_id) === Number(id))
    return { productId: id, value: total > 0 ? (value * (Number(line?.value) || 0)) / total : 0 }
  })
  const placed = shares.reduce((s, x) => s + x.value, 0)
  const rest = value - placed
  return { shares, unsplit: rest > 0.5 ? rest : 0 }
}

// Map(id → product) from the products lookup.
export function productsById(products) {
  return new Map((products ?? []).map((p) => [p.id, p]))
}

// The lead's products, in the owner's order.
export function productsOf(ids, byId) {
  return (ids ?? [])
    .map((id) => byId?.get(Number(id)) ?? byId?.get(id))
    .filter(Boolean)
    .sort(compareProducts)
}

// "Tostem + IN16", or null when there are none (blank means blank).
export function productNames(ids, byId, sep = ' + ') {
  const list = productsOf(ids, byId)
  return list.length ? list.map((p) => p.name).join(sep) : null
}

// What Leads by product groups a lead under: one entry per product with its
// share of dealValueFor(lead), 'Not specified' for a lead with none, and
// 'Not split yet' for whatever the split can't place — exactly
// leads_category_breakdown()'s 'product' rows. A lead appears under EACH of
// its products, so a report's per-row counts can add up to more leads than
// there are; its Total counts each lead once.
export const NOT_SPECIFIED = 'Not specified'
export const NOT_SPLIT = 'Not split yet'

export function productCategoryEntries(lead, byId) {
  const value = dealValueFor(lead)
  const ids = leadProductIds(lead)
  if (!ids.length) return [{ category: NOT_SPECIFIED, value }]
  const { shares, unsplit } = productShares(lead, value)
  const entries = shares.map((x) => ({ category: byId?.get(Number(x.productId))?.name ?? `Product #${x.productId}`, value: x.value }))
  if (unsplit > 0) entries.push({ category: NOT_SPLIT, value: unsplit })
  return entries
}

