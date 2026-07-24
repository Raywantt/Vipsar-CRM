# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A CRM for a Tostem window & door dealership: tracking leads, quotes, orders,
and installs. Built as a React + Vite PWA, with Supabase as the backend and
Vercel planned for hosting. Used by sales executives mostly from a phone in
the field, often with poor signal — favor mobile-first layouts, don't assume
a reliable connection.

## Current state

Phase 1 done: Supabase project created, `Schema/tostem_crm_schema.sql` run
against it, app connects via `src/lib/supabaseClient.js` (reads
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from `.env`; see `.env.example`).
`Schema/rls_policies.sql` has full RLS + grants for every table, and
`tostem_crm_schema.sql` includes the `employees.auth_user_id → auth.users`
FK — for both, confirm with the user they've actually been run in the live
project, don't assume from the file's presence alone.

Phase 2 done: email/password login (Supabase Auth), `AuthContext` resolving
the logged-in `employees` row, and protected/role-based routing. Employee
accounts are created manually in the Supabase dashboard (Auth → Users) — no
self-signup screen, none planned.

Phase 3 done: `PartySearchOrCreate`/`SiteSearchOrCreate` (search-before-
create components), `LeadQuickCapture` (quick-capture lead intake at
`/leads/new`), and `LeadDetail` (the "add more details" screen at
`/leads/:id`). `/leads/new` deliberately allows `owner` too, not just
`sales_executive` — an owner can personally log leads, not a testing
workaround. `OwnerDashboard` is still a placeholder.

Phase 4 done: `ActivityLog` (DPR replacement) at the now-free `/activity`
route. Not in scope for this pass: lead stage changes, `stage_history`
logging, or a screen listing past activities.

## Stack

- React 19 + Vite
- `vite-plugin-pwa` for PWA support (manifest + service worker), configured in `vite.config.js`
- Plain CSS (no CSS framework chosen yet)
- Oxlint for linting (`npm run lint`)

## Structure

```
src/
  components/   reusable UI pieces (ProtectedRoute, AppNav, PartySearchOrCreate,
                SiteSearchOrCreate, LeadSearchSelect, the four LeadDetail
                *Section components)
  pages/        top-level views (Login, OwnerDashboard, LeadQuickCapture,
                LeadDetail, ActivityLog, ...)
  contexts/     AuthContext — session + employee (id/name/role) lookup
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js)
  assets/       images, icons, etc.
```

Routing is set up in `App.jsx` (`react-router-dom`): `/login`, `/dashboard`
(owner-only), `/leads/new`, `/leads/:id`, `/activity` (sales_executive and
owner), `/` redirects based on auth + role. `ProtectedRoute` handles the
redirect-to-login and role gating; `AuthContext` is the single source of
truth for "who's logged in and what's their role" — look up an employee's
role via `useAuth()`, don't re-query `employees` directly in a component.
`ProtectedRoute` also renders `AppNav` (`src/components/AppNav.jsx`) above
`children` once auth/role checks pass, so every logged-in screen gets the
same nav bar (New Lead / Activity Log / Dashboard-if-owner + Log out)
without each page wiring it up itself — don't add a per-page logout button,
`AppNav` is the only one now.

### Search-before-create components

`PartySearchOrCreate` and `SiteSearchOrCreate` (`src/components/`) share one
UX pattern and stylesheet (`SearchOrCreate.css`, `search-or-create-` prefix)
and the `sanitizeForIlike` helper (`src/lib/sanitizeForIlike.js`, strips
`%_,()` before building a PostgREST `.or()` ILIKE filter — comma/parens are
filter-syntax delimiters, `%`/`_` are ILIKE wildcards). Neither uses an inner
`<form>` (Create is a button+onClick, not onSubmit) since the lead intake
screen embeds both inside one larger form and nested `<form>`s are invalid
HTML.

* `PartySearchOrCreate` — debounced ILIKE search on `parties` name/mobile,
  pick existing or create inline, `onSelect(party | null)`. The reason
  `parties`' RLS moved off "own data or owner role" (own-search invisibility
  broke duplicate checking across reps).
* `SiteSearchOrCreate` — Area picked first (from `areas`), then debounced
  search on `sites.locality`/`house_no` scoped to that `area_id`; site_stage
  is a preset dropdown + "Other…" free text (deliberately not a CHECK enum).
  `onSelect(site | null)`. Optional `discoveredVia` prop passes through
  `source_type` (e.g. Scanning) without exposing it as a field.

Reuse these for any future party/site picker — don't write another search input.

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

The sales_executive landing screen at `/leads/new` (owner can access too) —
deliberately not a structured form: three optional fields (Client name, Site
nickname, Other's name) plus a required Scanning/Lixil/Referral tap-select
(three buttons, not a dropdown). Validation is exactly `lead_needs_an_anchor`:
at least one of the three fields filled.

* Quick-select maps to `source_type`/`discovered_via` as
  `scanning`/`lixil`/`referral_architect` only — `referral_other`/
  `showroom_walkin` aren't reachable here.
* Client name and Other's name each use their own `PartySearchOrCreate`
  (`defaultPartyType` `'client'`/`'architect'` — just a pre-selected default,
  changeable in the create form).
* Site nickname is a direct insert of `{nickname, discovered_via,
  discovered_by}` (not via `SiteSearchOrCreate` — nicknames are free text,
  nothing structured to search yet); `LeadDetail`'s Site details section is
  where the structured `sites` fields get filled in later.
* `party_id` = client's party if given, else other's party.
  `referred_by_party_id` is set only when source is `referral_architect`
  **and** both a client and other party exist — otherwise NULL even if an
  "other" party was resolved (it's still created, just not linked to this
  lead). Deliberate edge case — don't add extra linking logic without
  checking with the user first.
* `leads.other_party_id` (distinct from `referred_by_party_id`) is always set
  when an "other" party is resolved, regardless of source — purely so
  `LeadDetail` can later suggest linking that party as a site contact, even
  in the non-referral case where they'd otherwise be untraceable.
* No DB transaction wraps the site+lead inserts — if the site succeeds but
  the lead fails, the site row is orphaned (error message surfaces the site
  id, but nothing auto-cleans up).

### LeadDetail (`src/pages/LeadDetail.jsx`)

The "add more details" enrichment screen at `/leads/:id`, reachable from the
lead ID link on `LeadQuickCapture`'s success screen. Read-only summary
(source/stage/party/site/created) plus up to four independent sections, each
with its own Save button and saving/error/success state (saving one never
touches the others):

* **Site details** (`SiteDetailsSection.jsx`, if `site_id` set) — plain edit
  form (not `SiteSearchOrCreate`'s find-or-create, since the site already
  exists) for Area/locality/house no./pincode/site_stage. Reuses
  `SITE_STAGE_OPTIONS` (`src/lib/siteStageOptions.js`, shared with
  `SiteSearchOrCreate`).
* **Client details** (`ClientDetailsSection.jsx`, if `party_id` set) — edits
  mobile/address/city.
* **Additional contacts** (`AdditionalContactsSection.jsx`, if `site_id`
  set) — lists existing `site_contacts`; surfaces `other_party_id` as a
  pre-filled suggestion if not yet linked; repeatable "+ Add another
  contact" via `PartySearchOrCreate` + role + optional firm name (updates
  `parties.firm_name`).
* **Sales progress** (`SalesProgressSection.jsx`, always shown) — product
  dropdown, RFQ raised (checkbox+date), quote sent (checkbox+date+value),
  straight fields on `leads`.

`sites`/`parties` UPDATE had to move off owner-only RLS to "own data or
owner role" for Site/Client details to work for a regular sales exec — a
real blocker found while building this screen, not preemptive.

### ActivityLog (`src/pages/ActivityLog.jsx`)

DPR replacement at `/activity`. Tap one of Site Visit/Call/RFQ Raised/Office
Day/Booking Update; every type except Office Day then shows `LeadSearchSelect`
(select-only, scoped to the current employee's own leads via `owner_employee_id`)
alongside `PartySearchOrCreate` with `allowCreate={false}` — pick a lead, a
party, or both, at least one required. Office Day skips this step entirely
(matches the loosened `activity_needs_an_anchor` CHECK — see
`Schema/tostem_crm_schema.sql`).

* Common fields: notes (textarea), accompanied-by (optional, `employees`
  dropdown excluding yourself). Office Day additionally gets a numeric
  "leads generated" field.
* If a lead is selected (any type), an optional "update next follow-up date"
  field updates `leads.next_followup_date` when filled in.
* RFQ Raised + a selected lead also sets that lead's `rfq_raised = true` and
  `rfq_raised_at` to today.
* Booking Update + a selected lead shows an optional `order_value` field,
  applied to the lead if filled in.
* Lead side effects run as separate UPDATE calls after the `activities`
  insert succeeds; a failure there surfaces as a warning on the success
  screen without blocking the activity itself from being logged.
* Not in scope for this pass: lead stage changes, `stage_history` logging,
  or a screen listing past activities.

`LeadSearchSelect` (`src/components/LeadSearchSelect.jsx`) is select-only
(no create) — fetches the employee's own leads once, filters client-side by
linked party name / site nickname / locality. Embedding `parties` from
`leads` needs an explicit FK hint (`parties!party_id(...)`) — `leads` has
three FKs to `parties` (`party_id`, `referred_by_party_id`, `other_party_id`),
so a bare `parties(...)` embed fails with "more than one relationship was
found." `PartySearchOrCreate` gained an `allowCreate` prop (default `true`)
for this screen's selection-only use — existing callers are unaffected.

## Commands

- `npm run dev` — start dev server (default port 5173)
- `npm run build` — production build
- `npm run preview` — preview the production build locally
- `npm run lint` — run Oxlint

## Local environment notes

This machine had Node.js installed mid-session, so its directory
(`C:\Program Files\nodejs`) may not yet be on PATH in every shell. If `node`/`npm`
aren't found, prepend it: `export PATH="/c/Program Files/nodejs:$PATH"` (bash)
or restart the terminal so the system PATH update takes effect.

`.claude/launch.json` and `.claude/dev-server.cmd` exist so the preview tooling
can start the dev server reliably even before PATH is fully refreshed.

The Browser-pane dev preview persists its Supabase session in localStorage
per-origin, shared across every tab — including tabs a human tester and
Claude open independently. A login for one manual test silently carries over
into later "unauthenticated" checks, producing false-positive real writes.
Confirm which state a test tab is actually in (expect `permission denied`
from an intentionally logged-out check) rather than assuming a fresh tab
means a fresh session.

## Conventions

- Secrets (Supabase URL/keys, etc.) go in a git-ignored `.env` file — never commit them. `.env.example` documents the required variable names with placeholders.
- Keep the `Schema/` folder as reference material; don't auto-apply it to a live database.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
- Row Level Security (full policies in `Schema/rls_policies.sql`): `activities`/`leads`/`plans`/`targets` use "own data or owner role" (by `employee_id`/`owner_employee_id`, or role=`'owner'`), with no DELETE at all. `employees`: SELECT open, INSERT/UPDATE/DELETE owner-only with **no self-update exception** (a sales exec must never set their own `role` to `'owner'`). `sites`/`parties`: SELECT/INSERT open to all (needed for search-before-create across reps), UPDATE is "own data or owner role" (`discovered_by`/`created_by`), DELETE owner-only. `areas`/`site_contacts`: SELECT/INSERT open, UPDATE/DELETE owner-only (shared master data / append-style joins — no per-row "own data" concept applies). `products`: SELECT open, else owner-only. `stage_history`: SELECT/INSERT open, no UPDATE/DELETE ever (append-only). `loss_reasons`: SELECT owner-only, INSERT open, no UPDATE/DELETE. A write needs both the table GRANT (Step A of `rls_policies.sql`) and the RLS policy to agree — DELETE is only granted on the six tables with an `owner_only_delete` policy (`employees`/`areas`/`sites`/`site_contacts`/`parties`/`products`).

## Roadmap

0. ✅ Environment + scaffold (done)
1. ✅ Supabase project, schema, RLS policies (`Schema/rls_policies.sql`) — confirm they've actually been run
2. ✅ Employee login (Supabase Auth): login screen, AuthContext, protected/role-based routing
3. ✅ Party/site/lead intake screens (search-before-create pattern): `PartySearchOrCreate`, `SiteSearchOrCreate`, quick-capture lead intake (`LeadQuickCapture`), and the "add more details" enrichment screen (`LeadDetail`) all done
4. ✅ DPR / activity logging (`ActivityLog` at `/activity`) — lead stage changes, `stage_history` logging, and a past-activities list are still not built
5. ⬅️ current — Dashboards (replaces manually-tallied Weekly Update / Monthly Prospects / Yearly Performance sheets)
6. PWA polish (installable, offline-tolerant for field use)
7. Deploy + pilot with 1-2 sales execs before full rollout

For domain model, lead-sourcing logic, and locked-in design decisions, see DECISIONS.md.
