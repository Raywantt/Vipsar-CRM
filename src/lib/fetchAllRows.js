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
// A short page must NEVER be read as "the rows ran out" on its own.
// `pageSize` is what we ASK for, and the server may hand back less because
// of its own max-rows cap rather than because the rows ran out; treating a
// short page as "exhausted" would reintroduce the exact silent truncation
// this file exists to remove, just at a different threshold. This is why
// the two branches below use two different stopping signals — an exact
// `total` (authoritative, independent of page size) when one is available,
// and "the page came back completely empty" (the only cap-independent
// signal there is) when it isn't. Page LENGTH is never used to decide
// whether more pages remain, in either branch.
//
// PARALLEL PAGING (added 2026-09-04, alongside the rest of this session's
// perf pass). The original version walked pages one at a time even when it
// already knew the exact total after page 1 — harmless while every table
// fit in a single page, but by the time `leads`/`parties`/`sites`/
// `stage_history` had all crossed 1,000 rows, that meant every dashboard-
// style screen was paying 2 full sequential round trips per table, back to
// back, on every load. When `total` is known after the first page, every
// remaining page's offset is already computable, so they're all fetched
// with one `Promise.all` instead of one at a time — a table sitting at 2
// pages now costs the same WALL TIME as 1 (not 2 sequential round trips),
// however many pages it turns out to have. A table that still fits in one
// page costs exactly the one request it always did — this only changes
// behaviour once a second page is actually needed. The no-count fallback is
// untouched: with no total to plan against, there's no way to know how many
// pages exist before walking them, so it stays serial exactly as before.
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
// `speculativePages` (default 0) fetches that many EXTRA pages at the same
// time as page 0, before the row count is known.
//
// WHY IT EXISTS — measured 2026-09-04, after the query cache landed. Paging
// is inherently sequential: page 2 cannot start until page 1 comes back with
// the count that proves page 2 is needed. On a table just over the 1,000-row
// cap that costs a whole extra round trip of pure waiting. On the real
// Dashboard, `leads` (1,209 rows) was exactly this: page 1 ran 1,199→2,914ms,
// page 2 then ran 2,917→3,611ms, and that second page WAS the page's total
// load time — every other query had finished by 2,274ms.
//
// Passing 1 fires page 2 alongside page 1 and removes that wait entirely.
// The cost when the guess is wrong is one extra request that returns an
// empty array (an offset past the end is cheap for Postgres and harmless
// here) — which is why this is OPT-IN per call site rather than the default:
// most queries in this app return well under one page, and making them all
// pay a wasted request to speed up the four that don't would be a bad trade.
// Set it only where the table is genuinely known to exceed `pageSize` (see
// ROW-COUNTS.md), and raise it if one of those tables passes 2,000 rows.
// A .range() whose offset is past the end of the result set is NOT an empty
// page — PostgREST answers it with an ERROR: 416 Range Not Satisfiable,
// PGRST103, "An offset of 1000 was requested, but there are only 3 rows."
// It does that whenever an exact count was requested, which every caller of
// this helper does.
//
// THIS SHIPPED AS A LIVE BUG (2026-09-07). speculativePages fires page 2
// before the count proves it is needed, and the tables it is set on only
// exceed 1,000 rows FOR THE OWNER. Under RLS a sales executive sees a few
// dozen leads, a coordinator their team's — so for every non-owner role the
// speculative page asked for rows 1000-1999 of a 30-row result, PostgREST
// refused the range, and the error was propagated as a failure of the WHOLE
// query. fetchLeadsForBreakdown() returned null, and Dashboard, Today, My
// Team and the Sales Exec Profile rendered every figure as zero. The
// verification pass that cleared this ran as the owner, the one role whose
// row counts hide it.
//
// A refused range is one of the two shapes that miss takes (the other is a
// statement timeout — see the note at the discard rule below). It is not a
// failure here. It is the server answering the
// exact question a speculative page asks — "is there anything at this
// offset?" — with "no". Treat it as an empty page, never as an error.
// Anything else (a real network failure, a permission error) still fails
// loudly, and page 0 is never covered by this: an offset of 0 is always a
// satisfiable range, so a genuine failure on the first page still surfaces.
function isRangeNotSatisfiable(error) {
  if (!error) return false
  if (error.code === 'PGRST103') return true
  return /range not satisfiable/i.test(error.message ?? '')
}

export async function fetchAllRows(
  buildQuery,
  { orderBy = 'id', ascending = true, pageSize = FETCH_ALL_PAGE_SIZE, speculativePages = 0 } = {}
) {
  const fetchPage = (offset) => buildQuery().order(orderBy, { ascending }).range(offset, offset + pageSize - 1)

  // Page 0, plus any speculative pages, all in flight together.
  const opening = [fetchPage(0)]
  for (let page = 1; page <= speculativePages; page++) opening.push(fetchPage(page * pageSize))
  const openingResults = await Promise.all(opening)

  const first = openingResults[0]
  if (first.error) return { data: null, error: first.error }

  const total = first.count ?? null
  const rows = [...(first.data ?? [])]

  // A speculative page past the end of the result set comes back either
  // empty or as a refused range (see isRangeNotSatisfiable above) — both
  // mean "there was nothing there", which is a correct answer to a guess,
  // not a failure of the query.
  let lastSpeculativeWasEmpty = false
  for (let i = 1; i < openingResults.length; i++) {
    const { data, error } = openingResults[i]

    // THE PRIMARY RULE: page 0 has now told us the real total, so we know
    // whether this speculative page was ever needed. If it lies past the
    // end it cannot contribute a single row, so whatever came back is
    // discarded — an empty array, a refused range, or a failure.
    //
    // Deliberately not an error-code test. Measured live on a real sales
    // executive's session (2026-09-07): the out-of-range page on `leads`
    // came back 416/PGRST103, but the one on `stage_history` came back
    // 57014 "canceling statement due to statement timeout" — PostgREST has
    // to compute the exact count before it can decide the range is
    // unsatisfiable, and under that table's own-leads RLS the count is slow
    // enough to hit the statement timeout first. So the SAME missed guess
    // surfaces as two different errors depending on the table, and matching
    // on either code would have left the sales funnel blank for exactly the
    // roles this whole fix exists for. Asking "did we need this page?"
    // instead of "what kind of error was it?" is right for every table and
    // every future failure mode.
    if (total != null && i * pageSize >= total) {
      lastSpeculativeWasEmpty = true
      continue
    }

    if (error) {
      // No count to reason with (the caller omitted it), so fall back to
      // reading the error: a refused range is still the server saying
      // "nothing at that offset". Anything else is a real failure.
      if (!isRangeNotSatisfiable(error)) return { data: null, error }
      lastSpeculativeWasEmpty = true
      continue
    }
    const batch = data ?? []
    rows.push(...batch)
    lastSpeculativeWasEmpty = batch.length === 0
  }

  if (total != null) {
    // Every remaining offset is known up front — fetch them all at once
    // rather than one at a time. Pages already covered above are skipped;
    // the common case (the whole result fits in what we already have) costs
    // nothing extra.
    const pageCount = Math.ceil(total / pageSize)
    const remaining = []
    for (let page = 1 + speculativePages; page < pageCount; page++) remaining.push(fetchPage(page * pageSize))

    if (remaining.length) {
      const results = await Promise.all(remaining)
      for (const { data, error } of results) {
        if (error) {
          // These offsets were planned against page 0's count, so a refused
          // range here means rows were deleted while we were paging. There
          // is genuinely nothing at that offset any more; skipping it hides
          // no rows, whereas failing the query would blank the whole screen
          // over a concurrent delete.
          if (!isRangeNotSatisfiable(error)) return { data: null, error }
          continue
        }
        rows.push(...(data ?? []))
      }
    }
    return { data: rows, error: null, count: total }
  }

  // No count available — walk serially, bounded so a server that ignores
  // .range() can never spin forever. An empty page is the only
  // cap-independent proof there is nothing left, so a speculative page that
  // already came back empty means we are done and must not re-walk it.
  if (!lastSpeculativeWasEmpty) {
    for (let page = 1; page < 500; page++) {
      const { data, error } = await fetchPage(rows.length)
      if (error) {
        if (!isRangeNotSatisfiable(error)) return { data: null, error }
        break
      }
      const batch = data ?? []
      rows.push(...batch)
      if (batch.length === 0) break
    }
  }

  return { data: rows, error: null, count: null }
}
