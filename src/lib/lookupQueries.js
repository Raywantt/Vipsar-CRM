import { supabase } from './supabaseClient'
import { fetchAllRows } from './fetchAllRows'

// Small, mostly-static reference tables that don't have a home in any other
// *Queries.js file (they aren't about a lead, a party, an employee, or a
// target — just "the list of areas" / "the list of products"). Both used to
// be duplicated, unbounded, inline `supabase.from(...)` calls in two
// different files (LeadDetail.jsx and SiteSearchOrCreate.jsx both fetched
// `areas` themselves) — consolidated here as part of the 2026-09-04 row-cap
// fix, so there's one query, wrapped once, instead of two copies to remember
// to fix. `areas` is genuinely growing (337 rows as of that fix, see
// ROW-COUNTS.md) — not near the 1,000 cap yet, but the exact shape of table
// this app has already been burned by once.
export function fetchAreas() {
  return fetchAllRows(() => supabase.from('areas').select('id, area_name, city', { count: 'exact' }).order('area_name'))
}

// `products` is 8 rows today and effectively static catalog data — nowhere
// near the cap, but wrapped anyway for the same reason every other list query
// in this app now is: it costs nothing extra under the cap, and it means "is
// this query safe" is never again a judgment call made table-by-table.
export function fetchProducts() {
  return fetchAllRows(() => supabase.from('products').select('id, name, category', { count: 'exact' }).order('name'))
}
