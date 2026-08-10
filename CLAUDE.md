# CLAUDE.md

Guidance for Claude Code when working in this repository.

## IMPORTANT — ask before you build

**Ask clarifying questions whenever a request leaves real room for
interpretation. This is strongly recommended, not optional, and it takes
priority over any "bias toward acting without asking" default.** The user
has said explicitly, more than once, that they'd rather answer two or three
questions up front than review a screen built on a guess. A wrong guess
costs a full build-and-revert cycle; a question costs one message.

Use `AskUserQuestion` (2–4 questions, with a recommended option marked) as
soon as any of these is true — don't wait until you're stuck:

- The request names a UI change but not the exact placement, shape, or
  wording ("add a lead count alongside the pipeline" — *which* pipeline
  figure? the KPI tile, the card header, both?).
- "Bring back the old look" / "like it was before" — confirm *which*
  previous state, especially when several changes landed in one session.
- A feature could reasonably be inline (filters on the current screen) or
  navigational (a second screen/panel) — these look nothing alike; pick with
  the user, not for them.
- The change removes or replaces something that already exists — confirm
  what happens to what's there now, and what fills the space it leaves.
- Anything touching layout on a screen the user actively uses. This app's
  Dashboard has been reworked repeatedly off vague briefs; a question about
  intent is always cheaper than another visual revert.

Note the difference from a purely technical choice (which util to reuse,
where a class belongs) — those you should still just decide, per the rest of
this file. This rule is about **what the user sees and how it behaves**.

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
- Deliberately **not built yet** — these need their own discussion first,
  don't add them as a side effect of unrelated work: a
  **`plans`-table screen** (the table has full RLS wired up and zero UI
  anywhere in `src/`), **further role-differentiated Home/Today content**
  (the old role-keyed `HOME_TILES`/`src/lib/homeTiles.js` tile-grid pattern
  is gone — see the Mobile redesign section's Today bullet — so a future
  role would need its own new mechanism, not an entry in a map that no
  longer exists), and **a general screen listing past activities**
  (`ActivityLog` only logs new ones; nothing browses old ones freely —
  the Day Review's day sheet lists a given exec's activities *for one
  chosen day*, and a lead's own timeline / a Sales Exec Profile's Activity
  log section cover their own slices, but there's still no
  "all activities, any range, filterable" screen). **Followups**
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
  since this app only has `owner`/`sales_executive`. The `lead_owner_history`
  table (see Conventions) is now live, so "Reassign owner" logs a real
  history entry. **Deliberately out of scope for this pass**: owner-name badges
  inside `DrilldownPanel.jsx`'s deeper bodies (ageing/forecast/pipeline/loss
  row lists) aren't links yet, unlike everywhere else a person's name
  appears — a real gap, not an oversight, left for a follow-up rather than
  rushed edits to that already-shipped file.
- **Dashboard v2** (Needs Attention + a universal drill-down panel reused
  across every metric — see the Dashboard section and its Design-system
  bullet) originally shipped desktop-first (KPI sparkline row/exec heatmap/
  source donut ≥1024px-only, All Leads with no mobile entry point at all) —
  the Mobile redesign pass below closed the All Leads gap (a real `Leads`
  tab now exists on the 4-tab mobile bar) and unhid `KpiSparkRow` at every
  width; the exec heatmap/source donut are still desktop-only by design
  (an owner-facing team comparison view, not meant for a phone).
- **My Team** (`/team`, owner-only — see its own section below) is a card-
  grid directory of the owner's non-owner employees (today, just
  `sales_executive`), with a name search and a role filter, each card
  linking to that employee's Sales Exec Profile. Its mobile entry point
  used to be a `HOME_TILES` tile on Home; since the Mobile redesign removed
  that tile grid entirely, it's now a `.vip-tile` row at the top of
  Dashboard instead (owner-only, mobile-only — see the Mobile redesign
  section's Dashboard bullet) — still a real mobile path, just relocated.
- **Search absorbed the old Parties tab.** Dashboard's `?tab=parties` view
  (`PartiesCard.jsx`, desktop-sidebar-only) and the global `Search` screen
  used to be two separate, confusingly overlapping "find a party" UIs with
  different filter mechanics and different reachability. `PartiesCard.jsx`
  is deleted; its always-loaded party directory (type filter, "Worked with"
  employee links, name/mobile search) now lives inside `Search.jsx` — see
  its own section below — styled with the same Filters-toggle/active-chip
  language `LeadsListCard`'s All Leads redesign introduced, for visual
  consistency. Search was already reachable on every device via
  `BottomNav`'s Search tab, so folding Parties into it also closes "Parties
  has no mobile entry point" as a side effect, not a separate project.
  There is no more `/dashboard?tab=parties` and no more Parties link in
  `BottomNav`.
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
- **Pipeline/deal value now has one canonical definition**, via the new
  `src/lib/pipelineValue.js` — previously Home's "Pipeline" tile,
  Dashboard's "Open pipeline" KPI, the All Leads header, Pipeline by stage
  (table + board), the four category-breakdown cards, EmployeeProfile/
  MyTeam's "Open pipeline" stats, and Needs Attention's row values each
  hand-rolled their own slightly different formula for "how much is this
  lead worth" — caught via a live audit that showed three different
  numbers on screen at once for what looked like one concept. See the
  Dashboard section's **Pipeline/deal value** bullet for the exact rule and
  full list of call sites. **Flagged, not yet resolved**: that same audit's
  SQL check found leads in the live DB with `order_value` set while still
  open (not `won`/`lost`) — contradicting the "a booked order is
  automatically won" assumption the new rule leans on. Doesn't change any
  figure today (see that bullet for why), but the underlying process gap —
  a Booking Update logged without the lead's stage being flipped to `won`
  — is still open; the owner is taking it up later, don't "fix" it as a
  side effect of unrelated work.
- **Day Review** (`Today`, the first period on Dashboard's date-range
  control — see its own section below) is the newest pass: a single-day
  accountability read for the owner, built on a **new `lead_change_log`
  audit trail** written by a Postgres trigger. It also restructured the
  exec's own Today screen into Done-today / Still-to-do halves (see the
  Today section) and fixed a **pre-existing timestamp bug** affecting every
  naive `TIMESTAMP` column in this schema — read that section's Timestamps
  paragraph and use `src/lib/dbTime.js`'s `parseTimestamp` before rendering
  any date or time from the database.
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
                SalesFunnelCard, LossReasonsCard,
                NeedsAttentionCard, KpiSparkRow,
                DashboardHeatmap, DonutChart, DrilldownPanel,
                AddEmployeeForm, ManageEmployeesSection,
                DayReviewCard, DayReviewHeader (exports DayDateBar +
                DayKpiStrip — see the Day Review section),
                DeletePartySection, ChangePasswordForm, InstallPrompt,
                NotificationPrompt, OfflineIndicator, FollowUpForm, FollowUpList,
                FabSheet — the mobile shell's FAB bottom sheet, see the
                Mobile redesign section)
  pages/        top-level views (Login, Home [renders Today, see the Mobile
                redesign section], Profile, Search, Dashboard,
                LeadQuickCapture, LeadDetail, EmployeeProfile, MyTeam,
                ActivityLog, ...)
  contexts/     AuthContext — session + employee (id/name/mobile/role) lookup;
                HeaderContext — lets Lead Detail/Sales Exec Profile/Dashboard
                push a dynamic {title, sub} override into AppNav's header
                (see Design system below)
  hooks/        custom React hooks (useOnlineStatus.js — added for the
                Mobile redesign's SYNCED/OFFLINE pill + offline notes)
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js, leadStageOptions.js, lossReasonOptions.js,
                statusColors.js, activityTypes.js, sourceTypeOptions.js,
                dateRanges.js, dashboardQueries.js, searchQueries.js, format.js,
                targetMetrics.js, targetPeriods.js, targetQueries.js,
                partyQueries.js, employeeQueries.js, leadOwnerHistory.js,
                tabRoutes.js, attention.js, drilldownBuilders.js,
                dayReviewQueries.js, dayReview.js, dbTime.js — the Day
                Review's day-scoped fetches, its pure aggregation, and the
                one correct way to parse a timestamp out of this schema
                (see the Day Review section),
                followUpQueries.js, followupDates.js, pushSubscription.js,
                theme.js — light/dark override, see the Design system
                section's Dark mode bullet — `homeTiles.js` is deleted, see
                the Mobile redesign section)
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
redirect-to-login and role gating (redirecting to `/` on a role mismatch),
plus a hard block — a full-page "Account deactivated" message with a Log
out button, no `AppNav`/`BottomNav` — for `employee.is_active === false`,
checked before the role gate. `AuthContext` now selects `is_active`
alongside `id`/`name`/`mobile`/`role` for exactly this. This is the UI
mirror of what `Schema/rls_policies.sql`'s `current_employee_id()`/
`current_employee_role()` enforce server-side (see Conventions) — a
deactivated employee's already-open session gets blocked at the database
layer immediately, the `ProtectedRoute` screen just makes the reason
visible instead of every query silently coming back empty.
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
including **New Lead**, **Activity Log**, **All Leads**, and (owner-only)
**My Team** (see the Desktop layout bullet below) — these all have their
own separate mobile-reachable paths instead (the 4-tab bar + FAB for New
Lead/Activity Log/Dashboard/Leads, a Dashboard-page tile for My Team — see
the Mobile redesign section for the current shape of all of this; the old
"All Leads/My Team have no mobile path" gaps this paragraph used to
describe are closed). Parties used to be a third `.vip-nav-extra` link
here with the same kind of gap — it's gone now, folded into `Search` (a
`BottomNav` tab reachable on every device already), see "Current state"
above and the Search section below. `AppNav` is a per-route header (title/sub/back button/avatar),
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
imports it before the theme file. Section numbering runs 1–23; **22 is dark
mode and stays physically last in the file** even though 23 (Day Review) is
numbered higher — 22 only overrides `:root` tokens and `.vip-chip-*`, so
nothing in 23 can beat it, and keeping the token redefinitions at the end is
the whole point of that section. Add new sections after 23.

**Watch the `.vip-only-mobile`/`.vip-only-desktop` cascade trap when adding a
class that sets `display`.** Both utilities are single-class rules
(`.vip-only-mobile { display: none }` lives inside section 17's ≥1024px
block), so any *unguarded* `display` you declare on the same element in a
later section wins at equal specificity and leaks the hidden half through.
This has now bitten twice — `.vip-leads-layout` (section 21) and
`.vip-daycards` (section 23) — both fixed the same way: leave `display` out
of the base rule and set it only inside the media query that should own it.

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
  `ROUTE_HEADERS` lookup), a back button
  (`vip-iconbtn`) on every route except `src/lib/tabRoutes.js`'s
  `TAB_ROUTES` (`/`, `/search`, `/dashboard` — the Mobile redesign's 4-tab
  bar's routes, see that section; the same set also drives
  `ProtectedRoute.jsx`'s `.vip-drilled` class, which hides the whole mobile
  tab bar on every other route
  — `/profile` deliberately isn't one of these either, so it keeps
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
  back to a dedicated neutral fallback grey — not aliased to any real
  stage's color — for a `current_stage` value that isn't a recognized
  stage at all; `LeadStageSection`'s chip picker no longer offers a way to
  create one of these, see the Lead stage taxonomy section below, but
  `current_stage` staying free text at the DB layer means one could still
  exist from older/imported data); `stageFg` exposes the raw foreground
  color for places that only tint text/borders rather than fill a chip
  (the stage board's column border, the sales funnel's bar fill,
  `LeadStageSection`'s selectable chips below, the Deal progress
  stepper's per-segment color). Display text never reads the raw stage
  value directly — `stageLabel()` (`src/lib/leadStageOptions.js`) maps it
  to a human label everywhere a stage is shown, falling back to the raw
  value unchanged for that same legacy-unrecognized case. See the Lead
  stage taxonomy section further down for the current stage list itself.
* **Lists are rows, not tables** — every list/breakdown screen (Closure
  forecast, Leads list, Search's party directory, the category breakdowns,
  activity-by-exec) renders `.vip-row`/`.vip-bar-row`/`.vip-matrix-row`
  stacks instead of a `<table>` — the design handoff's other top complaint,
  a wide table only reading correctly on desktop. Segmented controls
  (`.vip-seg`) replaced full-width button rows everywhere there's a tab or
  filter (the date-range selector, exec filters — Dashboard's own
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
  is a row of tappable `vip-chip-select` pills, one per `LEAD_STAGE_OPTIONS`
  value (see the Lead stage taxonomy section below for the current list),
  tinted via `stageFg`; tapping one applies that stage immediately via the
  same `stage_history`-logging path as before — **except `lost`, `on_hold`,
  and `won`**, all three of which withhold the write until their own prompt
  is confirmed (see the Lead Profile section's Change stage bullet and the
  Lead stage taxonomy section's On Hold write flow below; a real bug found
  and fixed after the initial redesign — `applyStage` used to commit
  `current_stage`/`stage_history` for `lost` *before* the reason prompt
  even opened, so closing the sheet or navigating away left a lost lead
  with no reason on file, silently violating DECISIONS.md's "no
  skip-for-now escape hatch" rule). `won`'s prompt requires an order value
  (pre-filled from the lead's existing `order_value`/`quote_value` if any)
  before the stage change is written — see the Lead Profile section's
  Change stage bullet for why. The picker's free-text "Other…"
  escape hatch (a text input + Set button for typing a custom stage) was
  removed entirely in a later pass, at the user's request — every stage a
  rep can pick is now one of the 11 real `LEAD_STAGE_OPTIONS` chips, no
  custom-typed stage is reachable from the UI anymore. `current_stage`
  staying non-enum at the DB layer is still a locked-in decision (see
  DECISIONS.md) — this only removed one UI entry point for creating a
  custom value, not the free-text column itself, so the app-wide fallback
  rendering for an unrecognized stage (see the Stage colors bullet above)
  stays in place for any value that predates this change.
* **Universal linking** — the rule of thumb from `design_handoff_detail_pages/
  FLOW.md`, applied globally: a person's name is always a link to
  `/employees/:id`; a lead or client's name is always a link to
  `/leads/:id`. Covers `LeadsListCard`, `ClosureForecastCard`, Pipeline by
  stage's own Leads view, `Search`'s party directory "Worked with" links, its
  Leads results, `LeadActivityTimeline`'s "by {employee}", and the
  Dashboard heatmap's row-header name (clicking a **cell** still opens the
  existing metric drill-down, unchanged — only the name itself navigates).
  `EmployeeLink.jsx` exists specifically for the case a person's name has
  to render *inside* a row that's already a `<Link>` to something else (a
  lead, a party) — a literal nested `<a>` would be invalid HTML and break
  the outer row's click target, so it navigates via `useNavigate` +
  `stopPropagation` instead; use a plain `<Link to={`/employees/${id}`}>`
  anywhere there's no outer link to nest inside. `Search`'s party rows (no
  single lead in view) link to that party's **most recent lead** if they
  have one (`fetchLeadsByParty`/`mostRecentLeadByParty` in
  `partyQueries.js` — `party_id` only, not `referred_by_party_id`/
  `other_party_id`, since only `party_id` makes them "the lead"), else stay
  non-clickable, same as before. **Known gap, not finished everywhere**:
  owner-name badges inside `DrilldownPanel.jsx`'s deeper bodies aren't
  linked yet — see "Current state" above.
* Home's tiles gained a fourth entry, **All Leads** (links to
  `/dashboard?tab=leads`) — `Dashboard.jsx` has no in-page tab buttons
  anymore (see the Dashboard section's "no more in-page tab buttons" bullet),
  so `?tab=leads` via `useSearchParams()` is now the *only* way to land on
  that view (`?tab=parties` used to be a second one, before Parties merged
  into Search — see "Current state" above); a plain `/dashboard` (or
  `?tab=` unset) always means Reports. Synced with a `useEffect` on
  `searchParams`, not a `useState` initializer, since navigating between
  sidebar links while already on `/dashboard` changes the query string
  without remounting the page — an initializer would only ever see the
  first value.
* **Desktop layout (≥1024px)** — this bullet describes ≥1024px only and is
  unaffected by anything in the Mobile redesign section further down (that
  pass only ever touches `@media (max-width: 1023.98px)` rules or the
  `.vip-only-mobile` side of a paired class, never this breakpoint). At
  ≥1024px, `BottomNav.jsx` becomes a persistent left sidebar
  (`--vip-sidebar-w`, 232px): the same Home/Search links plus five
  `.vip-nav-extra` ones (New Lead, Activity Log, Dashboard, All Leads, and
  — owner-only — My Team) — all five have their own separate mobile paths
  too now (the 4-tab bar + FAB, plus a Dashboard-page tile for My Team —
  see the Mobile redesign section, not Home's tiles, which no longer
  exist), a brand block
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
  single lists: LeadDetail, LeadQuickCapture, ActivityLog, Profile, Search)
  or `.vip-wide` (1180px — Home, and both of Dashboard's tabs, Reports and
  Leads). Dashboard's Leads tab used to be `.vip-narrow` despite showing six
  columns' worth of data per row and a five-facet filter panel — caught by a
  code review as the precise failure mode this paragraph warns about (huge
  empty gutters at desktop width) and moved to `.vip-wide` — see the
  Dashboard section's own LeadsListCard bullet for the persistent-rail +
  real-columns redesign that came with it. Inside `.vip-wide`, Dashboard's report
  cards sit in `.vip-report-grid` (2 columns); a card wrapped in
  `.vip-span-2` breaks out to the full row instead — used for cards whose
  content needs the width (Closure forecast, the Targets-vs.-actuals-plus-
  Needs-Attention featured row, Why we lose, and — since it's the odd one
  out — Leads by product), so Activity counts + Leads by source, Pipeline by
  stage + Sales funnel, and Leads by area + Leads by site stage are the
  three pairs that actually sit half-width. Get this pairing wrong (an odd
  number of half-width cards in a row) and CSS grid leaves a visible gap —
  checked via computed `getBoundingClientRect()` during build, not just
  eyeballed. Home's tile
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
  `buildAgeingPanel(staleBucket)`. Sales funnel used to have its own
  "Details" opening this same `pipeline` panel — removed, see the Sales
  funnel bullet below for why.
* **Color tokens** — a code-review finding flagged 216 inline `style={{}}`
  objects and 85 hardcoded hex colors across `src/`, worst in
  `LeadDetail.jsx` (46 inline styles) and `DrilldownPanel.jsx` (24) — plus
  `GOOD`/`OK`/`BAD` traffic-light constants independently redeclared (and,
  between `LeadDetail.jsx`/`EmployeeProfile.jsx` vs `MyTeam.jsx`, not even
  agreeing with each other — `#b8791f` vs `#7a6413` for "OK") in three
  separate files, against this section's own "never per-component CSS, add
  a `vip-` class instead" rule. Fixed in `LeadDetail.jsx` and
  `DrilldownPanel.jsx` first (216→177 inline styles between the two, 0
  hardcoded hex in either, remainder verified to be legitimately
  per-row/per-state computed values, not reachable via a static class) —
  `EmployeeProfile.jsx`/`MyTeam.jsx` still have the same unfixed pattern,
  left for a follow-up pass rather than widened here. New shared tone
  tokens (`--vip-status-warn`/`-good-soft`/`-warn-soft`/`-bad-soft`/
  `-neutral`/`-neutral-soft`/`-mid`, `--vip-teal`/`--vip-lost` doubling as
  the good/bad foreground) live in `vipsar-theme.css`; `src/lib/
  statusColors.js` exports them as `TONE_GOOD`/`TONE_WARN`/`TONE_BAD`/etc.
  — the one place a health/status pill or deal-stat color should be read
  from now, not a locally redeclared hex constant. A handful of new
  `vip-`-prefixed shape classes (`vip-kv-row`, `vip-owner-link`,
  `vip-contact-row`, `vip-linegrid-quotes`/`-scope`/`-value`/`-date`, a
  `.vip-stepper-col-current .vip-stepper-label` descendant rule, etc.)
  replaced the recurring inline layout objects those two files had been
  reimplementing per instance. One real duplication bug caught in the
  process: `DrilldownPanel.jsx`'s forecast-panel header row
  (`.vip-dd-fc-head-row`'s five `<span>`s) reimplemented via inline
  `style={{flex: ...}}` the exact column widths its own data-row classes
  (`.vip-dd-fc-owner`/`-prob`/`-value`/`-close`) already declared — fixed
  with a positional `.vip-dd-fc-head-row > span:nth-child(n)` rule instead
  of reusing those classes directly (which also carry font-size/color
  overrides the header row doesn't want). Verified live against real leads
  in every state this touched (on-hold, at-risk/stale, won-with-quote-and-
  order) at desktop and mobile widths, plus the Forecast and Mix
  drill-downs — every computed style matched the pre-refactor value exactly.
* **Dark mode** (`src/lib/theme.js`, section 22 of `vipsar-theme.css`) —
  the theme being fully tokenized (see the Color tokens bullet just above)
  is what made this a `@media (prefers-color-scheme: dark)` block plus a
  `:root[data-theme]` override, not a per-page rewrite: nearly every
  card/text/border color downstream repaints for free. Two ways in: system
  preference (automatic, zero action needed) and a manual override, three-
  way **Light/Dark/System** segmented control in Profile's new
  **Appearance** card (see the Profile section below) — `system` removes
  the `data-theme` attribute entirely and falls back to the media query,
  `light`/`dark` pin it regardless of the OS setting. The dark block's own
  selector is `:root:not([data-theme="light"])` inside the media query —
  that guard is what lets one ~30-property token list serve both "system
  prefers dark, no override" and "system prefers dark, user picked dark"
  without a third near-duplicate block just to force light against a dark
  system (forcing light only ever needs to *suppress* the media query, not
  redeclare values that are already the file's own light-mode defaults).
  `index.html` has a tiny inline `<script>` (before any CSS/JS loads) that
  reads the same `vip-theme` localStorage key and sets the attribute pre-
  paint, so a stored choice never flashes the wrong theme for a frame —
  keep it in sync with `theme.js` if that key ever changes. The 11
  `.vip-chip-<stage>` pairs (section 6) got hand-picked dark equivalents
  too (they were never tokens to begin with — nothing else reuses a single
  stage's color, so there was no reuse case for promoting them to custom
  properties, just an override per class per theme block). `--vip-shell-*`/
  `--vip-on-shell-*`/`--vip-amber` are deliberately untouched — the header/
  bottom-nav/login screen are already a dark chrome regardless of app
  theme (section 13), and `--vip-amber` is only ever a colored background
  with white text on top (offline banner, sync-dot), never on-card text, so
  there was nothing to invert. **Known gap, not fixed here**: a few
  decorative one-off accents never went through a token at all —
  `DashboardHeatmap.jsx`'s attainment-tier colors and the activity-mix
  sparkline/rhythm-bar tints (`.vip-dd-kpi-spark-up`/`-down`,
  `.vip-dd-rhythm-filled`, `.vip-chart-ytick`) — still legible against a
  dark card (they're colored fills, not the only source of contrast for
  text) but not re-tuned for it. Verified live: system-dark auto-detect,
  an explicit Light override correctly winning even with the OS in dark
  mode, explicit Dark, persistence across a real reload with no flash, and
  visual correctness (chips, pills, deal stats) across Lead Detail, the All
  Leads stage list, and Home — both desktop and mobile. **Testing gotcha
  worth knowing**: this app's own service worker precaches `index.html`
  (see PWA installability below), so an already-installed SW from earlier
  in a session keeps serving the old cached shell even after a fresh
  `npm run build` — unregister it (or bump past its update cycle) before
  trusting what a preview tab shows for an `index.html`-level change like
  this one.

### Today (`src/pages/Home.jsx`)

`/` is the landing page after login for both roles, still the one route
`AppNav` renders nothing for (`AppNav.jsx` returns `null` when
`pathname === '/'`) — a greeting bar (`.vip-today-head`: time-of-day
greeting via `greetingForTime`, falling back to "Hello" late at night, plus
a SYNCED/OFFLINE `.vip-sync-pill` from `useOnlineStatus()` and an avatar
`Link` to `/profile`) is the page's own heading, so the screen starts flush
at the top (`.vip-home .vip-body` swaps the fixed-header padding-top
allowance for a small safe-area-aware one instead). Rebuilt in the Mobile
redesign pass (see that section for the full breakdown — greeting bar/KPI
grid/target bar/work queue/reminders/closing-next) from a tile-based
shortcut screen into the current form; `src/lib/homeTiles.js`/`HOME_TILES`
(the old role-keyed tile config) is deleted, not just unused — read the
Mobile redesign section before assuming a "Home tile" mechanism still
exists anywhere.

**Restructured again by the Day Review pass (2026-08-10)** into the two
halves that handoff's screen 4c asks for. **There is no check-out flow, no
modal, no gate on logout, and the phrase "wrap up your day" appears
nowhere** — the screen just answers both questions whenever the rep looks at
it. Top to bottom now: greeting bar → **Done today** → **Still to do today**
→ the standing work buckets.

* **Done today** replaces the old "My numbers" W/M/Q/Y KPI grid entirely
  (`KPI_TILES` and both of its parallel mobile/desktop markups are gone).
  Four tiles — Activities, Follow-ups `done / due`, Leads touched, Quotes
  sent — from one `fetchDayReview(todayISO())` call run through
  `buildDayRows([employee], …)`, i.e. **the exact same aggregation the
  Dashboard's team table uses**, for this employee alone, so the two can't
  disagree. A "since 9:12 am" note comes off the first activity logged.
  Below it, a card of the day's three most significant entries
  (`buildSignificantEntries` — teal dot = activity, navy = a lead edit,
  red/green = lost/won) ending in **"See everything I logged today"**, which
  opens this employee's own `daySheet` panel — the same panel the owner sees.
* **Still to do today** replaces the old "Your reminders" card, keeping its
  `+ Add reminder` toggle (so nothing was lost). Each open follow-up — due
  today *or already late* — is a card with a red left bar, its own urgency
  line ("3 days late" / "due 11:00 am"), and **one action**: Call (a real
  `tel:` link on the most urgent, which is why `FOLLOW_UP_SELECT` now
  embeds `parties(name, mobile)`) or Move (an inline reschedule panel).
  Capped at 3, then "+N more · see all" opening the existing `followup`
  drill-down kind. Followed by a **Tomorrow** row.
* **The work queue lost its two follow-up rows** (Overdue follow-ups / Due
  today). Those were the same reminders "Still to do today" now lists in
  full, and the user's whole reason for picking this option was to stop
  showing them twice. What's left is the three lead-ageing buckets (stale /
  silent quotes / slipped) — the queue is now about leads going cold, which
  is genuinely distinct from a reminder.
* **The W/M/Q/Y period switch moved onto the "Order value vs target" card.**
  It used to head the "My numbers" grid; that grid is now a single day with
  no period to pick, and the target bar is the only block left that has one.
  `PERIOD_LABEL_SUFFIX` went with it — the control itself now says which
  period is showing.

**Real duplicate-fetch bug found and fixed** (a code-review finding, part of
a broader "every dashboard downloads the whole company and reduces it in
the browser" audit — the same performance-review lineage as Conventions'
note on the `leads`/`activities` indexing fix, a separate earlier pass on
the same theme): this page used to call
`fetchLeadsForBreakdown()` — a full, unbounded `leads` scan — from two
separate effects, once for the work-queue attention buckets and again for
the KPI/target-bar numbers, so it fired twice on every load and a third
time on every period (W/M/Q/Y) toggle even though neither of those figures
is actually period-scoped (`breakdownLeads` is the same period-agnostic
pipeline snapshot described in the Dashboard section's Pipeline/deal value
bullet). Fixed by fetching it once into `breakdownLeads`/
`lastActivityByLead` state and having both consumers read that instead —
`attentionBuckets` is now a plain derived value, not its own fetch+state.
Verified live with a `window.fetch` counter: one call on load (was two),
zero on a period toggle (was one redundant refetch every time). The rest of
that audit's findings — `EmployeeProfile`'s seven queries (four unbounded)
refiring on its own period toggle, and moving the shared aggregations
(`fetchLeadsForBreakdown`/`fetchLastActivityPerLead`/`fetchWonStageHistory`/
`fetchDecidedStageHistory`/`fetchStageHistoryForFunnel`) into Postgres
views/RPCs so a phone doesn't download and reduce the whole company's data
client-side — are **not** fixed yet, deliberately deferred: harmless at the
pilot's current ~76-lead volume, real schema work (views/RPCs need a
migration only the user can run, see Conventions) worth doing closer to
full rollout rather than against today's dummy data. See also the Search
section's `fetchLeadsForPartyDirectory` bullet for the other half of that
same audit that *was* worth fixing immediately (a pure client-side merge,
no schema change).

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

Mobile-only addition from the Mobile redesign pass, not described below:
below 1024px a `.vip-seg` Parties/Leads/Sites switch shows one section at a
time (`.vip-search-hide-mobile`) — desktop still stacks all three exactly
as this section describes. See the Mobile redesign section for the class.

Global search, reachable via `BottomNav`'s **Search** tab, both roles — and
now the *one* place in the app to find or browse a party, since the old
`/dashboard?tab=parties` view (`PartiesCard.jsx`) was folded in here (see
"Current state" above). The two used to be confusingly separate: Search
required 2+ typed characters and hit the DB for a bounded top-10 party
match, while the Dashboard's Parties tab eagerly loaded and client-side-
filtered the *entire* party directory, with its own differently-shaped
type filter, and was desktop-sidebar-only. There is exactly one "find a
party" UI now.

Deliberately **not** built on `PartySearchOrCreate`/`SiteSearchOrCreate` —
this searches across all three entities at once and neither party nor site
results are meant to be created inline here (this is a lookup screen, not
an intake screen).

* **Parties** — `fetchAllParties`/`fetchLeadsForPartyDirectory`
  (`src/lib/partyQueries.js`) load on mount, independent of the search
  box — `parties` SELECT is open to everyone, so this is the full directory
  regardless of role. `fetchLeadsForPartyDirectory` replaced two separate
  full `leads` scans this screen used to run (`fetchPartyEmployeeLinks`/
  `fetchLeadsByParty`, both gone now — the latter still exists for
  `FollowUpForm`'s narrower single-party lookup, see the Follow-ups
  section) that only differed in selected columns — a code-review finding
  (flagged alongside the same unbounded-full-scan pattern on every
  dashboard, see Conventions) that this screen in particular could just
  merge into one query and derive both `employeeMap` and `partyLeadMap`
  from it. The search box and a Type filter (a `Filters` toggle revealing
  `vip-chip-select` pills, dynamically discovered from the data the same
  way `PartiesCard` used to, plus the `vip-filter-chip`/"Clear all"
  active-chip language `LeadsListCard`'s All Leads redesign established)
  both apply **client-side and instantly** — no 2-character minimum, no
  debounce, since it's a plain array filter over already-loaded data. A
  **"Worked with"** list per row shows which employee(s) own a lead
  connected to that party (as `party_id`, `other_party_id`, or
  `referred_by_party_id`), derived client-side by `buildEmployeeMap` (a
  private helper local to `Search.jsx` now, not a shared export — it only
  ever had the one consumer). **RLS caveat carried over unchanged from
  `PartiesCard`**: a sales exec's `leads` query only ever returns their own
  leads, so they'll only ever see themselves in "Worked with", even when
  another rep has also worked with that party — full multi-employee
  associations are only visible to the owner. Each row links to that
  party's **most recent lead** if they have one (`mostRecentLeadByParty`,
  `party_id` only — see the Universal linking bullet above), else stays
  non-clickable. A side effect of this merge: party browsing is now
  reachable on a phone for the first time — `PartiesCard`'s desktop-sidebar
  gap is closed, not by giving Parties its own mobile entry point, but by
  it no longer being a separate destination at all.
* **Leads/Sites** — unchanged from before: `src/lib/searchQueries.js`'s
  `searchAll(term)` still gates on `MIN_QUERY_LENGTH` (2 chars) and a
  350ms debounce, since these still hit the DB. It's a two-step query, not
  embedded-relation ILIKE filtering (no precedent for that anywhere in this
  codebase, and it's fragile PostgREST syntax): first searches `parties`
  (name/mobile, used only internally now to resolve ids — its own result
  rows are ignored in favor of the always-loaded directory above) and
  `sites` (nickname/locality/house_no) directly — same `.or()` +
  `sanitizeForIlike` pattern as the search-before-create components, just
  without `SiteSearchOrCreate`'s hard area scope — then takes the matched
  party/site ids and finds every `leads` row linked to any of them via a
  plain `.or('party_id.in.(...),site_id.in.(...)')`, fully precedented, RLS
  applies normally. **Leads** results are clickable (`<Link to="/leads/:id">`)
  since that's the one entity with a real detail page; **Sites** results
  are read-only lookup rows — **there is no `/sites/:id` page anywhere in
  this app** — matching the existing "search before create" duplicate-check
  use case rather than pretending to be a navigation target.

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

Field order below is desktop's; the Mobile redesign pass reordered it
(source first) and added a sticky Save-lead footer with an offline note —
see that section, not described again here. "Other party" used to be
collapsed behind a `+ Architect / PMC / someone else` disclosure toggle
(the Mobile redesign's original choice); removed later (2026-08-09, user
feedback that a click-to-reveal step for a plain optional field was
unnecessary friction) — it's now a fourth always-visible `PartySearchOrCreate`
field, same treatment as Client name and Site nickname. `.vip-disclosure-row`/
`.vip-disclosure-hint` were deleted from `vipsar-theme.css` along with it,
having no other consumer.

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

Everything below is desktop's layout, unchanged. Below 1024px the four
edit sections (Sales progress/Site details/Client details/Contacts)
collapse into tap-to-expand summary rows and the quick-actions/Log-activity/
Call-client controls move into a sticky bottom bar — see the Mobile
redesign section, not repeated here.

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
`vip-btn-row` ("Log activity" for non-owners, "Call client") is otherwise
unchanged, but **"Log activity" is now a `<Link to="/activity?lead=<id>">`**
(desktop and the mobile action bar's own copy of this button, see below),
not a plain `<a href="/activity">` — a code-review finding: a bare `<a>`
inside an SPA forces a full document reload (re-downloading the whole app
shell, costly on the poor field connections this app is built for) and, more
importantly, always landed on `ActivityLog`'s empty anchor picker even
though the rep had just been looking at this exact lead. `ActivityLog.jsx`
reads that `?lead=` param, fetches the lead, and preselects it (see its own
section below) instead of making the rep find it again in
`RecentLeadsPicker`/`LeadSearchSelect`. `Call client` stays a real `<a
href="tel:...">`, unaffected — a `tel:` link isn't an in-app route, so
there's no SPA navigation to preserve there. This row is followed by
`LeadQuickActions.jsx` (**only if `canEdit`** —
`isOwner || lead.owner_employee_id === employee.id`, same gate as before)
— the three new quick actions from the handoff, each behind its own
toggle button so at most one is open at a time:

* **Change stage** — does **not** reimplement `LeadStageSection.jsx`, just
  relocates *when* it's visible: toggling this button mounts the exact
  same component (chip-select + mandatory loss-reason-on-lost prompt)
  instead of it always being on-screen. Everything documented about it
  before is still true, including a since-fixed bug in the prompt's own
  ordering: picking `lost` now opens the reason prompt *without* writing
  anything yet (`current_stage`/`stage_history` stay untouched — verified
  live against a real lead), and only commits `loss_reasons` +
  `current_stage` + `stage_history` together once a reason is picked and
  confirmed; a **Cancel** button on the prompt (new — safe now that nothing
  is written until confirm) discards the pending selection with no writes
  at all. Previously the stage/history write fired the instant `lost` was
  tapped, before the prompt even opened, so closing the sheet left a lost
  lead permanently missing a reason. **`won` is gated the same way** (added
  later, from a code-review finding — `order_value` used to be writable
  from exactly one place, the sales_executive-only Booking Update activity
  in `/activity`, so an owner could create a lead, work it, mark it won,
  and never give it a value, contributing ₹0 to every booked-value metric):
  picking `won` opens a prompt requiring an order value before
  `current_stage`/`stage_history` are written, pre-filled from the lead's
  existing `order_value` or `quote_value` if either is already set so
  re-confirming an already-quoted deal is a one-click accept, not a
  re-type. Cancel discards the pending selection the same way the
  lost/on_hold prompts do. `SalesProgressSection.jsx` also gained a direct
  **Order value** field (next to Quote value, save-independent of any
  activity or checkbox) so a value can be recorded at any stage, not just
  at the moment of marking won — see that section's own bullet below.
  **Not yet verified live** (no test login was available in the session
  that made this change) — reasoned through and lint-clean, same as any
  other change in this doc awaiting its first live check.
* **Set follow-up** — mounts the **same `FollowUpForm`** Home's "Add
  reminder" uses, so a reminder set from a lead is a real `follow_ups` row
  with a real push notification, not just a date stamp (2026-08-10, at the
  user's request — "the follow up they can give after going to a lead's
  screen should follow the same flow as add reminder on the home screen").
  It used to write `leads.next_followup_date` directly from its own inline
  Tomorrow/In-3-days/… panel, which meant a lead-screen follow-up never
  reminded anyone. Two things differ from Home's mount: the lead is passed
  in as `lead={lead}`, so **the "Related lead" picker isn't rendered at all**
  (you're already on the lead — asking would be redundant), and `assignedTo`
  is the **lead's owner** (`lead.owner_employee_id ?? employee.id`), not
  whoever clicked — an owner setting a reminder on a rep's lead is reminding
  the rep, and it's the rep's device the push should reach. Same rule
  `LeadStageSection`'s On Hold flow already used for its own `createFollowUp`
  call. `next_followup_date` still gets written (FollowUpForm does it for any
  linked lead), so nothing that read that field lost its value —
  `LeadDetail`'s `handleFollowUpSaved` merges it into local state from the
  returned row's `due_date` rather than refetching.
* **Change stage** — **owner-only** as of 2026-08-10, at the user's request
  ("a sales executive cannot change stage of a lead"). Confirmed to include
  the outcome stages: a rep can no longer mark their own deal Won or Lost
  either. They can still record the money behind a close — Activity Log's
  Booking Update, and Sales progress' own Order value field — they just
  don't flip the stage. The gate is the same one-line `{isOwner && …}`
  Reassign owner already used. **This is a UI gate; `Schema/migration_owner_only_stage.sql`
  is the database half** (a `BEFORE UPDATE` trigger on `leads`, because RLS
  restricts rows and not columns, and both roles authenticate as
  `authenticated` so a column-level `REVOKE` would lock the owner out too),
  plus `stage_history` INSERT narrowed to owner-only so the audit trail
  can't be written by someone who can't cause the change. See Conventions —
  **not yet run live**.
* **Reassign owner** — **owner-only**, even within `canEdit` (a sales exec
  who owns the lead gets Set follow-up but neither of the other two, per the
  design handoff's `FLOW.md` §4). Updates `leads.owner_employee_id`
  (already legal under existing "own data or owner role" RLS, no schema
  change) and inserts into `lead_owner_history` (see Conventions — now
  live). The write to `leads` and the history insert are independent: if
  the history insert ever fails, the reassignment still succeeds and an
  inline warning explains the history wasn't logged, mirroring how
  `ActivityLog`'s own lead-side-effect writes already handle a partial
  failure — this path is normally just belt-and-braces now that the table
  exists. Verified live: reassigning an owner immediately shows a real
  "Reassigned from X to Y" entry in both the Deal owner rail and the
  Activity timeline (attributed to the employee who made the change, not
  just logged silently).

Below the quick actions, a **Deal progress** hero card: a stage stepper
built off `FUNNEL_STAGES` (`LEAD_STAGE_OPTIONS` minus `on_hold`/`won`/
`lost` — the 8 fixed funnel stages, `calling` through `negotiation`; not
the handoff's generic 6, since `current_stage` staying non-enum is locked
in per DECISIONS.md), redesigned in a later pass so 11 stages' worth of
columns don't crowd into illegible truncated labels:

* Every segment is colored by its own stage (`stageFg`) once reached —
  the New/Warm/Hot ramp is visible directly in the bar, not just in the
  chip picker — but a stage still to come stays a neutral grey
  (`var(--vip-line-soft)`) rather than previewing a hue it hasn't earned
  yet.
* Only the *current* stage's column widens (`vip-stepper-col-current`)
  and shows its label + date; every other column is a narrow color-only
  strip with no visible text, its stage name and date available via a
  native `title` tooltip on hover instead — otherwise 10-11 columns'
  worth of labels crowd into illegible truncated text at this card's
  fixed width.
* **`on_hold` is not a fixed column** — it's spliced into the sequence at
  whatever position the lead actually paused at (found via the most
  recent non-on-hold `stage_history` row, or `calling`/`created_at` if
  the lead was never explicitly touched — same gap `SalesFunnelCard`
  already works around `stage_history` never logging an implicit
  default), e.g. a lead paused right after Quote submission gets an
  `On hold` column inserted between Quote submission and Negotiation,
  shown as the current (widened, grey) column while paused.
* **`won`/`lost` are never both shown** — the stepper has no permanent
  slot for either. A single trailing outcome column is appended after
  Negotiation only once a lead actually reaches one of them (green `Won`
  or red `Lost`, whichever really happened); a lead still open in the
  funnel shows no trailing column at all.
* The card's header note reads `stage X of Y` (`Y` = however many columns
  are actually showing, since that count now varies with on_hold/outcome),
  `closed won · {date}` once won, or `on hold · resumes {date}` while
  paused.

Plus 4 deal stats (Deal value = `max(order_value,
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
`lead_owner_history` entries when that table has rows). **Real overlap bug
found and fixed** (a code-review finding, measured at 390px): Quotes &
orders' fixed `64px minmax(0,1.4fr) 84px 64px 84px` grid (`.vip-linegrid-
head`/`.vip-linegrid-row`) wasn't gated to desktop the way the four
collapsible edit sections are — 296px of fixed columns plus gaps doesn't
fit a ~325px phone track, so the Scope column computed to 0 width and
rendered "Sliding Window"/etc. on top of the Value column (the header row
did the same, printing "Scope" over "Value"). Fixed by wrapping the
existing grid in `.vip-only-desktop` (unchanged) and adding a
`.vip-only-mobile` two-line stacked alternative (`.vip-linegrid-mrow`,
new) instead of trying to salvage the grid at phone width — Ref + Scope on
line 1, Value · Date · Status on line 2, no header row (at most two rows
ever exist here, so the column labels aren't needed to read them).
Verified live in the browser preview against a real won lead with both a
quote and an order row: desktop's 5-column grid unchanged, mobile renders
two clean stacked rows at 325px with no overlap and no console errors.

Right rail: a new **Deal owner** card (links to `/employees/:id`, plus the
ownership-history list from `lead_owner_history`) and a new **Contact**
card (site contacts + a facts list), then — **unchanged from before** —
`SalesProgressSection`, `SiteDetailsSection` (if `site_id`),
`ClientDetailsSection` (if `party_id`), `AdditionalContactsSection` (if
`site_id`), same `canEdit` gate, same merge-not-replace `setLead` pattern
as always (each section's save query has no `employees` embed, so
`LeadDetail` merges the returned row rather than replacing state wholesale
— a plain replace would drop `lead.employees`). **Real bug found and
fixed**: `SalesProgressSection.jsx`'s Save used to null out `quote_value`
on every save where the "Quote sent" checkbox wasn't ticked, even though
the Quote value field sits above that checkbox and is always visible/
editable regardless of it — a rep could type a value, not tick the box,
hit Save, and silently lose what they typed. Fixed by saving `quote_value`
whenever it's non-empty, independent of `quoteSent` (the field was never
actually gated by that checkbox in the UI, so the save shouldn't have
gated it either). `rfq_raised_at`/`quote_sent_at` don't have this problem
— those date inputs are only rendered once their own checkbox is ticked,
so the field's visibility already matches the save condition.

`SalesProgressSection.jsx` also gained an **Order value** field (next to
Quote value, same plain-number-input treatment, saved whenever non-empty
independent of any checkbox — same reasoning as the `quote_value` fix just
above) — closing a gap a code review found: `order_value` used to be
writable from exactly one place, the sales_executive-only Booking Update
activity in `/activity`, so an owner had no way to record a deal's value
directly on the lead itself. Paired with the `won`-stage gating described
in the Change stage bullet above (same fix, two entry points) — see that
bullet for the mandatory-order-value-on-won prompt. Not yet verified live.

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

### Lead stage taxonomy (`src/lib/leadStageOptions.js`, `src/lib/statusColors.js`)

`current_stage`'s app-layer suggested list (still free text at the DB
layer — locked in per DECISIONS.md), rebuilt from a dealership-specific
Claude Design mockup into a grouped, sales-team-language taxonomy —
replacing the previous flat `new/hot/rfq/quote/negotiation/won/lost` list
everywhere in the codebase and UI, not just relabeling it:

* **New** (blue, light→dark): `calling` → `presentation` →
  `joinery_follow_up` → `measurements`.
* **Warm** (amber, light→dark): `design_discussion` → `rfq` →
  `quote_submission`.
* **Hot** (green): `negotiation`.
* **Won** (deeper green than Hot) / **Lost** (red — the one color
  reserved for a genuinely lost deal, unchanged from before this pass).
* **On hold** (grey) — independent of the funnel above, not a sequential
  step. Reachable from *any* other stage (a client wants time to think, a
  site is paused for external reasons) via the same stage-chip picker
  every other stage uses.

`LEAD_STAGE_OPTIONS` (the 11 values, in the order above) and
`LEAD_STAGE_LABELS`/`stageLabel()` are exported from
`leadStageOptions.js` — values are the literal `current_stage` strings
(and double as CSS chip class suffixes, so they stay single-token slugs
like `joinery_follow_up`), labels are what's actually shown. Every
display site across the app (`LeadStageSection`'s chip picker, Dashboard's
Pipeline by stage card, `SalesFunnelCard`, `LeadsListCard`,
`LeadActivityTimeline`, `Search`, `ActivityLog`, `EmployeeProfile`,
`drilldownBuilders.js`'s panels) renders through `stageLabel()` rather than
the raw value — a `current_stage`
value that isn't a recognized `LEAD_STAGE_OPTIONS` entry (only reachable
today via older data or a direct DB edit, since `LeadStageSection`'s
picker no longer has a free-text "Other…" option — removed in a later
pass, see the Lead Detail's Stage section bullet above) still falls back
to displaying exactly what's stored. `rfq` and `negotiation` kept their pre-existing
literal values (only the label changed); `quote` → `quote_submission` and
`new` → `calling` were real value renames, and `hot` was retired
entirely (see the migration below). Every `lead.current_stage ?? 'new'`
fallback across the codebase became `?? 'calling'` to match — including
`src/lib/pipelineValue.js`'s `isOpenLead`, the one most load-bearing
instance, since it drives `dealValueFor`/`sumOpenPipelineValue` almost
everywhere a deal value is shown.

**On Hold's write flow** (`LeadStageSection.jsx`) is gated the same way
`lost` already was — DECISIONS.md's "no skip-for-now escape hatch" rule —
except it requires a reason *and* a compulsory follow-up date instead of
just a reason. Picking the `On hold` chip opens an inline panel with
exactly two inputs, kept deliberately minimal at the user's request: a
reason textarea, and a plain `<input type="date">` for the follow-up date
— no preset quick-pick chips (`FOLLOWUP_OPTIONS`/`followupDateFor` from
`followupDates.js`, the picker `LeadQuickActions`' "Set follow-up" action
uses) and no separate "Custom date" toggle step, just a direct calendar
picker, since a hold can reasonably resume in days, months, or years and
a preset list of near-term options didn't fit that range well. The
panel's intro copy was likewise trimmed to a single question (no
"both are required" explainer sentence) — the Save button's own disabled
state until both fields are filled already communicates that. On confirm,
in order: (1) `createFollowUp` (`src/lib/followUpQueries.js`) inserts a
real row into `follow_ups` — reusing the Follow-ups feature (see its own
section) rather than inventing a second reminder mechanism — with the
typed reason as `notes`, `activityType: 'other'`, `assignedTo:
lead.owner_employee_id` (falling back to the acting employee for the
rare unassigned-lead case), and an auto-generated title (no separate
title field in the dialog, to keep it to just the two inputs asked for);
(2) only once that succeeds, `applyStage('on_hold', {
next_followup_date: dueDate })` — a small generalization of the existing
`applyStage(resolvedStage)` to merge extra columns into the same `leads`
UPDATE call — writes the stage change and the follow-up date together.
This guarantees a lead can never end up `on_hold` with no reason or
reminder on file, the same guarantee `lost` already had for its reason.
Because the real Follow-ups + push pipeline is doing the reminding, the
reason resurfaces on the exec's device via the push notification when it
fires (see the Follow-ups section) — `LeadDetail.jsx` additionally shows
it inline (`fetchLatestFollowUpForLead`) as soon as a lead is on hold, so
opening the lead doesn't require waiting for the notification either.

`on_hold` is deliberately excluded from `drilldownBuilders.js`'s
`buildPipelinePanel` stage-to-stage `progression` chain — same reasoning
already applied to `lost` there: a parallel exit/pause isn't "the next
step after" whatever came before it, so including it would produce a
nonsensical conversion-rate row. `LeadDetail`'s own Deal progress stepper
takes a different approach (see the Lead Profile section's Deal progress
bullet above) — rather than excluding `on_hold` outright, it splices a
real `On hold` column into the sequence at the exact position the lead
paused, since a later pass decided that was more informative than a
same-position note about it. Neither treatment excludes `on_hold` from
stage breakdowns that just count leads per bucket (Dashboard's Pipeline
by stage table/board, `LeadsByCategoryCard`'s Stage instance) — an
on-hold lead is still open pipeline, just paused, so it should still show
up there.

**Migration (run once, live data):** existing leads/`stage_history` rows
at the old `new`/`hot`/`quote` values were remapped to `calling`/
`negotiation`/`quote_submission` respectively via a one-time SQL script
(handed to the user to run in the Supabase SQL Editor, per Conventions —
anon key can't run DDL/bulk UPDATEs), and `leads.current_stage`'s column
`DEFAULT` was changed from `'new'` to `'calling'` to match. No CHECK
constraint exists on `current_stage`/`stage_history.stage` (both free
text) or needed changing for `on_hold` itself, and `follow_ups
.activity_type`'s existing CHECK already allowed `'other'`.

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

The Mobile redesign pass added a third `.vip-team-stats` cell, **Needs
attn.** (sum of that employee's `computeAttentionBuckets` counts) — see
that section, not described again here.

`/team`, **owner-only** (`ProtectedRoute allowedRoles={['owner']}` in
`App.jsx` — a sales exec hitting this URL directly gets redirected to `/`,
same as any other role mismatch; there's also no nav link pointing here for
that role, so it's never surfaced to them). A card-
grid directory of the owner's team, reachable from `BottomNav`'s desktop
sidebar (a `.vip-nav-extra` link, with its own icon — `IconTeam` in
`NavIcons.jsx`, a deliberately distinct 3-person glyph so it doesn't read
as some other contacts/list destination in the sidebar) and, on mobile,
from a `.vip-tile` row at the top of `Dashboard.jsx` (see the Mobile
redesign section) so the owner can reach it on a phone too.

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
  same pattern as Search's own party directory), plus a `vip-seg-outline`
  segmented control for role, built from `[...new Set(employees.map(e =>
  e.role))]` rather than a hardcoded list — so if a role beyond
  `sales_executive` ever gets added to the team, the filter grows on its
  own with no code change here, same reasoning Search's dynamic
  `party_type` filter already uses. `ROLE_LABELS` in `MyTeam.jsx` is the
  one place a role gets a human-readable label; extend it, don't hardcode a
  new label inline.
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
  create form and row-list, reused by all three surfaces below. The date
  field reuses `FOLLOWUP_OPTIONS`/`followupDateFor` from
  `src/lib/followupDates.js` (extracted out of `LeadQuickActions.jsx`'s old
  inline "Set follow-up" panel so both couldn't drift into different date
  math; that panel is gone now — see the Lead Profile section — but the
  shared module stays, since `LeadStageSection`'s On Hold flow still uses
  it).
  **Linking is by lead, picked explicitly** (2026-08-10). It used to be a
  party picker whose most recent lead was silently resolved behind the
  scenes via `fetchLeadsByParty`/`mostRecentLeadByParty` — the user's actual
  complaint was that reminders showed no lead at all, which this was the
  cause of: a party with no lead linked nothing, and a party with several
  linked whichever happened to be newest rather than the one meant. The
  field is now an optional **"Related lead"** `LeadSearchSelect`; `party_id`
  is still written, derived from the chosen lead's own `party_id`, so
  nothing that read the party link broke. `fetchLeadsByParty` was deleted
  from `partyQueries.js` as dead code (`mostRecentLeadByParty` stays —
  `Search`'s party directory still uses it, off `fetchLeadsForPartyDirectory`).
  **The lead stays optional** — a reminder with no lead is still valid and
  still saves; only date + title are required.
  Two props shape the picker: **`lead`** presets the link and hides the
  picker entirely (`LeadQuickActions`' mount — see the Lead Profile
  section), and `LeadSearchSelect`'s new **`allLeads`** drops its
  `owner_employee_id` filter, set by `FollowUpForm` when an **owner** is
  picking a lead for their *own* reminder. That last one is a real bug found
  in the browser, not a hypothetical: scoping an owner to leads they
  personally carry made the picker come back "No matching leads" on the real
  database, since the owner carries few or none themselves. Assigning to
  someone else still scopes to *that person's* leads (`employeeId={assignedTo}`).
  If a lead is linked, saving **also** sets that lead's `next_followup_date`
  to the same due date (a plain overwrite, not a merge), so this doesn't
  create a second, out-of-sync "when's the next touch" field.
  Activity type (shown only once a lead is linked) reuses the canonical
  `ACTIVITY_TYPES` list plus an `other` option, rather than inventing a
  parallel taxonomy. `FollowUpList` names the linked lead via the same
  client-name → site-nickname → locality fallback chain every other
  lead-naming surface uses (falling back to the follow-up's own party, then
  `Lead #id`) — `FOLLOW_UP_SELECT` embeds `leads(...)` for exactly this;
  before, a row could only ever show its *party's* name, so a reminder on a
  lead with no party row rendered with no visible link whatsoever. Editing
  an existing follow-up's details, and any delete UI, are **out of scope**
  — only create and mark-done exist in the UI (owner-only DELETE still
  exists at the RLS layer, same as every other table, for manual cleanup).
* **`followupDates.js`'s `todayISO()`/`toISODate()`** are the one place in
  this app that should ever compute "today" as a plain date string — every
  caller that needs one (`fetchDueFollowUpsForEmployee` in
  `followUpQueries.js`, Home/Dashboard/ActivityLog's own "is this overdue /
  due today" checks, RFQ-raised/quote-sent date stamps) imports `todayISO`
  from here rather than rolling its own. **Real bug found and fixed**: both
  used to build the date via `new Date().toISOString().slice(0, 10)` —
  `toISOString()` converts to UTC first, so between midnight and 05:30 IST
  (IST is UTC+5:30) that expression returns *yesterday's* date. Three other
  files (`Home.jsx`, `Dashboard.jsx`, `ActivityLog.jsx`) had each hand-rolled
  their own identically-broken local `todayISO()` copy instead of importing
  one. All four were fixed to build the string from local
  `getFullYear`/`getMonth`/`getDate` (so they follow the browser's local
  timezone — IST for this app's real users — instead of shifting to UTC),
  and the three duplicate local copies were deleted in favor of importing
  the one in `followupDates.js`. Any future "what's today's date" need
  should import `todayISO` from there, not write `new Date().toISOString()`
  again.
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
* **Lead Profile** (`src/components/LeadQuickActions.jsx`) — the third
  mount, added 2026-08-10: "Set follow-up" on a lead now creates a real
  follow-up rather than only stamping a date. Lead preset (no picker),
  assigned to the lead's owner. See the Lead Profile section's own bullet.
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

The Mobile redesign pass added a sticky "Log it" footer — see that section.
Everything else below reflects a later pass (2026-08-09) that reworked the
anchor picker, removed Party as a fallback anchor, reordered Site Visit's
fields, and added the new Architect Meeting type — all from live user
feedback while testing this screen, not part of the original mobile
redesign.

An optional `?lead=<id>` query param, read via `useSearchParams`, preselects
a lead on load instead of leaving the anchor step blank — a code-review
finding: Lead Detail's "Log activity" (see the Lead Profile section's
Deal-progress-adjacent bullet above) used to link here with no context at
all, so a rep who just opened this exact lead had to find it again from
scratch. On mount, if the param is present, the lead is fetched into
`selectedLead`; once an activity type needing an anchor is picked, the
"Against which lead?" section collapses straight to a single confirmation
row (name + a "Change" link) instead of showing the picker at all —
"Change" backs out to the normal `LeadSearchSelect` flow for a different
lead. "Log another activity" (the post-submit reset) restores the same
preselected lead rather than clearing back to nothing, since a rep logging
a Site Visit then a Call against the one lead they came from is the common
case this was built for.

DPR replacement at `/activity`, **sales_executive-only** (`ProtectedRoute`
in `App.jsx`, plus the FAB sheet and sidebar nav link are both omitted for
`owner` — see the Mobile redesign section and `BottomNav.jsx`) — owners
don't do field work
themselves, so logging a site visit/call/RFQ/etc. isn't something they need;
they still see every rep's logged activity through the Dashboard and a
lead's own timeline. `LeadDetail`'s "Log activity" button is hidden for
`canEdit` owners for the same reason, even though they can still edit the
lead itself. Tap one of Site Visit/Call/RFQ Raised/Office Day/Booking
Update/**Architect Meeting** (`ACTIVITY_TYPES`, `src/lib/activityTypes.js`
— 6 values now); every type except Office Day and Architect Meeting then
shows `LeadSearchSelect` (select-only, scoped to the current employee's own
leads via `owner_employee_id`). Office Day skips the anchor step entirely
(matches the loosened `activity_needs_an_anchor` CHECK — see
`Schema/tostem_crm_schema.sql`); Architect Meeting is anchored on an
architect party instead of a lead, and has its own picker (see below).

* **"Against which lead?" is search-first, not a scrollable list.**
  `LeadSearchSelect` shows nothing below the search box until you actually
  type, then filters this employee's own already-fetched leads client-side
  by client/site name. Previously the default was `RecentLeadsPicker` — a
  radio list of this employee's 8 most-recently-touched leads, with a
  "Search all" toggle falling back to `LeadSearchSelect` — replaced because
  a list, even capped at 8, doesn't scale to an exec with dozens of leads.
  `RecentLeadsPicker`/`touchLabel` and the `searchAll` toggle state are
  deleted from this file entirely, not just unused.
* **Party is no longer a fallback anchor for Site Visit/Booking Update.**
  Both used to accept "lead, party, or both" via a
  `PartySearchOrCreate(allowCreate={false})` field alongside the lead
  picker; now, like Call and RFQ Raised, they **require** a lead. Removed
  because Next follow-up/Order value/Site stage all write onto a lead, so a
  party-only pick used to silently hide all three fields with no way to
  fill them in. `selectedParty`/`showPartyPicker` and that
  `PartySearchOrCreate` usage are gone from this file — `activities.party_id`
  is only ever set now for Architect Meeting (see below), never for the
  other five types.
* **Site Visit's field order**: Against which lead → Notes → **Site
  stage** (a preset + "Other…" dropdown, same shape as
  `SiteDetailsSection`'s own — shown only once the selected lead has a
  linked site, i.e. `selectedLead.sites?.id`; a lead with no site, like one
  created from just a client name, shows nothing here rather than a
  meaningless control) → Next follow-up → Accompanied by. Site stage is
  synced to the selected lead's *current* stage by its own `useEffect`
  (keyed on `selectedLead`, same derivation `SiteDetailsSection` uses for
  its initial value) and, on submit, writes `sites.site_stage` in a
  separate UPDATE alongside the `leads` one — skipped entirely if the
  resolved value didn't actually change, so picking a lead and submitting
  without touching this field never fires a no-op write. Every other type
  keeps Notes last, unchanged.
* **Architect Meeting** — its own anchor, entirely separate from the
  lead-picker block above: a `PartySearchOrCreate` field
  (`typeOptions={['architect']}`, the same search-or-create dialog every
  other party field in this app uses — Client name on New Lead, "other
  party" on New Lead, the Party field Call/RFQ Raised/Booking Update used
  to have) labelled "Architect name". Picking an unrecognized name genuinely
  inserts a new `parties` row with `party_type = 'architect'`, same
  mechanism as everywhere else in the app a party gets created — nothing
  special-cased for this screen. Fields, in order: Architect name → Next
  follow-up → Notes. There's no lead involved, so "Next follow-up" can't
  write `leads.next_followup_date` the way it does for every other type —
  instead, filling it creates a real `follow_ups` row via `createFollowUp`
  (`src/lib/followUpQueries.js`; `assignedTo`/`createdBy` both the logging
  employee, `partyId` the architect, an auto-generated title
  `Follow up with {name}`, `activityType: 'other'` — the literal
  `'architect_meeting'` value isn't in `follow_ups.activity_type`'s own
  CHECK list, same reasoning `LeadStageSection`'s On Hold flow already uses
  for its own `createFollowUp` call, see the Lead stage taxonomy section).
  This is deliberate reuse of the real Follow-ups feature (see its own
  section) rather than a second reminder mechanism — the reminder shows up
  in Home's "Your reminders" and fires a real push notification exactly
  like any other follow-up. `activities.party_id` is set to the architect's
  id on the activity row itself too (the one case in this file `party_id`
  is ever non-null). **Needs a schema migration before it works live** —
  `activities.activity_type`'s CHECK constraint doesn't include
  `'architect_meeting'` yet (confirmed via a real live error:
  `new row for relation "activities" violates check constraint
  "activities_activity_type_check"`), and `follow_ups.activity_type`'s
  CHECK needed the same value added too, since `FollowUpForm.jsx`'s "Type
  of follow-up" chip picker is built off the same `ACTIVITY_TYPES` list and
  would otherwise offer a chip that fails to save on any follow-up, not just
  ones created from this screen. See `Schema/migration_architect_meeting.sql`
  and Conventions below — not yet run against the live DB as of this
  writing.
* "Accompanied by" (optional, `employees` dropdown excluding yourself) only
  shows for Site Visit — going out to scan/visit a site is the one activity
  where bringing a colleague along is a normal, trackable thing; it doesn't
  apply to a phone Call, paperwork (RFQ Raised/Booking Update), Office Day,
  or Architect Meeting.
* Common fields: notes (textarea). Office Day additionally gets a numeric
  "leads generated" field.
* If a lead is selected (Site Visit/Call/RFQ Raised/Booking Update), an
  optional "update next follow-up date" field updates
  `leads.next_followup_date` when filled in — Architect Meeting's own
  "Next follow-up" is a different field entirely, see above.
* RFQ Raised + a selected lead also sets that lead's `rfq_raised = true` and
  `rfq_raised_at` to today.
* Booking Update + a selected lead shows an optional `order_value` field,
  applied to the lead if filled in.
* Lead/site/follow-up side effects all run as separate calls after the
  `activities` insert succeeds; a failure in any of them surfaces as a
  warning on the success screen without blocking the activity itself from
  being logged.
* Not in scope for this screen: lead stage changes (`LeadDetail`'s job) or
  a screen listing past activities (still not built anywhere).

`LeadSearchSelect` (`src/components/LeadSearchSelect.jsx`) is select-only
(no create) — fetches the employee's own leads once (now embedding
`sites(id, nickname, locality, site_stage)`, not just nickname/locality,
so a picked lead carries enough site data for Site Visit's Site stage field
above), filters client-side by linked party name / site nickname / locality,
and shows nothing below the search box until a query is typed (previously
showed the full unfiltered list by default — same "don't dump a big list"
reasoning as the anchor-picker change above). Embedding `parties` from
`leads` needs an explicit FK hint (`parties!party_id(...)`) — `leads` has
three FKs to `parties` (`party_id`, `referred_by_party_id`, `other_party_id`),
so a bare `parties(...)` embed fails with "more than one relationship was
found."

### Dashboard (`src/pages/Dashboard.jsx`)

The Mobile redesign pass unhid `KpiSparkRow` at every width (see the KPI
band bullet below — it no longer needs a separate mobile-only fallback
grid), capped `NeedsAttentionCard` to 3 buckets + "+N more" below 1024px
regardless of `wide`, added an owner-only mobile "My Team" tile at the top
of this page (My Team's only mobile path now that Home's tile grid is
gone), and gave `LeadsListCard`'s mobile view a grouped-by-stage layout (see
its own bullet below). See the Mobile redesign section for all of this;
not repeated inline below.

Single page at `/dashboard`, reachable by both roles — no separate owner/
sales-exec page. Role branching is just one derived boolean:
`isOwner = employee?.role === 'owner'` toggles `showByEmployee` on the
breakdown cards below. The same Supabase queries (`src/lib/dashboardQueries.js`)
serve both roles unchanged — RLS already scopes `activities`/`leads` to "own
data or owner role", so a sales exec's query naturally returns only their own
rows with no client-side filter needed.

**No more in-page tab buttons.** `activeTab` (`'reports' | 'leads'` — a
third value, `'parties'`, existed until Parties merged into Search, see
"Current state" above) used to be three `.vip-seg` buttons at the top of
the page; that row is gone (see the Dashboard-v2 Design-system bullet's
sibling note above) and `activeTab` is now driven purely by `?tab=` via a
`useEffect` on `useSearchParams()` — `?tab=leads` (Home's "All Leads" tile,
or the sidebar's All Leads link at ≥1024px, see Structure above), anything
else (including no `?tab=` at all) means **Reports**, which holds
everything below including the category-breakdown cards. **Reports** is
the only one of the two with any mobile entry point right now — Leads is
desktop-sidebar-only until that gap gets addressed (see Structure).
`LeadsListCard` still fetches independently of the Reports effects below,
since it isn't part of the date-range-scoped report data.

* **Pipeline/deal value** (`src/lib/pipelineValue.js`) — the canonical
  "how much is this lead worth" figure, shared by every card in this app
  that sums or displays one. Before this existed, at least nine call sites
  (this page's `openPipelineValue`/`stageRows`/the All Leads header
  override, Home's KPI grid, `LeadStageBoard.jsx`, `LeadsByCategoryCard.jsx`,
  `EmployeeProfile.jsx`'s Open pipeline stat + Pipeline owned + Leads
  assigned, `MyTeam.jsx`'s per-card stat, `attention.js`'s Needs Attention
  row values, `LeadsListCard.jsx`'s row/stage-group values, and
  `drilldownBuilders.js`'s `pipeline` drill-down) each hand-rolled their own
  version — some `order_value ?? 0`, others `order_value ?? quote_value ??
  0` — which silently drifted into different numbers shown on screen at the
  same moment for what looked like one concept (caught via a live audit:
  Home read one figure, Dashboard/All Leads read another, and Pipeline by
  stage's own new/hot/rfq rows read "—" even on leads that carried a real
  quote). The rule, confirmed with the owner against real data: `order_value`
  is only ever written once a deal is actually booked (`ActivityLog.jsx`'s
  Booking Update activity — see the ActivityLog section) — so for a lead
  that's still open (not `won`/`lost`), `order_value` is deliberately
  ignored even if present, and the lead's value is its latest `quote_value`
  alone (never a fabricated `0` — a lead with neither value renders `—`,
  not `₹0`). A `won`/`lost` lead keeps `order_value ?? quote_value ?? 0`,
  unchanged from before. `dealValueFor(lead)` is the per-lead function every
  call site above now imports; `sumOpenPipelineValue(leads)` is the
  open-leads-only total, used by this page's KPI tile/All Leads header and
  by Home. **Flagged for the owner to take up later, not fixed here**: a
  live SQL check (`select id, current_stage, quote_value, order_value from
  leads where current_stage not in ('won','lost') and order_value is not
  null`) turned up leads with `order_value` already set while still
  `quote`/`negotiation` stage — i.e. a Booking Update was logged without the
  lead's stage ever being flipped to `won`, contradicting the "a booked
  order is automatically won" assumption the rule above rests on. Doesn't
  change any figure today — in every one of those rows `quote_value` was
  already the larger number, so the quote-only rule never under-counts them
  versus the old fallback — but the process gap itself (reps logging a
  booking without changing the stage) is unresolved. `LeadDetail.jsx`'s own
  "Deal value" stat (`Math.max(order_value, quote_value)`) was deliberately
  left as a separate, fourth formula — a single lead's lifetime headline
  number, not a pipeline aggregate — not folded into this pass.
* **Date range** (`DateRangeSelector.jsx`) — **Today** (the Day Review — see
  its own section above; it replaces the entire card grid below rather than
  re-filtering it, and drives its own day-scoped queries) / **Week**
  (Monday–today) /
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
  a deliberate call, not a TODO. **Open pipeline** is the one exception to
  "value-only": it shows how many open leads that rupee figure is spread
  across ("₹5.0L · 2 leads", `openLeadCount` from `Dashboard.jsx`), reusing
  the tile's existing delta slot with `up: null` so the count renders plain
  and muted rather than as a green/red trend — it's a second snapshot
  figure, not a change over time.
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
  (`src/lib/targetMetrics.js`: `site_visit`/`call`/`rfq_raised`/
  `architect_meeting` — see `ACTIVITY_METRIC_OPTIONS`, the targetable subset
  of `ACTIVITY_TYPES` — plus `order_value` and `won_count`), deliberately
  not the "suggested options + Other…" free-text pattern used for
  `current_stage`/`site_stage` — an arbitrary metric would have a target but
  no computable actual, which defeats the section. **Office Day, Booking
  Update, and Offers Sent (`quote_sent`) were dropped from this list**
  (2026-08-09, per the owner) — Office Day/Booking Update are process-
  tracking entries rather than something a rep gets a quota for, and Offers
  Sent went with them; all three are still loggable in Activity Log and
  still count in `ActivityCountsCard`'s "Activity" tally (that card walks
  `ACTIVITY_TYPES` directly, not this list) and `EmployeeProfile.jsx`'s own
  hardcoded 6-tile grid (a separate list, unaffected — see the Sales Exec
  Profile section) — only *targeting* them is gone. `DashboardHeatmap.jsx`'s
  columns and `buildOverallAttainPanel`'s blended-attainment calc
  (`drilldownBuilders.js`) both import `ACTIVITY_METRIC_OPTIONS` from the
  same file rather than building their own filtered list, so the heatmap's
  inline "Overall %" and the panel its own cell opens can't drift into two
  different numbers for the same thing (the exact class of bug the Pipeline/
  deal value rule elsewhere in this doc was written to avoid). Actuals for the four remaining activity-type metrics are a straight count
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
  plain bar-list at every width — every metric shown even with zero
  activity and no target row, `no target set` rendered explicitly rather
  than the row being silently omitted. Every cell opens a drill-down: the 4
  activity-type cells fetch that one exec's real log entries on demand
  (`fetchActivityLogForExec`, only queried on click — not preloaded for
  everyone) and show a real "last 20 working days" logging-rhythm bar chart
  (`log` kind); Order value and the blended Overall column build
  synchronously from state already on the page (`attain` kind).
  **The owner's below-1024px fallback used to be the same flat
  employee-×-metric bar-list**, uncapped — a real team of 9 execs ×
  `METRIC_OPTIONS`'s 8 metrics measured 3,388px on this one card alone
  (a code-review finding: 7,798px total for the mobile Dashboard, with this
  card responsible for nearly half of it). Replaced with one collapsed row
  per exec (`ExecAttainmentRow` in `TargetsVsActualsCard.jsx`) — name ·
  **blended attainment** % (same "mean of the metric ratios, each capped at
  1.25" definition `EmployeeProfile.jsx`'s rank pill uses, see the Sales
  Exec Profile section, but scoped to all 6 `METRIC_OPTIONS` here rather
  than that page's own 6 tiles (a different 6 — see the note above on which
  metrics changed), and skipping any metric with no target rather than
  counting a missing target as a zero) · a single bar — reusing
  `.vip-detail-row`, the same tap-to-expand summary row Lead Detail's mobile
  collapsed sections already use, rather than a new component. Tapping a
  row expands it to that exec's full `METRIC_OPTIONS` breakdown (the exact
  same per-metric rows as before, just no longer all open at once) — same
  data, ~employee-count rows instead of employee-count × 6 (originally × 8,
  before Office Day/Booking Update/Offers Sent were dropped). Verified live
  in the browser preview: 6 real execs collapsed to 6 rows, tapping one
  (Priya, 34% attainment) expanded her 8 real metric rows with correct
  actual/target bars, collapsing back cleanly; desktop's heatmap is
  untouched by this (this table only ever mounts on mobile for the owner in
  practice, since `Dashboard.jsx` always supplies the `onOpenLog`/
  `onOpenPanel` props that gate `showHeatmap`). For
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
* **Leads by area / by site stage / by product**
  (`LeadsByCategoryCard.jsx`, one generic component reused 3×) — count +
  `order_value` sum, grouped by the lead's site's area / the lead's site's
  `site_stage` / `products.name`. A fourth instance, "Leads by stage
  (detail)", used to sit here too — removed (2026-08-09) since it was a
  near-exact duplicate of the "Pipeline by stage" card just below (same 11
  buckets, same count + value per bucket, same `pipeline` drill-down link),
  eating a full card's worth of space for no second insight. See the
  **Pipeline by stage** bullet below for where that stage-level detail lives
  now. Product is the odd one out now that Stage is gone (Area and Site
  Stage still pair up half-width) — it's `vip-span-2` (full row) instead,
  same "promote the leftover card rather than leave CSS grid a visible gap"
  fix the Desktop layout bullet warns about. Pipeline snapshots like
  Closure forecast, **not** date-range-scoped — "how many leads are in each
  category right now", not "how many arrived in a period" — fed by one
  shared unbounded query, `fetchLeadsForBreakdown` in `dashboardQueries.js`
  (selects `owner_employee_id, parties!party_id(name),
  employees!owner_employee_id(name)`, `sites(nickname, locality, ...)`, and
  `products!product_id(name, category)` — some of these fields only matter
  to specific cards, but it's one shared query for all of them, harmless
  extra columns for the rest). `categoryOrder` (optional prop) pins a fixed
  set of buckets in a fixed order, shown even at zero count, so "no leads at
  this stage" is visible rather than the row not existing — Site Stage uses
  `SITE_STAGE_OPTIONS` plus `'Not set'`/`'No site'`; Area and Product have
  no fixed list (both come from a table, not a suggested list) so their
  buckets are discovered from the data and sorted by count desc instead —
  Product falls back to `'Not specified'`, matching `SalesProgressSection`'s
  own "— Not specified —" label for an unset `product_id`. `maxRows`
  (optional prop) caps a card to its top rows plus a "+N more · View all"
  footer — only passed for **Area and Product** (real data, no natural
  ceiling — 11 and 9 rows on real data), **not** Site Stage, whose
  `categoryOrder` is already a short, fixed, meaningful list (6 rows) where
  trimming would arbitrarily hide a real bucket rather than an overflow. All
  three have a "Details" link opening `buildCategoryMixPanel` (`mix` kind,
  real count/share/won-conversion per bucket off the same `breakdownLeads`,
  just not capped) — generic enough that a fourth instance wouldn't need a
  second drill-down kind, just another `buildCategoryMixPanel` call.
* **Pipeline by stage** (inline in `Dashboard.jsx`) — count + `order_value`
  sum per `current_stage` as a plain bar-row list, all 11
  `LEAD_STAGE_OPTIONS` buckets shown even at zero. Its own markup rather
  than a `LeadsByCategoryCard` instance (that's also why the old
  near-duplicate "Leads by stage (detail)" card could go — see the previous
  bullet). It used to carry a **Table/Board** segmented toggle, Board being
  a read-only Kanban (`LeadStageBoard.jsx`, now **deleted**) whose cards
  linked to `LeadDetail` to actually change stage there; removed 2026-08-09
  at the user's request for being messy and for duplicating what a click
  into `LeadDetail` already does. A **Table/Leads** toggle briefly replaced
  it in the same pass — an inline stage-list-beside-leads split view — and
  was reverted immediately: the user's actual ask was for the *drill-down*
  to go deeper, not for the card to grow a second mode. **Don't reintroduce
  a second view mode on this card without asking** (see the "ask before you
  build" section at the top of this file — this exact card is why it's
  there). The card is a list plus a "Details ›" link, nothing else. It and
  Sales funnel sit side by side (both half-width, no `vip-span-2`), paired
  deliberately as the two "shape of the pipeline" cards.
* **Pipeline drill-down — a second level** (`buildPipelinePanel`/
  `buildStageLeadsPanel` in `drilldownBuilders.js`, `PipelineBody`/
  `StageLeadsBody` + the panel stack in `DrilldownPanel.jsx`) — the
  `pipeline` panel itself (stage-value bars, stage-to-stage conversion
  cards, "Biggest open leads" top-5) is **unchanged** from Dashboard v2.
  What's new (2026-08-09) is that each "Where the value is sitting" bar is
  now a button opening a `stageLeads` panel: every lead at that one stage,
  with an owner `<select>` (each option showing that owner's count) and the
  usual `vip-dd-lead-row` list linking to `/leads/:id`. Navigation is a
  **stack inside `DrilldownPanel`**, not a swapped `panel` prop — the root
  panel stays the caller's, a body pushes deeper via an `onDrill(panel)`
  prop, "‹ Back" (`.vip-dd-back`) pops one level, ✕ closes everything, and
  the stack resets whenever the caller opens a different root panel. Each
  stage row's sub-panel is **prebuilt eagerly** by `buildPipelinePanel`
  (attached as `stageRows[].drill`) rather than constructed on click, which
  is what keeps `DrilldownPanel` presentational — no builder imports, no
  lead data of its own — as its header comment has always required. Adding
  a third level anywhere else is just another `onDrill` call; the stack
  doesn't care how deep it goes. `buildPipelinePanel` also lost its old
  `mode: 'stage' | 'funnel'` param in this same pass — see the Sales funnel
  bullet below for why only one caller (and one behavior) was left.
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
  cards. **No "Details" link** (removed 2026-08-09, at the user's request,
  after they noticed it and Pipeline by stage's own Details opened
  identical content) — this card used to pass `buildPipelinePanel({ mode:
  'funnel', ... })`, but `mode` only ever changed the panel's header text;
  the body (stage-value bars, conversion cards, top leads) was the exact
  same either click, and `funnelRows` (reach + avg-days per stage — the one
  thing that *would* have been funnel-specific) was computed by the builder
  but never actually rendered by `DrilldownPanel`. `buildPipelinePanel` lost
  its `mode` param and `funnelRows` output entirely rather than keeping
  either as dead weight for a caller that no longer exists — see its own
  header comment in `drilldownBuilders.js`. This card's inline reach/
  avg-days bars are still the real, only place that data is shown.
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
  filtering, which this screen never had. This redesign's Filters-toggle/
  active-chip language was, in turn, the template Search's party directory
  copied when Parties merged into it — see the Search section and "Current
  state" above; there is no more standalone Parties card/tab in Dashboard
  at all. A search box (party/site/owner, client-side over the fetched
  page — same precedent as Search/My Team) sits above the filter controls.
  **Desktop was redesigned again**, from a code-review finding: this whole
  screen sat in `.vip-narrow` (700px) despite showing six columns' worth of
  data per row and a five-facet filter panel, leaving ~340px of empty
  gutter on each side at desktop width — the exact "picked the wrong width
  class" failure the Design system section calls non-negotiable
  (`Dashboard.jsx`'s wrapper was a `activeTab === 'reports' ? 'vip-wide' :
  'vip-narrow'` ternary; it's unconditionally `vip-wide` now, for both
  tabs). Desktop (`.vip-only-desktop`) now renders a persistent **filter
  rail** (`vip-leads-rail`, sticky, all five facets always visible — no
  toggle, there's room to just show them) beside real
  party/site/owner/stage/source/value/last-touch **columns**
  (`vip-leadrow-head`/`vip-leadrow`, a CSS grid, not a literal `<table>` —
  same "shape of a table, not the markup" spirit the Design system section
  already uses elsewhere) instead of the old three-line `.vip-row` per
  lead. Owner/Stage/Source/Status/Quote value are all applied server-side
  via the filters-object `fetchLeadsList({ employeeId, stage, source,
  status, minValue, maxValue })` (`dashboardQueries.js`) — correct even
  under the 100-row cap, unlike filtering client-side after the fact would
  be. Mobile is untouched by this pass — still the Filters-toggle/
  active-chip disclosure panel (`vip-filter-chip`) collapsing into small
  removable chips plus "Clear all" when closed, feeding the same grouped-
  by-stage rows described in the Mobile redesign section's own Leads list
  bullet below. The filter *fields* themselves (`filterFields` in
  `LeadsListCard.jsx`) are one shared block of JSX rendered in both the
  mobile disclosure panel and the desktop rail, so the two can't drift
  apart. **A real bug caught and fixed while building the rail**: giving
  `.vip-leads-layout` an unguarded base `display: flex` (outside the
  `≥1024px` media query) collided with `.vip-only-desktop`'s own
  unconditional `display: none` at equal specificity — since
  `.vip-leads-layout` is applied on the *same element* as
  `.vip-only-desktop` and its rule sits later in the stylesheet, it silently
  won the cascade and leaked the desktop rail+columns through at mobile
  widths. Fixed the same way `.vip-dd-attn-grid` already avoids this
  (Dashboard-v2 Design-system bullet) — no `display` in the unguarded base
  rule, only inside the `≥1024px` block. Caught via a standalone static CSS
  test harness (this session had no live login to verify through the real
  app) rather than in the browser preview directly — worth a real
  `npm run build && npm run preview` + login re-check before this ships.
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

### Day Review (Dashboard's `Today` period)

Built from a third Claude Design handoff (`design_handoff_today_review/`
README.md + `VIPSAR Mobile.dc.html` turn 4). A **daily accountability read,
not a report**: an owner opens it during or at the end of the day and answers
"what did each exec log, what did they change on each lead, which follow-ups
closed, and how does that compare across the team" without asking anyone.
**Every number is bounded to a single calendar day** — nothing here aggregates
wider, and it deliberately **isn't a scored leaderboard** (raw counts only, no
weighting, no composite index, no ranking badge; sorting is the only ordering).

`Today` is the first segment of the existing `DateRangeSelector`, not a
separate route. Picking it **replaces the whole Reports card grid** — a
pipeline total or a month's attainment says nothing about eight hours, so
re-filtering the standing cards would be worse than not showing them.

* **The audit trail** (`Schema/migration_lead_change_log.sql`, **run live
  2026-08-10**) — a new `lead_change_log` table, written **only by a Postgres
  trigger on `leads`**, never by app code. There is no single lead-update
  service in this app (`leads` is written from four LeadDetail sections,
  `LeadStageSection`, `LeadQuickActions` and three side-effect paths in
  `ActivityLog.jsx`), so a JS helper would have to be called from all of them
  and the first missed call site becomes a silently absent audit row. The
  trigger catches every path including direct edits in the Supabase table
  editor. `field` is a closed set: `quote_value`/`order_value`/`product`/
  `created`. **Append-only at both layers** — no INSERT/UPDATE/DELETE grant or
  policy for anyone, the `SECURITY DEFINER` trigger is the table's only
  writer. SELECT is "own leads or owner role", mirroring
  `migration_scope_stage_history.sql`.
* **Stage changes are NOT in that table** — they come from `stage_history`,
  which already records exactly that and has real history going back to the
  start of the project. Logging them in both places would create two sources
  of truth for one fact and leave the day sheet blank for every date before
  the migration. Won/Lost are stages in this app, not a separate status
  field, so the handoff's `status` and `stage` change types collapse into one.
  **Consequence worth knowing**: `migration_owner_only_stage.sql` means only
  an owner can change a stage, so `stage_history.changed_by` is always the
  owner — a rep's day sheet will never show a stage move, and since the team
  table lists only sales execs, the owner's own stage moves don't appear on
  it at all. That follows from the owner-only rule, not from this feature.
* **`leads.created_by_employee_id`** (same migration, stamped by its own
  `BEFORE INSERT` trigger, backfilled from `owner_employee_id`) — the "New
  leads" column counts what a rep *created*. Using `owner_employee_id` would
  re-credit every reassigned lead to whoever holds it now, retroactively
  rewriting a day sheet for a date before the reassignment happened.
* **Deliberately not logged** (per the handoff's own decision record): owner
  reassignment (`lead_owner_history` has it), contact/address/source edits,
  and lead notes — **there is no notes column on `leads` at all**, only on
  `activities`, and those already show in the day sheet's Activities block.
  The spec's `old_display`/`new_display` pre-formatted columns were dropped
  too: `src/lib/format.js` already formats every rupee figure, so a second
  baked-in copy is just a value that can drift from the renderer.
* **`src/lib/dayReviewQueries.js`** — seven parallel day-bounded fetches
  (activities, change log, stage history, new leads, follow-ups due on D,
  follow-ups due on D+1, quotes sent) plus a second-round `fetchPriorStages`
  for the `old chip → new chip` diff (`stage_history` only records the
  *destination* of a change). `dayBounds()` runs midnight-to-midnight in the
  **browser's** local timezone, matching `todayISO()`/`rangeForPreset()`
  rather than inventing a second definition of "today". The change-log query's
  error is surfaced separately (`changesUnavailable`) so a missing migration
  degrades that one block instead of failing the screen.
* **`src/lib/dayReview.js`** — all shaping, no network calls, same division of
  labour `drilldownBuilders.js` follows. `buildDayRows`/`buildDayTotals`/
  `buildDayKpis`/`buildDaySheetPanel`/`buildSignificantEntries`. Covered by
  `dayReview.test.js` (25 cases).
* **The pending vs missed rule** — an open follow-up is **pending** while D is
  still running and only becomes **missed** once the day is over. There's no
  configured end-of-working-day in this app, so the boundary is midnight.
  Calling an open reminder a miss at 10 am would be a lie a manager acts on.
  The cell renders `done / pending` in amber while the day runs and
  `done / missed` in red afterwards, with a `title` spelling it out — the
  design's literal `6 / 2 · 1 pending` third figure doesn't fit a 1fr column
  among nine, and the colour carries the same meaning.
* **The team table** (`DayReviewCard.jsx`) — desktop is a real
  `190px + repeat(9, 1fr)` grid with `ACTIVITY`/`LEADS`/`FOLLOW-UPS` group
  headers spanning 3/4/2, sortable headers (desc then asc, default Total ↓),
  **a zero rendered as an em-dash** except in the Total column and the
  done/missed pair, and a Team total footer row. A zero-activity exec is
  muted and sinks to the bottom on its own — no badge, no red band, no
  pinning. The handoff called this desktop-only with no mobile version;
  **that was overridden on purpose** (Dashboard is a mobile tab here and the
  owner works from a phone), so below 1024px the same rows render as stacked
  `.vip-daycard`s opening the same day sheet.
* **The day sheet** — a `daySheet` kind in `DrilldownPanel`, three blocks in
  the order a manager actually asks: follow-ups (missed group first, with the
  **one action this panel allows** — Reschedule) → activities logged →
  changes made to leads. Each block caps its list with a "+N more" line.
  `DrilldownPanel`'s head gained an optional `avatar`, and its value row is
  now conditional — a day sheet leads with a person, not a headline figure.
* **A sales exec sees only their own row.** Their queries are already
  RLS-scoped, so listing the whole team would render every colleague as an
  all-zero row — worse than not showing them. `dayEmployees` is
  `isOwner ? employees : [employee]`.

**Timestamps — read this before touching any date rendering.** Most timestamp
columns in this schema are `TIMESTAMP` *without* time zone, filled from
`now()` on a UTC database, so they hold a UTC wall clock with nothing marking
it as such; PostgREST serialises that as `"2026-08-09T09:49:01"`. Handing that
to `new Date()` parses it as **local** time (the ES spec's rule for an
offset-less date-time), so every such timestamp rendered **5½ hours early** in
IST. Confirmed against the live database, not inferred: a `lead_change_log`
row (a real `timestamptz`) came back `...T09:34:43+00:00` and an `activities`
row 15 minutes later on the same DB clock came back `...T09:49:01` with no
zone. **`src/lib/dbTime.js`'s `parseTimestamp` is the fix and the one correct
way to parse these** — it appends the missing `Z` and passes a
zone-carrying string through untouched, so it's safe on any timestamp column.
This was a **pre-existing bug**, not one this feature introduced; the three
places that render a naive timestamp to a user were fixed with it
(`drilldownBuilders.js`'s log drill-down, `EmployeeProfile.jsx`'s Activity
log, `LeadActivityTimeline.jsx`'s date). **Still unfixed, deliberately**: the
many places that only *compare* or sort naive timestamps (range filters in
`KpiSparkRow`/`TargetsVsActualsCard`/`SalesFunnelCard`/`attention.js`), where
a uniform offset mostly cancels out — a period boundary can still misclassify
an event inside a 5½-hour window, which is worth its own audit rather than a
scattergun edit here.

**Verified live** against the real dev database, not just reasoned through:
stepping back a day reloaded every figure (Live · updated → `Final · 9 Aug`,
activities 0 → 3, new leads 0 → 1, Tomorrow 1 → —); the day sheet's rows
matched the table's counts exactly (table said 3 activities / 1 call /
1 visit, sheet listed 3 rows with exactly that mix; table said 0 changes and
1 new lead, sheet showed one `CREATED` row and "1 lead created · no edits");
dash-for-zero and real-number-for-Total confirmed in both directions; a real
`quote_value` edit appeared as `₹5.0L → ₹8.4L`; and the timestamp fix was
confirmed by an activity stored as `09:49` UTC rendering as **3:19 pm**. Both
`.vip-only-mobile`/`.vip-only-desktop` sides were checked by computed style at
375px and 1440px — **a real cascade bug was caught this way**: `.vip-daycards`
carried an unguarded `display: flex`, which beat `.vip-only-mobile`'s
`display: none` (equal specificity, later in the file) and leaked the mobile
card list through at desktop width, exactly the failure `.vip-leads-layout`
hit before it. **Not exercised live**: multi-exec sorting and the
zero-activity-sinks-to-the-bottom behaviour (this dev database has one sales
exec; both are covered by unit tests), and the Reschedule write path.

### Profile (`src/pages/Profile.jsx`)

The Mobile redesign pass hid the whole owner-only admin block below (Add
employee/Manage employees/Delete a party) below 1024px — `.vip-only-desktop`
now wraps it; identity facts/Notifications/Change password/Log out are
unchanged at every width. See that section.

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
* **Appearance** (new — both roles, every width, unlike the owner-only
  admin block below) — a Light/Dark/System `vip-seg-outline` control over
  `src/lib/theme.js`'s `getStoredTheme`/`setTheme`; see the Design system
  section's Dark mode bullet for how the token side of this works.
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

### Mobile redesign (`design_handoff_vipsar_mobile`)

A second Claude Design handoff redesigned the below-1024px experience end to
end for a sales exec working in the field — desktop is untouched throughout
(every change here is gated by the `.vip-only-mobile`/`.vip-only-desktop`
pattern section 17 already established, or CSS scoped to
`@media (max-width: 1023.98px)`). No schema change, no new query — every
value shown was already produced by an existing `src/lib/*Queries.js`
function.

* **Navigation** — the old "just Home + Search visible, everything else
  desktop-sidebar-only" mobile bar is gone. `BottomNav.jsx` now renders 4
  mobile tabs (**Today**/**Leads**/**Dashboard**/**Search** — Leads and
  Dashboard are new `.vip-mobile-tab` links placed right after Home in the
  DOM so they don't disturb the desktop sidebar's existing link order,
  itself completely unchanged) plus a centre **FAB** (`.vip-fab-slot`/
  `.vip-fab`, a reserved 76px gap between the Leads/Dashboard tabs, not an
  absolutely-centred circle over 4 equal tabs — that clipped through the
  Dashboard label the first time this was built) opening `FabSheet.jsx`, a
  two-choice bottom sheet (New Lead / Log Activity — Log Activity omitted
  for an owner, `/activity` is sales_executive-only). **Real overlap bug
  found and fixed** (a code-review finding): the FAB (60px tall, `bottom:
  36px` inside an 82px slot) pokes 14px above the bar's own top edge, but
  `.vip-body`'s base bottom padding only ever cleared the bar itself, not
  that extra rise — so the last row of a tab route's scrollable content
  (Today, the Leads tab, Search) could sit behind the button. Fixed with a
  `.vip-pad-fab-overhang` utility (24px, mobile-only — same shape as
  `.vip-pad-sticky-footer`'s clearance for a drilled route's sticky
  footer, just for the three tab routes that actually show the FAB instead
  of the routes that show a sticky footer) applied to each of those three
  pages' own top-level wrapper div. Verified live at 375px: the last row on
  both All Leads and Search now clears the FAB with visible whitespace.
  `src/lib/tabRoutes.js`
  now holds the shared `TAB_ROUTES` set (`/`, `/search`, `/dashboard`) —
  `AppNav.jsx` reads it for the back-button gate, `ProtectedRoute.jsx` reads
  the same set to add a `.vip-drilled` class to `.vip-app` for every other
  route. Below 1024px, `.vip-drilled` hides `BottomNav` entirely (New Lead,
  Log Activity, Lead Detail, Profile, My Team, Sales Exec Profile) —
  replaced by each page's own `.vip-sticky-footer` (a normal static block at
  desktop, `position: fixed` above the safe-area only below 1024px) or
  nothing. A page using `.vip-sticky-footer` gives its scrollable content
  `.vip-pad-sticky-footer` (88px bottom padding, mobile-only) so the footer
  doesn't permanently cover the last field.
* **Today replaces Home** (`src/pages/Home.jsx`) — HOME_TILES/
  `src/lib/homeTiles.js` and the tile-grid shortcut stack are gone entirely
  (deleted, not just unused — its one consumer was Home's old mobile tile
  grid, which this redesign replaces). Today is now: a greeting bar (a
  SYNCED/OFFLINE pill from the new `src/hooks/useOnlineStatus.js` +
  avatar-linking-to-`/profile`), a "My numbers" `.vip-seg-mini` W/M/Q/Y
  block feeding a hairline 2×2 KPI grid (`.vip-dd-kpi-grid` — now 2 columns
  by default, widening to 6 only at ≥1024px, shared with `KpiSparkRow`/
  `EmployeeProfile`'s 6-metric grids, see below), an **order-value-vs-target
  bar** (new — `fetchTargetsForPeriod`/`targetFor`, scoped to *this*
  employee specifically via `computeOrderValueActuals(..., true).get(employee.id)`,
  even for an owner — deliberately personal, not the company-wide total the
  KPI tiles above it show), and a **work queue**: 2 rows from
  `fetchDueFollowUpsForEmployee` (Overdue / Due today, split on
  `due_date` vs today) + 3 of `computeAttentionBuckets`' 5 buckets (stale,
  silent quotes, slipped — `followups_overdue`/`pending_rfq` deliberately
  excluded, the first as redundant with the real follow-up rows, the second
  not shown on this screen at all), buckets pre-filtered to
  `owner_employee_id === employee.id` client-side (breakdownLeads/
  lastActivityByLead are company-wide for an owner under RLS). Tapping a
  queue row opens `DrilldownPanel` — the 3 attention rows via the existing
  `buildAgeingPanel(bucket, 'You', employee.id)` (new `scopeLabel` param,
  default `'Company'` for Dashboard's unchanged usage — the eyebrow used to
  hardcode "Company" even for this personal case), the 2 follow-up rows via
  a new `followup` panel kind (`DrilldownPanel.jsx`'s `FollowUpBody`, just
  `FollowUpList` reused as-is — a follow-up doesn't always resolve to a
  lead, so it can't reuse `AgeingBody`'s per-row `<Link>`). "Your reminders"
  (create a personal follow-up) and "Closing next" are unchanged from the
  old Home.
* **Queue drill-down row actions** — `buildAgeingPanel`'s `queueActions`
  flag (true whenever `scopeLabel !== 'Company'`, i.e. only Today's own
  calls) makes `AgeingBody` render `SwipeAgeRow` instead of a plain
  `<Link>`: drag left (touch or mouse, no drag library — see Conventions)
  to reveal **Log call** (inserts an `activities` row, same shape
  `ActivityLog.jsx` uses) and **Set date** (writes
  `leads.next_followup_date` via a small inline date picker reusing
  `.vip-action-panel`), snapping open past 40% travel. A footer button,
  "Set a follow-up on all N", bulk-writes the same column across every row
  in the panel and optimistically empties the local list (not a real
  bucket recomputation). Dashboard's own Needs Attention rows are
  unaffected — `queueActions` is false there, same plain `<Link>` as always.
* **New Lead** (`LeadQuickCapture.jsx`) — reordered: **Where from** (the
  only required field) now comes first, Client name, Site nickname, then
  originally "other party" collapsed behind a `.vip-disclosure-row` ("+
  Architect / PMC / someone else") until tapped or already filled — removed
  in a later pass, see the LeadQuickCapture section above, so this field is
  now always visible too. The sticky footer's
  Save button used to show a `.vip-offline-note` ("Offline — saves on this
  phone, syncs later") when `useOnlineStatus()` was false — removed, along
  with the matching "Works offline…" line in `FabSheet.jsx`'s footer,
  because neither claim was true: there's no write queue anywhere in this
  app, so a save attempted with no signal just fails like any other network
  error. `OfflineIndicator.jsx` (mounted globally, see PWA installability
  below) is the one honest source of connectivity status; don't reintroduce
  a second, conflicting one on a specific form without actually building
  the offline write queue to back it.
* **Log Activity** (`ActivityLog.jsx`) — "Against which lead?" now defaults
  to a `RecentLeadsPicker` (radio rows, `.vip-radio-row`/`.vip-radio-dot`,
  `fetchLeadsList({employeeId})` + `fetchLastActivityPerLead()` sorted by
  last touch, capped to 8) instead of search-first — a "Search all" toggle
  falls back to the original `LeadSearchSelect`. Sticky footer for "Log it".
* **Lead Detail** (`LeadDetail.jsx`) — desktop is the exact same inline rail
  + always-visible `LeadQuickActions` as before (now wrapped in
  `.vip-only-desktop`, that's the only change on that side). Mobile
  collapses `SalesProgressSection`/`SiteDetailsSection`/
  `ClientDetailsSection`/`AdditionalContactsSection` into one `.vip-card` of
  `.vip-detail-row` summary lines (`quote sent 12 Jul ›`, `Model Town ·
  finishing ›`, etc., derived from state already loaded, no new fetch) —
  tapping one pushes the *same* section component into a full-screen
  `.vip-dd-panel` overlay (reusing the drill-down's own backdrop/panel CSS
  for a form instead of a data view). A `mobileActionBar` (Log
  activity/Call client, available to every viewer same as the old
  unconditional btn-row, plus a `canEdit`-only 48px ⇄ button) replaces the
  desktop btn-row below 1024px, opening the exact same `LeadQuickActions`
  as a `FabSheet`-style bottom sheet instead of always-inline.
* **Leads list** (`LeadsListCard.jsx`) — mobile default is grouped by stage:
  sticky `.vip-lead-group-head` (stage colour square via `stageFg()`,
  count, summed value) over full-bleed `.vip-lead-row`s (breaking out of
  `.vip-body`'s 16px gutter via `.vip-lead-groups`'s negative margin,
  mobile-only) each showing a recency line ("touched today" / "Nd silent"
  in `--vip-lost` past `STALE_DAYS`, from a new `fetchLastActivityPerLead()`
  call this card didn't previously make), inside `.vip-only-mobile`. Desktop
  originally kept the old flat `.vip-row` list wrapped in `.vip-only-desktop`
  unchanged by this redesign — since replaced by its own persistent-rail +
  real-columns layout from a later code-review pass, see the Dashboard
  section's own LeadsListCard bullet above; this bullet's mobile-side
  description is otherwise still current. Search/filter
  state and queries are unchanged. Dashboard's own header pushes a
  `{title, sub}` override when `?tab=leads` ("My leads"/"All leads" + a live
  open-count/value from `breakdownLeads`) — `AppNav.jsx`'s override now
  supports a `title` override, not just `sub` (still only used by this one
  case).
* **Dashboard** (`Dashboard.jsx`) — `KpiSparkRow` lost its `.vip-only-desktop`
  wrapper and now renders at every width (the old separate 4-tile mobile
  `.vip-kpi-grid` fallback is gone); `NeedsAttentionCard` caps to the first
  3 buckets + a "+N more buckets" expand link below 1024px regardless of its
  `wide` prop (desktop is unaffected either way — plain list or the
  existing tile grid). Owner-only, mobile-only: a "My Team" `.vip-tile` row
  now sits at the top of this page — Home's old tile grid was My Team's
  *only* mobile entry point before this redesign removed it, so without
  this row an owner would have no way to reach `/team` on a phone at all.
  **Real bug found and fixed**: this tile used to render outside
  `Dashboard.jsx`'s `activeTab === 'reports'` branch entirely, so it also
  showed on the All Leads view (`?tab=leads`) — a "Browse your sales team"
  card sitting above the lead list, on a screen it has nothing to do with.
  Moved inside the `reports` branch; verified live that it's gone from All
  Leads and still shows on Reports.
* **Search** (`Search.jsx`) — a mobile-only `.vip-seg` Parties/Leads/Sites
  switch (`.vip-search-hide-mobile`, a class with no rule outside
  `max-width: 1023.98px`) now shows one section at a time; desktop still
  stacks all three, unchanged.
* **Profile** (`Profile.jsx`) — the owner-only admin block (Add employee /
  Manage employees / Delete a party) is now `.vip-only-desktop` — mobile
  Profile stays a lean personal screen (identity facts, Notifications,
  Change password, Log out), matching the handoff's "not shown on mobile"
  note. `AddEmployeeForm`/`ManageEmployeesSection`/`DeletePartySection`
  themselves are unchanged; only their visibility is new.
* **My Team** (`MyTeam.jsx`) — each card's `.vip-team-stats` strip gained a
  third cell, **Needs attn.** (red at 5+, amber below) — the sum of all 5
  `computeAttentionBuckets` bucket counts for that employee's own leads, a
  new `fetchLastActivityPerLead()` call this page didn't previously make.
* **Sales Exec Profile** — needed no direct changes; its 6-tile
  `.vip-dd-kpi-grid` metric grid automatically picked up the 2-column
  mobile layout from the shared CSS fix above.

### Data isolation — what a sales exec can see and change

A full audit (2026-08-10) of "a sales exec only sees their own data and only
changes their own leads", traced against `Schema/rls_policies.sql` and every
`.from('leads'|'activities'|'targets'|'stage_history'|'employees'|'follow_ups')`
call site. **Verified clean, don't re-litigate these**: all writes are backed
by real RLS `WITH CHECK` clauses (a UI gate bypass fails server-side, so UI
gates here are convenience, not the boundary); `/team`, `/employees/:id`'s
role check, and the owner-only Dashboard cards (`LossReasonsCard`,
`DashboardHeatmap`, exec filters) all hard-block rather than CSS-hide;
`Home`, `NeedsAttentionCard`, `Search`'s "Worked with" list,
`ClosureForecastCard` and `TargetsVsActualsCard` read only RLS-scoped
`leads`/`activities`. What the audit actually found:

* **`stage_history` SELECT was open to every active employee** — not scoped
  to own leads. Three unconditional fetches (`fetchStageHistoryForFunnel`,
  `fetchWonStageHistory`, `fetchDecidedStageHistory`) therefore pulled every
  lead's stage rows on every Dashboard/Home/EmployeeProfile load. The
  *displayed* numbers were never wrong — each consumer drops rows whose
  embedded `leads(...)` came back null under RLS — but the raw network
  response carried other reps' `lead_id`/`stage`/`changed_at`. Fixed at the
  RLS layer by `Schema/migration_scope_stage_history.sql` (see Conventions;
  **outstanding**). The client-side null-embed filters are deliberately kept
  as belt-and-braces.
* **`EmployeeProfile.jsx` fired its fetches before the role redirect** — the
  guard was its own `useEffect`, and React runs every initial-mount effect
  in the same pass, so `navigate()` didn't preempt them. Only
  `fetchEmployeeProfile` actually returned anything (the other three hit
  RLS-scoped tables), so the exposure was a colleague's name/role flashing
  before redirect, but every fetch effect is now gated on
  `allowed = isOwner || isSelf`.
* **`employees` SELECT is open to any active employee** (name, mobile,
  email, role) — a documented, deliberate exception, needed for name
  lookups, `EmployeeLink`, and the "Accompanied by" dropdown. Left as-is,
  but `fetchEmployeeProfile` stopped selecting `mobile`, which it fetched
  and never rendered.
* **Drill-down panels were labelled "Company" for everyone.** A sales exec's
  panels are correctly scoped by RLS, but the hardcoded eyebrow implied
  team-wide visibility. Every `build*Panel` in `drilldownBuilders.js` now
  takes a `scopeLabel` (defaulting to `'Company'`, so the owner is
  unchanged); `Dashboard.jsx` passes the viewer's own name for a non-owner.
  `buildAgeingPanel` already had this param — the others just never got it.
  Note its fourth arg, `queueActions`: Dashboard passes `false` explicitly,
  since that flag used to be *derived* from `scopeLabel !== 'Company'` and
  would otherwise have switched Dashboard's Needs Attention rows into
  Today's swipe-action queue as a side effect of the label change.

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
- The anon key this app runs on can't execute DDL. Any schema/DB change (new column, altered constraint, etc.) has to be handed to the user as a migration statement to run manually via the Supabase dashboard's SQL Editor — never assume a schema-file edit is reflected in the live database. Confirm with the user that `Schema/` files (schema + `Schema/rls_policies.sql`) have actually been run against the live project rather than trusting their presence in the repo. Three migrations flagged as outstanding before the pilot — `parties.party_type`'s `'pmc'` value, `targets.period_type`'s `'quarter'` value, and the `lead_owner_history` table + its RLS policies — were all run live on 2026-08-09 via `Schema/migration_pilot_outstanding.sql` and re-verified end to end in the browser (created a `pmc` party from New Lead's "other party" field, saved a Quarter target, reassigned a lead's owner and confirmed a real history entry with the correct "changed by" attribution — a related bug in `insertLeadOwnerHistory`'s own `.select()` not fetching back `changed_by_employee`, caught during that verification, is fixed too). None of the three are outstanding anymore. Still outstanding: the Lead stage taxonomy rename (see its own section above) needs a one-time data migration run live — `ALTER TABLE leads ALTER COLUMN current_stage SET DEFAULT 'calling';`, then `UPDATE leads SET current_stage = 'calling' WHERE current_stage = 'new';`, `UPDATE leads SET current_stage = 'negotiation' WHERE current_stage = 'hot';`, `UPDATE leads SET current_stage = 'quote_submission' WHERE current_stage = 'quote';`, and the matching `UPDATE stage_history SET stage = 'negotiation' WHERE stage = 'hot';` / `UPDATE stage_history SET stage = 'quote_submission' WHERE stage = 'quote';` to keep the historical trail consistent. No CHECK constraint needs altering for this one (`current_stage`/`stage_history.stage` are both free text, and `follow_ups.activity_type`'s CHECK already allows the `'other'` value the On Hold flow uses) — until the `UPDATE`s run, live leads still sitting at the old `new`/`hot`/`quote` values will render as a plain grey "Other…" chip with their raw old value as the label, rather than a colored stage chip. A code-review pass also flagged the two columns every `own_data_or_owner_role_*` RLS policy filters on, `leads.owner_employee_id` and `activities.employee_id`, plus `stage_history(stage, changed_at)` (the columns `fetchWonStageHistory` filters/sorts on), as unindexed — every `leads`/`activities` query for every employee was a sequential scan on those columns. Fixed live via `idx_leads_owner`/`idx_activities_employee`/`idx_stage_history_stage_changed`, run 2026-08-09; `Schema/tostem_crm_schema.sql`'s own index list now includes all three so a fresh install gets them too. Also outstanding: the new **Architect Meeting** activity type (see the ActivityLog section above) needs `Schema/migration_architect_meeting.sql` run live — it adds `'architect_meeting'` to both `activities.activity_type`'s and `follow_ups.activity_type`'s CHECK constraints (confirmed via a real live error that the former's constraint name is exactly `activities_activity_type_check`, as the migration assumes; the latter's name wasn't independently confirmed the same way, hence that file's own SELECT-first safety check). Until this runs, tapping Architect Meeting and submitting fails with a CHECK violation, surfaced as a normal inline error — everything up to that point (the architect search-or-create picker, the party insert if a new architect is typed) already works against the live DB today, since neither depends on this constraint. **Two more migrations from the 2026-08-10 data-isolation pass are also outstanding** (see the Data isolation section below): `Schema/migration_scope_stage_history.sql` (narrows `stage_history` SELECT to "own leads or owner role" — until it runs, a sales exec's browser still *receives* every lead's stage-change rows in the raw network response, even though nothing renders them) and `Schema/migration_owner_only_stage.sql` (the `BEFORE UPDATE` trigger on `leads` enforcing owner-only stage changes, plus owner-only `stage_history` INSERT — until it runs, the "sales exec can't change stage" rule is UI-only and a rep could still flip a stage through the API). Both are safe to re-run and neither is required for the app to work as it does today — the UI already behaves correctly without them; they close the gap between the UI's rules and the database's. **`Schema/migration_lead_change_log.sql` was run live on 2026-08-10** and is
no longer outstanding — it creates the `lead_change_log` audit trail, adds
`leads.created_by_employee_id`, and installs three triggers on `leads` (see
the Day Review section for what each does and why the trail is trigger-written
rather than written from app code). It had to run **after**
`migration_backlog_2026_08_10.sql`, since that file's bulk stage-rename
`UPDATE`s must land before its own owner-only-stage trigger is installed, and
the Day Review reads stage moves straight out of `stage_history`. Verified end
to end in the browser afterwards: a real `quote_value` edit made through Lead
Detail produced a correctly attributed log row that renders on the day sheet.
**`Schema/migration_backlog_2026_08_10.sql` bundles all four outstanding items** (architect meeting, the stage taxonomy rename, and both of the above) into one safe-to-re-run file with verification queries — prefer it over running the individual files, because **the order is load-bearing and not obvious**: the owner-only-stage trigger fires even for roles that bypass RLS (triggers aren't part of RLS), and the SQL Editor has no `auth.uid()`, so `current_employee_role()` is NULL there — running the trigger step before the taxonomy `UPDATE`s would make those `UPDATE`s abort with "Only an owner can change a lead's stage". The trigger function carries an `auth.uid() IS NOT NULL` guard so admin SQL keeps working after it's installed (a deactivated employee is still blocked — real `auth.uid()`, NULL role), but the bundled file also sequences the steps so the hazard can't bite.
- Employee accounts are created manually in Supabase (Auth → Users), not via self-signup — none planned. Supabase's default email-confirmation requirement can block login for a newly created account before its email is confirmed — worth checking that setting if a freshly created sales-exec login doesn't work.
- Row Level Security (full policies in `Schema/rls_policies.sql`; **confirmed live** — `current_employee_id()`/`current_employee_role()` and every policy below have been run against the real project and verified: deactivating an employee (`employees.is_active = false` in Manage Employees) now actually revokes their database access, not just the client-side `ProtectedRoute` block): every policy that used to inline `(SELECT id/role FROM employees WHERE auth_user_id = auth.uid())`, or leave a table wide open with `USING (true)`/`WITH CHECK (true)`, now goes through one of two `SECURITY DEFINER` helper functions instead — `current_employee_id()`/`current_employee_role()`, both filtered to `is_active = true` and both resolving to `NULL` for a deactivated employee's row. That single change is what makes deactivating someone in Manage Employees actually revoke their access, not just hide the UI. `activities`/`leads`/`plans`/`targets` use "own data or owner role" (`employee_id`/`owner_employee_id` `= current_employee_id()`, or `current_employee_role() = 'owner'`) for SELECT/INSERT/UPDATE, plus **owner-only DELETE** (no "own data" exception — a sales exec can create/edit their own rows but can't delete even those; only an owner can). `employees`: SELECT requires `current_employee_role() IS NOT NULL` (i.e. "you resolve to some active employee" — this doesn't filter which employee rows come back, so an active owner still sees every row including inactive ones; it only gates whether a deactivated caller can query the table at all), INSERT/UPDATE/DELETE owner-only with **no self-update exception** (a sales exec must never set their own `role` to `'owner'`). `sites`/`parties`/`areas`/`site_contacts`/`products`/`stage_history`/`lead_owner_history` SELECT/INSERT now require `current_employee_role() IS NOT NULL` too — these used to be unconditionally `true` (open to any authenticated session regardless of `is_active`), which is exactly how a deactivated rep kept full access to the whole party directory even after being switched off. `sites`/`parties` UPDATE is "own data or owner role" (`discovered_by`/`created_by`), DELETE owner-only. `areas`/`site_contacts` UPDATE/DELETE stay owner-only (shared master data / append-style joins — no per-row "own data" concept applies). `products` UPDATE/DELETE owner-only. `stage_history`/`lead_owner_history` have no UPDATE/DELETE ever, for anyone including owner — permanently append-only by design. `loss_reasons`: SELECT requires `current_employee_role() = 'owner'`, INSERT requires `current_employee_role() IS NOT NULL`, no UPDATE/DELETE ever, same append-only-forever reasoning. `follow_ups` is "own data or owner role" keyed on `assigned_to` (not `created_by`) for SELECT/INSERT/UPDATE plus owner-only DELETE — same shape as activities/leads/plans/targets, see the Follow-ups section. `push_subscriptions` is narrower: SELECT is "own data or owner role" (keyed on `employee_id`), but INSERT/UPDATE/DELETE have **no owner-role exception at all** — a subscription is tied to one specific browser instance, so only the device's own employee can write it (`employee_id = current_employee_id()`, no `OR` branch); real cross-employee cleanup of dead subscriptions happens via the Edge Function's `service_role` key instead, which bypasses RLS entirely and never calls these functions (`service_role` has no `auth.uid()`). A write needs both the table GRANT (Step A of `rls_policies.sql`) and the RLS policy to agree — DELETE is granted on the twelve tables with an `owner_only_delete`/`own_data_delete` policy (`employees`/`areas`/`sites`/`site_contacts`/`parties`/`products`/`leads`/`activities`/`plans`/`targets`/`follow_ups`/`push_subscriptions`); `stage_history`/`lead_owner_history`/`loss_reasons` get no DELETE grant at all.
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
   role-differentiated Home/Today content, and a general
   browse-past-activities screen. Followups (see the dedicated section), the
   Mobile redesign (the below-1024px experience end to end, desktop
   untouched) and the Day Review (`Today` on the Dashboard, plus the
   `lead_change_log` audit trail and the Done/Still-to-do restructure of the
   exec's own Today screen) all shipped during this phase.

For domain model, lead-sourcing logic, and locked-in design decisions, see DECISIONS.md.
