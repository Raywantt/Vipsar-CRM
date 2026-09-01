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

## What that means for the redesign

Of the 7 flagged tables, these are the ones actually rendered as an
unbounded/scrollable list in the current UI today (per `CLAUDE.md`) —
the ones worth designing with virtualization in mind rather than pagination:

- **`leads`** — `LeadsListCard`'s All Leads view (currently hard-capped at
  100 rows client-side, not paginated).
- **`parties`** — `Search`'s party directory (`fetchAllParties` loads the
  *entire* table on mount, no cap at all — already flagged in `CLAUDE.md`
  as a "downloads the whole company" pattern).
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
