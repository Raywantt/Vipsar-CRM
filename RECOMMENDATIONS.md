# Recommendations (post-pilot)

Items logged for later, not built now — each needs a schema/DB change (a
migration, an RPC) that this pass is deliberately not making without
separate approval. Dated as logged.

## 1. Server-side search RPC for leads/party search (2026-08-23)

**What**: A Postgres `security definer` function doing the party/site/
employee ILIKE matching as a real SQL join, server-side, returning the
already-filtered/paginated `leads` rows (or a party/lead result set for
`Search.jsx`) directly — instead of the current app-side approach
(`resolveLeadsSearchFilter` in `src/lib/dashboardQueries.js`): three
separate ILIKE lookups per keystroke, each capped at 50 rows, stitched into
a `leads.or(party_id.in.(...),site_id.in.(...),owner_employee_id.in.(...))`
filter built in the browser.

**Why it's worth doing eventually**:
- **Removes the URL-length ceiling.** The current approach sends a
  potentially-large `.in()` id list as a GET query string. Measured live: a
  single common letter ("a") resolves to 520 ids and a ~3,474-character
  request URL with no cap at all; even the enforced 2-character minimum
  hits 292 ids on a real substring ("an"). A server-side join has no id
  list to serialize into a URL — the cap becomes unnecessary at the
  transport level, not just raised.
- **Removes the 50-per-category cap entirely**, which is a real functional
  limitation, not an edge case. **Any common surname in the customer base
  will exceed 50 matching parties in ordinary use** — this isn't a rare
  large-input scenario, it's what "search for a customer by surname" looks
  like once the party table has a few hundred rows. When that happens today,
  the fix in place tells the user to "refine your search" — advice that
  doesn't work when the surname *is* the search and there's nothing more
  specific to type. A real join can paginate the true matching set instead
  of silently truncating the candidate pool before the query even runs.
- Same reasoning applies to `Search.jsx`'s party directory once it moves to
  server-side search (see section A below) — same RPC could likely serve
  both screens.

**Why not now**: needs a migration (`CREATE FUNCTION ... SECURITY DEFINER`),
which per this pass's rules requires separate approval and is a genuine
schema change, not a client-side fix. Reasonable to defer past the pilot,
where the current cap's failure mode (a common surname search silently
missing results past the 50th match, with an unhelpful "refine your
search" message) is a real but survivable rough edge at pilot scale.

## 2. A user-selectable Top-N toggle for Pipeline concentration (2026-09-08)

**What**: the "Right now" strip's Pipeline concentration metric (see
`TIME-INDEPENDENT-METRICS-LOG.md`'s Milestone 6 entry) is fixed at "top 10%
of active leads by value" for v1, with no way to switch to a fixed count
(Top 5, Top 10) instead. A toggle — Top 5 / Top 10 / Top 10% — was discussed
while building this panel and deliberately deferred rather than built now.

**Why it's worth doing eventually**: a fixed 10% reads very differently at
different team sizes — for the owner's company-wide ~674 active leads it
means ~68 leads, a genuinely useful "how top-heavy is the whole pipeline"
question; for a small team it can mean 1–2 leads, which stops being a
concentration question and starts just being "the biggest deal or two." A
fixed-count option (Top 5/Top 10) would give a consistent, comparable
number regardless of scope size, which a percentage-of-scope cannot.

**Why not now**: this is a UI/UX decision (which framing is more useful),
not a technical blocker — `leads_open_deal_ranking()`
(`Schema/migration_time_independent_dashboard_metrics.sql`) already returns
every active lead ranked by value, so a Top-5/Top-10 cut is a client-side
`.slice()` change, no migration needed. Deferred simply because the brief
for this feature fixed the rule at 10% for v1 and asked that a toggle be
logged here rather than built in the same pass — worth revisiting once the
product owner has seen the concentration panel in front of real, varied-size
teams and has an opinion on whether 10% alone reads well at every scale.
