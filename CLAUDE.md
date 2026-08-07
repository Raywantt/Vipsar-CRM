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
  don't add them as a side effect of unrelated work: a
  **`plans`-table screen** (the table has full RLS wired up and zero UI
  anywhere in `src/`), **further role-differentiated Home content** beyond
  today's Activity Log tile split (`HOME_TILES` is role-keyed and ready for
  more of this), and **a screen listing past activities** (`ActivityLog`
  only logs new ones; nothing browses old ones outside a lead's own
  timeline or a Sales Exec Profile's Activity log section). **Followups**
  *is* now built — real personal + owner-assigned reminders with actual
  push notifications, see the dedicated Follow-ups section below — but
  editing an existing follow-up's details and a standalone Follow-ups list
  page are still out of scope for this pass (only create and mark-done
  exist in the UI).
- **Sales Exec Profile + redesigned Lead Profile** (`/employees/:id`,
  `/leads/:id` — see their own sections below) were built from a second
  Claude Design handoff (`design_handoff_detail_pages/README.md`/
  `FLOW.md`/`DATA_CONTRACT.md`). That handoff's data model treats "lead" and
  "client" as the same record and assumes a 3-tier admin/manager/exec role
  system with tables this app doesn't have (`quotes`, `orders`,
  `order_items`, `lead_contacts`, and a `follow_ups` unrelated to the real,
  differently-shaped `follow_ups` table added later — see the Follow-ups
  section) — every field on both pages
  is mapped onto this app's real schema instead (see each section for the
  exact mapping), nothing is fabricated, and the manager tier is dropped
  since this app only has `owner`/`sales_executive`. **Outstanding**: the
  new `lead_owner_history` table (see Conventions) hasn't been created live
  yet — "Reassign owner" still works without it, just without a logged
  history. **Deliberately out of scope for this pass**: owner-name badges
  inside `DrilldownPanel.jsx`'s deeper bodies (ageing/forecast/pipeline/loss
  row lists) aren't links yet, unlike everywhere else a person's name
  appears — a real gap, not an oversight, left for a follow-up rather than
  rushed edits to that already-shipped file.
- **Dashboard v2** (Needs Attention + a universal drill-down panel reused
  across every metric — see the Dashboard section and its Design-system
  bullet) is desktop-first: the KPI sparkline row, exec heatmap, and source
  donut only render at ≥1024px, and **All Leads/Parties currently have no
  mobile entry point at all** (the in-page tab row that used to carry them
  on a phone is gone; their sidebar-link replacement is desktop-only) —
  known, deliberately deferred, not an oversight. Don't "fix" the mobile gap
  as a side effect of unrelated work; it needs its own discussion (see the
  `BottomNav` paragraph in Structure below for the current state).
- **My Team** (`/team`, owner-only — see its own section below) is a card-
  grid directory of the owner's non-owner employees (today, just
  `sales_executive`), with a name search and a role filter, each card
  linking to that employee's Sales Exec Profile. Unlike All Leads/Parties
  above, it has a real mobile entry point (a `HOME_TILES` tile), not just a
  desktop `.vip-nav-extra` sidebar link — see the Structure section's
  `BottomNav` paragraph.
- **Account and Settings were merged into one page, `Profile`** (`/profile`,
  see its own section below) — reached by tapping the avatar/nametag
  (header, desktop sidebar, or Home's own mobile-only one) rather than a
  `BottomNav` tab; there's no `/account` or `/settings` route anymore.
  Settings' old **Delete a lead** tool is gone — replaced with **Delete a
  party**, for cleaning up a wrongly-added architect/PMC/other contact, not
  for leads. A **Change password** option was added (new capability, didn't
  exist before), requiring the current password before allowing a change.
  Add employee is now collapsible and Manage employees is search-only
  (nothing shown until a name matches) — the same treatment Delete a party
  got, both fixing the same "long list, just for scrolling past it" problem.
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
                the four remaining LeadDetail *Section components (Sales
                progress/Site details/Client details/Contacts — Stage moved
                into LeadQuickActions, see the Lead Profile section) plus
                LeadQuickActions, LeadActivityTimeline, EmployeeLink,
                DateRangeSelector, ActivityCountsCard,
                LeadsBySourceCard, ClosureForecastCard, TargetsVsActualsCard,
                SetTargetForm, LeadsListCard, LeadsByCategoryCard,
                LeadStageBoard, SalesFunnelCard, LossReasonsCard,
                PartiesCard, NeedsAttentionCard, KpiSparkRow,
                DashboardHeatmap, DonutChart, DrilldownPanel,
                AddEmployeeForm, ManageEmployeesSection,
                DeletePartySection, ChangePasswordForm, InstallPrompt,
                NotificationPrompt, OfflineIndicator, FollowUpForm, FollowUpList)
  pages/        top-level views (Login, Home, Profile, Search, Dashboard,
                LeadQuickCapture, LeadDetail, EmployeeProfile, MyTeam,
                ActivityLog, ...)
  contexts/     AuthContext — session + employee (id/name/mobile/role) lookup;
                HeaderContext — lets Lead Detail/Sales Exec Profile/Dashboard
                push a dynamic sub into AppNav's header (see Design system
                below)
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js, leadStageOptions.js, lossReasonOptions.js,
                statusColors.js, activityTypes.js, sourceTypeOptions.js,
                dateRanges.js, dashboardQueries.js, searchQueries.js, format.js,
                targetMetrics.js, targetPeriods.js, targetQueries.js,
                partyQueries.js, employeeQueries.js, leadOwnerHistory.js,
                homeTiles.js, attention.js, drilldownBuilders.js,
                followUpQueries.js, followupDates.js, pushSubscription.js)
  assets/       images, icons, etc.
  vipsar-theme.css   the app's one design-system stylesheet — see Design
                system below
```

Outside `src/`, `supabase/functions/send-followup-reminders/` is the one
piece of backend code in this repo — a Deno Edge Function, not part of the
Vite build, deployed independently (see the Follow-ups section and
Conventions).

Routing is set up in `App.jsx` (`react-router-dom`): `/` (Home, landing
page after login), `/profile`, `/search`, `/dashboard`, `/leads/new`,
`/leads/:id`, `/employees/:id` — all allow both `sales_executive` and
`owner` at the route level — plus `/activity` (**sales_executive-only**,
see the ActivityLog section below) and `/team` (**owner-only**, see the My
Team section below). There is no more standalone `/settings` route —
`Profile.jsx` shows its owner-only section inline instead (see the Profile
section below); `Profile` itself is reachable by both roles the same way
`/account` used to be.
`/employees/:id` is further gated *inside* `EmployeeProfile.jsx` itself,
not by `ProtectedRoute`'s `allowedRoles` (see the Sales Exec Profile
section below for why — a sales exec may view their own page but not a
colleague's, which isn't a role-level distinction `ProtectedRoute` can
express). `ProtectedRoute` handles the
redirect-to-login and role gating (redirecting to `/` on a role mismatch);
`AuthContext` is the single source of truth for "who's logged in and what's
their role" — look up an employee's role via `useAuth()`, don't re-query
`employees` directly in a component. `ProtectedRoute` renders
`<div className="vip-app">` (the centered app-column shell — see Design
system below) containing `AppNav` (`vip-header`, top), `{children}`
(`vip-body`), and `BottomNav` (`vip-bottom-nav`, fixed bottom — just
**Home** / **Search** on the mobile tab bar). Account and Settings no
longer have their own tabs or routes — both were merged into one `Profile`
page (`/profile`, see its own section below), reached by tapping the
avatar/nametag rather than a tab: `AppNav`'s header avatar (every route
except Home, top right) and `BottomNav`'s sidebar-foot avatar (desktop
sidebar, bottom left) are both `Link`s to `/profile`; Home — the one route
with no `AppNav` header — gets its own mobile-only avatar instead (see the
Home section below).
**`BottomNav` is the one place for primary navigation in this app — don't
add nav links back to `AppNav`.** At ≥1024px `BottomNav` becomes the
sidebar and also carries `.vip-nav-extra` links a phone doesn't show,
including **All Leads**, **Parties**, and (owner-only) **My Team** (see the
Desktop layout bullet below) — All Leads/Parties currently have **no
mobile entry point at all** (dropped along with Dashboard's old in-page tab
row, see the Dashboard section); that's a known, deliberately deferred gap,
not an oversight. My Team doesn't share that gap — it also has a
`HOME_TILES` entry for the owner, so it's reachable on a phone too, same as
New Lead/Dashboard. `AppNav` is a per-route header (title/sub/back button/avatar),
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

**Non-negotiable: build and render every screen to the standard of the best
frontend engineer working from that Claude Design handoff — not an
approximation of it.** Concretely:
- **Pick the right width class on purpose, every time.** `.vip-narrow`
  (700px) is for genuinely single-column content only (forms, a single
  list/detail page). Anything with a multi-card grid, a chart, a table, or
  a rail — the shape Dashboard's Reports tab and the Sales Exec/Lead
  Profile pages all have — needs `.vip-wide` (1180px) or `.vip-cols`/
  `.vip-cols-3`. Wrapping wide content in `.vip-narrow` by mistake (this
  happened once already on `EmployeeProfile.jsx` — fixed) produces exactly
  the "huge empty gutters on left and right at desktop width" bug the
  original design handoff's whole first complaint was about — see the App
  column bullet below. If a screen looks narrower than its content
  warrants, that's a bug, not a stylistic choice.
- **Always visually verify new/changed UI in the browser preview at desktop
  width before calling it done** — per this repo's own `<verification_workflow>`
  habit, don't just trust that the CSS classes did the right thing. Take a
  screenshot, actually look for unexplained empty space, misaligned grids,
  overflow, or elements that don't reach the edges the mockup's did, and
  fix what you find. This applies to every future screen, not just the two
  built in this pass.

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
  (`vip-iconbtn`) on every route except `BottomNav`'s two tabs (Home,
  Search — `/profile` deliberately isn't a tab route either, so it keeps
  its back button, see the Structure section above), and an avatar
  (initials from `employee.name`, via `getInitials` — see the Profile
  section for the exact first+surname rule) that's now a `Link` to
  `/profile` rather than a static badge. No Log out button here — that
  lives at the bottom of `Profile`. Two routes need a sub `AppNav`
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
  full-width button rows everywhere there's a tab or filter (the date-range
  selector, exec filters, Search's type filter — Dashboard's own
  Reports/Leads/Parties tabs used to be one of these too, but that row is
  gone now, see the Dashboard section). Where this doc's per-screen sections
  below still say "table", read it as "this shape of data", not literal
  `<table>` markup.
* **Home's KPI grid** (open leads/pipeline/visits this week/won this month)
  and **Dashboard's KPI band** compute from data each page was already
  fetching — no new queries. Both reuse `computeOrderValueActuals`
  (exported from `TargetsVsActualsCard.jsx`) for their "won" figure, so the
  definition of "won value in a period" can't drift into two different
  approximations across the app. Dashboard's own KPI band is now two parallel
  views switched by `.vip-only-mobile`/`.vip-only-desktop` (see the
  Dashboard-v2 bullet below): the original 4-tile grid below 1024px, a
  6-tile `KpiSparkRow.jsx` above it.
* **Lead Detail's Stage section** (`LeadStageSection.jsx`) — `current_stage`
  is now a row of tappable `vip-chip-select` pills (one per
  `LEAD_STAGE_OPTIONS` value, tinted via `stageFg`); tapping one applies
  that stage immediately (no separate confirm step) via the same
  `stage_history`-logging path as before. An "Other…" chip still exists for
  the free-text escape hatch — reveals a text input + Set button, since
  `current_stage` staying non-enum is a locked-in decision (see
  DECISIONS.md), not something the redesign was meant to remove.
* **Universal linking** — the rule of thumb from `design_handoff_detail_pages/
  FLOW.md`, applied globally: a person's name is always a link to
  `/employees/:id`; a lead or client's name is always a link to
  `/leads/:id`. Covers `LeadsListCard`, `ClosureForecastCard`,
  `LeadStageBoard`, `PartiesCard`'s "Worked with" column, `Search`'s
  Leads/Parties results, `LeadActivityTimeline`'s "by {employee}", and the
  Dashboard heatmap's row-header name (clicking a **cell** still opens the
  existing metric drill-down, unchanged — only the name itself navigates).
  `EmployeeLink.jsx` exists specifically for the case a person's name has
  to render *inside* a row that's already a `<Link>` to something else (a
  lead, a party) — a literal nested `<a>` would be invalid HTML and break
  the outer row's click target, so it navigates via `useNavigate` +
  `stopPropagation` instead; use a plain `<Link to={`/employees/${id}`}>`
  anywhere there's no outer link to nest inside. `PartiesCard` rows and
  `Search`'s Parties results (no single lead in view) link to that party's
  **most recent lead** if they have one (`fetchLeadsByParty`/
  `mostRecentLeadByParty` in `partyQueries.js` — `party_id` only, not
  `referred_by_party_id`/`other_party_id`, since only `party_id` makes them
  "the lead"), else stay non-clickable, same as before. **Known gap, not
  finished everywhere**: owner-name badges inside `DrilldownPanel.jsx`'s
  deeper bodies aren't linked yet — see "Current state" above.
* Home's tiles gained a fourth entry, **All Leads** (links to
  `/dashboard?tab=leads`) — `Dashboard.jsx` has no in-page tab buttons
  anymore (see the Dashboard section's "no more in-page tab buttons" bullet),
  so `?tab=leads`/`?tab=parties` via `useSearchParams()` is now the *only*
  way to land on those two views; a plain `/dashboard` (or `?tab=` unset)
  always means Reports. Synced with a `useEffect` on `searchParams`, not a
  `useState` initializer, since navigating between sidebar links while
  already on `/dashboard` changes the query string without remounting the
  page — an initializer would only ever see the very first value.
* **Desktop layout (≥1024px)** — below 1024px this app is pixel-identical to
  before; nothing here changes mobile. At ≥1024px, `BottomNav.jsx` becomes a
  persistent left sidebar (`--vip-sidebar-w`, 232px): the same Home/Search
  links plus six `.vip-nav-extra` ones (New Lead, Activity
  Log, Dashboard, All Leads, Parties, and — owner-only — My Team) — New
  Lead/Activity Log/Dashboard/My Team are reachable on a phone via Home's
  tiles instead, but **All Leads/Parties currently have no mobile path at
  all** (see the Structure section's
  `BottomNav` paragraph above), a brand block
  (`.vip-sidebar-brand`) up top, and the employee's name/role pinned at the
  bottom (`.vip-sidebar-foot`, now a `Link` to `/profile` — see the Structure
  section above) — all hidden on mobile via CSS, not conditional
  JSX. Making `.vip-sidebar-foot` a `Link` means it also matches the plain
  `.vip-bottom-nav a` rule (higher specificity than the lone `.vip-sidebar-foot`
  class), so both places that style/hide it use the
  `.vip-bottom-nav a.vip-sidebar-foot` selector form instead, to reliably win
  — see `vipsar-theme.css`. `AppNav`'s header stretches to span the content area right of the
  sidebar instead of staying phone-width-centered. This is a deliberate,
  discussed loosening of section 2's "never full-bleed" rule, not a reversal
  of it — that rule was about not stretching the phone-frame column, and
  there's no phone frame at this breakpoint. Every page wraps its own
  returned content in one of two width utilities (a plain wrapper div, not a
  layout rewrite): `.vip-narrow` (700px, centered — forms, detail pages,
  single lists: LeadDetail, LeadQuickCapture, ActivityLog, Profile,
  Search, and Dashboard's Leads/Parties tabs) or `.vip-wide` (1180px —
  Home, and Dashboard's Reports tab). Inside `.vip-wide`, Dashboard's report
  cards sit in `.vip-report-grid` (2 columns); a card wrapped in
  `.vip-span-2` breaks out to the full row instead — used for cards whose
  content needs the width (Closure forecast, the Targets-vs.-actuals-plus-
  Needs-Attention featured row, Why we lose), so the four
  `LeadsByCategoryCard` instances plus the Table/Board pipeline-by-stage
  card + Sales funnel pair are the only ones that actually pair up
  half-width. Get this pairing wrong (an odd number of half-width cards
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
* **Dashboard v2 — Needs Attention + universal drill-down** (built from a
  Claude Design "VIPSAR Dashboard" mockup, `vip-dd-*` classes) — see the
  Dashboard section below for what each piece shows; this bullet is the
  shared plumbing. Two visibility utilities, `.vip-only-mobile`/
  `.vip-only-desktop`, gate parallel views the same "one DOM, switched by
  CSS" way the sidebar above does — the KPI sparkline row, the exec
  heatmap, and the source donut only exist at ≥1024px; below that the
  original simpler cards render unchanged. The one exception is the
  drill-down panel itself (`DrilldownPanel.jsx`): a single element resized
  by media query (full-screen sheet below 1024px, a fixed 600px right-hand
  panel above it) rather than two parallel ones, since a phone and a
  desktop panel show the same content, just sized differently.
  `src/lib/drilldownBuilders.js` holds one pure `build*Panel` function per
  panel "kind" (`log`/`ageing`/`attain`/`pipeline`/`winrate`/`forecast`/
  `mix`/`loss`) — each shapes already-fetched Dashboard state into
  `DrilldownPanel`'s props, no network calls of its own, and **none of them
  produce a verdict/narrative field** — `DrilldownPanel` has no section that
  would render one even if they did. `src/lib/attention.js` is the one
  exception living outside that file (`computeAttentionBuckets`/
  `buildAgeingPanel`) since Needs Attention's bucket logic and its
  drill-down are tightly coupled. Reuse an existing `build*Panel` call
  before adding a new one — e.g. the KPI row's "Stale leads" tile and the
  Needs Attention card's matching row call the exact same
  `buildAgeingPanel(staleBucket)`, and "Leads by stage (detail)" opens the
  identical panel Pipeline-by-stage's own "Details" link does.

### Home (`src/pages/Home.jsx`)

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
`sales_executive` only and My Team for `owner` only — owners don't log
field activity, sales execs have no team to browse, see the ActivityLog and
My Team sections below), rather than inline `isOwner`-style JSX branching
like every other role-aware page
in this app uses — deliberate groundwork: more roles are planned later,
each potentially with a home screen that looks substantially different,
and a role-keyed data map means adding one is a new entry in `HOME_TILES`,
not a rewrite of `Home.jsx`.

Home is also the one route with no `AppNav` header, so it's the one place
in the app that needs its own avatar/nametag markup rather than inheriting
it — a mobile-only (`vip-only-mobile`) `Link` to `/profile` sits top-right
of the greeting row (`.vip-home-head-actions`, grouped with the KPI period
selector so both stay right-aligned together). `.vip-home-head` wraps
(`flex-wrap: wrap`) and `.vip-greeting` carries a `min-width: 200px` so a
longer greeting forces the period-selector+avatar group onto its own
right-aligned line below, instead of squeezing the greeting text down to
an ugly 3-line wrap on a narrow phone — confirmed live at 375px width. At
≥1024px this avatar hides (the sidebar's own avatar, bottom-left, already
covers Home there — see the Profile section below).

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

### LeadDetail (`src/pages/LeadDetail.jsx`) — the Lead Profile

`/leads/:id`, reachable from every place in the app a lead or a client
appears — a client and their lead are treated as the same record in this
app's UI (confirmed decision, not a schema merge: `parties`/`leads` are
still separate tables). Redesigned from the original plain enrichment form
into the "Deal room" layout from `design_handoff_detail_pages` — Layout A
of that handoff only, the Layout B "Dossier" alternative and the
prototype's own layout-toggle/"Jump to" chip row were explicitly marked
"do not build" and aren't here. **Every edit capability the original form
had is still here too** — nothing was removed, the new design was layered
on top (a deliberate call, see the "Current state" bullet above).

Identity band: avatar, name (party/site name — unchanged fallback chain),
a **status pill** (`Customer` once won, `At risk` if open and 14+ days
untouched, else `Open lead` — derived, not stored) and a **health pill**
(from days-since-last-touch: Stale ≥14d / Cooling ≥7d / Active — same
thresholds `attention.js` already uses elsewhere, not a second definition),
sub-line (type · site · source · created). Below that, the original
`vip-btn-row` ("Log activity" for non-owners, "Call client") is unchanged,
followed by `LeadQuickActions.jsx` (**only if `canEdit`** —
`isOwner || lead.owner_employee_id === employee.id`, same gate as before)
— the three new quick actions from the handoff, each behind its own
toggle button so at most one is open at a time:

* **Change stage** — does **not** reimplement `LeadStageSection.jsx`, just
  relocates *when* it's visible: toggling this button mounts the exact
  same component (chip-select + mandatory loss-reason-on-lost prompt,
  unchanged) instead of it always being on-screen. Everything documented
  about it before is still true.
* **Set follow-up** — writes the existing `leads.next_followup_date` field
  directly (Tomorrow / In 3 days / Next Monday / In 2 weeks / a custom date
  input) — one more entry point onto the same field `ActivityLog` already
  sets, and distinct from the real Follow-ups feature (see its own section)
  even though it shares that feature's date-picker logic via
  `src/lib/followupDates.js`.
* **Reassign owner** — **owner-only**, even within `canEdit` (a sales exec
  who owns the lead gets the other two actions but never this one, per the
  design handoff's `FLOW.md` §4). Updates `leads.owner_employee_id`
  (already legal under existing "own data or owner role" RLS, no schema
  change) and inserts into `lead_owner_history` (see Conventions —
  **not live yet**). The write to `leads` and the history insert are
  independent: if the history table doesn't exist, the reassignment still
  succeeds and an inline warning explains the history wasn't logged,
  mirroring how `ActivityLog`'s own lead-side-effect writes already handle
  a partial failure.

Below the quick actions, a **Deal progress** hero card: a 7-column stage
stepper (one per `LEAD_STAGE_OPTIONS` value — this app's real stage list,
not the handoff's generic 6, since `current_stage` staying non-enum is
locked in per DECISIONS.md) dated from `stage_history` ("not yet" for
unreached stages, `new` falls back to `created_at` the same way
`SalesFunnelCard` already works around `stage_history` never logging an
implicit default), plus 4 deal stats (Deal value = `max(order_value,
quote_value)`, Probability = `closure_probability` or a stage-keyed
default table, Expected close = `estimated_close_date` rendering
`slipped` when past and open, Last touch).

Main column below that: **Quotes & orders** (at most 2 real rows — one
from `quote_value`/`quote_sent_at` if `quote_sent`, one from `order_value`
if set, dated via the `stage_history` `'won'` row as a proxy order
date since `leads` has no separate order-date column — **not** a
fabricated multi-document list; "No quotes or orders yet" if neither is
set), **Products in scope** (a single real row from `product_id` →
`products.name`, since this app tracks one product per lead, not
per-SKU line items), then the existing `LeadActivityTimeline.jsx`
(unchanged merge of `stage_history` + `activities`, now also splicing in
`lead_owner_history` entries when that table has rows).

Right rail: a new **Deal owner** card (links to `/employees/:id`, plus the
ownership-history list from `lead_owner_history`) and a new **Contact**
card (site contacts + a facts list), then — **unchanged from before** —
`SalesProgressSection`, `SiteDetailsSection` (if `site_id`),
`ClientDetailsSection` (if `party_id`), `AdditionalContactsSection` (if
`site_id`), same `canEdit` gate, same merge-not-replace `setLead` pattern
as always (each section's save query has no `employees` embed, so
`LeadDetail` merges the returned row rather than replacing state wholesale
— a plain replace would drop `lead.employees`).

A sales exec viewing a lead that isn't theirs still sees the identity
band + Deal progress + Quotes/Products/Activity (all read-only, no
`canEdit` needed for those) plus the "belongs to X" notice instead of the
quick actions/edit sections — unchanged in spirit from before, just with
more to actually look at. **Known RLS asymmetry, not a bug** (unchanged):
`stage_history` SELECT is open to everyone, `activities` SELECT is "own
data or owner role", so a non-owning sales exec's activity feed is empty
even though the stage history isn't.

`sites`/`parties` UPDATE is "own data or owner role", not owner-only —
needed for Site/Client details to work for a regular sales exec, a real
blocker found while building this screen originally.

### EmployeeProfile (`src/pages/EmployeeProfile.jsx`) — the Sales Exec Profile

`/employees/:id`, brand new (no prior equivalent existed) — reachable from
**every place an employee/owner name appears anywhere in the app** (see
the "universal linking" bullet in Design system below), plus the
Dashboard heatmap's row-header name (see Dashboard section). Layout A
("Scorecard") only from the same `design_handoff_detail_pages` bundle —
the layout toggle, exec switcher, and team-chip row the prototype shipped
for design review are all "do not build" and aren't here; navigation
between execs happens by going back to the dashboard heatmap, not a
switcher on this page.

**Who can open it** (enforced inside the component, not by
`ProtectedRoute` — see Structure above): `owner` → any employee; a
`sales_executive` → **their own page only**, redirected to `/dashboard`
otherwise. A sales exec viewing their own page never sees the rank pill or
any other peer-relative element (nothing to compare against, and RLS on
`activities`/`leads`/`targets` would return empty rows for anyone else's
data anyway — this redirect is the same category of UI-layer belt-and-braces
as `SetTargetForm`'s owner-only gating).

Top bar: a Week/Month/Quarter period filter (`vip-seg-outline`, default
Month, reflected in the URL as `?period=`) that drives every figure on the
page. Identity band: avatar, name, a **rank pill** (this employee's
position by *blended attainment* — mean of the six metric ratios below,
each capped at 1.25, among active sales execs — among the team, tinted by
tertile), sub-line using `employees.office_location` for "territory" and
`employees.created_at` for "with VIPSAR since" (both flagged in the UI
copy as approximations — this app tracks neither a real territory nor a
hire date column; "reports to a manager" from the handoff is dropped
entirely, since this app has no manager tier, only `owner`/
`sales_executive`).

Below that: 5 head stats (Attainment/Booked/Open pipeline/Win rate/Stale
leads — Stale leads reuses `computeAttentionBuckets` from `attention.js`
scoped to this exec's own leads, not a second stale-threshold
definition), then the **6 metric tiles** (Order value/Site visits/Calls
made/RFQs raised/Offers sent/Bookings). The first 4 are the activity
types already tracked everywhere else in this app; **Offers sent** and
**Bookings** are two metrics new to this pass — added as real,
targetable entries to `src/lib/targetMetrics.js`'s `METRIC_OPTIONS` (no
DB migration needed, `targets.metric_name` has no CHECK constraint), with
their own actual-computing functions (`computeQuoteSentActuals`/
`computeWonCountActuals`, exported from `TargetsVsActualsCard.jsx`
alongside `computeOrderValueActuals`) so `SetTargetForm`'s dropdown and
this page's tiles read the exact same definition. Adding these two also
extended the existing Dashboard "Targets vs. actuals" bar-list (sales
exec's own view, and the owner's mobile-width fallback) with two more
rows — **deliberately did not** touch `DashboardHeatmap.jsx`, which builds
its own column list straight from `ACTIVITY_TYPES` rather than
`METRIC_OPTIONS`, so the existing heatmap is unaffected.

Below the tiles: an **Activity mix** stacked bar chart (Calls/Site
visits/Offers sent/Bookings, bucketed by working day/ISO week/calendar
month depending on the period filter — geometry follows the handoff's
exact spec: a 176px bar scale inside a 200px plot box, segments separated
by an inset shadow rather than a gap so heights stay exact), a **Leads
assigned** table (this exec's open leads, worst-touch-first, each row
linking to `/leads/:id`), and a right rail of **Conversion funnel**
(computed bottom-up per the handoff's formula so it can't contradict the
Bookings tile — both read the same won-count query), **Pipeline owned**
(grouped by stage), and **Activity log** (this exec's own recent raw
activity feed across all types, reusing `fetchActivityLogForEmployee` —
distinct from the per-activity-type `fetchActivityLogForExec` the
Dashboard heatmap's cell drill-down already uses).

### My Team (`src/pages/MyTeam.jsx`)

`/team`, **owner-only** (`ProtectedRoute allowedRoles={['owner']}` in
`App.jsx` — a sales exec hitting this URL directly gets redirected to `/`,
same as any other role mismatch; there's also no nav link or `HOME_TILES`
entry pointing here for that role, so it's never surfaced to them). A card-
grid directory of the owner's team, reachable from `BottomNav`'s desktop
sidebar (a `.vip-nav-extra` link right after Parties, with its own icon —
`IconTeam` in `NavIcons.jsx`, deliberately a 3-person glyph, distinct from
`IconUsers`'s 2-person one already used for Parties) and, unlike All
Leads/Parties, from a real `HOME_TILES` entry too, so the owner can reach it
on a phone.

* **Data** — `fetchTeamMembers()` (`src/lib/employeeQueries.js`) selects
  every employee row with `role != 'owner'` — "my team" is defined as the
  owner's non-owner employees, not a raw dump of the whole `employees`
  table (which would include the owner's own row, and any co-owner
  accounts). Today that's only ever `sales_executive` rows, since those are
  the only two roles this app has. `is_active` employees still show
  (deactivate, never hide, same as everywhere else in this app) — an
  inactive row gets a muted "Inactive" pill next to their name instead of
  being filtered out.
* **Search + role filter** — a plain client-side name search (`vip-input`,
  same pattern as `PartiesCard`'s), plus a `vip-seg-outline` segmented
  control for role, built from `[...new Set(employees.map(e => e.role))]`
  rather than a hardcoded list — so if a role beyond `sales_executive` ever
  gets added to the team, the filter grows on its own with no code change
  here, same reasoning `PartiesCard`'s dynamic `party_type` filter already
  uses. `ROLE_LABELS` in `MyTeam.jsx` is the one place a role gets a
  human-readable label; extend it, don't hardcode a new label inline.
* **Per-card stats** — "Open leads" count and "Open pipeline" value, computed
  client-side from `fetchLeadsForBreakdown()` (`src/lib/dashboardQueries.js`)
  — the same unbounded, RLS-open-to-owner query Dashboard/EmployeeProfile
  already fetch, grouped by `owner_employee_id` here. No dedicated
  per-employee query; this is the same "reuse the shared breakdown fetch"
  pattern `LeadsByCategoryCard` and friends use.
* **Layout** — `.vip-team-grid`: a single column on mobile (`.vip-wide`'s
  normal stacked-flex behavior), switching to
  `grid-template-columns: repeat(auto-fit, minmax(270px, 1fr))` at ≥1024px
  (see `vipsar-theme.css` section 19). Deliberately `auto-fit`, not a fixed
  column count — team headcount is open-ended, unlike Needs Attention's
  always-5 buckets (section 17's `.vip-dd-attn-grid`, which uses a fixed
  `repeat(5, 1fr)` for exactly that reason). `auto-fit` collapses unused
  tracks and stretches whatever cards exist to fill the row, so filtering
  down to one result (via search or the role filter) still fills the row
  edge to edge instead of leaving a bare gutter — confirmed live in the
  browser preview, not just reasoned through.
* Each card is a `<Link to="/employees/:id">` (no `EmployeeLink` needed —
  the whole card is already the one clickable target, nothing nested inside
  it) straight to that employee's Sales Exec Profile — this screen is
  deliberately just a directory/entry point, it doesn't duplicate anything
  `EmployeeProfile.jsx` already shows (rank, attainment, activity mix, etc.).

### Follow-ups (personal + owner-assigned reminders, with real push notifications)

New `follow_ups` table (self-service reminders, not tied to logging an
activity — see Conventions for its RLS shape) plus `push_subscriptions`
(one row per subscribed browser/device). Fills the gap the "Current state"
list used to flag: a sales exec can set a reminder for themselves, and an
owner can assign one to any sales exec — each with a required due date, an
optional time, a required short title, an optional link to a party, an
activity-type tag once a party's linked, and an always-optional notes field.

* **`FollowUpForm.jsx`/`FollowUpList.jsx`** (`src/components/`) — the shared
  create form and row-list, reused by both surfaces below. The date field
  reuses `FOLLOWUP_OPTIONS`/`followupDateFor` from `src/lib/followupDates.js`
  (extracted out of `LeadQuickActions.jsx`'s existing "Set follow-up" quick
  action so both can't drift into different date math). Linking is
  **party-only** in the UI — there's no separate "pick a lead" step — but
  `FollowUpForm` silently resolves that party's most recent lead app-side via
  the *existing* `fetchLeadsByParty`/`mostRecentLeadByParty` helpers in
  `src/lib/partyQueries.js` (the same ones `PartiesCard` already uses for its
  "worked with" links), and if one resolves, saving the follow-up **also**
  sets that lead's `next_followup_date` to the same due date in the same
  save call — mirrors `LeadQuickActions`' existing "Set follow-up" write
  exactly (a plain overwrite, not a merge), so this doesn't create a second,
  out-of-sync "when's the next touch" field. A party with more than one lead
  resolves to whichever is most recently created — same ambiguity
  `PartiesCard`'s "worked with" column already accepts, not a new one.
  Activity type (shown only once a party's picked) reuses the canonical
  `ACTIVITY_TYPES` list plus an `other` option, rather than inventing a
  parallel taxonomy. Editing an existing follow-up's details, and any delete
  UI, are **out of scope for this pass** — only create and mark-done exist
  in the UI (owner-only DELETE still exists at the RLS layer, same as every
  other table, for manual cleanup).
* **Home** (`src/pages/Home.jsx`) — a "Your reminders" card, identical for
  both roles, showing this employee's own not-done follow-ups due today or
  earlier (`fetchDueFollowUpsForEmployee`), with a "+ Add reminder" toggle
  that mounts `FollowUpForm` with `assignedTo` locked to yourself. This is
  also how an **owner** sets a personal reminder for themselves — Home
  renders identically regardless of role.
* **Sales Exec Profile** (`src/pages/EmployeeProfile.jsx`) — a "Follow-ups"
  card in the right rail (after Activity log) showing every follow-up ever
  assigned to this exec, done or not (`fetchFollowUpsForEmployee`), with a
  "+ Assign follow-up" toggle mounting `FollowUpForm` with `assignedTo`
  locked to the exec whose page this is — the actual "owner assigns to a
  specific exec" entry point, and also how an exec adds one for themselves
  from their own profile. `FollowUpList` shows "Assigned by {name}" whenever
  `created_by !== assigned_to`, so an owner reviewing this page can see
  whether their own assigned reminders were followed up on and marked done.
* **Profile** (`src/pages/Profile.jsx` — see its own section below) — a
  "Notifications" card between the identity facts and the owner-only
  settings block, showing this device's actual `Notification.permission`
  state (unsupported/blocked/available) and, when available, a plain
  `.vip-check` checkbox toggling this device's push subscription on/off —
  no dedicated toggle-switch component exists in this app, so this matches
  the checkbox style already used elsewhere.
* **`NotificationPrompt.jsx`** (`src/components/`, mounted globally in
  `App.jsx` next to `InstallPrompt`/`OfflineIndicator`) — a one-time
  dismissible banner (same `sessionStorage`-flag/`.vip-install`-class shape
  as `InstallPrompt.jsx`) prompting to enable notifications, shown only when
  permission has never been asked and this device isn't already subscribed.
  Necessary for discoverability, not polish — without it, push never fires
  for anyone who doesn't independently find the toggle buried in Profile.

**Push delivery** — real OS-level notifications, not just an in-app badge,
which needed new infrastructure this app didn't have before:
* `src/lib/pushSubscription.js` — `subscribeToPush`/`unsubscribeFromPush`
  wrap the browser's own `Notification`/`PushManager` APIs and upsert/delete
  the matching `push_subscriptions` row (keyed on `endpoint`, so the same
  device re-subscribing updates its row instead of duplicating it).
* `vite.config.js`'s `VitePWA` plugin switched from the default `generateSW`
  strategy to `injectManifest` (`strategies: 'injectManifest', srcDir: 'src',
  filename: 'sw.js'`) specifically because `generateSW` can't add custom
  event listeners — `src/sw.js` is now a real, checked-in service worker
  source file that calls `precacheAndRoute(self.__WB_MANIFEST)` itself (same
  file list that used to live under `workbox.globPatterns`, now under
  `injectManifest.globPatterns`) plus its own `push`/`notificationclick`
  handlers. `devOptions.enabled` is still off for the same reason noted
  under PWA installability below — test this via `npm run build && npm run
  preview`, never `npm run dev` (no service worker registers under `dev` at
  all, so `hasActiveSubscription()`/`NotificationPrompt` are effectively
  inert there — not a bug, matches every other SW-dependent behavior here).
* `supabase/functions/send-followup-reminders/index.ts` — a Deno Edge
  Function, deployed and scheduled separately from this app's own Vercel
  build (see Conventions — this needed the same kind of user-driven hand-off
  as a schema migration, just via the `supabase` CLI instead of the SQL
  Editor). Uses the `service_role` key (bypasses RLS entirely — the one
  legitimate place in this app that reads/writes across every employee's
  rows, since a cron job has no `auth.uid()` to satisfy "own data or owner
  role" policies with), finds `follow_ups` rows that are due, not done, and
  not yet notified, sends via `npm:web-push` to every subscribed device for
  that employee, stamps `notified_at` once a send was actually attempted
  (skipped, and retried on the next run, for an employee with no subscribed
  device yet — never silently marked "notified" with nothing sent), and
  prunes any `push_subscriptions` row a send comes back 404/410 against (an
  expired subscription). `due_date`/`due_time` have no timezone (same as
  every other date column in this schema) — the function treats them as IST
  explicitly, defaulting to 09:00 when `due_time` is null. Scheduled via
  Supabase's Cron Jobs (every 5 minutes) — either its dashboard "Invoke Edge
  Function" UI, or a `pg_cron`+`pg_net` SQL job as a fallback.
* VAPID keypair generated once via `npx web-push generate-vapid-keys`. The
  public half lives in `.env`/`.env.example` as `VITE_VAPID_PUBLIC_KEY`
  (safe client-side, that's the point of VAPID); the private half is a
  Supabase Edge Function secret (`VAPID_PRIVATE_KEY`), never committed.

**Not yet verified against a real device**: the actual "grant notification
permission → receive a real push on a locked phone" path — this sandbox's
automated browser can't grant real OS-level notification permission (same
class of limitation already noted for `InstallPrompt`'s iOS hint), so
everything up to and including the `push_subscriptions` write was verified,
but the live end-to-end push send needs a real phone once this ships.

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

**No more in-page tab buttons.** `activeTab` (`'reports' | 'leads' | 'parties'`)
used to be three `.vip-seg` buttons at the top of the page; that row is gone
(see the Dashboard-v2 Design-system bullet's sibling note above) and
`activeTab` is now driven purely by `?tab=` via a `useEffect` on
`useSearchParams()` — `?tab=leads`/`?tab=parties` (Home's "All Leads" tile,
or the sidebar's All Leads/Parties links at ≥1024px, see Structure above),
anything else (including no `?tab=` at all) means **Reports**, which holds
everything below including the category-breakdown cards. **Reports** is the
only one of the three with any mobile entry point right now — Leads/Parties
are desktop-sidebar-only until that gap gets addressed (see Structure).
`LeadsListCard`/`PartiesCard` still fetch independently of the Reports
effects below, since neither is part of the date-range-scoped report data.

* **Date range** (`DateRangeSelector.jsx`) — **Week** (Monday–today) /
  **15D** (rolling 15 days ending today, not calendar-aligned) / **Month** /
  **Quarter** / **Custom** (two date inputs), in that left-to-right order.
  Computed by `src/lib/dateRanges.js`; an incomplete custom range returns
  `null` and the page shows a prompt instead of querying. Week/Month/Quarter
  line up with a `targets.period_type` (see Targets vs. actuals below) —
  15D/Custom don't render Targets vs. actuals at all rather than showing it
  with a fallback message (see that bullet and Needs Attention's below for
  what fills the freed width instead). 15D stays excluded deliberately, not
  as a gap to close later — it's a rolling window with no fixed period
  identity to key a target by (see Targets vs. actuals).
* **Needs Attention** (`NeedsAttentionCard.jsx` + `src/lib/attention.js`,
  shown at every width, `vip-span-2`) — five real queues computed from
  `breakdownLeads` (see the category-breakdown bullet below for that query)
  plus a new `fetchLastActivityPerLead()`: leads with **no activity in 7+
  days**, **quotes sent 5+ days ago with nothing logged since**, **overdue
  follow-ups** (`next_followup_date` in the past), **slipped close dates**
  (`estimated_close_date` in the past), and **RFQs raised 3+ days ago with
  no quote yet**. Thresholds are named constants at the top of `attention.js`
  — tune there, not inline. Every row opens the `ageing` drill-down kind via
  `buildAgeingPanel`; the KPI row's "Stale leads" tile reuses the exact same
  call rather than a second computation (see the Dashboard-v2 Design-system
  bullet above for why that reuse matters generally). For Week/Month/
  Quarter it's paired with Targets vs. actuals inside `.vip-featured-row`
  (narrow sticky aside, see Targets vs. actuals below); for 15D/Custom, with
  no Targets card to pair with, `Dashboard.jsx` renders it alone in its own
  `vip-span-2` row with a `wide` prop. `wide` switches the 5 buckets from
  the vertical row list to a tile grid (`.vip-dd-attn-grid`, ≥1024px only —
  below that, and whenever `wide` is false, it's the plain list) — fixed at
  `repeat(5, 1fr)`, not `auto-fit`, since `attention.js` always produces
  exactly 5 buckets and an `auto-fit` track count leaves a visible empty
  cell on the wrapped row whenever the computed column count doesn't divide
  5 evenly.
* **KPI band** — two parallel views (see the Dashboard-v2 Design-system
  bullet): the original 4-tile grid (Activities/New leads/Pipeline/Won)
  below 1024px, unchanged; `KpiSparkRow.jsx`'s 6 tiles (Order value booked/
  Activities logged/Open pipeline/Win rate/Stale leads/Weighted forecast)
  above it. Only the first, second, and fourth (order value, activities,
  win rate) have a real week-over-week delta and an 8-week sparkline — each
  bucketed from data that has real per-event timestamps to bucket by week
  (`wonEventsInRange`/`fetchActivitiesTrendWindow`/`decidedStageHistory`).
  The other three are point-in-time snapshots with nothing stored over
  time, so they render value-only rather than fabricate a trend — this was
  a deliberate call, not a TODO.
* **Activity counts** (`ActivityCountsCard.jsx`) — counts by `activity_type`
  for the selected range; a fixed 5-row list, always. Used to also render a
  "by exec" matrix (one column per employee, no cap) — dropped in the
  Dashboard-v2 density pass so this card can't grow past 5 rows regardless
  of headcount; per-exec activity counts are still real and visible on the
  Targets heatmap below, and the card's "Details" link opens the same
  `attain` drill-down (`buildActivitiesAttainPanel`) the KPI row's
  "Activities logged" tile does, broken down by activity type rather than
  by exec.
* **New leads by source** (`LeadsBySourceCard.jsx`) — grouped by
  `source_type`. A sales exec only sees Scanning/Showroom Walk-in rows
  (`SALES_EXEC_SOURCES`, now exported for reuse by the drill-down builder)
  — Lixil and referrals are distributed by the owner, not something a rep
  sources themselves, so showing all 5 rows to them was mostly zeros. Owner
  still sees all 5. Two parallel views again: a `DonutChart.jsx` + legend at
  ≥1024px, the original bar-row list below it. Also used to render a "by
  exec" matrix — dropped the same way and for the same reason as Activity
  counts above; "Details" opens the `mix` drill-down (`buildMixPanel`),
  donut + legend with a real all-time (not range-scoped) conversion % per
  source.
* **Closure forecast** (`ClosureForecastCard.jsx`) — leads not `won`/`lost`
  where `quote_sent` is true or `closure_probability` is set, sorted by
  `estimated_close_date` ascending (nulls last). Deliberately **not**
  date-range-scoped — it's a snapshot of the current pipeline, not tied to
  when leads were created. `closure_probability`/`estimated_close_date` are
  set via `SalesProgressSection` on `LeadDetail`. Shows an **Owner** column
  (`employees!owner_employee_id(name)` embedded on `fetchClosureForecast`)
  — the lead's owner is shown wherever a lead appears throughout this app.
  Capped to the soonest 6 rows (`maxRows` prop, already sorted that way) with
  a "+N more · View all" row beneath — this list ran 40+ rows on real data,
  exactly the kind of unbounded card the density pass targeted; the rest is
  one click into the `forecast` drill-down (`buildForecastPanel`: month
  buckets of gross vs. probability-weighted value, plus every row).
* **Targets vs. actuals** (`TargetsVsActualsCard.jsx`) — only ever mounted
  by `Dashboard.jsx` for Week/Month/Quarter; `targets` rows are keyed by
  `period_type`/`period_value`, not arbitrary ranges, so for 15D/Custom the
  card isn't rendered at all — not even a fallback message (see Needs
  Attention above for what fills that space instead). The gate,
  `isTargetPeriod = periodForPreset(preset) != null`, lives in
  `Dashboard.jsx` itself (reusing `periodForPreset` instead of a second
  week/month/quarter check that could drift from it) — the card component
  has no `isTargetPeriod` branch of its own anymore, since it's structurally
  never mounted any other way. `metric_name` is a **closed** list
  (`src/lib/targetMetrics.js`: the five `ACTIVITY_TYPES` values plus
  `order_value`), deliberately not the "suggested options + Other…"
  free-text pattern used for `current_stage`/`site_stage` — an arbitrary
  metric would have a target but no computable actual, which defeats the
  section. Actuals for the five activity-type metrics are a straight count
  from the *same* `activities` array `ActivityCountsCard` already fetched
  for the period — no duplicate query. `order_value` has no timestamp of
  its own, so its actual is approximated via `stage_history`: sum
  `order_value` for leads whose most recent `stage_history` row with
  `stage = 'won'` falls inside the period (`fetchWonStageHistory` in
  `src/lib/targetQueries.js`, deduped client-side to one row per lead since
  the query is pre-sorted `changed_at` desc) — a deliberate, discussed
  approximation, see DECISIONS.md. For the owner at ≥1024px, this is now
  `DashboardHeatmap.jsx` instead of a table — one row per exec, one column
  per activity type plus Order value and a blended Overall column (both
  `targetFor`/`computeOrderValueActuals` exported from this file for the
  heatmap and the drill-down builders to share, so a lookup/total can't
  drift into a second definition), attainment-tinted per the mockup's
  literal 5-step scale. A sales exec (nothing to compare against) keeps the
  plain bar-list at every width; the owner keeps that same list below
  1024px too. Every cell opens a drill-down: the 5 activity-type cells
  fetch that one exec's real log entries on demand
  (`fetchActivityLogForExec`, only queried on click — not preloaded for
  everyone) and show a real "last 20 working days" logging-rhythm bar chart
  (`log` kind); Order value and the blended Overall column build
  synchronously from state already on the page (`attain` kind). Below
  1024px (or for a sales exec), every (employee × metric) combination is
  still shown even with zero activity and no target row — `no target set`
  is rendered explicitly rather than the row being silently omitted. For
  the owner, a "Sales exec" filter (local `useState` inside the card,
  defaulting to "— All employees —") sits above the table — picking one
  narrows the same `employees` array the table already iterates over down
  to a single entry. `src/lib/targetPeriods.js` computes the Week/Month/
  Quarter `period_type`/`period_value` (ISO 8601 Monday-start week and
  calendar quarter, both matching `dateRanges.js`'s own boundaries) —
  shared by both the lookup query and `SetTargetForm`'s prefill, so they
  can't drift out of sync with each other. 15D is deliberately not one of
  these three — it's a rolling window ending today, not a discrete
  calendar period, so it has no fixed `period_value` identity a target
  could be keyed by (unlike Week/Month/Quarter, "last 15 days" means a
  different range every day).
* **Set a target** (`SetTargetForm.jsx`, inside the same card, collapsed
  behind a `+ Set a target` toggle button until clicked — same
  reveal/Cancel shape as Lead Detail's `+ Add contact`, not shown inline by
  default — **owner-only in the UI**) —
  employee/period_type/period_value/metric_name/target_value, the only way
  to populate the `targets` table. Owner-only is a UI-layer choice, not an
  RLS one — `targets`' `own_data_or_owner_role` INSERT policy still
  technically lets a sales exec insert their own row. `period_type` is
  restricted to week/month/quarter in this form (the DB CHECK also allows
  `year`, but nothing on this dashboard displays a year-keyed target yet —
  and the live DB doesn't have `quarter` in its CHECK yet either, see
  Conventions); `period_value` auto-prefills from `targetPeriods.js` when
  `period_type` changes but stays editable, so a future period can be set
  in advance. A successful insert is appended straight into
  `Dashboard.jsx`'s `targets` state (`onTargetCreated`) so the table above
  updates immediately.
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
  own "— Not specified —" label for an unset `product_id`. `maxRows`
  (optional prop, new) caps a card to its top rows plus a "+N more · View
  all" footer — only passed for **Area and Product** (real data, no natural
  ceiling — 11 and 9 rows on real data before this), **not** Stage or Site
  Stage, whose `categoryOrder` is already a short, fixed, meaningful list
  (7 and 6 rows) where trimming would arbitrarily hide a real bucket like
  `lost` rather than an overflow. All four now have a "Details" link:
  Stage's opens the identical `pipeline` panel the Pipeline-by-stage card's
  own link does (same data, no point building a second view of it); Area/
  Site Stage/Product open a new `buildCategoryMixPanel` (`mix` kind, real
  count/share/won-conversion per bucket off the same `breakdownLeads`, just
  not capped) — generic enough that a fifth `LeadsByCategoryCard` instance
  wouldn't need a sixth drill-down kind, just another `buildCategoryMixPanel`
  call.
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
  independently past a max-height. This card and Sales funnel below now sit
  side by side (both half-width, no `vip-span-2`) instead of each taking a
  full row — a Dashboard-v2 layout change, paired deliberately since they're
  the two "shape of the pipeline" cards; get an odd count of half-width
  siblings elsewhere in the grid and CSS leaves a visible gap (see the
  Desktop layout bullet above), so this card's own "Details" link opens the
  same `pipeline` panel (`mode: 'stage'`) as the Table/Board toggle's data.
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
  cards. "Details" opens the same `pipeline` panel as Pipeline by stage,
  just with `mode: 'funnel'` (conversion-rate-between-stages emphasis
  instead of stage-value emphasis) — one builder, two entry points.
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
  correctly absent entirely. "Details" opens the `loss` drill-down
  (`buildLossPanel`) — the same reason bars and competitor list, plus a
  "lost this month" row list this compact card doesn't have room for
  (party/owner/value/date, needs `fetchLossReasons`'s embedded `leads` —
  the compact card's own reason/competitor tallies never needed that join).
* **Parties** (`PartiesCard.jsx`, reached via the sidebar's Parties link —
  see the "no more in-page tab buttons" note above) — every party ever created
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
* **My Leads / All Leads** (`LeadsListCard.jsx`, reached via Home's "All
  Leads" tile or the sidebar's All Leads link — see the "no more in-page
  tab buttons" note above) — a browsable, filterable list of individual
  leads (party name links to `/leads/:id`), ordered `created_at` desc,
  capped at 100. Deliberately **not** wired to the Reports view's
  date-range selector — it's a browse/lookup tool, not a period report.
  **Redesigned** in a later pass to fix real drift from the rest of the
  app (a party-less row fell back straight to `'(no party)'` instead of
  the site-name fallback chain `LeadStageBoard` already used — despite
  that card's own comment claiming they matched — and `source_type`/
  `created_at` were being fetched but never rendered) and to add real
  filtering, which this screen never had. A search box (party/site/owner,
  client-side over the fetched page — same precedent as Parties/My Team)
  sits above a single **Filters** toggle that reveals one panel holding
  all five facets together — Owner, Stage (the same tinted
  `vip-chip-select` pills `LeadStageSection` uses to *set* a stage),
  Source, Status, Quote value — rather than a category-then-value picker;
  closing the panel collapses whatever's active into small removable
  chips (`vip-filter-chip`, the one new theme class this needed) plus a
  "Clear all", so the resting screen stays as clean as before any
  filtering existed. Owner/Stage/Source/Status/Quote value are all applied
  server-side via the now filters-object `fetchLeadsList({ employeeId,
  stage, source, status, minValue, maxValue })` (`dashboardQueries.js`) —
  correct even under the 100-row cap, unlike filtering client-side after the
  fact would be.
  Status is a binary Active/Inactive (`current_stage` not-in vs. in
  `(won,lost)`, mirroring `fetchClosureForecast`'s own not-won-not-lost
  filter) rather than stage-level granularity, since picking one exact
  stage is already what the Stage facet is for. Quote value filters on
  `quote_value` specifically (min/max, debounced 400ms same as any
  free-typed query trigger elsewhere in this app), not `order_value` — the
  two can genuinely differ on a won lead, so a row's displayed figure
  (`order_value ?? quote_value`, the same fallback `attention.js`/My
  Team's stats already use) can rarely sit outside a quote-value range
  that still matched it; accepted as a minor edge case rather than adding
  complexity to reconcile the two fields. Owner shows for both roles
  (trivially always themselves for a sales exec, but "wherever a lead
  appears, show its owner" won out over trimming a redundant column) — for
  the owner it's now one more facet inside the same filter panel
  (`employeeFilter` state, default "— All employees —") instead of its own
  always-visible row above the card; for a sales exec, RLS already scopes
  the query, so it doesn't render at all. There is no more Delete-a-lead
  tool anywhere in the app — Profile's owner-only settings delete parties
  instead, not leads (see the Profile section below); `dashboardQueries.js`
  no longer exports a `deleteLead` (removed as dead code once its one
  caller, `DeleteLeadSection.jsx`, was deleted).
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
(the Settings section that has since moved into Profile, the Sales exec
filters, Why we lose) are correctly absent for that role, not just gated
by an untested `isOwner` flag. Profile's own `isOwner` gate (see its
section below) is the same pattern, unchanged, but wasn't independently
re-verified with a second login in the pass that built Profile — only
reasoned through by inspection. Owner-only DELETE
exists on `leads`/`parties`/`activities`/`targets` (see Conventions) if test
data ever needs cleaning up — the only in-app delete tool left is Profile's
Delete-a-party section (`leads` lost its in-app delete UI in the Profile
merge, see the LeadsListCard bullet above; cleaning up a stray lead now
needs direct Supabase access).

**Dashboard v2 verified against real data too**: every card above and every
`build*Panel` drill-down was driven live in the browser against the real dev
database (not just reasoned through) — Needs Attention's counts spot-checked
against a manual filter of the `leads` table for one bucket; every kind of
drill-down opened at least once (`ageing`, `log` via an on-demand heatmap
cell fetch, `pipeline`, `mix`) and confirmed to show real numbers matching
the compact card it opened from, with no verdict/narrative text anywhere; a
real logic bug caught this way and fixed — the `pipeline` kind's
stage-to-stage conversion chain was producing a nonsensical "won → lost"
card before `lost` got excluded from that sequence (see
`buildPipelinePanel`'s `progression` comment). Resized below 1024px and
confirmed the sparkline/heatmap/donut disappear in favor of the original
cards, Needs Attention still renders full-width, and a drill-down opens as
a genuine full-screen sheet rather than a clipped 600px box — the one row
type dense enough to actually overflow a phone width (`ageing`'s per-lead
owner badge) now hides below 520px rather than clip off-screen (see
`vipsar-theme.css`'s `max-width: 520px` block near the drill-down classes).

Needs Attention's `wide` tile grid (added after the initial Dashboard v2
pass, see its own bullet above) was checked the same way: 15D and Custom
both confirmed to hide Targets vs. actuals entirely and render Needs
Attention alone across the full row at desktop width, with all 5 tiles
filling it edge to edge and no leftover empty cell; Week/Month/Quarter
confirmed unchanged (still the paired featured-row layout); and the mobile
width was confirmed to keep the plain vertical list rather than attempting
the tile grid at phone width.

### Profile (`src/pages/Profile.jsx`)

`/profile`, both roles — the merged replacement for what used to be two
separate screens, `Account` (`/account`) and owner-only `Settings`
(`/settings`). There's no tab or sidebar link for it (unlike the old
Account/Settings entries in `BottomNav`) — it's reached only by tapping the
avatar/nametag: `AppNav`'s header avatar (every route except Home), the
desktop sidebar's `.vip-sidebar-foot` avatar (bottom-left), or Home's own
mobile-only top-right avatar (see the Structure and Home sections above for
all three). The nametag's initials were already first-letter-of-first-name
+ first-letter-of-surname (`getInitials` in `src/lib/initials.js`, splits
on whitespace, falls back to the first two letters of a single-word name) —
unchanged by this merge, just now the thing every entry point links to.

Top to bottom:

* **Identity facts** — Name/Role/Mobile/Email, read-only, unchanged from
  the old `Account` page's own facts card.
* **Notifications** — unchanged from `Account`, see the Follow-ups section
  above.
* **Owner-only settings** (`{isOwner && ...}`, same `employees` state /
  `upsertEmployee` lifted-and-shared pattern the old `Settings.jsx` used) —
  * **Add employee** (`AddEmployeeForm.jsx`) — now collapsed behind a
    "+ Add" toggle in the card header instead of always being on-screen
    (same reveal/Cancel shape as `SetTargetForm`'s "+ Set a target" —
    `AddEmployeeForm` itself no longer renders its own `.vip-card`/title,
    since the parent card + toggle now owns that chrome; wrapping it in a
    second nested card produced a visibly duplicated "Add employee" title
    the first time this was built, caught and fixed in the browser
    preview). Otherwise unchanged: name/mobile/role/Auth User ID (UUID) →
    `insertEmployee` in `src/lib/employeeQueries.js`, **CRM-side record
    only** — creating the actual Supabase Auth login still needs the owner
    to do it manually in the Supabase dashboard first (Authentication →
    Users → Add user, "Auto Confirm User" on) and paste the UUID in, for
    the same `service_role`-must-never-reach-the-browser reason as before.
  * **Manage employees** (`ManageEmployeesSection.jsx`) — was an
    always-rendered list of every employee; now a search box with **nothing
    shown until it matches** ("Type a name to search." / "No employees
    found." otherwise) — the list was long enough that scrolling past it
    to reach Delete a party below was the actual complaint this fixed. Once
    filtered, each matching row is unchanged: editable mobile (own Save),
    editable role dropdown (own Save), Active/Inactive toggle — with
    role/Active still disabled for the owner's own row
    (`isSelf = emp.id === currentEmployeeId`) so an owner can't demote or
    deactivate themselves via RLS's caller-is-owner (not
    row-stays-owner) `owner_only_update` policy.
  * **Delete a party** (`DeletePartySection.jsx`) — replaces the old
    **Delete a lead** tool entirely; deleting leads is no longer possible
    from the UI at all (RLS still permits it, see Conventions, but cleaning
    up a stray lead now needs direct Supabase access). The actual ask was
    for cleaning up a wrongly-added architect/PMC/other contact, not a real
    client — same search-only-then-act treatment as Manage employees above
    (nothing shown until the search matches a name or mobile number), then
    a two-step confirm (Delete → inline "Delete {name}?" with
    Confirm/Cancel) before `deleteParty` (`src/lib/partyQueries.js`) fires.
    **Real constraint surfaced while building this**: `leads.party_id`,
    `activities.party_id`, and `site_contacts.party_id` have no `ON DELETE`
    clause in the schema (plain `RESTRICT`) — only `referred_by_party_id`/
    `other_party_id` are `SET NULL`. So a party that's anyone's actual
    lead/activity-anchor/site-contact fails to delete with a Postgres
    FK-violation error, surfaced verbatim (same "just show `error.message`"
    precedent every delete flow in this app already follows) rather than
    pre-checked client-side — exactly why this tool exists for the
    "wrongly added referrer" case (only `referred_by_party_id`/
    `other_party_id` links, which null out cleanly) and not for a party
    that's already someone's client record.
* **Change password** (`ChangePasswordForm.jsx`, `changePassword` in
  `src/lib/authQueries.js`) — new capability, didn't exist before this
  merge. Collapsed behind a "Change" toggle, same pattern as Add employee
  above. Current password / new password / confirm new password.
  **Re-authenticates with the current password first**
  (`supabase.auth.signInWithPassword`) before calling
  `supabase.auth.updateUser({ password })` — a deliberate choice over the
  simpler "just call `updateUser`" (which Supabase allows on any valid
  session with no old-password check at all): the point is to stop a
  password change from a device that's merely left unlocked, at the cost of
  one extra field and one extra failure mode. Client-side validation first
  (new password ≥ 6 characters — Supabase's own default minimum,
  new === confirm) before the network round-trip; a wrong current password
  surfaces Supabase's own "Invalid login credentials" error and never
  reaches `updateUser` — confirmed live (submitted with a deliberately
  wrong current password and watched the error appear without the password
  actually changing).
* **Log out** — moved to the very bottom, below Change password, instead of
  living inside the owner-only settings block; unchanged `signOut()` call,
  same one `AppNav`'s old logout button used to use.

**Verified live in the browser** (dev preview, owner login): Manage
employees' and Delete a party's search-then-show behavior (typed a letter,
watched matching rows/parties appear, empty state before typing), the
Delete-a-party confirm/cancel step rendering correctly (cancelled rather
than completing a real delete against live data), Add employee's and
Change password's collapse/expand toggles, Change password's mismatch
validation and its wrong-current-password error path end to end, and the
desktop sidebar's hover-expand still working with `.vip-sidebar-foot` now a
`Link` (see the CSS specificity note in the Structure section above). **Not
exercised this pass**: an actual successful employee creation, a real
party deletion, or a real password change (all three would have mutated
the live dev database's test data or credentials for no verification
benefit beyond what the error-path testing above already proved) — same
category of "reasoned through, not independently re-run" as the second
`sales_executive` login check noted earlier in this doc.

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

`vite.config.js`'s `injectManifest.globPatterns` (moved here from
`workbox.globPatterns` when the Follow-ups feature's push notifications
needed a custom `src/sw.js` — see that section) is scoped to
`**/*.{js,css,html,svg,png,ico,webmanifest,woff2}` — this precaches the app
shell only. No `runtimeCaching` rule was added for Supabase, so API calls are
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
- The anon key this app runs on can't execute DDL. Any schema/DB change (new column, altered constraint, etc.) has to be handed to the user as a migration statement to run manually via the Supabase dashboard's SQL Editor — never assume a schema-file edit is reflected in the live database. Confirm with the user that `Schema/` files (schema + `Schema/rls_policies.sql`) have actually been run against the live project rather than trusting their presence in the repo. Currently outstanding: `tostem_crm_schema.sql`'s `parties.party_type` CHECK includes `'pmc'` but this has not been run live — the constraint is named `parties_party_type_check` (confirmed via the exact error it throws today), so `ALTER TABLE parties DROP CONSTRAINT parties_party_type_check, ADD CONSTRAINT parties_party_type_check CHECK (party_type IN ('client','architect','builder','firm','other','pmc'));` is the migration once someone's ready to run it. Also outstanding: `tostem_crm_schema.sql`'s `targets.period_type` CHECK now includes `'quarter'` (added for the Set-a-target Quarter option — see the Dashboard section's Targets vs. actuals bullet) but this hasn't been run live either — Postgres's default name for an unnamed inline CHECK is `<table>_<column>_check`, so (unconfirmed against the live error, unlike the `pmc` case above — verify the constraint name first if it errors) the expected migration is `ALTER TABLE targets DROP CONSTRAINT targets_period_type_check, ADD CONSTRAINT targets_period_type_check CHECK (period_type IN ('week','month','quarter','year'));`. Until this runs, saving a Quarter target through the UI will fail with a CHECK-violation error from Supabase. Also outstanding: `tostem_crm_schema.sql`'s new `lead_owner_history` table (added for the Lead Profile's "Reassign owner" action and its ownership-history list — same append-only shape as `stage_history`) hasn't been created live yet — run the `CREATE TABLE lead_owner_history (...)` statement from the schema file plus its matching `authenticated_select`/`authenticated_insert` policies from `rls_policies.sql` before that action will work; until then, reassigning an owner will fail with a "relation does not exist" error from Supabase.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup — none planned. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
- Row Level Security (full policies in `Schema/rls_policies.sql`): `activities`/`leads`/`plans`/`targets` use "own data or owner role" (by `employee_id`/`owner_employee_id`, or role=`'owner'`) for SELECT/INSERT/UPDATE, plus **owner-only DELETE** (no "own data" exception — a sales exec can create/edit their own rows but can't delete even those; only an owner can). `employees`: SELECT open, INSERT/UPDATE/DELETE owner-only with **no self-update exception** (a sales exec must never set their own `role` to `'owner'`). `sites`/`parties`: SELECT/INSERT open to all (needed for search-before-create across reps), UPDATE is "own data or owner role" (`discovered_by`/`created_by`), DELETE owner-only. `areas`/`site_contacts`: SELECT/INSERT open, UPDATE/DELETE owner-only (shared master data / append-style joins — no per-row "own data" concept applies). `products`: SELECT open, else owner-only. `stage_history`: SELECT/INSERT open, no UPDATE/DELETE ever, for anyone including owner — permanently append-only by design. `lead_owner_history` is the same shape/policy as `stage_history` (SELECT/INSERT open, no UPDATE/DELETE ever) — see the outstanding-migration note above, it isn't live yet. `loss_reasons`: SELECT owner-only, INSERT open, no UPDATE/DELETE ever, same append-only-forever reasoning. `follow_ups` is "own data or owner role" keyed on `assigned_to` (not `created_by`) for SELECT/INSERT/UPDATE plus owner-only DELETE — same shape as activities/leads/plans/targets, see the Follow-ups section. `push_subscriptions` is narrower: SELECT is "own data or owner role" (keyed on `employee_id`), but INSERT/UPDATE/DELETE have **no owner-role exception at all** — a subscription is tied to one specific browser instance, so only the device's own employee can write it; real cross-employee cleanup of dead subscriptions happens via the Edge Function's `service_role` key instead, which bypasses RLS entirely. A write needs both the table GRANT (Step A of `rls_policies.sql`) and the RLS policy to agree — DELETE is granted on the twelve tables with an `owner_only_delete`/`own_data_delete` policy (`employees`/`areas`/`sites`/`site_contacts`/`parties`/`products`/`leads`/`activities`/`plans`/`targets`/`follow_ups`/`push_subscriptions`); `stage_history`/`lead_owner_history`/`loss_reasons` get no DELETE grant at all.
- Deploying/configuring anything on Supabase's or Vercel's side still needs the user to do the parts that require *their own* credentials — the initial `supabase login` (interactive browser OAuth) and anything on Vercel's dashboard (env vars, redeploys) — and Edge Function secrets (`supabase secrets set ...`) are values only the user should be typing in, since a raw `service_role`/VAPID-private-key never belongs in this transcript's tool output. Once `supabase login`+`link` have been run locally, though, subsequent `supabase functions deploy`/`delete` calls work fine from a normal shell session on the same machine — this isn't a hard sandbox limitation the way the initial OAuth is. `supabase init` (to generate `supabase/config.toml`) may be needed before `link`/`deploy` will resolve the project correctly, even if `supabase/.temp/linked-project.json` already exists from an earlier `link` — the CLI keys its local cache off `config.toml`'s `project_id`, not just that temp file.
- **`service_role` does not automatically get access to a new table** on this project — this is a newer Supabase platform default (see `supabase/config.toml`'s `auto_expose_new_tables` comment: "new entities are NOT auto-exposed, matching the new cloud default"), which broke the assumption that an Edge Function's `service_role` key bypasses everything automatically. Real failure mode hit while building the Follow-ups push pipeline: the Edge Function's own `createClient(url, serviceRoleKey)` query came back `permission denied for table follow_ups` / `42501` even though the service_role key was valid and present — PostgREST's own error hint spelled out the fix (`GRANT SELECT ON public.follow_ups TO service_role;`). Any future table a `service_role`-using Edge Function needs to touch needs this same explicit `GRANT ... TO service_role` in `rls_policies.sql` (see the `follow_ups`/`push_subscriptions` grant there for the pattern) — don't assume service_role "just works" on a new table the way it might on an older Supabase project.
- No GPS, geocoding, or drag-and-drop libraries in this project — deliberate (see DECISIONS.md and the Kanban board note above). No icon library either (no `lucide-react`/icon-font dependency) — `src/components/NavIcons.jsx` hand-authors BottomNav's icons as plain inline SVG instead; reuse/extend that file for any new icon rather than adding a package. Everything else icon-shaped stays plain text/CSS.

## Roadmap

0. ✅ Environment + scaffold
1. ✅ Supabase project, schema, RLS policies — confirm they've actually been run (see Conventions)
2. ✅ Employee login (Supabase Auth): login screen, AuthContext, protected/role-based routing
3. ✅ Party/site/lead intake screens (search-before-create pattern)
4. ✅ DPR / activity logging (`ActivityLog` at `/activity`)
5. ✅ Dashboards, Settings (employee management + lead deletion — since
   merged into Profile, see its own section above), Home hub,
   global search, Kanban board, and reporting cards — see the dedicated
   sections above for how each works today.
6. ✅ PWA polish (installable, offline-tolerant for field use) — see the PWA
   installability section above. Out of scope: background sync/auto-retry
   of failed submissions, iOS's more aggressive cache-clearing on inactive
   PWAs.
7. ⬅️ current — Deploy + pilot with 1-2 sales execs before full rollout.
   Still open from the "Current state" list above: a `plans`-table screen,
   role-differentiated Home content, and a screen listing past activities.
   Followups (see the dedicated section) shipped during this phase.

For domain model, lead-sourcing logic, and locked-in design decisions, see DECISIONS.md.
