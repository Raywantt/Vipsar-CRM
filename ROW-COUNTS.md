# Row counts & 12-month growth projection

`ROW-COUNTS.sql` doesn't exist in the repo, so this uses two queries I wrote
myself, run live against the production Supabase project (via an
authenticated owner session, since RLS blocks anonymous reads on every table
here):

1. **Current rows**: `select count(*) from <table>`
2. **Added in the last 30 days**: `select count(*) from <table> where <created_at column> >= now() - interval '30 days'`

Every real table in `Schema/tostem_crm_schema.sql` plus the two audit-trail
tables added by later migrations (`lead_change_log`, `follow_up_change_log`)
was checked — 18 tables total, covering everything the app writes to.

**Projected 12-month figure** = current rows + (30-day count × 12) — a naive
linear extrapolation of the last 30 days' rate forward a year. No smarter
model than that; treat it as a rough order of magnitude, not a forecast.

## ⚠️ Read this before trusting the projection

Most of the current row counts are **synthetic seed data**, not organic
usage. `simulation_plan.json` (repo root) documents a Phase 9 audit that
generated ~6 months of backdated, realistic-looking leads/activities/etc.
(`window_start: 2026-02-12`, `window_days: 181`) purely so dashboards had
something non-trivial to render while testing. That's why `parties`
(319 total, only 107 in the last 30 days) and `activities` (79 total, all 79
in the last 30 days) look so different in shape — `activities` and
`follow_ups` are almost entirely rows created during real, recent testing
sessions, while `parties`/`sites`/`leads`/`stage_history` carry a large
backdated historical tail from that seed script. The 30-day window is
measuring a mix of "tail end of a synthetic 6-month backfill" and "real
pilot usage since ~2026-08-06" — not a steady organic growth rate. Take the
12-month projection as illustrative, not a number to plan infrastructure
against without a re-check once the app has a real usage history.

## Results

| Table | Current rows | Added (last 30d) | Projected in 12mo | Flag |
|---|---:|---:|---:|:---:|
| `parties` | 319 | 107 | 1,603 | ⚠️ >1,000 |
| `lead_change_log` | 293 | 109 | 1,601 | ⚠️ >1,000 |
| `sites` | 259 | 78 | 1,195 | ⚠️ >1,000 |
| `leads` | 262 | 77 | 1,186 | ⚠️ >1,000 |
| `stage_history` | 225 | 82 | 1,209 | ⚠️ >1,000 |
| `follow_up_change_log` | 111 | 111 | 1,443 | ⚠️ >1,000 |
| `activities` | 79 | 79 | 1,027 | ⚠️ >1,000 |
| `site_contacts` | 248 | 51 | 860 | — |
| `follow_ups` | 71 | 71 | 923 | — |
| `employees` | 9 | 8 | 105 | — |
| `push_subscriptions` | 6 | 6 | 78 | — |
| `loss_reasons` | 4 | 4 | 52 | — |
| `products` | 4 | N/A (no timestamp column) | N/A | — |
| `lead_owner_history` | 0 | 0 | 0 | — |
| `areas` | 0 | N/A (no timestamp column) | N/A | — |
| `plans` | 0 | N/A (no timestamp column) | N/A | — |
| `targets` | 0 | N/A (no timestamp column) | N/A | — |
| `employee_preferences` | — | — | — | table doesn't exist yet — `Schema/migration_employee_theme_preference.sql` is outstanding, not run live |

**7 tables flagged** (projected to exceed 1,000 rows in 12 months):
`parties`, `lead_change_log`, `sites`, `leads`, `stage_history`,
`follow_up_change_log`, `activities`.

## ⚠️ 1,000 is a HARD CEILING, not just a "getting big" threshold

Added 2026-09-04, after the first table crossed it and broke a live figure.

PostgREST caps every response at the project's `max-rows` setting — **1,000
rows here** — regardless of whether the query asked for a limit. So a query
with no `.limit()`/`.range()` does **not** return the whole table. It returns
the first 1,000 rows and says nothing about the rest: no error, no flag, just
a shorter array. This document's own "loads the *entire* table on mount, no
cap at all" framing below was wrong in exactly that way.

Five tables are already past it: `stage_history` (1,591), `parties` (1,358),
`lead_change_log` (1,265), `sites` (1,206), `leads` (1,204). `activities`
(900) is next.

What that cost, before it was found: every screen built on
`fetchLeadsForBreakdown` was reducing 1,000 of 1,204 leads and reporting the
result as the whole company — **₹3.16 Cr of open pipeline missing (14%), 10
leads missing from Negotiation, 24 from Won**.

And it got worse the more the data was curated, which is what made it look
like a ghost rather than a rounding error. Those queries had no `ORDER BY`
either, so Postgres returned heap order — and an UPDATE writes a new tuple
version at the **end** of the heap. **Editing a lead therefore moved it to
the back of the physical order and pushed it over the cap.** The owner added
a quote value to a lead and the act of recording it is what deleted it from
every dashboard figure.

**The rule: a query that means "every row" must page.** Use
`fetchAllRows()` (`src/lib/fetchAllRows.js`) — it pages past the cap and
imposes a deterministic order, which is required too, since `.range()` paging
with no `ORDER BY` can silently repeat or skip rows between pages. A bare
unbounded `.select()` is only safe on a table that will never reach 1,000
rows, and this file exists to tell you which those are.

## What that means for the redesign

Of the 7 flagged tables, these are the ones actually rendered as an
unbounded/scrollable list in the current UI today (per `CLAUDE.md`) —
the ones worth designing with virtualization in mind rather than pagination:

- **`leads`** — `LeadsListCard`'s All Leads view (currently hard-capped at
  100 rows client-side, not paginated).
- **`parties`** — `Search`'s party directory (`fetchAllParties` loads the
  entire table on mount — already flagged in `CLAUDE.md` as a "downloads the
  whole company" pattern. It now really does load all of it: until
  2026-09-04 it silently stopped at 1,000 of 1,358, see the ceiling section
  above).
- **`activities`** / **`stage_history`** — merged into
  `LeadActivityTimeline` per lead (bounded per-lead today, so not urgent at
  the per-lead scale, but relevant if a future screen lists activity
  company-wide).
- **`lead_change_log`** — the Day Review's audit trail (currently
  day-scoped, so also bounded today; matters if a "browse all history"
  screen is ever built, which `CLAUDE.md`'s "Current state" section notes
  is still an open gap).

`sites` and `follow_up_change_log` don't currently have a dedicated
list screen at all, so the flag is forward-looking only.
