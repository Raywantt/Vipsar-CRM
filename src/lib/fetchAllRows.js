// PostgREST caps EVERY response at the project's `max-rows` setting (1,000
// on this project), whether or not the query asked for a limit. A query with
// no .limit()/.range() therefore does NOT mean "all rows" — it means "the
// first 1,000 rows, silently". Nothing in the response says it was cut: no
// error, no flag, just a shorter array.
//
// That shipped as a real, reported bug (2026-09-04). `leads` had grown past
// the cap (1,204 rows) after the five legacy imports, so every screen built
// on fetchLeadsForBreakdown was reducing 1,000 of 1,204 leads and reporting
// the result as the whole company: ₹3.16 Cr of open pipeline missing, 10
// leads missing from Negotiation, 24 from Won.
//
// The way it surfaced is what makes it dangerous. Those queries had no
// ORDER BY either, so Postgres returned heap order — and an UPDATE writes a
// new tuple version at the END of the heap. So EDITING a lead moved it to
// the back of the physical order and pushed it over the cap: the owner
// added a quote value to a lead, and the act of curating it is what removed
// it from every dashboard figure. The lead was fine; only the read was
// wrong.
//
// This helper is the fix: page until the rows run out, and impose a
// deterministic order so paging is stable. Both halves are required —
// .range() paging with no ORDER BY is itself unreliable, since Postgres
// gives no guarantee that two OFFSET queries walk the same order, so pages
// can silently repeat or skip rows.
export const FETCH_ALL_PAGE_SIZE = 1000

// `buildQuery` must return a FRESH PostgREST builder on every call — a
// builder is single-use, so the same one cannot be re-ranged per page.
//
// Pass `{ count: 'exact' }` in the caller's .select() and paging stops as
// soon as the known total is reached, costing exactly ceil(total / cap)
// requests. Without a count it keeps going until a page comes back EMPTY,
// which costs one extra round trip — so forgetting the count is slow, never
// wrong.
//
// A short page deliberately does NOT end the loop on its own. `pageSize` is
// what we ASK for, and the server may hand back less because of its own
// max-rows cap rather than because the rows ran out; treating that as
// "exhausted" would reintroduce the exact silent truncation this file
// exists to remove, just at a different threshold.
//
// `orderBy` defaults to 'id', the SERIAL primary key every table in this
// schema has. It is applied LAST, so a caller's own .order() stays the
// primary sort and this only breaks ties — which is exactly what makes
// paging stable without changing the order a caller already asked for.
//
// `ascending` must MATCH the direction of the caller's own sort whenever a
// consumer reduces the result with "first row per key wins"
// (mostRecentLeadByParty, computeOrderValueActuals). Those read a
// most-recent-first list, so an ascending tiebreaker would hand them the
// OLDEST of a set of rows sharing a timestamp — the exact opposite of what
// they ask for. Ties are common here: the legacy imports wrote whole
// sheets inside one transaction, so hundreds of rows share a timestamp.
export async function fetchAllRows(buildQuery, { orderBy = 'id', ascending = true, pageSize = FETCH_ALL_PAGE_SIZE } = {}) {
  const rows = []
  let total = null

  // Bounded so a server that ignores .range() can never spin forever.
  for (let page = 0; page < 500; page++) {
    const { data, error, count } = await buildQuery()
      .order(orderBy, { ascending })
      .range(rows.length, rows.length + pageSize - 1)

    if (error) return { data: null, error }
    if (count != null) total = count

    const batch = data ?? []
    rows.push(...batch)

    // An empty page is the only cap-independent proof there is nothing left.
    // A known total lets us stop one request earlier.
    if (batch.length === 0) break
    if (total != null && rows.length >= total) break
  }

  return { data: rows, error: null, count: total }
}
