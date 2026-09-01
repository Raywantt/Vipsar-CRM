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
