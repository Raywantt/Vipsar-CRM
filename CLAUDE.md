# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A CRM for a Tostem window & door dealership: tracking leads, quotes, orders,
and installs. Built as a React + Vite PWA, with Supabase as the backend and
Vercel planned for hosting. Used by sales executives mostly from a phone in
the field, often with poor signal — favor mobile-first layouts, don't assume
a reliable connection.

The app's own display name (browser tab title, PWA manifest name/short_name,
login heading, nav brand) is **VIPSAR CRM** — VIPSAR is the dealership
itself; Tostem is the window/door product line it sells. Don't conflate the
two or "fix" one to match the other: schema/doc language ("Tostem CRM
schema", "a Tostem window & door dealership") describes the product domain
and predates the rename, not the app's own brand name.

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
workaround.

Phase 4 done: `ActivityLog` (DPR replacement) at the now-free `/activity`
route. Lead stage changes and `stage_history` logging (originally deferred
from this phase) were added afterward to `LeadDetail`, not `ActivityLog` —
see below. A screen listing past activities is still not built.

Phase 5 done: `Dashboard.jsx` (renamed from the old `OwnerDashboard`
placeholder) at `/dashboard`, now reachable by both roles via `AppNav`, not
owner-only. Covers activity counts by type, new leads by source_type, a
closure forecast, targets vs. actuals (with an owner-only target-setting
form), and leads by area — each scoped by a This Week/This Month/Custom
date-range selector except closure forecast (pipeline snapshot, not
date-scoped) and targets vs. actuals (period-keyed to This Week/This Month
only, since `targets` rows are keyed by `period_type`/`period_value`, not
arbitrary ranges). Owner sees a per-employee breakdown on top of the team
total on every card that supports it; sales exec sees only their own
numbers, since RLS already scopes the underlying queries — the same query
code serves both roles. Verified against real data end-to-end by driving
the actual UI, including setting a real target through the new form and
confirming it show up as a real vs. target comparison (see the Dashboard
section below for specifics).

Interface simplification pass (post-Phase 5): a round of UX cleanup across
`LeadQuickCapture`, `ActivityLog`, and `Dashboard`, based on real usage
feedback rather than a new roadmap phase — narrower party-type choices on
lead intake (added `pmc` as a `parties.party_type` value — **schema file
updated, not yet run against the live database**, see Conventions), fewer
anchor fields per activity type, a sales-exec-scoped source list, `Dashboard`
split into Reports/Leads tabs (with a new My Leads/All Leads list), targets
vs. actuals filtered to one sales exec at a time instead of showing everyone
at once, and Leads by area removed outright (it was Phase 5's other new
card, cut one round-trip later — see the relevant sections below for
specifics).

Dashboard expansion + owner tooling (post-Phase 5, second round): three more
report cards on the Reports tab (Leads by stage, Leads by area — brought
back, one round after being removed, this time as a Reports card rather than
its own tab — and Leads by site stage), a new **Parties** tab (directory of
every party ever created, with a type filter/search and a "worked with"
column derived from `leads`), the lead's owner (sales exec) now shown
wherever a lead appears (`ClosureForecastCard`, `LeadsListCard`, `LeadDetail`),
`LeadDetail` now enforces read-only in the UI for a sales exec viewing a lead
they don't own (RLS already blocked the write; this closes the UX gap where
they'd see full edit forms that would just fail), and a new owner-only
**Settings** page (`/settings`) for adding employees, managing existing
ones, and deleting a lead. See the Dashboard, LeadDetail, and new Settings
sections below for specifics — including what Settings *can't* do yet
(create an Auth login) and why.

Phase 6 done: PWA installability. Full icon set generated from the brand
logo (`public/icon-192.png`, `icon-512.png` purpose `any`,
`icon-maskable-512.png` purpose `maskable`, `apple-touch-icon.png`, and a
regenerated `favicon.svg` replacing the old placeholder blue "T") plus
`vite.config.js`'s `vite-plugin-pwa` manifest wired to reference them and a
workbox config scoped to app-shell files only (no `runtimeCaching` rule for
the Supabase API — those requests always hit the network honestly, never
served stale from cache). `InstallPrompt.jsx` (Chrome/Android
`beforeinstallprompt` banner + an iOS-Safari-specific "Add to Home Screen"
hint, both dismissible for the rest of the session via `sessionStorage`) and
`OfflineIndicator.jsx` (a banner on `online`/`offline` events warning that
submissions won't save) both mount globally in `App.jsx`, above routing, so
they show even on `/login`. See the PWA installability section below for
implementation specifics and how this was verified (including deliberately
killing the preview server to prove the app shell loads with zero network).

App rename (post-Phase 6): the app's own display name changed from "Tostem
CRM" to **VIPSAR CRM** across `index.html`'s title, the manifest's
`name`/`short_name`, `AppNav`'s brand text, `Login`'s heading, and
`InstallPrompt`'s banner copy — see "What this is" above for the VIPSAR vs.
Tostem distinction this reflects. The manifest's `description` field and all
`Schema/`/doc references to "Tostem" describing the product line were left
alone — only the app's own name-as-brand moved.

`employees.mobile` added (schema + live DB, via a manually-run `ALTER TABLE`
— the anon key this app runs on can't execute DDL, so schema/DB changes that
aren't done through the Supabase dashboard's SQL Editor have to be handed to
the user as a migration statement rather than applied automatically).
Surfaced in `AddEmployeeForm`/`ManageEmployeesSection` (owner-only, same
pattern as the existing role/active-status editing) and now also selected by
`AuthContext` (`id, name, mobile, role`) so any component can read
`employee.mobile` via `useAuth()` without a separate query.

Home screen (first of an ongoing "polish/finetune" pass, not a numbered
phase): a new `/` landing screen (`src/pages/Home.jsx`) that all roles now
land on after login, replacing the old per-role redirect
(`owner → /dashboard`, `sales_executive → /leads/new`) that used to be
copy-pasted across `Login.jsx`, `App.jsx`, and `ProtectedRoute.jsx` — all
three now just redirect to `/`. Home's shortcuts (currently New Lead,
Activity Log, Dashboard — identical for both roles) come from a role-keyed
config, `HOME_TILES` in `src/lib/homeTiles.js`, rather than inline
`isOwner`-style JSX branching like every other role-aware page in this app
(`Dashboard.jsx`/`LeadDetail.jsx`/`Settings.jsx`) uses — deliberate,
requested groundwork: more roles are planned later, each potentially with a
home screen that looks substantially different, and a role-keyed data map
means adding one is a new entry in `HOME_TILES`, not a rewrite of
`Home.jsx`. A fourth planned tile, **Followups** (personal reminders for a
sales exec plus owner-assigned follow-ups — nothing like this exists yet;
`leads.next_followup_date` is currently write-only, set from `ActivityLog`
but never read back anywhere), was deliberately deferred to its own future
prompt — don't build it as a side effect of an unrelated change. Home also
has a top-right corner area, visually separate from the three tiles, with
**Settings** (owner-only, same `isOwner` check `AppNav` already uses) and a
new **Account** link (`/account`, `src/pages/Account.jsx` — both roles, a
minimal read-only Name/Role/Mobile/Email display plus a Log out button that
calls the same `signOut()` `AppNav`'s existing logout button already uses;
no self-service editing, wasn't asked for). `AppNav` briefly gained a `Home`
NavLink too, then lost it again one round later along with the rest of its
link row — see the routing paragraph below for where that ended up.

CRM UI/data benchmarking (research pass, no code): compared this app's
navigation/layout/flow against Zoho/Salesforce/HubSpot, and separately
grepped the schema against `src/` for columns/tables with zero UI — not
tied to a roadmap phase, just a checkpoint before the next round of polish.
Findings and the resulting roadmap (bottom tab bar, a unified per-lead
activity timeline, a Kanban board, plus deferred items: global search, a
`plans`-table screen, funnel/loss-reason/product-mix reporting) aren't
duplicated here — see the three items actually built below. The biggest
"schema exists, no UI" findings if picked up later: the `plans` table is
100% unused anywhere in `src/`, and `stage_history`/`loss_reasons` are
collected but never fed into a funnel or loss-reason report.

Bottom tab bar + unified activity timeline + Kanban board (the first three
items off that roadmap, one round after it): fixes the "no way back to
Home" gap the brand-only top bar left (see the routing paragraph below),
gives a lead's own page a merged view of everything that happened on it
(previously `activities` was never queried on `LeadDetail` at all — only
`stage_history` was, so logged site visits/calls/RFQs/booking updates were
invisible there), and adds a read-only board visualization of the existing
"Leads by stage" data alongside its table view. See the routing paragraph,
the LeadDetail section, and the Dashboard section below for specifics.

Global search + three reporting cards (the last two roadmap items, one
round after A/B/C): a new **Search** tab on `BottomNav`
(`src/pages/Search.jsx`) searching parties/sites/leads at once, replacing
the reality of five separate scoped search boxes with no way to search
everything together; and three new Reports-tab cards, all built from data
already being collected with zero new data entry — a sales funnel +
avg-days-in-stage (`SalesFunnelCard.jsx`, from `stage_history`), a
**owner-only** "why we lose" breakdown (`LossReasonsCard.jsx`, from
`loss_reasons` — RLS itself restricts SELECT to owners, not a UI choice),
and a "Leads by product" card (reuses `LeadsByCategoryCard.jsx`, no new
component). See the Search and Dashboard sections below for specifics,
including a real data-completeness bug caught and fixed during live
verification of the funnel card (see the Dashboard section's Sales funnel
bullet). The two remaining roadmap items — a `plans`-table screen and
role-differentiated Home content — are still open; `plans` in particular is
still 100% unused anywhere in `src/`.

## Stack

- React 19 + Vite
- `vite-plugin-pwa` for PWA support (manifest + service worker), configured in `vite.config.js`
- Plain CSS (no CSS framework chosen yet)
- Oxlint for linting (`npm run lint`)

## Structure

```
src/
  components/   reusable UI pieces (ProtectedRoute, AppNav, BottomNav,
                PartySearchOrCreate, SiteSearchOrCreate, LeadSearchSelect,
                the four LeadDetail *Section components plus
                LeadActivityTimeline, DateRangeSelector, ActivityCountsCard,
                LeadsBySourceCard, ClosureForecastCard, TargetsVsActualsCard,
                SetTargetForm, LeadsListCard, LeadsByCategoryCard,
                LeadStageBoard, SalesFunnelCard, LossReasonsCard,
                PartiesCard, AddEmployeeForm, ManageEmployeesSection,
                DeleteLeadSection, InstallPrompt, OfflineIndicator)
  pages/        top-level views (Login, Home, Account, Search, Dashboard,
                LeadQuickCapture, LeadDetail, ActivityLog, Settings, ...)
  contexts/     AuthContext — session + employee (id/name/mobile/role) lookup
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js, leadStageOptions.js, lossReasonOptions.js,
                activityTypes.js, sourceTypeOptions.js, dateRanges.js,
                dashboardQueries.js, searchQueries.js, format.js,
                targetMetrics.js, targetPeriods.js, targetQueries.js,
                partyQueries.js, employeeQueries.js, homeTiles.js)
  assets/       images, icons, etc.
```

Routing is set up in `App.jsx` (`react-router-dom`): `/` (Home, all roles —
the landing page after login), `/account`, `/search`, `/dashboard`,
`/leads/new`, `/leads/:id`, `/activity` — all allow both `sales_executive`
and `owner` — plus `/settings` (**owner-only**). `ProtectedRoute` handles the
redirect-to-login and role gating (redirecting to `/` on a role mismatch,
e.g. a sales exec hitting `/settings`); `AuthContext` is the single source
of truth for "who's logged in and what's their role" — look up an
employee's role via `useAuth()`, don't re-query `employees` directly in a
component. `ProtectedRoute` renders `AppNav` (top) and `BottomNav`
(`src/components/BottomNav.jsx`, fixed bottom) around `{children}`
(wrapped in a plain `.app-body` div purely so one shared CSS rule —
`ProtectedRoute.css` — can pad every page's bottom clearance for the fixed
bar, instead of touching all 7 pages' own CSS files) once auth/role checks
pass. `AppNav` went through three rounds: full link row → brand + Log out +
Settings → brand + Log out only, at which point there was **no nav-bar way
back to `/`** at all (a real gap, hit almost immediately after the third
round). `BottomNav` is the fix, following the mobile-CRM-standard pattern
(a persistent bottom tab bar, not a return to a top link row) surfaced by
the CRM UI benchmarking pass above: **Home** / **Search** / **Account** /
**Settings** (owner-only, same `employee?.role === 'owner'` check `AppNav`
used to carry) — **Search** (`src/pages/Search.jsx`) was added one round
later, deliberately placed here rather than a Home tile or an `AppNav`
entry, to keep every piece of primary navigation in the one place this app
has been consolidating toward all along. Active tab highlighted the same
way `.app-nav-settings-active` used to. Sized off one shared CSS var,
`--bottom-nav-height` (`src/index.css`),
so the bar's own height and every page's clearance padding can't drift
apart; also accounts for `env(safe-area-inset-bottom)` (requires
`viewport-fit=cover` on `index.html`'s viewport meta, added alongside this)
so it doesn't sit under the iOS home-indicator gesture area on this
already-installable PWA. `AppNav` itself is back to just brand + Log out —
Settings moved to `BottomNav` instead of existing in both places. Home
(`src/pages/Home.jsx`) dropped its own top-right Settings/Account corner
links for the same reason — redundant once both are globally one tap away
on every screen, not just Home.

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
  broke duplicate checking across reps). Takes a `typeOptions` prop (default:
  all six `party_type` values) that narrows the create form's Type dropdown;
  a single-value list (e.g. `['client']`) hides the Type field entirely and
  uses that value directly — `LeadQuickCapture`'s Client name field doesn't
  need to ask, it's always `'client'`. See its own section below.
* `SiteSearchOrCreate` — Area picked first (from `areas`), then debounced
  search on `sites.locality`/`house_no` scoped to that `area_id`; site_stage
  is a preset dropdown + "Other…" free text (deliberately not a CHECK enum).
  `onSelect(site | null)`. Optional `discoveredVia` prop passes through
  `source_type` (e.g. Scanning) without exposing it as a field.

Reuse these for any future party/site picker — don't write another search input.

### Search (`src/pages/Search.jsx`)

Global search, reachable via `BottomNav`'s **Search** tab, both roles.
Deliberately **not** built on `PartySearchOrCreate`/`SiteSearchOrCreate` —
this searches across all three entities at once and neither party nor site
results are meant to be created inline here (this is a lookup screen, not
an intake screen). `src/lib/searchQueries.js`'s `searchAll(term)` is a
two-step query, not embedded-relation ILIKE filtering (no precedent for
that anywhere in this codebase, and it's fragile PostgREST syntax): first
searches `parties` (name/mobile) and `sites` (nickname/locality/house_no)
directly — same `.or()` + `sanitizeForIlike` pattern as the search-before-
create components, just without `SiteSearchOrCreate`'s hard area scope
(global search shouldn't require picking an area first) — then takes the
matched party/site ids and finds every `leads` row linked to any of them
via a plain `.or('party_id.in.(...),site_id.in.(...)')`, fully precedented,
RLS applies normally. Results render in three sections: **Leads** are
clickable (`<Link to="/leads/:id">`) since that's the one entity with a
real detail page; **Parties**/**Sites** are read-only lookup rows — **there
is no `/parties/:id` or `/sites/:id` page anywhere in this app** (confirmed
before building this), so those results can't link anywhere, matching the
existing "search before create" duplicate-check use case rather than
pretending to be a navigation target.

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

The sales_executive landing screen at `/leads/new` (owner can access too) —
deliberately not a structured form: three optional fields (Client name, Site
nickname, Other's name) plus a required Scanning/Lixil/Referral tap-select
(three buttons, not a dropdown). Validation is exactly `lead_needs_an_anchor`:
at least one of the three fields filled.

* Quick-select maps to `source_type`/`discovered_via` as
  `scanning`/`lixil`/`referral_architect` only — `referral_other`/
  `showroom_walkin` aren't reachable here.
* Client name and Other's name each use their own `PartySearchOrCreate`.
  Client name passes `typeOptions={['client']}` — they're always a client,
  so the Type field doesn't show at all. Other's name passes
  `typeOptions={['architect', 'builder', 'pmc', 'other']}` — narrower than
  the full `party_type` list, deliberately excluding `client` (that's what
  the Client name field is for) and `firm` (not a realistic "other" on this
  screen); `pmc` was added as a `party_type` value specifically for this
  field, matching its label ("architect / PMC / anyone else").
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
(source/stage/**owner**/party/site/created — owner added in the dashboard-
expansion round, via `employees!owner_employee_id(name)` embedded on the
initial `leads` select) plus up to five independent sections, each with its
own Save button and saving/error/success state (saving one never touches the
others) — **but only if `canEdit`** (`isOwner || lead.owner_employee_id ===
employee.id`). A sales exec viewing a lead that isn't theirs sees the
read-only summary plus a plain notice instead of the five edit sections;
RLS was already refusing the actual UPDATE for them, this just stops them
from being shown forms that would fail on save. Each section's own save
query (`LeadStageSection`, `SalesProgressSection`) does a bare `.select()`
with no `employees` embed, so `LeadDetail` **merges** the returned row into
existing state (`setLead((prev) => ({ ...prev, ...updated }))`) rather than
replacing it wholesale — a plain replace would silently drop `lead.employees`
(the owner's name) after the first edit.

* **Activity** (`LeadActivityTimeline.jsx`, always shown, right after the
  summary block and **before** the `canEdit` gate — so even a read-only
  viewer sees it) — a merged, newest-first feed of `stage_history` (append-
  only stage changes) and `activities` filtered by `lead_id` (site visits,
  calls, RFQs, booking updates logged via `ActivityLog`). Before this
  existed, `LeadDetail` never queried `activities` at all — everything
  logged against a lead was invisible on the lead's own page. Newest-first
  is a deliberate departure from the old stage-only list's oldest-first
  order (matches how every CRM benchmarked above orders a record's activity
  feed); this is a new unified component, not an extension of the old one.
  **Known RLS asymmetry, not a bug**: `stage_history` SELECT is open to
  everyone, but `activities` SELECT is "own data or owner role" — so a
  sales exec viewing a colleague's lead sees the full stage history but an
  empty activity feed for activities they didn't log themselves. Same
  category as the existing `PartiesCard` "Worked with" caveat below.
* **Stage** (`LeadStageSection.jsx`, always shown) — `current_stage` selector
  (suggested new/hot/rfq/quote/negotiation/won/lost + "Other…" free text,
  same pattern as `site_stage`). Every change updates `leads.current_stage`
  and inserts a `stage_history` row (`lead_id`, `stage`, `changed_by`,
  `changed_at`) — no longer rendered inline here now that
  `LeadActivityTimeline` covers it (see above); this section only owns
  changing the stage and the loss-reason prompt. Setting the stage to
  `lost` immediately opens an inline `loss_reasons` prompt (reason +
  optional competitor name) with **no skip option** — "Save reason" is the
  only way to dismiss it, since a rep must always account for why a lead
  was lost.
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
  closure probability (0–100 number input, matches the `closure_probability`
  CHECK) and estimated close date (always-visible, not gated behind a
  checkbox like the RFQ/quote fields), straight fields on `leads`. These
  last two are what the Phase 5 closure forecast dashboard reads.

`sites`/`parties` UPDATE had to move off owner-only RLS to "own data or
owner role" for Site/Client details to work for a regular sales exec — a
real blocker found while building this screen, not preemptive.

### ActivityLog (`src/pages/ActivityLog.jsx`)

DPR replacement at `/activity`. Tap one of Site Visit/Call/RFQ Raised/Office
Day/Booking Update; every type except Office Day then shows
`LeadSearchSelect` (select-only, scoped to the current employee's own leads
via `owner_employee_id`). Office Day skips this step entirely (matches the
loosened `activity_needs_an_anchor` CHECK — see `Schema/tostem_crm_schema.sql`).

* The `PartySearchOrCreate` (`allowCreate={false}`) anchor picker only shows
  alongside Site Visit and Booking Update — Call and RFQ Raised dropped it,
  so those two **require** a lead (no party fallback for them); Site
  Visit/Booking Update keep the original "lead, party, or both" flexibility.
  `selectActivityType` clears `selectedParty` when switching to a type that
  hides the field, so a stale invisible selection can't get submitted.
* "Accompanied by" (optional, `employees` dropdown excluding yourself) only
  shows for Site Visit — going out to scan/visit a site is the one activity
  where bringing a colleague along is a normal, trackable thing; it doesn't
  apply to a phone Call, paperwork (RFQ Raised/Booking Update), or Office
  Day. Same clear-on-switch behavior as Party.
* Common fields: notes (textarea). Office Day additionally gets a numeric
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

### Dashboard (`src/pages/Dashboard.jsx`)

Single page at `/dashboard`, reachable by both roles from `AppNav` — no
separate owner/sales-exec page. Role branching is just one derived boolean:
`isOwner = employee?.role === 'owner'` toggles `showByEmployee` on the
breakdown cards below. The same Supabase queries (`src/lib/dashboardQueries.js`)
serve both roles unchanged — RLS already scopes `activities`/`leads` to "own
data or owner role", so a sales exec's query naturally returns only their own
rows with no client-side filter needed.

Three in-page tabs (plain `useState`, not routes — `activeTab`), so the page
doesn't turn into one long scroll: **Reports** (default) holds everything
below, including the three category-breakdown cards; **My Leads**/**All
Leads** holds `LeadsListCard`; **Parties** holds `PartiesCard`. All of
`Dashboard.jsx`'s data-fetching effects run regardless of which tab is
active (the data is light enough that this isn't worth lazy-loading) — only
`LeadsListCard` fetches independently, since it's not part of the
date-range-scoped report data at all. The three category-breakdown cards
were originally their own tabs (By Stage/By Area/By Site Stage) for about
one edit — moved into Reports instead once it became clear that's where they
actually belonged; don't reintroduce them as separate tabs without checking
first.

* **Date range** (`DateRangeSelector.jsx`) — This Week (Monday–today) / This
  Month / Custom (two date inputs). Computed by `src/lib/dateRanges.js`;
  an incomplete custom range returns `null` and the page shows a prompt
  instead of querying.
* **Activity counts** (`ActivityCountsCard.jsx`) — counts by `activity_type`
  for the selected range; team total table always shown, plus a
  per-employee breakdown table when `showByEmployee` (owner only).
* **New leads by source** (`LeadsBySourceCard.jsx`) — same shape, grouped by
  `source_type` instead, keyed by `owner_employee_id` for the breakdown. A
  sales exec only sees Scanning/Showroom Walk-in rows (`SALES_EXEC_SOURCES`)
  — Lixil and referrals are distributed by the owner, not something a rep
  sources themselves, so showing all 5 rows to them was mostly zeros. Owner
  still sees all 5. The card's "Total" row reflects whichever subset is
  visible, not every lead in range, so it never looks inconsistent with the
  rows above it.
* **Closure forecast** (`ClosureForecastCard.jsx`) — leads not `won`/`lost`
  where `quote_sent` is true or `closure_probability` is set, sorted by
  `estimated_close_date` ascending (nulls last). Deliberately **not**
  date-range-scoped — it's a snapshot of the current pipeline, not tied to
  when leads were created. `closure_probability`/`estimated_close_date` are
  set via `SalesProgressSection` on `LeadDetail` (see above) — both fields
  now have a real data-entry path, closing the gap this card started with.
  Shows an **Owner** column (`employees!owner_employee_id(name)` embedded on
  `fetchClosureForecast`) — part of the dashboard-expansion round's "show
  the lead's owner wherever a lead appears" pass.
* **Targets vs. actuals** (`TargetsVsActualsCard.jsx`) — shown only for This
  Week/This Month (Custom shows an explanatory message instead — `targets`
  rows are keyed by `period_type`/`period_value`, not arbitrary ranges).
  `metric_name` is a **closed** list (`src/lib/targetMetrics.js`: the five
  `ACTIVITY_TYPES` values plus `order_value`), deliberately not the
  "suggested options + Other…" free-text pattern used for `current_stage`/
  `site_stage` — an arbitrary metric would have a target but no computable
  actual, which defeats the section. Actuals for the five activity-type
  metrics are a straight count from the *same* `activities` array
  `ActivityCountsCard` already fetched for the period — no duplicate query.
  `order_value` has no timestamp of its own, so its actual is approximated
  via `stage_history`: sum `order_value` for leads whose most recent
  `stage_history` row with `stage = 'won'` falls inside the period
  (`fetchWonStageHistory` in `src/lib/targetQueries.js`, deduped client-side
  to one row per lead since the query is pre-sorted `changed_at` desc) — a
  deliberate, discussed approximation, see DECISIONS.md. Every
  (employee × metric) combination is shown for the period, even with zero
  activity and no target row — `no target set` is rendered explicitly rather
  than the row being silently omitted. For the owner, a "Sales exec" filter
  (local `useState` inside the card, defaulting to "— All employees —") sits
  above the table — picking one narrows the same `employees` array the table
  already iterates over down to a single entry, reusing the existing
  render logic rather than a separate code path; showing every employee's 6
  rows stacked at once got unreadable fast as more than one or two employees
  existed. `src/lib/targetPeriods.js` computes
  the This Week/This Month `period_type`/`period_value` (ISO 8601
  Monday-start week, matching `dateRanges.js`'s week boundary) — shared by
  both the lookup query and `SetTargetForm`'s prefill, so they can't drift
  out of sync with each other.
* **Set a target** (`SetTargetForm.jsx`, inside the same card, **owner-only in
  the UI**) — employee/period_type/period_value/metric_name/target_value,
  the only way to populate the previously-empty `targets` table. Owner-only
  is a UI-layer choice, not an RLS one — `targets`' `own_data_or_owner_role`
  INSERT policy still technically lets a sales exec insert their own row.
  `period_type` is restricted to week/month in this form (the DB CHECK also
  allows `year`, but nothing on this dashboard displays a year-keyed target
  yet); `period_value` auto-prefills from `targetPeriods.js` when
  `period_type` changes but stays editable, so a future period can be set in
  advance. A successful insert is appended straight into `Dashboard.jsx`'s
  `targets` state (`onTargetCreated`) so the table above updates immediately,
  no reload needed.
* **Leads by stage / by area / by site stage / by product**
  (`LeadsByCategoryCard.jsx`, one generic component now reused 4×) — count +
  `order_value` sum, grouped by `current_stage` / the lead's site's area /
  the lead's site's `site_stage` / `products.name`. Pipeline snapshots like
  Closure forecast, **not** date-range-scoped — "how many leads are in each
  category right now", not "how many arrived in a period" — fed by one
  shared unbounded query, `fetchLeadsForBreakdown` in `dashboardQueries.js`
  (now also selects `owner_employee_id, parties!party_id(name),
  employees!owner_employee_id(name)`, `sites(nickname, locality, ...)`, and
  `products!product_id(name, category)` on top of the original columns —
  added incrementally for the Kanban board and Product card below, but
  harmless extra fields for the other table cards too, same "redundant but
  harmless" pattern as the Owner column shown everywhere), fetched once and
  reused across all four cards plus the board. `categoryOrder` (optional
  prop) pins a fixed set of buckets in a fixed order, shown even at zero
  count, so "no leads at this stage" is visible rather than the row not
  existing — Stage uses `LEAD_STAGE_OPTIONS` (`src/lib/leadStageOptions.js`,
  extracted out of `LeadStageSection.jsx` so the two can't drift), Site
  Stage uses `SITE_STAGE_OPTIONS` plus `'Not set'`/`'No site'`; Area and
  Product have no fixed list (both come from a table, not a suggested list)
  so their buckets are discovered from the data and sorted by count desc
  instead — Product falls back to `'Not specified'`, matching
  `SalesProgressSection`'s own "— Not specified —" label for an unset
  `product_id`.
* **Leads by stage — Table/Board toggle** (`stageView` state in
  `Dashboard.jsx`, default `'table'`) — the Stage instance specifically
  (not Area/Site Stage, which have no meaningful "pipeline" reading) can
  switch to `LeadStageBoard.jsx`, a **read-only** Kanban-style board:
  columns = `LEAD_STAGE_OPTIONS`, same order as the table's
  `categoryOrder`; each column header shows the stage name + count +
  summed `order_value` (same aggregate the table already computes,
  rendered differently); each card is a `<Link to="/leads/:id">` (party
  name → site nickname/locality → `'(no party)'` fallback chain, matching
  `LeadsListCard`'s), showing order value and — owner-only — the lead's
  owner name. Deliberately **not** drag-and-drop: a card click opens
  `LeadDetail`, where the actual stage change happens through the existing,
  already-correct flow (mandatory loss-reason prompt, `stage_history`
  logging, ownership checks) — reimplementing that as a drop-to-change
  interaction was considered and explicitly deferred, not an oversight.
  Toggle buttons reuse the existing `.dashboard-range-btn`/`-active` style
  (the same one This Week/This Month already use), not a new button style.
  Columns scroll horizontally (`overflow-x: auto`, same convention as
  `.dashboard-table-wrap`); each column's card list scrolls independently
  past a max-height.
* **Sales funnel** (`SalesFunnelCard.jsx`) — reach-count + avg-days-in-stage
  per `LEAD_STAGE_OPTIONS` stage, from `fetchStageHistoryForFunnel` in
  `dashboardQueries.js` (`stage_history` joined to `leads(owner_employee_id)`).
  `stage_history` SELECT is open to *everyone* (unlike `leads`/`activities`)
  — the embedded `leads` comes back `null` for a sales exec's rows on leads
  they don't own (RLS on the embed), dropped client-side to get the same
  "own data or owner role" scoping every other card gets for free; exact
  same trick `fetchWonStageHistory`/`computeOrderValueActuals`
  (`TargetsVsActualsCard.jsx`) already established — this is the only other
  place in the codebase that needed it. **Real bug caught during live
  verification, not hypothetical**: `stage_history` only logs the
  *destination* of an explicit stage change — a lead that goes straight
  `new → lost` gets exactly one row (`'lost'`), never a `'new'` row, since
  the initial `'new'` is a DB default, not a logged "change". An
  implementation that only reads `stage_history` therefore silently
  undercounts `'new'` (and any lead untouched since creation has *zero*
  history rows at all). Fixed by seeding every lead's reached-set with both
  `'new'` (true for all of them, by schema default) and its own
  `current_stage` from `breakdownLeads` (already fetched, already
  RLS-scoped normally), *then* widening with whatever's actually in
  `stage_history` — avg-days-in-stage is unaffected, since it only reflects
  actual logged transitions, which is the correct thing to measure there.
  One team-wide table, deliberately **no** per-employee breakdown — funnel
  shape is a whole-pipeline metric, not a per-rep tally like the other
  cards.
* **Why we lose** (`LossReasonsCard.jsx`, **owner-only** — `{isOwner && ...}`
  in `Dashboard.jsx`, and the fetch itself is skipped entirely for a sales
  exec rather than firing a request that RLS would just return empty) —
  count per `reason`, fixed bucket order via `LOSS_REASON_OPTIONS`
  (`src/lib/lossReasonOptions.js`, extracted out of `LeadStageSection.jsx`
  the same way `LEAD_STAGE_OPTIONS`/`SITE_STAGE_OPTIONS` were, so the "why
  was this lost" prompt and this report can't drift apart), plus a small
  named-competitors list below (from `loss_reasons.competitor_name` —
  captured on every loss already, displayed nowhere until this card).
  `loss_reasons` SELECT requires `role = 'owner'` in RLS itself (see the RLS
  convention below) — this card being owner-only is a hard constraint the
  policy enforces, not a UI-layer nicety like `SetTargetForm`'s gating.
  Verified live against a genuine second `sales_executive` session (not
  just reasoned through) — the card is correctly absent entirely.
* **Parties** (`PartiesCard.jsx`, the third tab) — every party ever created
  (`fetchAllParties` in `src/lib/partyQueries.js` — `parties` SELECT is open
  to everyone, so this is the same full directory regardless of role), with
  a Type filter dropdown and a client-side name search. A **"Worked with"**
  column shows which employee(s) own a lead connected to that party (as
  `party_id`, `other_party_id`, or `referred_by_party_id`) — derived
  client-side from `fetchPartyEmployeeLinks` (all `leads` rows, RLS-scoped)
  by `buildEmployeeMap`, not a stored relationship. **RLS caveat**: a sales
  exec's `leads` query only ever returns their own leads, so they'll only
  ever see themselves in this column, even when another rep has also worked
  with that party — full multi-employee associations are only visible to
  the owner. Not a bug, just what "own data or owner role" RLS means applied
  to a derived, cross-lead computation like this one.
* **My Leads / All Leads** (`LeadsListCard.jsx`, the second tab) — a
  browsable table of individual leads (Party/Site/**Owner**/Source/Stage/
  Order value/Created — the Owner column shows for both roles now, not just
  owner; for a sales exec it's trivially always themselves, but "wherever a
  lead appears, show its owner" won out over trimming a redundant-but-
  harmless column), party name links to `/leads/:id`, `fetchLeadsList` in
  `dashboardQueries.js`, ordered `created_at` desc, capped at 100.
  Deliberately **not** wired to the Reports tab's date-range selector — it's
  a browse/lookup tool, not a period report, so it stays independent of
  `preset`/`range`. For the owner, a "Sales exec" filter (`employeeFilter`
  state, default "— All employees —") re-queries with
  `.eq('owner_employee_id', ...)`; for a sales exec, RLS already scopes the
  query to their own leads, so the filter doesn't render at all — same
  `isOwner`-driven pattern as the rest of the page. This is the app's first
  browsable list of leads at all (previously leads were only reachable one
  at a time via a direct `/leads/:id` link or buried inside the
  `LeadSearchSelect` picker). Also reused, unmodified, by Settings' Delete a
  lead section (see the Settings section below) — same query, different
  page.
* **History note**: a dedicated `LeadsByAreaCard.jsx` (grouped leads by
  area) shipped in Phase 5, was removed one round later in the interface
  simplification pass as unnecessary, then came back one round after *that*
  in the dashboard-expansion round — but as one of the three
  `LeadsByCategoryCard` uses above, not as its own file. `LeadsByAreaCard.jsx`
  itself stays deleted; don't recreate it — the generic component covers
  the same ground plus Stage and Site Stage.
* `ACTIVITY_TYPES`/`ACTIVITY_LABELS` moved out of `ActivityLog.jsx` into
  `src/lib/activityTypes.js` (canonical, kept in sync with the
  `activities.activity_type` CHECK) so the dashboard can't drift from it —
  `ActivityLog.jsx` now imports from there instead of defining its own copy.
  `src/lib/sourceTypeOptions.js` is the dashboard-only equivalent for the
  full 5-value `source_type` CHECK list — `LeadQuickCapture`'s own
  `SOURCE_OPTIONS` stays a deliberate 3-value subset and was left untouched.
  `formatCurrency` (INR, `₹` + `en-IN` grouping) was pulled out of
  `ClosureForecastCard.jsx` into `src/lib/format.js` once `TargetsVsActualsCard`
  and `LeadsListCard` needed the same formatting.

Verified against real data by driving the actual UI (New Lead → Activity Log
→ Sales progress), since the dev project's `leads`/`activities` tables
started out empty — this left a real "Dashboard Test Client" / lead #8 in
the live database, and lead #8 carries a real `closure_probability`/
`estimated_close_date` (70% / 2026-08-15) set through `SalesProgressSection`.
The targets-vs-actuals build was verified further: logged a real Booking
Update activity on lead #8 (`order_value` 200000), marked it `won` via
`LeadStageSection`, and confirmed `order_value` actual correctly picked up
₹2,00,000 for This Week (and that closure forecast correctly dropped the
lead once it was `won`); separately, set a real target through
`SetTargetForm` (Raywant / week / 2026-W30 / call / 5) and confirmed it
appeared as a live 1-vs-5 actual/target row without a reload, persisted
correctly in the database, and correctly showed `no target set` again under
This Month (proving period-scoping, not just "always matches"). Owner-only
DELETE now exists on `leads`/`activities`/`targets` (see the RLS convention
below), so this data can be cleaned up if wanted, but wasn't removed
automatically.

The interface simplification pass was verified the same way, against a
second real employee ("Test Sales Exec") that now exists in the live
project alongside Raywant (owner): confirmed the Client name create-form has
no Type field, the Other's name create-form's Type options are exactly
architect/builder/pmc/other (creating a `pmc` party currently fails —
expected, the schema change hasn't been applied live yet), Party/Accompanied
by show and hide correctly across all five activity types, both Dashboard
tabs render real data, the Sales exec filter narrows All Leads and Targets
vs. actuals correctly, and New leads by source's owner view still shows all
5 sources. Not independently verified live: the exact sales-exec-role
rendering of the trimmed source list / "My Leads" heading / no-employee-
filter behavior — didn't have that account's login credentials this round,
so this rests on the same `showByEmployee`/`isOwner` prop pattern already
proven correct elsewhere on this page, not a fresh screenshot.

### Settings (`src/pages/Settings.jsx`)

Owner-only page at `/settings`. Three independent sections, `employees`
state lifted to the page and shared between the first two (`upsertEmployee`
updates-in-place-or-appends, keeping both sections in sync without a
re-fetch):

* **Add employee** (`AddEmployeeForm.jsx`) — name/role/Auth User ID (UUID)
  → inserts an `employees` row (`insertEmployee` in
  `src/lib/employeeQueries.js`). **Only creates the CRM-side record.**
  Creating the actual Supabase Auth login (the part that lets someone log
  in) can't be done from here, or from the browser at all, without exposing
  a secret that must never reach client code: Supabase's admin API
  (`auth.admin.createUser()`) needs the `service_role` key, and that key
  bypasses RLS entirely — putting it in frontend code would let anyone open
  devtools and read/write the whole database as any user. The only correct
  way to add that automation later is a small server-side function (a
  Supabase Edge Function, using `service_role` only in server-side code that
  never ships to the browser) that this project doesn't have yet. Until
  then, the owner still creates the Auth user manually in the Supabase
  dashboard (Authentication → Users → Add user, with "Auto Confirm User" on)
  and pastes the resulting UUID into this form — this form only saves the
  second, previously-also-manual step of inserting the matching `employees`
  row. Leaving the UUID blank is allowed (creates an unlinked record,
  linkable later by editing `auth_user_id` directly in Supabase).
* **Manage employees** (`ManageEmployeesSection.jsx`) — lists every
  employee with an editable role dropdown (+ per-row Save, only enabled
  when changed) and an Active/Inactive toggle (`is_active` — a schema
  column that existed since Phase 1 but had no UI anywhere until now; the
  schema's own comment calls it out: "deactivate, never delete a person
  with history"). **Both controls are disabled for the currently logged-in
  owner's own row** (`isSelf = emp.id === currentEmployeeId`) — RLS's
  `owner_only_update` policy on `employees` checks that the *caller* is an
  owner, not that a row being edited stays an owner, so without this an
  owner could technically demote or deactivate themselves via this exact
  screen and lock themselves out. This guardrail is UI-only, same category
  as `SetTargetForm`'s owner-only gating — a deliberate, narrower rule
  layered on top of a more permissive RLS policy, not a reflection of what
  RLS itself blocks.
* **Delete a lead** (`DeleteLeadSection.jsx`) — reuses `fetchLeadsList(null)`
  (same query `LeadsListCard` uses, all leads, capped at 100) with a
  client-side search box, and a two-step confirm (click Delete → inline
  "Delete #N?" with Confirm/Cancel) before the actual `deleteLead` DELETE
  fires — a deliberate extra step given this is genuinely irreversible.
  RLS's `owner_only_delete` policy on `leads` is the real enforcement; this
  UI is owner-only too, so the two layers agree.

The dashboard-expansion round was verified end to end, all as the owner
(Raywant) against the live database, with "Test Sales Exec" providing the
second employee needed for multi-employee views: Reports tab renders the
three new breakdown cards correctly (e.g. stage totals summed to the same 4
leads shown elsewhere); Parties tab's type filter/search and "Worked with"
column matched the known party/lead data; `LeadDetail` showed the correct
Owner line and full edit access on both a self-owned lead and one owned by
Test Sales Exec (confirming the owner-role bypass); Settings' employee
Active/Deactivate toggle was exercised on the Test Sales Exec row and
confirmed to persist and revert correctly via direct REST checks, with
Raywant's own row's controls confirmed disabled; and the Delete a lead flow
was proven for real — created a throwaway lead via the actual New Lead
screen, deleted it through Settings' search → Delete → Confirm flow, and
confirmed via a direct database check that it was actually gone. Not
independently verified: the Add employee form's submit path (skipped
creating a real employee row purely to avoid cluttering the Manage
Employees list — the insert call is the same pattern already proven working
by `SetTargetForm` and `PartySearchOrCreate`), and everything that requires
the sales-exec account's own login (same limitation noted for the interface
simplification pass above).

### PWA installability (`src/components/InstallPrompt.jsx`, `OfflineIndicator.jsx`)

Icons were generated from `src/assets/VIPSAR PWA icon design.pdf` — the
brand asset actually present in the repo (a raw `logo-source.png` was never
added despite that being the original plan). The PDF's artwork already had
rounded corners baked in, which is wrong for a maskable icon (Android
expects a flat, full-bleed square and applies its own mask shape), so the
"V" mark was extracted pixel-precise (exact fill colors sampled from the
PDF's vector path/Type3 glyph: `#0f1216` background, `#f8f5ee` mark) and
recomposited onto a plain full-bleed square with no pre-rounding, at
matching proportions across all sizes. Confirmed the mark sits well inside
the maskable 80%-diameter safe-zone circle (measured half-diagonal ≈0.27×
icon size, vs. the 0.4× limit) — same generation script, not hand-tuned per
size. The regeneration script itself was a one-off (Python + Pillow, run
from the scratchpad), not checked into the repo — regenerate by hand if the
logo ever changes.

`vite.config.js`'s `workbox.globPatterns` is scoped to
`**/*.{js,css,html,svg,png,ico,webmanifest}` — this precaches the app shell
only. No `runtimeCaching` rule was added for Supabase, so API calls are
untouched by the service worker and always hit the network (fail honestly
offline instead of silently serving stale data). `devOptions.enabled: true`
was tried, to get a service worker running under `npm run dev` too, and then
reverted — workbox's dev-mode precache went stale on every source edit
(kept serving an old `index.html` after an unrelated change), which is worse
than no SW in dev. **Test real PWA/offline behavior via
`npm run build && npm run preview`, not `npm run dev`** — see the
`tostem-crm-preview` launch config below.

* `InstallPrompt.jsx` — Chrome/Android: listens for `beforeinstallprompt`,
  captures the event, shows a dismissible banner whose Install button
  replays the captured event's `.prompt()`. iOS Safari: detected via UA
  sniffing specifically (excludes Chrome/Firefox/Edge-on-iOS, which report
  `CriOS`/`FxiOS`/`EdgiOS` in the UA; handles iPadOS 13+'s Mac-spoofed UA via
  a `platform === 'MacIntel' && maxTouchPoints > 1` fallback), shows a "Tap
  Share, then Add to Home Screen" hint since `beforeinstallprompt` never
  fires there. Both dismissals are `sessionStorage`-backed (key per
  platform), not shown again for the rest of the session; the whole
  component renders nothing if already running standalone
  (`display-mode: standalone` or `navigator.standalone`).
* `OfflineIndicator.jsx` — sticky banner driven by `window`'s `online`/
  `offline` events, warns that submissions won't save until reconnected.
  Deliberately no background sync / auto-retry of failed submissions once
  reconnected, and no special handling for iOS's more aggressive
  cache-clearing on inactive PWAs — both real but bigger pieces, explicitly
  out of scope for this pass.
* Both mount globally in `App.jsx`, above `<Routes>` and outside
  `ProtectedRoute`/`AppNav` entirely — so they show on `/login` too, not
  just logged-in screens.

Verified via a production build served with `vite preview`: manifest,
all four icons, and `apple-touch-icon` all resolve with correct
content-type; the service worker registers, activates, and takes control of
the page. Then — instead of relying on devtools network throttling —
**the actual preview server process was killed** and the tab reloaded: every
request (HTML/JS/CSS/icons) still returned 200, served entirely from the
service worker's cache, proving the app shell genuinely loads with zero
signal rather than just passing a simulated-offline check. The Install
banner was exercised end-to-end by dispatching a synthetic
`beforeinstallprompt` (Chrome's real installability heuristics don't fire it
reliably from a single automated page load) — Install correctly called
`.prompt()` and hid the banner; dismiss correctly persisted across a reload.
The offline banner was verified the same way, via dispatched `online`/
`offline` events. iOS-Safari detection was unit-verified against 6 real
device UA strings (iPhone Safari, iPadOS's Mac-spoofed UA, iPhone Chrome,
Android Chrome, desktop Safari, desktop Chrome) — all correct. Not
verified: an actual screenshot of the iOS hint rendering (this environment
can't convincingly spoof `navigator.userAgent`) — real iPhone verification
(Share → Add to Home Screen, airplane mode) was left to the user, as planned
going in.

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
`.claude/preview-server.cmd` is a second launch config (`tostem-crm-preview`,
port 4173) that runs `npm run build && npm run preview` — use this one, not
the plain dev server, to test real PWA/service-worker/offline behavior (see
the PWA installability section above for why).

The Browser-pane dev preview persists its Supabase session in localStorage
per-origin, shared across every tab — including tabs a human tester and
Claude open independently. A login for one manual test silently carries over
into later "unauthenticated" checks, producing false-positive real writes.
Confirm which state a test tab is actually in (expect `permission denied`
from an intentionally logged-out check) rather than assuming a fresh tab
means a fresh session.

## Conventions

- Secrets (Supabase URL/keys, etc.) go in a git-ignored `.env` file — never commit them. `.env.example` documents the required variable names with placeholders.
- Keep the `Schema/` folder as reference material; don't auto-apply it to a live database. As of the interface simplification pass, `tostem_crm_schema.sql`'s `parties.party_type` CHECK includes `'pmc'` but **this has not been run against the live database** — confirm before assuming a `pmc` party can actually be saved; the constraint is named `parties_party_type_check` (confirmed live via the exact error it throws today), so `ALTER TABLE parties DROP CONSTRAINT parties_party_type_check, ADD CONSTRAINT parties_party_type_check CHECK (party_type IN ('client','architect','builder','firm','other','pmc'));` is the migration once someone's ready to run it.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
- Row Level Security (full policies in `Schema/rls_policies.sql`): `activities`/`leads`/`plans`/`targets` use "own data or owner role" (by `employee_id`/`owner_employee_id`, or role=`'owner'`) for SELECT/INSERT/UPDATE, plus **owner-only DELETE** (no "own data" exception — a sales exec can create/edit their own rows but can't delete even those; only an owner can). `employees`: SELECT open, INSERT/UPDATE/DELETE owner-only with **no self-update exception** (a sales exec must never set their own `role` to `'owner'`). `sites`/`parties`: SELECT/INSERT open to all (needed for search-before-create across reps), UPDATE is "own data or owner role" (`discovered_by`/`created_by`), DELETE owner-only. `areas`/`site_contacts`: SELECT/INSERT open, UPDATE/DELETE owner-only (shared master data / append-style joins — no per-row "own data" concept applies). `products`: SELECT open, else owner-only. `stage_history`: SELECT/INSERT open, no UPDATE/DELETE ever, for anyone including owner — permanently append-only by design (append-only history log, not a data-entry mistake to be corrected). `loss_reasons`: SELECT owner-only, INSERT open, no UPDATE/DELETE ever, same append-only-forever reasoning. A write needs both the table GRANT (Step A of `rls_policies.sql`) and the RLS policy to agree — DELETE is granted on the ten tables with an `owner_only_delete` policy (`employees`/`areas`/`sites`/`site_contacts`/`parties`/`products`/`leads`/`activities`/`plans`/`targets`); `stage_history`/`loss_reasons` get no DELETE grant at all.

## Roadmap

0. ✅ Environment + scaffold (done)
1. ✅ Supabase project, schema, RLS policies (`Schema/rls_policies.sql`) — confirm they've actually been run
2. ✅ Employee login (Supabase Auth): login screen, AuthContext, protected/role-based routing
3. ✅ Party/site/lead intake screens (search-before-create pattern): `PartySearchOrCreate`, `SiteSearchOrCreate`, quick-capture lead intake (`LeadQuickCapture`), and the "add more details" enrichment screen (`LeadDetail`, including lead stage changes + `stage_history` logging, added after Phase 4) all done
4. ✅ DPR / activity logging (`ActivityLog` at `/activity`) — a screen listing past activities is still not built
5. ✅ Dashboards (replaces manually-tallied Weekly Update / Monthly Prospects
   / Yearly Performance sheets): activity counts, new leads by source,
   closure forecast, targets vs. actuals + owner-only target-setting form —
   all on `Dashboard.jsx`, both roles (see Current state and the Dashboard
   section above). Two rounds of post-Phase-5 refinement followed, not
   numbered as their own phases: an interface simplification pass (party
   types, activity anchors, Dashboard tabs), then a dashboard-expansion
   round (Stage/Area/Site Stage breakdowns, a Parties directory, owner
   visibility everywhere, `LeadDetail` read-only enforcement, and an
   owner-only Settings page for employee management + lead deletion) —
   see Current state for both.
6. ✅ PWA polish (installable, offline-tolerant for field use): full icon
   set, `vite-plugin-pwa` manifest + app-shell-only precaching, a Chrome/
   Android install banner, an iOS Safari "Add to Home Screen" hint, and an
   offline indicator banner — see Current state and the PWA installability
   section above. Out of scope for this pass: background sync/auto-retry of
   failed submissions, and iOS's more aggressive cache-clearing on inactive
   PWAs (both bigger pieces for later). A separate follow-up renamed the
   app's own display name to VIPSAR CRM — see Current state.
7. ⬅️ current — Deploy + pilot with 1-2 sales execs before full rollout

For domain model, lead-sourcing logic, and locked-in design decisions, see DECISIONS.md.
