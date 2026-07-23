# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A CRM for a Tostem window & door dealership: tracking leads, quotes, orders,
and installs. Built as a React + Vite PWA, with Supabase planned as the
backend and Vercel planned for hosting.

## Current state

Phase 1 done: a real Supabase project exists, `Schema/tostem_crm_schema.sql`
has been run against it, and the app connects via `src/lib/supabaseClient.js`
(reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from `.env` — see `.env.example`
for the variable names). `Schema/rls_policies.sql` has the full Row Level
Security + grants for every table — check with the user whether it's actually
been run in the live Supabase project before assuming it has (don't infer
this from the file's presence alone). The `employees.auth_user_id` foreign
key to `auth.users` has been written into `tostem_crm_schema.sql` too — same
caveat, confirm the `ALTER TABLE ... ADD CONSTRAINT fk_auth_user` has
actually been run before assuming it.

Phase 2 done: email/password login via Supabase Auth, an `AuthContext` that
resolves the logged-in `employees` row, protected/role-based routing all
exist. Employee accounts are created manually in the Supabase dashboard
(Auth → Users), not via self-signup — there's no signup screen and none is
planned.

Phase 3 in progress: `PartySearchOrCreate` and `SiteSearchOrCreate` (search-
before-create components) exist. `LeadQuickCapture` (at `/activity`) is the
first real lead-intake screen — replaces the old `ActivityScreen` placeholder
as the sales_executive landing page. `OwnerDashboard` is still a placeholder.
The "add more details" follow-up screen (structured editing of a
quick-captured lead) is not built yet.

## Domain model

Four core entities, all independent, linked by foreign keys — never by retyping names or addresses:

* `parties` — every person/firm we deal with (client, architect, builder, firm). One row per person, ever.
* `sites` — a physical property/project. Independent of parties; can exist with zero known contacts (e.g. a plot spotted while scanning, owner unknown).
* `site_contacts` — many-to-many join between sites and parties, with a role (owner/architect/builder/project_manager/site_staff/other). Fills in progressively as contacts are discovered — this is how "unknown until later" gets resolved.
* `leads` — one row per opportunity. Requires EITHER `site_id` OR `party_id`, never both mandatory. Which one is known first depends on the lead source (see below).

Full schema and comments: `Schema/tostem_crm_schema.sql`.

### Why leads can start with just a site OR just a party

Three lead sources, each surfaces different information first:

* Scanning (sales exec finds a plot in person) → site known, party usually unknown at first.
* Lixil-provided leads → only a client name (sometimes a number) — party known, no site yet.
* Architect referrals → architect's details + client's name — party known (often two parties), no site yet.

`leads.source_type` records which of these it was. Never make `site_id` or `party_id` NOT NULL on `leads` — both must stay optional, enforced instead by the `lead_needs_an_anchor` CHECK constraint (at least one required).

### Access model (Row Level Security)

Full policies live in `Schema/rls_policies.sql` — this is just the shape, so
you don't have to re-read the whole SQL file to remember the design:

* `activities`, `leads`, `parties`, `plans`, `targets` — "own data or owner
  role": SELECT/INSERT/UPDATE allowed if the row is yours (by employee_id /
  owner_employee_id / created_by) OR your role is `'owner'`. No DELETE grant
  and no DELETE policy on any of these five — non-deletable by design.
* `employees` — SELECT open to all authenticated; INSERT/UPDATE/DELETE
  `'owner'`-only with **no self-update exception**. This is deliberate: a
  sales exec must never be able to write their own `employees` row, or they
  could set their own `role` to `'owner'`.
* `areas`, `sites`, `site_contacts` — SELECT/INSERT open to all authenticated
  (they fill in progressively during intake); UPDATE/DELETE `'owner'`-only.
* `products` — SELECT open to all; INSERT/UPDATE/DELETE `'owner'`-only.
* `stage_history` — SELECT/INSERT open to all; no UPDATE/DELETE policy at
  all — permanently append-only.
* `loss_reasons` — SELECT `'owner'`-only; INSERT open to all; no
  UPDATE/DELETE policy.

Two layers have to agree for a write to succeed: the table-level GRANT (Step
A of `rls_policies.sql`) and the RLS policy itself. DELETE is only granted at
all on `employees`, `areas`, `sites`, `site_contacts`, `products` — the five
tables with an `owner_only_delete` policy; the other five tables get no
DELETE grant, so they can't become deletable even if a policy were added by
mistake later.

### Design decisions — don't reverse these without discussion

* No GPS, no geocoding API, no fuzzy-matching database extension (pg_trgm). Deliberately dropped as unnecessary/costly for v1. Duplicate-checking is a "search before create" UI pattern (search parties by name/mobile, search sites by locality/plot number before creating a new row) — a human decides, the database doesn't auto-merge or block.
* No UNIQUE constraint on `parties.mobile`. Shared household/family numbers are common; a hard constraint would reject valid entries.
* `current_stage` and `site_stage` are free text, not a CHECK enum. The dealer's own stage vocabulary is specific and still evolving — standardize the list at the application layer, not the database layer.
* Budget constraint: stay on free tiers as long as possible (Supabase free tier, Vercel free tier). Don't reach for a paid API/service to solve a problem that a simpler free approach already covers.

### Roadmap

0. ✅ Environment + scaffold (done)
1. ✅ Supabase project, schema, RLS policies (`Schema/rls_policies.sql`) — confirm they've actually been run
2. ✅ Employee login (Supabase Auth): login screen, AuthContext, protected/role-based routing
3. ⬅️ current — Party/site/lead intake screens (search-before-create pattern):
   `PartySearchOrCreate` ✅, `SiteSearchOrCreate` ✅, quick-capture lead intake
   (`LeadQuickCapture`) ✅ — structured "add more details" follow-up screen
   (editing a quick-captured lead's full site/party details) not started yet
4. DPR / activity logging (mobile-first, replaces the old Google Form)
5. Dashboards (replaces manually-tallied Weekly Update / Monthly Prospects / Yearly Performance sheets)
6. PWA polish (installable, offline-tolerant for field use)
7. Deploy + pilot with 1-2 sales execs before full rollout — **before deploying**:
   remove the two unprotected `/dev/*` routes (`/dev/site-search`,
   `/dev/lead-capture`) from `App.jsx` entirely, and drop `'owner'` from
   `/activity`'s `allowedRoles` (should be `['sales_executive']` only). See
   the "Temporary state" note under Structure below for exactly what to
   revert.

### Users of this app

Sales executives, mostly using it from a phone in the field — often with poor signal. Favor mobile-first layouts and don't assume a reliable connection.

## Stack

- React 19 + Vite
- `vite-plugin-pwa` for PWA support (manifest + service worker), configured in `vite.config.js`
- Plain CSS (no CSS framework chosen yet)
- Oxlint for linting (`npm run lint`)

## Structure

```
src/
  components/   reusable UI pieces (ProtectedRoute, PartySearchOrCreate, SiteSearchOrCreate)
  pages/        top-level views (Login, OwnerDashboard, LeadQuickCapture, ...)
  contexts/     AuthContext — session + employee (id/name/role) lookup
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js)
  assets/       images, icons, etc.
```

Routing is set up in `App.jsx` (`react-router-dom`): `/login`, `/dashboard`
(owner-only), `/activity` (sales_executive-only), `/` redirects based on
auth + role. `ProtectedRoute` handles the redirect-to-login and role gating;
`AuthContext` is the single source of truth for "who's logged in and what's
their role" — look up an employee's role via `useAuth()`, don't re-query
`employees` directly in a component.

**Temporary state currently in `App.jsx`, needs cleanup:** `/activity`'s
`allowedRoles` includes `'owner'` (should be `['sales_executive']` only)
because there's still just one real test account (the owner's). Also two
unprotected dev-only routes, `/dev/site-search` and `/dev/lead-capture`,
exist purely so these screens could be checked without real login — remove
both once a sales_executive test account exists and each screen has been
confirmed end-to-end through its real protected route.

### Search-before-create components

`PartySearchOrCreate` and `SiteSearchOrCreate` (`src/components/`) share one
UX pattern and stylesheet (`SearchOrCreate.css`, classes prefixed
`search-or-create-`) and the `sanitizeForIlike` helper (`src/lib/sanitizeForIlike.js`,
strips `%_,()` before building a PostgREST `.or()` ILIKE filter — comma/parens
are filter-syntax delimiters, `%`/`_` are ILIKE wildcards). Neither uses an
inner `<form>` — Create is a plain button + onClick, not onSubmit — because
Phase 3's lead intake screen embeds both inside one larger form, and nested
`<form>` elements are invalid HTML.

* `PartySearchOrCreate` — debounced ILIKE search on `parties` name/mobile,
  pick existing or create inline, calls `onSelect(party | null)`. It's the
  reason `parties`' RLS had to move off the "own data or owner role" pattern
  (see Access model above) — that pattern made a rep's own search invisible
  to every other rep, defeating duplicate checking.
* `SiteSearchOrCreate` — requires an Area picked first (dropdown sourced from
  `areas`), then debounced search on `sites.locality`/`house_no` scoped to
  that `area_id`, pick existing or create inline (locality, house/plot no.,
  site_stage — a preset dropdown with an "Other…" free-text fallback, since
  `site_stage` is deliberately not a CHECK enum). Calls `onSelect(site | null)`.
  Accepts an optional `discoveredVia` prop so the lead-intake screen can pass
  through which of `leads.source_type`'s values triggered the site creation
  (Scanning, in particular) without exposing it as a user-facing field here.

Reuse these rather than writing another search input — site_contacts and all
three lead-intake source types (item 3 in the roadmap) depend on them.

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

The sales_executive landing screen at `/activity` — deliberately not a
structured form. Three optional fields (Client name, Site nickname, Other's
name) plus a required Scanning/Lixil/Referral tap-select (three buttons, not
a dropdown). Validation is exactly `lead_needs_an_anchor`: at least one of
the three name/nickname fields must be filled.

* Quick-select maps to `source_type`/`discovered_via` as `scanning`, `lixil`,
  or `referral_architect` — there's no UI option for `referral_other` or
  `showroom_walkin` here; those aren't reachable from this screen.
* Client name and Other's name each go through their own
  `PartySearchOrCreate` instance (`defaultPartyType` `'client'` and
  `'architect'` respectively — just a pre-selected default, the rep can
  still change it in the create-form dropdown).
* Site nickname does **not** go through `SiteSearchOrCreate` — it's a direct
  insert of just `{ nickname, discovered_via, discovered_by }`, everything
  else NULL. Nicknames are personal/free-text, so there's nothing structured
  to search against yet; the "add more details" follow-up screen (not built)
  is where the structured `sites` fields get filled in.
* `party_id` on the lead = client's party if given, else other's party.
  `referred_by_party_id` is only ever set when source is `referral_architect`
  **and** both a client and an other's-name party exist — otherwise it stays
  NULL, even if an "other" party was resolved (that party still gets
  created, it's just not linked to this particular lead). This is a known,
  deliberate edge case, not a bug — don't add extra linking logic here
  without checking with the user first.
* No DB transaction wraps the two inserts (site, then lead) — if the site
  insert succeeds but the lead insert fails, the site row is orphaned. The
  error message surfaces the site's id when this happens so it's not a
  silent loss, but nothing auto-cleans it up.

### Gotcha: this project's shared browser session

The Browser-pane dev preview persists its Supabase session in localStorage
per-origin, shared across every tab opened against it — including tabs a
human tester and Claude open independently. A login done for one manual
test silently carries over into later "unauthenticated" checks, easily
producing a false-positive real write. Always confirm which state a test
tab is actually in (expect `permission denied` from an intentionally
logged-out check) rather than assuming a fresh tab means a fresh session.

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

## Conventions

- Secrets (Supabase URL/keys, etc.) go in a git-ignored `.env` file — never commit them. `.env.example` documents the required variable names with placeholders.
- Keep the `Schema/` folder as reference material; don't auto-apply it to a live database.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
