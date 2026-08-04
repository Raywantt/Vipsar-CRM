# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A CRM for a Tostem window & door dealership: tracking leads, quotes, orders,
and installs. Built as a React + Vite PWA, with Supabase as the backend and
Vercel as the host (deploys from `master`). Used by sales executives mostly
from a phone in the field, often with poor signal — favor mobile-first
layouts, don't assume a reliable connection.

The app's own display name (browser tab title, PWA manifest name/short_name,
login heading, nav brand) is **VIPSAR CRM** — VIPSAR is the dealership
itself; Tostem is the window/door product line it sells. Don't conflate the
two or "fix" one to match the other: schema/doc language ("Tostem CRM
schema", "a Tostem window & door dealership") describes the product domain
and predates the rename, not the app's own brand name.

## Current state

Phases 0–6 are done (full checklist in Roadmap below): schema + RLS, login,
lead intake, activity logging, dashboards, PWA installability. Currently in
**Phase 7 — deploy + pilot**. How each screen works today is documented in
its own section further down; this section is only what a fresh session
needs before touching anything:

- The UI was rebuilt against a design handoff from Claude Design — one
  shared stylesheet (`src/vipsar-theme.css`), no per-page CSS anymore. See
  the Design system section further down before styling or restructuring
  any screen's markup.
- Mobile-first is still the primary design intent, but a real desktop
  layout now exists too (sidebar nav, wider dashboard grid) at ≥1024px —
  see the "Desktop layout" bullet in the Design system section before
  assuming a screen is phone-only or adding new mobile-only markup.
- `parties.party_type`'s `'pmc'` value is in `Schema/tostem_crm_schema.sql`
  but **not yet run against the live DB** — confirm before assuming a `pmc`
  party can actually be saved (exact migration statement in Conventions).
- Deliberately **not built yet** — these need their own discussion first,
  don't add them as a side effect of unrelated work: **Followups**
  (personal + owner-assigned reminders; `leads.next_followup_date` is
  write-only today, set from `ActivityLog` but never read back anywhere),
  a **`plans`-table screen** (the table has full RLS wired up and zero UI
  anywhere in `src/`), **further role-differentiated Home content** beyond
  today's Activity Log tile split (`HOME_TILES` is role-keyed and ready for
  more of this), and **a screen listing past activities** (`ActivityLog`
  only logs new ones; nothing browses old ones outside a lead's own
  timeline).
- `LeadsByAreaCard.jsx` was tried as its own component/tab twice and
  removed both times — permanently merged into the generic
  `LeadsByCategoryCard` instead (see Dashboard section). Don't recreate it.
- Domain model, lead-sourcing logic, and locked-in design decisions ("don't
  reverse without discussion") live in `DECISIONS.md`, not here.

## Stack

- React 19 + Vite
- `vite-plugin-pwa` for PWA support (manifest + service worker), configured in `vite.config.js`
- Plain CSS — one shared design-system stylesheet, `src/vipsar-theme.css`
  (design tokens + `vip-*` component classes), imported in `main.jsx` after
  the now-empty `src/index.css`. No CSS framework, no per-page CSS files —
  see the Design system section below before styling anything.
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
  contexts/     AuthContext — session + employee (id/name/mobile/role) lookup;
                HeaderContext — lets Lead Detail/Dashboard push a dynamic
                sub into AppNav's header (see Design system below)
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js, leadStageOptions.js, lossReasonOptions.js,
                statusColors.js, activityTypes.js, sourceTypeOptions.js,
                dateRanges.js, dashboardQueries.js, searchQueries.js, format.js,
                targetMetrics.js, targetPeriods.js, targetQueries.js,
                partyQueries.js, employeeQueries.js, homeTiles.js)
  assets/       images, icons, etc.
  vipsar-theme.css   the app's one design-system stylesheet — see Design
                system below
```

Routing is set up in `App.jsx` (`react-router-dom`): `/` (Home, landing
page after login), `/account`, `/search`, `/dashboard`, `/leads/new`,
`/leads/:id` — all allow both `sales_executive` and `owner` — plus
`/activity` (**sales_executive-only**, see the ActivityLog section below)
and `/settings` (**owner-only**). `ProtectedRoute` handles the
redirect-to-login and role gating (redirecting to `/` on a role mismatch);
`AuthContext` is the single source of truth for "who's logged in and what's
their role" — look up an employee's role via `useAuth()`, don't re-query
`employees` directly in a component. `ProtectedRoute` renders
`<div className="vip-app">` (the centered app-column shell — see Design
system below) containing `AppNav` (`vip-header`, top), `{children}`
(`vip-body`), and `BottomNav` (`vip-bottom-nav`, fixed bottom — **Home** /
**Search** / **Account** / **Settings**-if-owner). **`BottomNav` is the one
place for primary navigation in this app — don't add nav links back to
`AppNav`.** `AppNav` is a per-route header (title/sub/back button/avatar),
not a nav bar — see Design system. Sized off `vipsar-theme.css`'s
`--vip-header-h`/`--vip-bottom-nav-h` and `env(safe-area-inset-bottom)`
(needs `viewport-fit=cover` on `index.html`'s viewport meta) so the bottom
bar clears the iOS home-indicator gesture area on this installable PWA.

### Design system (`src/vipsar-theme.css`)

Every screen's styling comes from one shared stylesheet, built against a
design handoff from Claude Design. Per-page CSS files (`Dashboard.css`,
`LeadDetail.css`, `Home.css`, etc.) and the shared ones
(`SearchOrCreate.css`, `ProtectedRoute.css`, `AppNav.css`, `BottomNav.css`,
`OfflineIndicator.css`, `InstallPrompt.css`) are all **deleted** — don't
recreate them; add a `vip-`-prefixed class to `vipsar-theme.css` instead of
writing new per-component CSS. `src/index.css` is kept as an intentionally
empty seam (nothing left to own) rather than deleted, since `main.jsx`
imports it before the theme file.

* **App column** — below 1024px, `.vip-app` caps every screen at
  `--vip-app-max` (460px), centered on a darker canvas (`--vip-canvas-2`).
  This is the fix for the app stretching full-bleed at desktop widths, which
  was the design handoff's top complaint about the first restyle pass.
  `.vip-header` and `.vip-bottom-nav` are `position: fixed` but width-capped
  and centered the same way, so they track the app column instead of the
  viewport at any screen size below that breakpoint. At ≥1024px this cap is
  deliberately dropped in favor of a sidebar + wide-content layout — see the
  "Desktop layout" bullet further down; that's a considered addition, not a
  reversal of this one.
* **Fonts** — Archivo (headings/numbers), IBM Plex Sans (body), IBM Plex
  Mono (ids/timestamps) — self-hosted in `public/fonts/` rather than the
  Google Fonts CDN `@import` the handoff shipped with, so they're
  precached by the service worker and survive offline like the rest of the
  app shell (see PWA installability below). `vite.config.js`'s
  `workbox.globPatterns` includes `woff2` for this.
* **Header** (`AppNav.jsx`) — a per-route title + sub (a small
  `ROUTE_HEADERS` lookup, same spirit as `HOME_TILES`), a back button
  (`vip-iconbtn`) on every route except `BottomNav`'s four tabs, and an
  avatar (initials from `employee.name`). No longer carries a Log out
  button — `Account` already had its own. Two routes need a sub `AppNav`
  can't compute itself: Lead Detail (the party/site name) and Dashboard
  (the selected date range). Those push it in via
  `src/contexts/HeaderContext.jsx`'s `useHeaderOverride()` instead of
  `AppNav` re-fetching their data itself; both pages clear the override in
  their effect's cleanup so it doesn't leak into the next route navigated
  to.
* **Stage colors** (`src/lib/statusColors.js`) — canonical stage → color
  table, keyed to `LEAD_STAGE_OPTIONS` so it can't drift. `stageChipClass`
  resolves to the theme's ready-made `vip-chip-<stage>` pill class (falling
  back to the neutral `vip-chip-new` for a stage saved via the "Other…"
  escape hatch, since `current_stage` is still free text); `stageFg`
  exposes the raw foreground color for places that only tint text/borders
  rather than fill a chip (the stage board's column border, the sales
  funnel's bar fill, `LeadStageSection`'s selectable chips below).
* **Lists are rows, not tables** — every list/breakdown screen (Closure
  forecast, Leads list, Parties, the category breakdowns, activity-by-exec)
  renders `.vip-row`/`.vip-bar-row`/`.vip-matrix-row` stacks instead of a
  `<table>` — the design handoff's other top complaint, a wide table only
  reading correctly on desktop. Segmented controls (`.vip-seg`) replaced
  full-width button rows everywhere there's a tab or filter (Dashboard's
  Reports/Leads/Parties tabs, the date-range selector, exec filters,
  Search's type filter). Where this doc's per-screen sections below still
  say "table", read it as "this shape of data", not literal `<table>`
  markup.
* **Home's KPI grid and Dashboard's KPI band** (open leads/pipeline/visits
  this week/won this month; activities/new leads/pipeline/won for the
  selected range, respectively) compute from data each page was already
  fetching — no new queries. Both reuse `computeOrderValueActuals`
  (exported from `TargetsVsActualsCard.jsx`) for their "won" figure, so the
  definition of "won value in a period" can't drift into two different
  approximations across the app.
* **Lead Detail's Stage section** (`LeadStageSection.jsx`) — `current_stage`
  is now a row of tappable `vip-chip-select` pills (one per
  `LEAD_STAGE_OPTIONS` value, tinted via `stageFg`); tapping one applies
  that stage immediately (no separate confirm step) via the same
  `stage_history`-logging path as before. An "Other…" chip still exists for
  the free-text escape hatch — reveals a text input + Set button, since
  `current_stage` staying non-enum is a locked-in decision (see
  Conventions), not something the redesign was meant to remove.
* Home's tiles gained a fourth entry, **All Leads** (links to
  `/dashboard?tab=leads`) — `Dashboard.jsx` reads `?tab=` on mount via
  `useSearchParams()` to land on the Leads tab directly instead of always
  defaulting to Reports.
* **Desktop layout (≥1024px)** — below 1024px this app is pixel-identical to
  before; nothing here changes mobile. At ≥1024px, `BottomNav.jsx` becomes a
  persistent left sidebar (`--vip-sidebar-w`, 232px): the same Home/Search/
  Account/Settings links plus three `.vip-nav-extra` ones (New Lead, Activity
  Log, Dashboard) that a phone only reaches via Home's tiles, a brand block
  (`.vip-sidebar-brand`) up top, and the employee's name/role pinned at the
  bottom (`.vip-sidebar-foot`) — all hidden on mobile via CSS, not conditional
  JSX. `AppNav`'s header stretches to span the content area right of the
  sidebar instead of staying phone-width-centered. This is a deliberate,
  discussed loosening of section 2's "never full-bleed" rule, not a reversal
  of it — that rule was about not stretching the phone-frame column, and
  there's no phone frame at this breakpoint. Every page wraps its own
  returned content in one of two width utilities (a plain wrapper div, not a
  layout rewrite): `.vip-narrow` (700px, centered — forms, detail pages,
  single lists: LeadDetail, LeadQuickCapture, ActivityLog, Settings, Account,
  Search, and Dashboard's Leads/Parties tabs) or `.vip-wide` (1180px —
  Home, and Dashboard's Reports tab). Inside `.vip-wide`, Dashboard's report
  cards sit in `.vip-report-grid` (2 columns); a card wrapped in
  `.vip-span-2` breaks out to the full row instead — used for cards whose
  content needs the width (Closure forecast, Targets vs. actuals, the
  Table/Board pipeline-by-stage card, Sales funnel, Why we lose), so the
  four `LeadsByCategoryCard` instances are the only ones that actually pair
  up half-width. Get this pairing wrong (an odd number of half-width cards
  in a row) and CSS grid leaves a visible gap — checked via computed
  `getBoundingClientRect()` during build, not just eyeballed. Home's tile
  stack becomes `.vip-tile-grid` (2×2) and the KPI grid goes 4-up in one
  row. `.vip-narrow`/`.vip-wide` are plain utility classes, not React
  components — applying one is a one-line class-name change per page, not a
  new abstraction. `--vip-app-max` is redefined to 700px inside the ≥1024px
  block purely so `InstallPrompt`/`OfflineIndicator` (mounted outside
  `.vip-app`, so they can't inherit its width) keep a sensible centered
  width once the phone-frame cap they used to piggyback on goes away.
* **Sidebar icons + hover-expand** — `BottomNav.jsx`'s links (and the mobile
  tab bar, same component) each carry an icon from
  `src/components/NavIcons.jsx` — hand-authored inline SVG, not a library
  (see Conventions). At ≥1024px the sidebar rests as a permanent icon-only
  rail (`--vip-sidebar-w-collapsed`, 68px — this is what `.vip-app`'s
  content padding and `.vip-header`'s left offset actually reserve, always,
  so hovering never reflows the page) and widens to
  `--vip-sidebar-w` (232px) on `:hover`, floating over the content as an
  overlay (box-shadow + `z-index`) rather than pushing it. Pure CSS, no
  React state: `.vip-nav-label`/`.vip-sidebar-word`/`.vip-sidebar-foot-text`
  each sit at `max-width: 0; overflow: hidden`, transitioning open on
  `.vip-bottom-nav:hover` — labels are always in the DOM, just clipped to
  nothing at rest. The footer shows initials in a small avatar
  (`getInitials`, `src/lib/initials.js`, shared with `AppNav`'s header
  avatar) at rest, name/role revealed on hover; nav links also keep a
  native `title` tooltip. No effect below 1024px — the mobile tab bar
  always shows icon+label, no hover concept on touch.

### Home (`src/pages/Home.jsx`) and Account (`src/pages/Account.jsx`)

`/` is the landing page after login for both roles — a time-of-day greeting
("Good morning/afternoon/evening, {first name}", falling back to "Hello"
late at night — `greetingForHour` in `Home.jsx`), a KPI grid (open
leads/pipeline/visits this week/won this month, see Design system above),
tappable shortcut tiles, and a "Closing next" card (top 4 rows from the
same closure-forecast query the Dashboard card uses). Home is the one route
`AppNav` renders nothing for (`AppNav.jsx` returns `null` when
`pathname === '/'`) — the greeting is the page's own heading instead of a
"Today / date · name" bar, so the screen starts flush at the top
(`.vip-home .vip-body` in `vipsar-theme.css` swaps the fixed-header
padding-top allowance for a small safe-area-aware one instead). Every other
route keeps its normal `AppNav` header. Tiles come from a
role-keyed config, `HOME_TILES` in `src/lib/homeTiles.js` (currently New
Lead/Dashboard/All Leads for both roles, plus Activity Log for
`sales_executive` only — owners don't log field activity, see the
ActivityLog section below), rather than inline `isOwner`-style JSX branching
like every other role-aware page
in this app uses — deliberate groundwork: more roles are planned later,
each potentially with a home screen that looks substantially different,
and a role-keyed data map means adding one is a new entry in `HOME_TILES`,
not a rewrite of `Home.jsx`.

`Account` (`/account`, both roles) is a minimal read-only Name/Role/Mobile/
Email display plus a Log out button (calls the same `signOut()` `AppNav`'s
button uses) — no self-service editing, wasn't asked for.

### Search-before-create components

`PartySearchOrCreate` and `SiteSearchOrCreate` (`src/components/`) share one
UX pattern, `vipsar-theme.css`'s `vip-*` classes (no dedicated stylesheet of
their own — `SearchOrCreate.css` is deleted, see Design system above), and
the `sanitizeForIlike` helper (`src/lib/sanitizeForIlike.js`, strips
`%_,()` before building a PostgREST `.or()` ILIKE filter — comma/parens are
filter-syntax delimiters, `%`/`_` are ILIKE wildcards). Neither uses an inner
`<form>` (Create is a button+onClick, not onSubmit) since the lead intake
screen embeds both inside one larger form and nested `<form>`s are invalid
HTML.

* `PartySearchOrCreate` — debounced ILIKE search on `parties` name/mobile,
  pick existing or create inline, `onSelect(party | null)`. `parties`' RLS
  is deliberately not "own data or owner role" — own-search invisibility
  would break duplicate checking across reps. Takes a `typeOptions` prop
  (default: all six `party_type` values) that narrows the create form's
  Type dropdown; a single-value list (e.g. `['client']`) hides the Type
  field entirely and uses that value directly.
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
is no `/parties/:id` or `/sites/:id` page anywhere in this app**, so those
results can't link anywhere, matching the existing "search before create"
duplicate-check use case rather than pretending to be a navigation target.

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

The sales_executive landing screen at `/leads/new` — deliberately not a
structured form: three optional fields (Client name, Site nickname,
Other's name) plus a required Scanning/Lixil/Referral tap-select (three
buttons, not a dropdown). Validation is exactly `lead_needs_an_anchor`: at
least one of the three fields filled. `owner` can access this route too,
deliberately — an owner can personally log leads, not a testing workaround.

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
lead ID link on `LeadQuickCapture`'s success screen. An identity card up
top (`LEAD-000<id>` mono, party/site name, site as a sub-line, a stage
chip via `stageChipClass`) plus a 2×2 facts grid (Order value/Owner/
Source/Created), via `employees!owner_employee_id(name)` embedded on the
initial `leads` select. Below that, a `vip-btn-row` of "Log activity"
(links to `/activity`) and "Call client" (`tel:` link, disabled if the
party has no `mobile`). Then up to five independent edit sections, each
with its own Save button and saving/error/success state (saving one never
touches the others) — **but only if `canEdit`**
(`isOwner || lead.owner_employee_id === employee.id`). A sales exec viewing
a lead that isn't theirs sees the identity card/button row plus a plain
notice instead of the five edit sections; RLS was already refusing the
actual UPDATE for them, this just stops them from being shown forms that
would fail on save. Each section's own save query (`LeadStageSection`,
`SalesProgressSection`) does a bare `.select()` with no `employees` embed,
so `LeadDetail` **merges** the returned row into existing state
(`setLead((prev) => ({ ...prev, ...updated }))`) rather than replacing it
wholesale — a plain replace would silently drop `lead.employees` (the
owner's name) after the first edit.

Render order: **Stage** (if `canEdit`) → **Activity** (always, regardless
of `canEdit` — see below) → **Sales progress** → **Site details** →
**Client details** → **Contacts**, all `canEdit`-gated except Activity.

* **Stage** (`LeadStageSection.jsx`) — `current_stage` as a row of tappable
  `vip-chip-select` pills, one per `LEAD_STAGE_OPTIONS` value (suggested
  new/hot/rfq/quote/negotiation/won/lost, tinted via `stageFg`) plus an
  "Other…" chip revealing a text input for the free-text escape hatch
  (same pattern as `site_stage`) — `current_stage` staying non-enum is
  locked in, see Conventions. Tapping a chip applies that stage
  immediately (no separate confirm step): updates `leads.current_stage`
  and inserts a `stage_history` row (`lead_id`, `stage`, `changed_by`,
  `changed_at`) — this section only owns changing the stage and the
  loss-reason prompt; the history itself renders in the Activity section
  below. Setting the stage to `lost` immediately opens an inline
  `loss_reasons` prompt (reason + optional competitor name) with **no skip
  option** — "Save reason" is the only way to dismiss it, since a rep must
  always account for why a lead was lost.
* **Activity** (`LeadActivityTimeline.jsx`, always shown, regardless of
  `canEdit` — so even a read-only viewer sees it) — a merged, newest-first
  feed of `stage_history` (append-only stage changes) and `activities`
  filtered by `lead_id` (site visits, calls, RFQs, booking updates logged
  via `ActivityLog`). Newest-first is a deliberate choice matching how most
  CRMs order a record's activity feed. **Known RLS asymmetry, not a bug**:
  `stage_history` SELECT is open to everyone, but `activities` SELECT is
  "own data or owner role" — so a sales exec viewing a colleague's lead
  sees the full stage history but an empty activity feed for activities
  they didn't log themselves. Same category as the `PartiesCard` "Worked
  with" caveat below.
* **Sales progress** (`SalesProgressSection.jsx`, always shown) — product
  dropdown, RFQ raised (checkbox+date), quote sent (checkbox+date+value),
  closure probability (0–100 number input, matches the `closure_probability`
  CHECK) and estimated close date (always-visible, not gated behind a
  checkbox like the RFQ/quote fields), straight fields on `leads`. These
  last two feed the Closure forecast dashboard card.
* **Site details** (`SiteDetailsSection.jsx`, if `site_id` set) — plain edit
  form (not `SiteSearchOrCreate`'s find-or-create, since the site already
  exists) for Area/locality/house no./pincode/site_stage. Reuses
  `SITE_STAGE_OPTIONS` (`src/lib/siteStageOptions.js`, shared with
  `SiteSearchOrCreate`).
* **Client details** (`ClientDetailsSection.jsx`, if `party_id` set) — edits
  mobile/address/city.
* **Contacts** (`AdditionalContactsSection.jsx`, if `site_id` set — the
  component name is unchanged, only the card's on-screen title shortened) —
  lists existing `site_contacts`; surfaces `other_party_id` as a pre-filled
  suggestion if not yet linked; repeatable "+ Add contact" via
  `PartySearchOrCreate` + role + optional firm name (updates
  `parties.firm_name`).

`sites`/`parties` UPDATE is "own data or owner role", not owner-only —
needed for Site/Client details to work for a regular sales exec, a real
blocker found while building this screen.

### ActivityLog (`src/pages/ActivityLog.jsx`)

DPR replacement at `/activity`, **sales_executive-only** (`ProtectedRoute`
in `App.jsx`, plus the Home tile and sidebar nav link are both omitted for
`owner` in `homeTiles.js`/`BottomNav.jsx`) — owners don't do field work
themselves, so logging a site visit/call/RFQ/etc. isn't something they need;
they still see every rep's logged activity through the Dashboard and a
lead's own timeline. `LeadDetail`'s "Log activity" button is hidden for
`canEdit` owners for the same reason, even though they can still edit the
lead itself. Tap one of Site Visit/Call/RFQ Raised/Office
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
* Not in scope for this screen: lead stage changes (`LeadDetail`'s job) or
  a screen listing past activities (still not built anywhere).

`LeadSearchSelect` (`src/components/LeadSearchSelect.jsx`) is select-only
(no create) — fetches the employee's own leads once, filters client-side by
linked party name / site nickname / locality. Embedding `parties` from
`leads` needs an explicit FK hint (`parties!party_id(...)`) — `leads` has
three FKs to `parties` (`party_id`, `referred_by_party_id`, `other_party_id`),
so a bare `parties(...)` embed fails with "more than one relationship was
found." `PartySearchOrCreate` has an `allowCreate` prop (default `true`)
for this screen's selection-only use.

### Dashboard (`src/pages/Dashboard.jsx`)

Single page at `/dashboard`, reachable by both roles — no separate owner/
sales-exec page. Role branching is just one derived boolean:
`isOwner = employee?.role === 'owner'` toggles `showByEmployee` on the
breakdown cards below. The same Supabase queries (`src/lib/dashboardQueries.js`)
serve both roles unchanged — RLS already scopes `activities`/`leads` to "own
data or owner role", so a sales exec's query naturally returns only their own
rows with no client-side filter needed.

Three in-page tabs (plain `useState`, not routes — `activeTab`): **Reports**
(default) holds everything below, including the category-breakdown cards;
**My Leads**/**All Leads** holds `LeadsListCard`; **Parties** holds
`PartiesCard`. All of `Dashboard.jsx`'s data-fetching effects run regardless
of which tab is active (the data is light enough that this isn't worth
lazy-loading) — only `LeadsListCard` fetches independently, since it's not
part of the date-range-scoped report data at all.

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
  set via `SalesProgressSection` on `LeadDetail`. Shows an **Owner** column
  (`employees!owner_employee_id(name)` embedded on `fetchClosureForecast`)
  — the lead's owner is shown wherever a lead appears throughout this app.
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
  already iterates over down to a single entry. `src/lib/targetPeriods.js`
  computes the This Week/This Month `period_type`/`period_value` (ISO 8601
  Monday-start week, matching `dateRanges.js`'s week boundary) — shared by
  both the lookup query and `SetTargetForm`'s prefill, so they can't drift
  out of sync with each other.
* **Set a target** (`SetTargetForm.jsx`, inside the same card, **owner-only in
  the UI**) — employee/period_type/period_value/metric_name/target_value,
  the only way to populate the `targets` table. Owner-only is a UI-layer
  choice, not an RLS one — `targets`' `own_data_or_owner_role` INSERT policy
  still technically lets a sales exec insert their own row. `period_type` is
  restricted to week/month in this form (the DB CHECK also allows `year`,
  but nothing on this dashboard displays a year-keyed target yet);
  `period_value` auto-prefills from `targetPeriods.js` when `period_type`
  changes but stays editable, so a future period can be set in advance. A
  successful insert is appended straight into `Dashboard.jsx`'s `targets`
  state (`onTargetCreated`) so the table above updates immediately.
* **Leads by stage / by area / by site stage / by product**
  (`LeadsByCategoryCard.jsx`, one generic component reused 4×) — count +
  `order_value` sum, grouped by `current_stage` / the lead's site's area /
  the lead's site's `site_stage` / `products.name`. Pipeline snapshots like
  Closure forecast, **not** date-range-scoped — "how many leads are in each
  category right now", not "how many arrived in a period" — fed by one
  shared unbounded query, `fetchLeadsForBreakdown` in `dashboardQueries.js`
  (selects `owner_employee_id, parties!party_id(name),
  employees!owner_employee_id(name)`, `sites(nickname, locality, ...)`, and
  `products!product_id(name, category)` — some of these fields only matter
  to specific cards, but it's one shared query for all of them, harmless
  extra columns for the rest). `categoryOrder` (optional prop) pins a fixed
  set of buckets in a fixed order, shown even at zero count, so "no leads at
  this stage" is visible rather than the row not existing — Stage uses
  `LEAD_STAGE_OPTIONS` (`src/lib/leadStageOptions.js`, extracted out of
  `LeadStageSection.jsx` so the two can't drift), Site Stage uses
  `SITE_STAGE_OPTIONS` plus `'Not set'`/`'No site'`; Area and Product have
  no fixed list (both come from a table, not a suggested list) so their
  buckets are discovered from the data and sorted by count desc instead —
  Product falls back to `'Not specified'`, matching `SalesProgressSection`'s
  own "— Not specified —" label for an unset `product_id`.
* **Leads by stage — Table/Board toggle** (`stageView` state in
  `Dashboard.jsx`, default `'table'`) — the Stage instance specifically
  (not Area/Site Stage, which have no meaningful "pipeline" reading) can
  switch to `LeadStageBoard.jsx`, a **read-only** Kanban-style board:
  columns = `LEAD_STAGE_OPTIONS`, same order as the table's `categoryOrder`;
  each column header shows the stage name + count + summed `order_value`;
  each card is a `<Link to="/leads/:id">` (party name → site nickname/
  locality → `'(no party)'` fallback chain, matching `LeadsListCard`'s),
  showing order value and — owner-only — the lead's owner name.
  Deliberately **not** drag-and-drop: a card click opens `LeadDetail`, where
  the actual stage change happens through the existing, already-correct
  flow (mandatory loss-reason prompt, `stage_history` logging, ownership
  checks) — reimplementing that as a drop-to-change interaction was
  considered and explicitly deferred, not an oversight. Columns scroll
  horizontally (`overflow-x: auto`); each column's card list scrolls
  independently past a max-height.
* **Sales funnel** (`SalesFunnelCard.jsx`) — reach-count + avg-days-in-stage
  per `LEAD_STAGE_OPTIONS` stage, from `fetchStageHistoryForFunnel` in
  `dashboardQueries.js` (`stage_history` joined to `leads(owner_employee_id)`).
  `stage_history` SELECT is open to *everyone* (unlike `leads`/`activities`)
  — the embedded `leads` comes back `null` for a sales exec's rows on leads
  they don't own (RLS on the embed), dropped client-side to get the same
  "own data or owner role" scoping every other card gets for free; same
  trick `fetchWonStageHistory`/`computeOrderValueActuals`
  (`TargetsVsActualsCard.jsx`) already uses. **Real data-completeness gap,
  fixed during build**: `stage_history` only logs the *destination* of an
  explicit stage change — a lead that goes straight `new → lost` gets
  exactly one row (`'lost'`), never a `'new'` row, since the initial `'new'`
  is a DB default, not a logged "change" (and a lead untouched since
  creation has *zero* history rows at all). Reading `stage_history` alone
  therefore silently undercounts `'new'`. Fixed by seeding every lead's
  reached-set with both `'new'` (true for all of them, by schema default)
  and its own `current_stage` from `breakdownLeads` (already fetched,
  already RLS-scoped normally), *then* widening with whatever's actually in
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
  named-competitors list below (from `loss_reasons.competitor_name`).
  `loss_reasons` SELECT requires `role = 'owner'` in RLS itself (see
  Conventions) — this card being owner-only is a hard constraint the policy
  enforces, not a UI-layer nicety like `SetTargetForm`'s gating. Confirmed
  live against a genuine second `sales_executive` session — the card is
  correctly absent entirely.
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
  browsable table of individual leads (Party/Site/Owner/Source/Stage/Order
  value/Created — Owner shows for both roles: trivially always themselves
  for a sales exec, but "wherever a lead appears, show its owner" won out
  over trimming a redundant column), party name links to `/leads/:id`,
  `fetchLeadsList` in `dashboardQueries.js`, ordered `created_at` desc,
  capped at 100. Deliberately **not** wired to the Reports tab's
  date-range selector — it's a browse/lookup tool, not a period report. For
  the owner, a "Sales exec" filter (`employeeFilter` state, default
  "— All employees —") re-queries with `.eq('owner_employee_id', ...)`; for
  a sales exec, RLS already scopes the query, so the filter doesn't render
  at all. Also reused, unmodified, by Settings' Delete a lead section.
* `ACTIVITY_TYPES`/`ACTIVITY_LABELS` live in `src/lib/activityTypes.js`
  (canonical, kept in sync with the `activities.activity_type` CHECK) —
  `ActivityLog.jsx` imports from there instead of defining its own copy.
  `src/lib/sourceTypeOptions.js` is the dashboard-only equivalent for the
  full 5-value `source_type` CHECK list — `LeadQuickCapture`'s own
  `SOURCE_OPTIONS` stays a deliberate 3-value subset. `formatCurrency` (INR,
  `₹` + `en-IN` grouping) lives in `src/lib/format.js`, shared by
  `ClosureForecastCard`/`TargetsVsActualsCard`/`LeadsListCard`.

**Verified against real data**, not just reasoned through: drove the actual
UI end-to-end (New Lead → Activity Log → Sales progress → mark won) on a
real lead in the live dev database, confirming closure forecast correctly
drops a lead once `won`, `order_value` actuals correctly attribute to the
right period, a real target set through `SetTargetForm` shows a live
actual-vs-target row without a reload and correctly reads `no target set`
under a different period (proving period-scoping), and — separately, with a
genuine second `sales_executive` login — that all owner-only elements
(Settings, the Sales exec filters, Why we lose) are correctly absent for
that role, not just gated by an untested `isOwner` flag. Owner-only DELETE
exists on `leads`/`activities`/`targets` (see Conventions) if test data
ever needs cleaning up.

### Settings (`src/pages/Settings.jsx`)

Owner-only page at `/settings`. Three independent sections, `employees`
state lifted to the page and shared between the first two (`upsertEmployee`
updates-in-place-or-appends, keeping both sections in sync without a
re-fetch):

* **Add employee** (`AddEmployeeForm.jsx`) — name/mobile/role/Auth User ID
  (UUID) → inserts an `employees` row (`insertEmployee` in
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
  and pastes the resulting UUID into this form. Leaving the UUID blank is
  allowed (creates an unlinked record, linkable later by editing
  `auth_user_id` directly in Supabase).
* **Manage employees** (`ManageEmployeesSection.jsx`) — lists every
  employee with an editable mobile field (own per-row Save when changed —
  no self-edit restriction, unlike role/status below), an editable role
  dropdown (+ per-row Save, only enabled when changed), and an
  Active/Inactive toggle (`is_active` — "deactivate, never delete a person
  with history"). **Role and Active/Inactive are both disabled for the
  currently logged-in owner's own row** (`isSelf = emp.id === currentEmployeeId`)
  — RLS's `owner_only_update` policy checks that the *caller* is an owner,
  not that a row being edited stays an owner, so without this an owner could
  demote or deactivate themselves and lock themselves out. This guardrail is
  UI-only, same category as `SetTargetForm`'s owner-only gating.
* **Delete a lead** (`DeleteLeadSection.jsx`) — reuses `fetchLeadsList(null)`
  (same query `LeadsListCard` uses, all leads, capped at 100) with a
  client-side search box, and a two-step confirm (click Delete → inline
  "Delete #N?" with Confirm/Cancel) before the actual `deleteLead` DELETE
  fires — a deliberate extra step given this is genuinely irreversible.
  RLS's `owner_only_delete` policy on `leads` is the real enforcement.

Verified end to end against the live database: employee Active/Deactivate
toggle persists and reverts correctly (checked via direct REST calls), the
owner's own row's controls are confirmed disabled, and the Delete a lead
flow was proven for real (created a throwaway lead, deleted it through the
actual UI flow, confirmed gone via a direct database check). Not
independently verified: the Add employee form's submit path (same insert
pattern already proven elsewhere, just never exercised here to avoid
cluttering the live employee list).

### PWA installability (`src/components/InstallPrompt.jsx`, `OfflineIndicator.jsx`)

Icons were generated from `src/assets/VIPSAR PWA icon design.pdf`. The
PDF's artwork already had rounded corners baked in, which is wrong for a
maskable icon (Android expects a flat, full-bleed square and applies its
own mask shape), so the "V" mark was extracted pixel-precise (exact fill
colors sampled from the PDF's vector path/Type3 glyph: `#0f1216`
background, `#f8f5ee` mark) and recomposited onto a plain full-bleed square
with no pre-rounding. The mark sits well inside the maskable 80%-diameter
safe-zone circle (measured half-diagonal ≈0.27× icon size, vs. the 0.4×
limit). The regeneration script (Python + Pillow) was a one-off, not
checked into the repo — regenerate by hand if the logo ever changes.

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

Verified via a production build served with `vite preview`: manifest, all
four icons, and `apple-touch-icon` resolve correctly; the service worker
registers, activates, and takes control. The preview server process was
then **actually killed** and the tab reloaded — every request still
returned 200, served from the service worker's cache, proving the app
shell genuinely loads with zero signal. Install/offline banners were
exercised by dispatching synthetic `beforeinstallprompt`/`online`/`offline`
events (Chrome doesn't reliably fire real installability heuristics from a
single automated page load). iOS-Safari UA detection was unit-verified
against 6 real device UA strings — all correct. Not verified: an actual
screenshot of the iOS hint rendering (this environment can't spoof
`navigator.userAgent` convincingly) — left to the user, as planned.

## Commands

- `npm run dev` — start dev server (default port 5173)
- `npm run build` — production build
- `npm run preview` — preview the production build locally
- `npm run lint` — run Oxlint

## Local environment notes

`.claude/launch.json` and `.claude/dev-server.cmd` exist so the preview
tooling can start the dev server reliably even if Node isn't yet on PATH in
a fresh shell (`export PATH="/c/Program Files/nodejs:$PATH"` fixes that
manually if needed). `.claude/preview-server.cmd` is a second launch config
(`tostem-crm-preview`, port 4173) that runs `npm run build && npm run preview`
— use this one, not the plain dev server, to test real PWA/service-worker/
offline behavior (see the PWA installability section above for why).

The Browser-pane dev preview persists its Supabase session in localStorage
per-origin, shared across every tab — including tabs a human tester and
Claude open independently. A login for one manual test silently carries over
into later "unauthenticated" checks, producing false-positive real writes.
Confirm which state a test tab is actually in (expect `permission denied`
from an intentionally logged-out check, or check which employee name
renders) rather than assuming a fresh tab means a fresh session.

## Conventions

- Secrets (Supabase URL/keys, etc.) go in a git-ignored `.env` file — never commit them. `.env.example` documents the required variable names with placeholders.
- The anon key this app runs on can't execute DDL. Any schema/DB change (new column, altered constraint, etc.) has to be handed to the user as a migration statement to run manually via the Supabase dashboard's SQL Editor — never assume a schema-file edit is reflected in the live database. Confirm with the user that `Schema/` files (schema + `Schema/rls_policies.sql`) have actually been run against the live project rather than trusting their presence in the repo. Currently outstanding: `tostem_crm_schema.sql`'s `parties.party_type` CHECK includes `'pmc'` but this has not been run live — the constraint is named `parties_party_type_check` (confirmed via the exact error it throws today), so `ALTER TABLE parties DROP CONSTRAINT parties_party_type_check, ADD CONSTRAINT parties_party_type_check CHECK (party_type IN ('client','architect','builder','firm','other','pmc'));` is the migration once someone's ready to run it.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup — none planned. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
- Row Level Security (full policies in `Schema/rls_policies.sql`): `activities`/`leads`/`plans`/`targets` use "own data or owner role" (by `employee_id`/`owner_employee_id`, or role=`'owner'`) for SELECT/INSERT/UPDATE, plus **owner-only DELETE** (no "own data" exception — a sales exec can create/edit their own rows but can't delete even those; only an owner can). `employees`: SELECT open, INSERT/UPDATE/DELETE owner-only with **no self-update exception** (a sales exec must never set their own `role` to `'owner'`). `sites`/`parties`: SELECT/INSERT open to all (needed for search-before-create across reps), UPDATE is "own data or owner role" (`discovered_by`/`created_by`), DELETE owner-only. `areas`/`site_contacts`: SELECT/INSERT open, UPDATE/DELETE owner-only (shared master data / append-style joins — no per-row "own data" concept applies). `products`: SELECT open, else owner-only. `stage_history`: SELECT/INSERT open, no UPDATE/DELETE ever, for anyone including owner — permanently append-only by design. `loss_reasons`: SELECT owner-only, INSERT open, no UPDATE/DELETE ever, same append-only-forever reasoning. A write needs both the table GRANT (Step A of `rls_policies.sql`) and the RLS policy to agree — DELETE is granted on the ten tables with an `owner_only_delete` policy (`employees`/`areas`/`sites`/`site_contacts`/`parties`/`products`/`leads`/`activities`/`plans`/`targets`); `stage_history`/`loss_reasons` get no DELETE grant at all.
- No GPS, geocoding, or drag-and-drop libraries in this project — deliberate (see DECISIONS.md and the Kanban board note above). No icon library either (no `lucide-react`/icon-font dependency) — `src/components/NavIcons.jsx` hand-authors BottomNav's icons as plain inline SVG instead; reuse/extend that file for any new icon rather than adding a package. Everything else icon-shaped stays plain text/CSS.

## Roadmap

0. ✅ Environment + scaffold
1. ✅ Supabase project, schema, RLS policies — confirm they've actually been run (see Conventions)
2. ✅ Employee login (Supabase Auth): login screen, AuthContext, protected/role-based routing
3. ✅ Party/site/lead intake screens (search-before-create pattern)
4. ✅ DPR / activity logging (`ActivityLog` at `/activity`)
5. ✅ Dashboards, Settings (employee management + lead deletion), Home hub,
   global search, Kanban board, and reporting cards — see the dedicated
   sections above for how each works today.
6. ✅ PWA polish (installable, offline-tolerant for field use) — see the PWA
   installability section above. Out of scope: background sync/auto-retry
   of failed submissions, iOS's more aggressive cache-clearing on inactive
   PWAs.
7. ⬅️ current — Deploy + pilot with 1-2 sales execs before full rollout.
   Still open from the "Current state" list above: Followups, a
   `plans`-table screen, and role-differentiated Home content.

For domain model, lead-sourcing logic, and locked-in design decisions, see DECISIONS.md.
