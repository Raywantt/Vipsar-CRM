# Performance — what's been done, and the rules that keep it fast as we grow

Written 2026-09-04, after a measured investigation into "everything in the
CRM is slow". Read this before adding a screen, a dashboard card, or any
query. Every number below was measured against the live database, not
estimated.

---

## 1. What was actually wrong (and what wasn't)

The instinct was that queries were slow. **They weren't.** Timed
individually against the real database:

| Query | Alone | During a real Dashboard load |
|---|---|---|
| `leads` + 4 joins (1,209 rows) | 868 ms | **5,143 ms** |
| `stage_history` + embed (1,596 rows) | 467 ms | **4,477 ms** |
| `activities` (last-activity-per-lead) | ~400 ms | **3,024 ms** |
| network round-trip floor | ~300 ms | — |

Same queries, same data, 6–10× slower during a page load. **The cause was
concurrency, not query cost**: Dashboard fired 32 requests simultaneously
and they starved each other — browser connections, Supabase's connection
pool, and Postgres CPU all contended at once.

**This is the single most important lesson in this file: at this scale the
bottleneck is the NUMBER and WEIGHT of concurrent requests, not the speed of
any one of them.** Optimising a single query in isolation will keep looking
like it "should" be fast while the page stays slow.

## 2. What was fixed, in order of impact

1. **Session read cache with in-flight de-duplication**
   (`src/lib/queryCache.js`). Identical requests issued at the same moment
   collapse into one; results are reused across screens for 90s. Cold
   Dashboard went **32 requests → 19**, **6.4 s → 3.6 s**; revisiting a
   screen went to **~250 ms**.
2. **Server-side aggregation for the category cards**
   (`Schema/migration_leads_category_breakdown_rpc.sql`). Four cards stopped
   downloading 1,209 leads to count them in the browser.
3. **Trigram indexes for search** (`migration_search_trgm_indexes.sql`).
   Every `ILIKE '%term%'` was a full table scan; plain B-tree indexes cannot
   help a leading wildcard.
4. **Date-range indexes** (`migration_date_range_indexes.sql`). The owner's
   RLS gives no usable employee predicate, so date-only dashboard queries
   were sequential scans.
5. **Parallel page fetching** in `fetchAllRows`. Helps a single multi-page
   query in isolation; note it *adds* to peak concurrency, so it was not the
   win it looked like on a page firing ten queries at once.
6. **Speculative second page** (`fetchAllRows`'s `speculativePages` option).
   Paging is inherently sequential — page 2 can't start until page 1 returns
   the count proving it's needed. On `leads` (1,209 rows) that second round
   trip *was* Dashboard's entire critical path: page 1 ran 1,199→2,914ms,
   page 2 then ran 2,917→3,611ms while everything else had finished by
   2,274ms. Opt-in per call site (`leads`, `stage_history`, `parties` — the
   tables ROW-COUNTS.md shows just over the cap), because the cost of
   guessing wrong is one wasted empty request and most queries here return
   well under one page.

   **It delivered less than predicted, and the reason matters.** Measured
   over three cold loads: Dashboard data completes at 3,320 / 3,479 /
   3,438 ms, against 3,611 ms before — roughly **150–300 ms saved, not the
   ~700 ms the sequential gap suggested.** The pages do now overlap exactly
   as intended (both start within 1 ms of each other, confirmed), but page 1
   itself slowed from 1,715 ms to ~2,150–2,285 ms, because the two pages now
   compete with each other for the same connection pool and CPU. **The
   saving was partly eaten by the very contention that caused the original
   problem.** Keep the change — it is a real win with no correctness cost —
   but read it as confirmation of the central lesson in section 1: this app
   is contention-bound, and adding parallelism has diminishing returns. The
   only fix that keeps paying is fewer and lighter queries.

## 3. The rules — follow these and this doesn't recur

### Rule 1: Never download rows just to reduce them in the browser
If a card shows a count, a sum, a rate or a group-by, **Postgres must
compute it**. Shipping 1,200 rows to count them is the root cause of
everything in section 1, and it gets linearly worse forever.

- Aggregate → write an RPC returning the grouped result (see
  `leads_category_breakdown` for the pattern, including the
  `SECURITY INVOKER` requirement).
- List → paginate server-side (`fetchLeadsList` is the good precedent:
  filters, sort and `count` all applied before `.range()`).

### Rule 2: `fetchAllRows()` is a transitional escape hatch, not the goal
It exists because PostgREST silently caps responses at 1,000 rows, and it
correctly fixes that. But it is **O(table size)**: it pages the entire
table. At 5,000 leads that is 5 round trips and several MB; at 20,000 it is
unusable. Every new use should be questioned — prefer an aggregate or a
paginated query. Treat an existing use as debt to retire, not a pattern to
copy.

### Rule 3: Budget the concurrent requests per screen
A screen firing 15–20 queries will be slow no matter how good each one is.
Consolidate related figures into one RPC. Defer anything below the fold or
behind a click (drill-down panels do not need their data before the user
opens them).

### Rule 4: Every filtered/sorted column needs an index — and RLS counts
RLS predicates are part of the query. The owner role's "true for every row"
policy means composite indexes keyed on `employee_id` don't help owner-side
queries at all (this is exactly why `migration_date_range_indexes.sql`
exists). When adding a query, ask what Postgres will actually scan **for
each role**.

### Rule 5: Cache invalidation belongs at the transport, not the call site
`supabaseFetch.js` drops the read cache after any successful non-GET. This
is deliberate: `leads` alone is written from four LeadDetail sections,
`LeadStageSection`, `LeadQuickActions` and three paths in `ActivityLog`.
"Remember to invalidate" fails the first time someone adds a write path —
the same reasoning that made `lead_change_log` trigger-written rather than
app-written. Keep it centralised.

### Rule 6: Measure before optimising, and measure in the browser
The Resource Timing API against a real logged-in session is how every number
in this file was obtained:

```js
const { supabase } = await import('/src/lib/supabaseClient.js')
performance.getEntriesByType('resource')
  .filter(e => e.name.includes('supabase.co'))
  .map(e => ({ q: e.name.split('/rest/v1/')[1]?.slice(0,60), ms: Math.round(e.duration) }))
  .sort((a,b) => b.ms - a.ms)
```
Note dev mode roughly doubles request counts (React StrictMode double-invokes
effects), so judge production numbers from a production build.

## 4. Guardrails already in place — keep them working

- **`queryPaging.test.js`** fails the build if a new query can return more
  than one row without paging. Extend it rather than adding exceptions.
- **Dev-time truncation warning** in `supabaseFetch.js` fires the moment an
  unpaged query is silently cut off by the row cap.
- **`queryCache.test.js`** pins the properties that matter: de-duplication,
  never caching errors, and clearing on sign-out.

## 5. When to reach for the next tier (not yet, but know the triggers)

| Trigger | Do this |
|---|---|
| More screens sharing data, wanting background refetch/retries/devtools | Adopt **TanStack Query**. `queryCache.js` deliberately mirrors its vocabulary (`queryKey`/`staleTime`/invalidate) so the swap is mechanical. Don't keep growing that file instead. |
| An aggregate too expensive to compute per request | **Materialized view** refreshed on a schedule, or a rollup table maintained by trigger. Dashboards rarely need to-the-second freshness. |
| `activities` past ~100k rows, dashboards slowing again | Pre-aggregated **daily rollup table** (per employee per day), so reports read hundreds of rows instead of hundreds of thousands. |
| Needing to know what's slow in production, not just locally | Enable **`pg_stat_statements`** in Supabase and review the top queries by total time monthly. |
| Tables into the millions | **Partitioning** (`activities`/`lead_change_log` by month) and an archival policy for closed leads. |

## 6. Known remaining work (deliberately not done yet)

- ~~**Needs Attention still downloads every lead.**~~ **DONE 2026-09-05**
  (`migration_needs_attention_rpc.sql`) — 66 rows instead of 1,209, verified
  IDENTICAL against the client-side path on every bucket and every rendered
  field. It also let Dashboard drop `fetchLastActivityPerLead()` on the fast
  path. **The side-by-side comparison earned its keep twice**: it caught
  `NULL LIKE '...'` returning NULL rather than false (which silently emptied
  two whole buckets of app-created leads) and a tie-ordering difference that
  a count-only check would have declared a pass. Use that same technique for
  anything below.
- **`fetchLeadsForBreakdown` is now the critical path on its own (~2.3s of a
  ~3.4s load), and Needs Attention no longer keeps it there.** Its remaining
  consumers fall into three groups, each with a clear route off it:
  1. *Open-pipeline KPIs, on-hold value/count, open lead count, the All
     Leads header* — all stage-grouped counts/sums, already returned by
     `leads_category_breakdown`'s `stage` grouping. Pure rewiring.
  2. *Drill-down panels* (`buildPipelinePanel`, `buildCategoryMixPanel`,
     `buildMixPanel`) — click-triggered, so they can fetch on open. The
     query cache makes the second panel instant.
  3. *Sales funnel* — the one genuine blocker: `computeFunnel` needs per-lead
     ids to dedupe leads that appear in both `stage_history` and the current
     stage list, so counts alone won't do. Either give it its own slim
     `select id, current_stage` (no joins — measured 429ms vs 868ms) or move
     the funnel into an RPC too.
- **`fetchStageHistoryForFunnel` / `fetchWonStageHistory` /
  `fetchDecidedStageHistory`** ship 1,600 raw rows each to compute a handful
  of figures. All three are good RPC candidates.
- **Two-page sequential penalty** — mitigated, not eliminated. `leads`,
  `stage_history` and `parties` now fetch page 2 speculatively (see item 6
  above), so the wait is gone for them. But this is a workaround: shrinking
  the payloads via aggregation removes the problem at its root, and every
  table that crosses another 1,000-row boundary needs its
  `speculativePages` raised or the wait comes back. `activities` (900 rows)
  is the next to cross.
- **Other screens still each fetch the company independently** — Today, My
  Team and the Sales Exec Profile now share the cache, which mostly hides
  this, but they should move to aggregates too.
