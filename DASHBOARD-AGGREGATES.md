# Dashboard aggregates — design review

**Status: plan only. Nothing built.** Real costs measured live against
production data via an authenticated owner session; no writes made, no
schema touched.

## The finding that changes the shape of the fix

Before the per-function breakdown: **all six of these fire once per page
mount with an empty `useEffect` dependency array, and never refetch** — not
on the Dashboard's own date-range control (Week/Month/Quarter/15D/Custom),
not on anything. Confirmed by reading every call site. Whatever range
filtering a card appears to do (Targets vs. actuals, the KPI sparkline's
week-over-week deltas) happens by **slicing the already-fully-downloaded,
all-time array client-side**, every time, on every mount.

And there are more mounts than one dashboard: **four independent pages each
call `fetchLeadsForBreakdown` on their own** — `Home.jsx`, `Dashboard.jsx`,
`MyTeam.jsx`, `EmployeeProfile.jsx` — no shared cache between them. Same
story for `fetchLastActivityPerLead` (5 call sites) and
`fetchWonStageHistory` (3 call sites). Navigate Home → Dashboard → My Team →
a Sales Exec Profile in one session and you've downloaded the entire leads
table, in full, four separate times.

This matters for the proposal below: **converting each function to a
server-side aggregate helps, but doesn't by itself fix the four-times-over
redundancy** — that needs either a shared cache/store (e.g. one fetch per
session, invalidated on write) or range-aware refetching wired to the actual
control that's supposed to govern it. Flagging this as its own decision,
separate from the six functions themselves.

## Real costs, measured live (production data, owner session)

| Function | Rows today | Payload today | Latency (warm) | Call sites |
|---|---:|---:|---:|---:|
| `fetchLeadsForBreakdown` | 262 | **150 KB** | 650ms–2s (spiked to 7.9s cold) | 4 |
| `fetchStageHistoryForFunnel` | 227 | 24 KB | ~380ms | 1 |
| `fetchLastActivityPerLead` | 79 | 4.6 KB | ~470ms | 5 |
| `fetchDecidedStageHistory` | 17 | 2.1 KB | ~360ms | 2 |
| `fetchLossReasons` | 6 | 1.5 KB | ~330ms | 1 |
| `fetchWonStageHistory` | 11 | 1.2 KB | ~300ms | 3 |

`fetchLeadsForBreakdown` is the outlier by a wide margin — 6× the next
largest payload, and it's the one with four embedded joins
(`parties`/`sites+areas`/`employees`/`products`) per row. At the ~1,186-lead
12-month projection (ROW-COUNTS.md), payload scales to roughly **~680 KB**
per fetch, ×4 independent mounts if the redundancy isn't also fixed. On the
field connections this app is explicitly built for, that's the one that
actually hurts.

## Per-function analysis

### 1. `fetchLastActivityPerLead` — clean aggregate, do this first

**What it produces**: one row per lead — its most recent activity
timestamp. Currently ships every `activities` row with a non-null `lead_id`
(79 today; scales with activity volume, not lead volume, so this one grows
*faster* than leads as the pilot ages) and reduces to a `Map` client-side in
five different places, each with its own copy of the same reduction logic.

**View/RPC**: a plain `SECURITY INVOKER` (the Postgres default — no
`SECURITY DEFINER` needed) view or SQL function:
```sql
SELECT lead_id, MAX(created_at) AS last_activity_at
FROM activities WHERE lead_id IS NOT NULL GROUP BY lead_id;
```
`activities` SELECT is already "own data or owner role" — a view just
re-runs that same RLS check per caller, so a sales exec still only sees
their own leads' activity, an owner sees everyone's, automatically, with
zero new policy work.

**Time window**: none needed or wanted — staleness has to look arbitrarily
far back (a lead untouched for 90 days is still "90 days stale," not
invisible).

**Verdict**: straightforward, lowest-risk, do this one regardless of what
else gets approved. Removes ~5× redundant full-`activities` scans and a
duplicated JS reduction, replaces both with one small pre-aggregated result.

### 2. `fetchDecidedStageHistory` + `fetchWonStageHistory` — merge into one bounded, RLS-clean view

**What they produce**: `fetchWonStageHistory` is `stage_history` filtered to
`stage = 'won'`; `fetchDecidedStageHistory` is the same table filtered to
`stage IN ('won','lost')`. Both embed `leads(owner_employee_id,
order_value)` and both exist **only** to work around `stage_history` not
letting you filter on an embedded relation — so both over-fetch, then drop
rows where the embed came back `null` (RLS on the join target hid them).
That workaround is real and documented in the code, but it's a symptom of
doing this client-side, not something to keep.

**View/RPC**: one view, `stage_outcomes`, `stage_history JOIN leads` where
`stage IN ('won','lost')`, selecting `lead_id, stage, changed_at,
owner_employee_id, order_value`. `SECURITY INVOKER` — RLS on the join to
`leads` (own leads or owner role) then does the row-hiding *at the query*
instead of the client filtering out nulls after the fact. Correctness
improvement, not just a perf one: the current approach *downloads* another
employee's `lead_id`/`stage`/`changed_at` and only hides it client-side
(this exact gap is already called out in `CLAUDE.md`'s Data isolation
section for `fetchStageHistoryForFunnel` — the same trick, the same
exposure, just not yet fixed for these two). Callers filter `stage = 'won'`
vs `IN ('won','lost')` themselves — one view, two call shapes, not two
near-duplicate fetches.

**Time window — does it need all-time?** No consumer I found does.
`fetchWonStageHistory` feeds `computeOrderValueActuals` (Targets vs.
actuals, bounded to the Dashboard's own Week/Month/Quarter selection) *and*
`KpiSparkRow`'s 8-week trailing sparkline *and* `EmployeeProfile`'s own
period selector (also capped at Quarter). The widest real need across every
consumer is "the last ~3 months plus the 8-week sparkline" — comfortably
covered by a **trailing 12-month window**, which would also naturally
self-bound as the pilot's data ages instead of growing forever. **This is a
product question I'm flagging, not deciding**: today "all-time" and "last 12
months" produce identical numbers (the whole dataset is younger than that),
so nothing would visibly change yet — but the query stops being an
unbounded table scan.

### 3. `fetchStageHistoryForFunnel` — genuinely wants all-time; make it an aggregate anyway

**What it produces**: reach-count and avg-days-in-stage per funnel stage,
for `SalesFunnelCard`. Currently ships all 227 `stage_history` rows and does
the reduction in JS.

**Time window — which product is this?** I think this one is legitimately
trying to be "the shape of the whole pipeline," not a 12-month report — an
avg-days-in-stage figure and a reach-count are properties of *how leads got
to where they are now*, including leads that have been open for a year.
Bounding it to a rolling window would silently change what the card means
(a lead that entered Negotiation 14 months ago would vanish from "reach"
counts it should still count toward). **Surfacing this rather than picking
it**: if that's not the product intent, say so and this becomes the same
bounded-window treatment as #2.

**View/RPC**: regardless of the window question, this should still become a
real SQL aggregate (`GROUP BY stage`, `COUNT(DISTINCT lead_id)`,
`AVG(...)` with a window function for time-in-stage) instead of shipping
227+ raw rows to reduce in the browser — that part isn't a product decision,
it's moving work to where it's cheaper. `SECURITY INVOKER` is enough here
too (same RLS-on-`leads`-join reasoning as #2) — I don't see a case for
`SECURITY DEFINER` anywhere in these six; every one of them is an aggregate
over a table whose RLS already scopes correctly per caller, so a
security-invoker view/function inherits that for free. Flagging this since
you expected these might need definer functions — happy to be argued out of
this if there's a case I'm missing, but I don't see one yet.

### 4. `fetchLossReasons` — small today, structurally unbounded forever

**What it produces**: reason counts + named-competitor counts for "Why we
lose" (owner-only), currently filtered *client-side* in `Dashboard.jsx` to
exclude leads that were marked lost and later reopened (a real, deliberate
rule — `loss_reasons` is append-only, so the table alone can't tell you
whether a lead is *still* lost, only that it was once).

**View/RPC**: an aggregate view doing that same "still lost" join
server-side (`loss_reasons JOIN leads WHERE leads.current_stage = 'lost'`)
for the compact card's counts, `SECURITY INVOKER`. The drill-down's "lost
this month" row list is a separate, genuinely bounded query (name says what
window it wants) and should stay row-level rather than aggregated.

**Time window**: the compact card's counts read as a lifetime pattern
("why do we generally lose deals"), same reasoning as the funnel — **same
open question, your call**. Six rows today either way, so there's no cost
argument forcing a decision; it's purely about what the card should mean.

**Verdict**: lowest priority of the six — trivial cost today, RLS already
gates it to owner-only at the table level so there's no exposure risk in
leaving it as-is a while longer.

### 5. `fetchLeadsForBreakdown` — the one that actually needs the discussion

**What it produces**: not one aggregate — this is the shared raw-row feed
for at least six *different* downstream shapes: Leads-by-area,
Leads-by-site-stage, Leads-by-product, Pipeline-by-stage, My Team's
per-employee open-lead stats, and Needs Attention's row-level buckets
(`attention.js`). The first four just want counts + summed value per
category — real aggregates. The last two (My Team's stats, Needs Attention)
need actual per-lead identity (id, party name, owner, value) to link into
`/leads/:id` and can't be satisfied by a pre-aggregated count.

**Proposed split, not a single fix**:
- **Category aggregates** (area / site stage / product / pipeline stage):
  four small `SECURITY INVOKER` views, each a `GROUP BY` returning
  `category, count, sum(value)` — the compact cards read these directly
  instead of 262 rows with four joins. This is most of the 150 KB payload;
  none of these four cards need a single embedded relation once the
  grouping happens in SQL.
- **Needs Attention / row-level consumers**: keep a row-level fetch, but
  trim it to what `attention.js` actually reads (it doesn't need
  `products`/`areas` at all) and — bigger win — **fetch on demand** rather
  than on every mount. Needs Attention's bucket *counts* could come from a
  fifth aggregate view (counts per bucket, mirroring `attention.js`'s five
  thresholds as SQL predicates); the row-level detail only has to load once
  a bucket is actually opened, the same "eager build, lazy fetch" split
  `drilldownBuilders.js` already uses for other panels.
- **My Team's per-card stat** (open leads + open pipeline value per
  employee) is itself just another `GROUP BY owner_employee_id` aggregate —
  a sixth view, or foldable into the pipeline-by-stage one with an extra
  grouping column.

**Time window**: none of this wants bounding — every one of these is "the
shape of the pipeline right now," same as the funnel, not a period report.

**This is the one I'd want a real second design pass on before writing
migration SQL** — five-ish views is more surface area than the other five
functions combined, and I'd rather propose the exact view definitions as
their own follow-up than sketch them in prose here.

## Proposed phasing

1. `fetchLastActivityPerLead` → one view. Lowest risk, fixes the most
   redundant calls per line of SQL.
2. `fetchWonStageHistory` + `fetchDecidedStageHistory` → merge into
   `stage_outcomes`, bounded to a trailing window (pending your call on the
   window question above) — also closes the RLS over-fetch gap.
3. `fetchStageHistoryForFunnel` → one aggregate view, all-time (pending
   confirmation that's the intended product).
4. `fetchLossReasons` → one aggregate view, whenever convenient — cheapest,
   least urgent.
5. `fetchLeadsForBreakdown` → its own design pass, four-to-six views plus an
   on-demand row-level fetch for drill-downs. The highest-value fix (it's
   the 150 KB one) and the one most worth getting right rather than rushing.
6. Separately: decide whether the four-times-redundant-fetch pattern gets
   fixed by a shared cache/store, independent of how many of the above ship.

## Open questions for you

1. **`fetchWonStageHistory`/`fetchDecidedStageHistory`**: bound to a
   trailing ~12 months, or must something read further back than that?
2. **`fetchStageHistoryForFunnel`**: whole-pipeline-ever (my read) or should
   it become a 12-month report like everything else?
3. **`fetchLossReasons`**: same question — lifetime pattern or bounded
   report?
4. **Redundant fetching across Home/Dashboard/MyTeam/EmployeeProfile**: worth
   a shared cache as its own piece of work, or acceptable to leave once the
   individual fetches are cheaper?
5. Green light to design the `fetchLeadsForBreakdown` split as its own
   follow-up pass, or fold it into this one?

No `SECURITY DEFINER` functions proposed anywhere above — every one of
these is an aggregate over a table whose RLS already scopes correctly per
caller, so a plain (default `SECURITY INVOKER`) view or function inherits
that automatically. Tell me if there's a case for definer I'm missing.
