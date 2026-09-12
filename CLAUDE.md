# CLAUDE.md

Start every reply with my name (Code Genius).

Guidance for Claude Code when working in this repository.

## IMPORTANT — ask before you build

**Ask clarifying questions whenever a request leaves real room for
interpretation. This takes priority over any "bias toward acting without
asking" default.** The user would rather answer two or three questions up
front than review a screen built on a guess. A wrong guess costs a full
build-and-revert cycle; a question costs one message.

Use `AskUserQuestion` (2–4 questions, recommended option marked) as soon as
any of these is true — don't wait until you're stuck:

- The request names a UI change but not the exact placement, shape, or
  wording ("add a lead count alongside the pipeline" — *which* pipeline
  figure? the KPI tile, the card header, both?).
- "Bring back the old look" / "like it was before" — confirm *which*
  previous state.
- A feature could reasonably be inline (filters on the current screen) or
  navigational (a second screen/panel). These look nothing alike.
- The change removes or replaces something that already exists — confirm
  what happens to what's there now, and what fills the space it leaves.
- Anything touching layout on a screen the user actively uses.

Purely technical choices (which util to reuse, where a class belongs) you
should still just decide. This rule is about **what the user sees and how it
behaves**.

**If a request doesn't say which role it's for, ask.** Don't infer it from
whichever role happens to be logged in on the preview tab. This app has four
(`owner` / `sales_executive` / `sales_coordinator` / `sales_manager`) and
they diverge constantly.

## IMPORTANT — every change is a role × breakpoint matrix

**Nothing is done until it has been checked at BOTH widths for EVERY
affected role.** Mobile (<1024px) and desktop (≥1024px), against each of the
four roles the change can touch. A capability that appears on a phone but
not on desktop (or the reverse) is a bug unless this file records it as a
deliberate decision.

This shipped once: a sales coordinator had no New Lead and no Log Activity
anywhere on desktop, because `BottomNav.jsx` computed the same capability
twice — the mobile FAB OR'd the role in at its own call site while the
desktop `.vip-nav-extra` links kept older exec/owner-only flags. Two rules
follow:

- **One flag per capability, read by both renderings.** Never let a mobile
  and a desktop control compute the same permission separately. Correcting
  the boolean without merging the two leaves the trap armed. Gate the link,
  not the viewport.
- **Walk the matrix before declaring done.** Three dev servers
  (`role-owner`/`role-coordinator`/`role-exec`, ports 5181/5182/5183) let
  several roles be logged in at once — separate origins mean separate
  localStorage. **The session on a port may not match the port's name**; key
  off the rendered role in `.vip-sidebar-foot-role`, not the launch-config
  label.

## What this is

A CRM for a Tostem window & door dealership: leads, quotes, orders, installs.
React + Vite PWA, Supabase backend, Vercel host (deploys from `master`). Used
by sales executives mostly from a phone in the field, often with poor signal
— favor mobile-first layouts, don't assume a reliable connection.

The app's display name (tab title, PWA manifest, login heading, nav brand) is
**VIPSAR CRM** — VIPSAR is the dealership; Tostem is the product line it
sells. Don't "fix" one to match the other: schema/doc language ("Tostem CRM
schema") describes the product domain and predates the rename.

Domain model, lead-sourcing logic, and locked-in design decisions ("don't
reverse without discussion") live in `DECISIONS.md`, not here.

## Current state

Phases 0–6 done (schema + RLS, login, lead intake, activity logging,
dashboards, PWA). **Phase 10 — Sales Manager role** is current; see the
Roadmap. Each screen is documented in its own section below.

**Deliberately not built — don't add as a side effect of unrelated work:**

- A **`plans`-table screen.** The table has full RLS and zero UI anywhere.
- **A general browse-past-activities screen.** `ActivityLog` only *logs*
  new ones. The Day Review's day sheet covers one exec on one chosen day, a
  lead's timeline and a Sales Exec Profile cover their own slices — there is
  no "all activities, any range, filterable" screen.
- **Editing an existing follow-up's details**, and a standalone Follow-ups
  list page. Only create and mark-done exist in the UI.
- **Owner-name badges inside `DrilldownPanel.jsx`'s deeper bodies**
  (ageing/forecast/pipeline/loss row lists) as links, unlike everywhere else
  a person's name appears. A known gap, left deliberately.
- **`LeadsByAreaCard.jsx`** was tried as its own component twice and removed
  both times; it is permanently merged into the generic
  `LeadsByCategoryCard`. Don't recreate it.

**Open process gap, the owner's to resolve — don't "fix" it in passing:**
leads exist in the live DB with `order_value` set while still open (not
`won`/`lost`), i.e. a Booking Update was logged without the stage being
flipped to `won`. This contradicts the "a booked order is automatically won"
assumption `pipelineValue.js` leans on. It changes no figure today.

## Stack

- React 19 + Vite
- `vite-plugin-pwa` (manifest + service worker), configured in `vite.config.js`
- Plain CSS — one shared design-system stylesheet, `src/vipsar-theme.css`
  (design tokens + `vip-*` classes), imported in `main.jsx` after the
  deliberately-empty `src/index.css`. No CSS framework, no per-page CSS.
- Oxlint (`npm run lint`), Vitest

## Structure

```
src/
  components/   reusable UI (ProtectedRoute, AppNav, BottomNav, NavIcons,
                PartySearchOrCreate, SiteSearchOrCreate, LeadSearchSelect,
                EmployeeSearchSelect, the four LeadDetail *Section components
                (Sales progress / Site details / Client details / Contacts),
                LeadQuickActions, LeadStageSection, LeadActivityTimeline,
                EmployeeLink, DateRangeSelector, the Dashboard cards
                (ActivityCountsCard, LeadsBySourceCard, ClosureForecastCard,
                TargetsVsActualsCard, SetTargetForm, LeadsListCard,
                LeadsByCategoryCard, SalesFunnelCard, LossReasonsCard,
                NeedsAttentionCard, KpiSparkRow, RightNowStrip,
                DashboardHeatmap, DonutChart, DrilldownPanel),
                DayReviewCard, DayReviewHeader (exports DayDateBar +
                DayKpiStrip), AddEmployeeForm, ManageEmployeesSection,
                DeletePartySection, ChangePasswordForm, InstallPrompt,
                NotificationPrompt, OfflineIndicator, UpdateBanner,
                FollowUpForm, FollowUpList, FabSheet, AssignedLeadsCard,
                NumPadInput, TodayGreetingHeader, TeamTodayPanel,
                FollowUpsCard, ShowMoreRows, ErrorBoundary)
  pages/        Login, Today (the role switch for `/`), Home
                (sales_executive's own `/`; takes an `embedded` prop),
                OwnerToday, CoordinatorToday, ManagerToday, Profile, Search,
                Dashboard, LeadQuickCapture, LeadDetail, EmployeeProfile,
                MyTeam, ActivityLog, NotFound
  contexts/     AuthContext (session + employee lookup);
                HeaderContext (dynamic {title, sub} override for AppNav)
  hooks/        useOnlineStatus.js, useIsMobile.js (the 1024px breakpoint as
                a JS boolean)
  lib/          supabaseClient.js, supabaseFetch.js, queryCache.js,
                fetchAllRows.js, sanitizeForIlike.js, errorMessage.js,
                format.js, dbTime.js, initials.js, theme.js, roles.js,
                tabRoutes.js,
                option lists: siteStageOptions, leadStageOptions,
                lossReasonOptions, statusColors, activityTypes,
                sourceTypeOptions, meetingLocationOptions, partyTypeOptions,
                territoryOptions, targetMetrics,
                rules: pipelineValue, leadName, attention, stageProgress,
                meetingBucket, rfqKind, dateRanges, dateMath, targetPeriods,
                followupDates, dayReview, drilldownBuilders, selfAssignTest,
                appUpdate,
                queries: dashboardQueries, searchQueries, targetQueries,
                partyQueries, employeeQueries, lookupQueries,
                leadOwnerHistory, dayReviewQueries, followUpQueries,
                notificationQueries, authQueries, pushSubscription
  assets/       images, icons
  sw.js         the service worker source (push handlers only)
  vipsar-theme.css   the app's one design-system stylesheet
```

Outside `src/`, `supabase/functions/send-followup-reminders/` is the only
backend code in this repo — a Deno Edge Function, not part of the Vite
build, deployed independently. **Its name is now wrong and must stay wrong:**
it sends both follow-up reminders and lead-assignment pushes, but renaming it
changes the invoke URL and would silently break the configured cron.

### Routing (`App.jsx`)

`/`, `/profile`, `/search`, `/dashboard`, `/leads/new`, `/leads/:id`,
`/employees/:id`, plus `/activity` (**not owner** — exec, coordinator and
manager) and `/team` (**owner + sales_manager**). There is no `/settings` or
`/account` route; both merged into `/profile`.

`/employees/:id` is gated *inside* `EmployeeProfile.jsx`, not by
`ProtectedRoute`'s `allowedRoles` — a sales exec may view their own page but
not a colleague's, which isn't a role-level distinction `ProtectedRoute` can
express.

`ProtectedRoute` handles redirect-to-login and role gating (redirect to `/`
on mismatch), plus a hard block for `employee.is_active === false` — a
full-page "Account deactivated" message with a Log out button, no nav,
checked **before** the role gate. That mirrors what
`rls_policies.sql`'s `current_employee_id()`/`current_employee_role()`
enforce server-side; without the screen, a deactivated session would just
see every query come back empty.

**`AuthContext` is the single source of truth for who's logged in and what
their role is.** Use `useAuth()`; never re-query `employees` in a component.

`ProtectedRoute` renders `<div className="vip-app">` containing `AppNav`
(`vip-header`), `{children}` (`vip-body`) and `BottomNav`
(`vip-bottom-nav`). Heights come from `--vip-header-h` /
`--vip-bottom-nav-h` and `env(safe-area-inset-bottom)` (which needs
`viewport-fit=cover` on the viewport meta) so the bottom bar clears the iOS
home-indicator area.

**`BottomNav` is the one place for primary navigation — don't add nav links
to `AppNav`**, which is a per-route header (title/sub/back/avatar), not a
nav bar. Profile is reached by tapping an avatar, never a tab: `AppNav`'s
header avatar, `BottomNav`'s sidebar-foot avatar, or Home's own mobile-only
one (Home is the single route with no `AppNav` header).

## Design system (`src/vipsar-theme.css`)

One shared stylesheet, built against a Claude Design handoff. **All per-page
CSS files are deleted — don't recreate them.** Add a `vip-`-prefixed class to
`vipsar-theme.css` instead of writing per-component CSS. `src/index.css` is
kept as a deliberately empty seam, since `main.jsx` imports it first.

**📄 Read `UI-DESIGN.md` (repo root) before designing or redesigning any
screen.** This section describes what the components ARE; that file is how to
choose what to build and how to know it works. Each of its rules is paid for
by something that shipped wrong here. The two most reusable: **pull the real
numbers before choosing a chart form**, and **measuring and looking catch
different bugs, so do both**.

### Non-negotiable rendering standard

- **Pick the right width class on purpose.** `.vip-narrow` (700px) is for
  genuinely single-column content only (forms, one list/detail page).
  Anything with a multi-card grid, chart, table or rail needs `.vip-wide`
  (1180px) or `.vip-cols`/`.vip-cols-3`. Wrapping wide content in
  `.vip-narrow` produces the "huge empty gutters at desktop width" bug. If a
  screen looks narrower than its content warrants, that's a bug.
- **Always visually verify new/changed UI in the browser preview at desktop
  width before calling it done.** Take a screenshot and actually look for
  unexplained empty space, misaligned grids, overflow, or elements that
  don't reach the edges they should. Don't just trust the class names.

### Cascade traps

- **`.vip-only-mobile`/`.vip-only-desktop` vs a later `display`.** Both are
  single-class rules, so any *unguarded* `display` you declare on the same
  element in a later section wins at equal specificity and leaks the hidden
  half through. This has bitten three times. Fix: leave `display` out of the
  base rule, set it only inside the media query that should own it.
- **A class shared between a row and a column container must not carry a
  flex basis.** `flex: 1 1 150px` sets width in a row and *height* in a
  column — it made every filter facet 150px tall in the mobile panel.
- **A negative margin inside an `overflow-x: auto` container is a
  scrollbar.** A row hover tint inset with `margin: 0 -8px` produced a real
  8px horizontal scroll. Use padding on both the row and its header instead,
  so the grids stay column-aligned.
- **Section 22 is dark mode** and only redefines `:root` tokens and
  `.vip-chip-*`, never layout, so a later section can't beat it — **provided
  that section styles itself out of tokens rather than hardcoding a colour.**
  A literal hex declared after 22 is a colour dark mode cannot reach. The
  `--vip-shell-*` family is the deliberate exception in the other direction:
  22 leaves it alone, because header/bottom-nav/login are dark chrome in both
  themes, so a component built from those tokens needs no dark block. Add new
  sections at the end.

### Components and conventions

* **App column** — below 1024px `.vip-app` caps every screen at
  `--vip-app-max` (460px), centered on `--vip-canvas-2`. `.vip-header` and
  `.vip-bottom-nav` are `position: fixed` but width-capped the same way, so
  they track the app column, not the viewport. At ≥1024px the cap is
  deliberately dropped for the sidebar layout below.
* **Fonts** — Archivo (headings/numbers), IBM Plex Sans (body), IBM Plex Mono
  (ids/timestamps), self-hosted in `public/fonts/` rather than the Google
  Fonts CDN, so they're same-origin, covered by Vercel's `immutable` caching,
  and not a render-blocking third-party request.
* **Header** (`AppNav.jsx`) — per-route title + sub from a `ROUTE_HEADERS`
  lookup, a back button on every route except `tabRoutes.js`'s `TAB_ROUTES`
  (`/`, `/search`, `/dashboard` — the same set drives `ProtectedRoute`'s
  `.vip-drilled` class, which hides the mobile tab bar everywhere else;
  `/profile` is deliberately not one, so it keeps its back button), and an
  avatar `Link` to `/profile`. No Log out button — that lives at the bottom
  of Profile. **A sub describes the screen as it is now; re-check it when a
  screen's rules change.** Lead Detail and Dashboard need a sub `AppNav`
  can't compute, so they push it via `HeaderContext`'s `useHeaderOverride()`
  and clear it in their effect cleanup so it can't leak to the next route.
* **Stage colors** (`src/lib/statusColors.js`) — canonical stage → colour,
  keyed to `LEAD_STAGE_OPTIONS` so it can't drift. `stageChipClass` resolves
  to a `vip-chip-<stage>` pill, falling back to a dedicated neutral grey (not
  aliased to any real stage) for an unrecognised value. `stageFg` gives the
  raw foreground for places that only tint text/borders. **Display text never
  reads the raw stage value** — always `stageLabel()`, which falls back to
  the stored value unchanged.
* **Lists are rows, not tables.** Every list/breakdown renders
  `.vip-row`/`.vip-bar-row`/`.vip-matrix-row` stacks, not a `<table>`;
  segmented controls (`.vip-seg`) replace full-width button rows. Where a
  section below says "table", read it as that shape of data, not the markup.
* **Universal linking** — a person's name is always a link to
  `/employees/:id`; a lead or client's name always a link to `/leads/:id`.
  `EmployeeLink.jsx` exists for a name rendering *inside* a row that is
  already a `<Link>` (a nested anchor is invalid HTML and breaks the outer
  click target); it navigates via `useNavigate` + `stopPropagation`. Use a
  plain `<Link>` anywhere there's no outer link to nest inside.
* **KPI figures compute from data the page already fetched** — no new
  queries. Home's KPI grid and Dashboard's KPI band both reuse
  `computeOrderValueActuals` (exported from `TargetsVsActualsCard.jsx`) for
  "won", so that definition can't fork.
* **`?tab=leads` is the only way to reach All Leads.** Dashboard has no
  in-page tab buttons; a plain `/dashboard` always means Reports. Synced with
  a `useEffect` on `searchParams`, **not** a `useState` initializer —
  navigating between sidebar links while already on `/dashboard` changes the
  query string without remounting, and an initializer would only ever see the
  first value.

### Desktop layout (≥1024px)

Unaffected by anything in the Mobile redesign section, which only ever
touches `@media (max-width: 1023.98px)` or the `.vip-only-mobile` half of a
pair.

`BottomNav.jsx` becomes a persistent left sidebar: the Home/Search links plus
five `.vip-nav-extra` ones (New Lead, Activity Log, Dashboard, All Leads,
and — owner + sales_manager — My Team), a brand block, and the employee's
name/role pinned at the bottom as a `Link` to `/profile`. All hidden on
mobile via CSS, not conditional JSX. Because `.vip-sidebar-foot` is a `Link`
it also matches the plain `.vip-bottom-nav a` rule, so anything styling or
hiding it must use the `.vip-bottom-nav a.vip-sidebar-foot` form to win.

The sidebar rests as an icon-only rail (`--vip-sidebar-w-collapsed`, 68px —
this is what the content padding and header offset always reserve, so
hovering never reflows the page) and widens to `--vip-sidebar-w` (232px) on
`:hover`, floating over content as an overlay. Pure CSS, no React state:
labels sit at `max-width: 0; overflow: hidden` and transition open. Icons are
hand-authored inline SVG in `NavIcons.jsx` — no icon library.

Every page wraps its content in `.vip-narrow` (LeadDetail, LeadQuickCapture,
ActivityLog, Profile, Search) or `.vip-wide` (Home, both Dashboard tabs).
These are plain utility classes, not components.

Inside `.vip-wide`, Dashboard's cards sit in `.vip-report-grid` (2 columns);
`.vip-span-2` breaks a card out to the full row. **Get the pairing wrong (an
odd number of half-width cards) and CSS grid leaves a visible gap** — check
with computed `getBoundingClientRect()`, don't eyeball it.
`.vip-report-grid` is `align-items: stretch`, so a shorter paired card fills
its row and the slack sits inside the card rather than as a hole in the page;
`.vip-total` carries `margin-top: auto` so a stretched card's Total row
anchors to its base. **`.vip-featured-row` deliberately keeps
`align-items: start`** — its last child is `position: sticky`, which a
stretched full-height item defeats. Don't "consistency-fix" it. Stretch hides
a mismatch rather than fixing one: a wildly uneven pairing still wants its
*content* equalised.

`--vip-app-max` is redefined to 700px inside the ≥1024px block only so
`InstallPrompt`/`OfflineIndicator` (mounted outside `.vip-app`) keep a
sensible centered width.

### Drill-down plumbing (`vip-dd-*`)

`.vip-only-mobile`/`.vip-only-desktop` gate parallel views the same "one DOM,
switched by CSS" way as the sidebar: the KPI sparkline row, exec heatmap and
source donut exist only at ≥1024px. The one exception is `DrilldownPanel.jsx`
itself — a single element resized by media query (full-screen sheet below
1024px, fixed 600px right-hand panel above), since both show the same
content.

`src/lib/drilldownBuilders.js` holds one pure `build*Panel` per panel kind
(`log`/`ageing`/`attain`/`pipeline`/`winrate`/`forecast`/`mix`/`loss`/
`daySheet`/`followup`/`stageLeads`). Each shapes already-fetched state into
props and makes **no network calls**; none produces a verdict/narrative
field, and `DrilldownPanel` has no section that would render one.
`src/lib/attention.js` is the deliberate exception, owning both Needs
Attention's buckets and their drill-down, since the two are tightly coupled.
**Reuse an existing `build*Panel` before adding a new one** — the KPI row's
"Stale leads" tile and Needs Attention's matching row call the identical
`buildAgeingPanel(staleBucket)`.

Panels navigate as a **stack inside `DrilldownPanel`**, not a swapped prop: a
body pushes deeper via `onDrill(panel)`, "‹ Back" pops one level, ✕ closes
everything, and the stack resets when a different root panel opens.
Sub-panels are **prebuilt eagerly** by their parent builder rather than
constructed on click, which is what keeps `DrilldownPanel` presentational —
no builder imports, no data of its own.

### Colour tokens

**Never redeclare a hex constant locally.** Shared tone tokens
(`--vip-status-warn`/`-good-soft`/`-warn-soft`/`-bad-soft`/`-neutral`/
`-neutral-soft`/`-mid`, with `--vip-teal`/`--vip-lost` doubling as good/bad
foreground) live in `vipsar-theme.css` and are exported from
`statusColors.js` as `TONE_GOOD`/`TONE_WARN`/`TONE_BAD`/etc. That is the one
place a health/status pill or deal-stat colour comes from. `LeadDetail.jsx`
and `DrilldownPanel.jsx` were converted; **`EmployeeProfile.jsx` and
`MyTeam.jsx` still carry the old pattern** (locally redeclared, and formerly
mutually disagreeing, traffic-light constants) — a known follow-up.

### Dark mode (`src/lib/theme.js`, section 22)

A `@media (prefers-color-scheme: dark)` block plus a `:root[data-theme]`
override — possible only because the theme is fully tokenized, so nearly
everything repaints for free. Two ways in: system preference, and a
Light/Dark/System control in Profile's Appearance card (`system` removes the
attribute and falls back to the media query).

The dark block's selector is `:root:not([data-theme="light"])` *inside* the
media query. That guard is what lets one token list serve both "system dark,
no override" and "system dark, user picked dark" without a third block —
forcing light only needs to *suppress* the media query, not redeclare the
file's own light defaults.

`index.html` has a tiny inline script, before any CSS/JS, that reads the same
`vip-theme` localStorage key and sets the attribute pre-paint so a stored
choice never flashes. **Keep it in sync with `theme.js` if that key changes.**

The choice also follows the account, via the `employee_preferences` table —
deliberately a new table rather than a column on `employees`, whose UPDATE
policy is owner-only with no self-update exception, so a column there would
let only the owner save their own theme. `fetchAccountTheme`/
`saveAccountTheme` layer over the localStorage functions rather than
replacing them: `AuthContext` applies the account value best-effort after
login, and a failed save shows an inline warning while the local choice still
applies, so a network hiccup never blocks the control.

The 11 `.vip-chip-<stage>` pairs got hand-picked dark equivalents (they were
never tokens — nothing else reuses a single stage's colour).
`--vip-shell-*`/`--vip-on-shell-*`/`--vip-amber` are deliberately untouched.
**Known gap:** `DashboardHeatmap.jsx`'s attainment-tier colours and the
activity-mix sparkline/rhythm tints never went through a token and aren't
re-tuned for dark — legible, but not deliberate.

## Screens

### Today — `/` (`Today.jsx` → `Home` / `OwnerToday` / `CoordinatorToday` / `ManagerToday`)

The landing page after login, and the one route `AppNav` renders nothing for.
**Four separate screens, not one component branching on role.** `Today.jsx`
is a thin wrapper picking one. It's a wrapper *around* `Home`, not an early
return *inside* it — `Home` fires a dozen hooks and several fetches before it
renders, none of them scoped to data an owner or coordinator owns, so an
early return would still pay for all of them.

All four share `TodayGreetingHeader.jsx`: a time-of-day greeting
(`greetingForTime`, falling back to "Hello" late at night), a SYNCED/OFFLINE
`.vip-sync-pill` from `useOnlineStatus()`, an avatar `Link` to `/profile`,
and `AssignedLeadsCard` — mounted here, once, so every Today screen gets it
and a fifth would too (see Lead assignment notifications).

All four follow one **Hero → Act now → Recap/Overview → Outlook** grammar,
with team-shaped content standing in for personal content on the
supervising screens.

* **`Home.jsx` — `sales_executive` only.** Hero is the W/M/Q/Y "Order value
  vs target" bar plus 4 "Done today" tiles (Activities, Follow-ups
  done/pending, Leads touched, Quotes sent) off the same
  `fetchDayReview(todayISO())` → `buildDayRows` pipeline Dashboard's team
  table uses, for this employee alone. **Follow-ups render done/pending via
  `DayKpiStrip`** — a not-yet-due follow-up is amber-pending, never red.
  Act now is one "Needs your attention today" card: every open follow-up via
  `FollowUpList` (every row carries every action), then the 3 lead-ageing
  buckets under a "Stale leads" subhead, then a Tomorrow row. Recap is
  `buildSignificantEntries` ending in a link to the same `daySheet` panel the
  owner sees. Outlook is "Closing next".
* **`OwnerToday.jsx`** — Hero is "Your team today" (headcount + team-wide
  total). Overview is the literal `DayReviewCard` table over
  `fetchActiveSalesExecs()`. Act now is **2 of `computeAttentionBuckets`'s 5
  categories** (stale leads, overdue follow-ups), org-wide — confirmed with
  the owner rather than defaulting to all 5, to keep a screen billed as brief
  actually brief. A small secondary "Your reminders" card carries the owner's
  own occasional follow-ups. **No target bar** — an owner carries no quota.
* **`CoordinatorToday.jsx`** — a thin roster fetch
  (`fetchMyTeamExecs(employee.id)`) around `TeamTodayPanel`.
* **`ManagerToday.jsx`** — two tabs, **My day / My team**, defaulting to My
  day (personal work first; team review a deliberate tap). Deliberately
  **not persisted** — the answer was a fixed default, not "remember the last
  choice". "My day" renders the **real `Home`** embedded (via its `embedded`
  prop, which only skips the greeting bar and page wrapper), so a manager's
  personal day cannot drift from an exec's. "My team" is `TeamTodayPanel`.
* **`TeamTodayPanel.jsx` is the ONE implementation both supervising roles
  render.** Its defaults are the coordinator's behaviour; a manager passes
  all 5 attention buckets and `rowActions`. The coordinator's own added
  capability is **"+ Assign follow-up"** (pick a team exec, then the same
  `FollowUpForm` `EmployeeProfile` uses) — without it a coordinator has no
  "Set follow-up" action anywhere, since `LeadQuickActions` only mounts under
  `canEdit`.

Every screen shows only what RLS returns; the rosters come from
`fetchActiveSalesExecs()`/`fetchMyTeamExecs()`, not a client-side role check,
so nothing needs gating beyond which component renders.

**Fetch `fetchLeadsForBreakdown()` once.** This page used to call it from two
separate effects and again on every W/M/Q/Y toggle, even though neither
figure is period-scoped. It is fetched once into `breakdownLeads`/
`lastActivityByLead` state and `attentionBuckets` is a plain derived value.

**Deliberately not here on the coordinator screen** (matching Phase 4 scope):
a date picker (Dashboard already owns past-day review, already team-scoped)
and a team target/attainment card (a coordinator carries no personal quota).

### Search-before-create components

`PartySearchOrCreate` and `SiteSearchOrCreate` share one UX pattern and the
`sanitizeForIlike` helper (strips `%_,()` before building a PostgREST `.or()`
ILIKE filter — comma/parens are filter-syntax delimiters, `%`/`_` are
wildcards). **Neither uses an inner `<form>`** (Create is a button + onClick)
because the intake screen embeds both inside one larger form and nested forms
are invalid HTML.

**Reuse these for any future party/site picker — don't write another search
input.**

* **`PartySearchOrCreate`** — debounced ILIKE search on `parties`
  name/mobile, pick existing or create inline, `onSelect(party | null)`.
  - `typeOptions` narrows the create form's Type dropdown; a single-value
    list hides the Type field entirely and uses that value.
  - **It clamps the chosen type back into range whenever the offered list
    changes.** A `<select>` whose value has no matching `<option>` displays
    the *first* option while React state keeps the old one — so without this,
    picking a type and then changing the source shows one type on screen and
    inserts a different one.
  - `initialSelected` is a **seed, not a controlled value** — pass a `key`
    that changes when the source does, so it re-seeds.
  - `required` draws the ` *` marker. **Pass it rather than appending an
    asterisk to `label`**, because `label` is also spoken in the "New {label}"
    heading and the "+ Add new {label}…" button, where an asterisk reads as a
    typo. It is a marker only; the caller's Save gate does the enforcing.
  - `createdByEmployeeId` sets `parties.created_by`. **A coordinator acting
    for an exec must pass the exec's id** — `parties` UPDATE is
    "own data or owner role", so the coordinator's own id would leave the
    exec unable to edit their own client.
  - `deferCreate` holds the insert until save, so a name typed and abandoned
    never becomes a permanent `parties` row.
  - **Party-only, deliberately.** An employee is never a `parties` row and
    this component doesn't know employees exist. A field that can point at
    either renders its own type toggle and switches to `EmployeeSearchSelect`.
  - **Search returns parties of every type** regardless of `typeOptions`,
    which narrows the *create* form only.
* **`SiteSearchOrCreate`** — Area picked first (from `areas`), then debounced
  search on `sites.locality`/`house_no` scoped to that `area_id`.
  `onSelect(site | null)`. Optional `discoveredVia` passes `source_type`
  through without exposing it as a field.
* **`EmployeeSearchSelect`** — search-only, no create, over real `employees`
  rows (every active employee, any role, excluding the current user). No
  create escape hatch, so a rep typing a colleague's name can't spawn a
  duplicate `parties` row for someone who already exists as an employee.
* **`LeadSearchSelect`** — select-only, searches the database as you type
  (350ms debounce, 2-char minimum, both shared with `searchQueries.js` so
  every free-typed search feels the same). Two-step: resolve the term against
  `parties`/`sites`, then fetch leads pointing at the matched ids via `.in()`.
  It embeds `sites(id, nickname, locality, house_no, site_stage)` so a picked
  lead carries enough for Site Visit's stage field.
  - **Never fetch-then-filter-client-side here.** It once fetched
    `.limit(100)` and filtered in the browser, which made 28–55 leads per
    legacy-import rep unselectable at all. `LOOKUP_CAP` (150) on the
    party/site lookup is deliberately generous for the same reason: a
    company-wide lookup gets narrowed to one employee afterwards.
  - `hasAnyLeads` (a cheap `head: true` count on mount) keeps "you have no
    leads yet" distinguishable from "nothing matched".
  - A sequence counter discards stale responses so a slow reply for a short
    prefix can't overwrite a longer one's results.
  - `employeeId` scopes to one person's leads; `allLeads` drops that filter
    (needed when an **owner** picks a lead for their own reminder, since they
    personally carry few or none).

### Search (`src/pages/Search.jsx`)

Global search across parties, leads and sites, reachable from `BottomNav`'s
Search tab on every device. **The one place in the app to find or browse a
party** — the old `/dashboard?tab=parties` view and `PartiesCard.jsx` are
deleted, not merely hidden.

Deliberately **not** built on `PartySearchOrCreate`/`SiteSearchOrCreate`:
this searches three entities at once and creates nothing. It's a lookup
screen, not an intake screen.

Below 1024px a `.vip-seg` Parties/Leads/Sites switch shows one section at a
time (`.vip-search-hide-mobile`); desktop stacks all three.

* **Parties** — `fetchAllParties`/`fetchLeadsForPartyDirectory` load on
  mount, independent of the search box. The search box and Type filter (a
  Filters toggle revealing `vip-chip-select` pills discovered from the data,
  plus the `vip-filter-chip`/"Clear all" language) both apply **client-side
  and instantly** — no minimum length, no debounce, since it's an array
  filter over already-loaded data.
  - **`fetchLeadsForPartyDirectory` is one query replacing two** full `leads`
    scans that differed only in selected columns; both `employeeMap` and
    `partyLeadMap` derive from it.
  - A **"Worked with"** list per row shows which employees own a lead
    connected to that party (`party_id`, `other_party_id` or
    `referred_by_party_id`). **RLS caveat:** a sales exec's `leads` query
    returns only their own leads, so they only ever see themselves there.
    Full multi-employee associations are visible to the owner alone.
  - Each row links to that party's **most recent lead**
    (`mostRecentLeadByParty`, `party_id` only), else stays non-clickable.
* **Leads / Sites** — `searchQueries.js`'s `searchAll(term)` gates on
  `MIN_QUERY_LENGTH` (2) and a 350ms debounce, since these hit the DB. It is
  a **two-step query, not embedded-relation ILIKE filtering** (no precedent
  for that here, and it's fragile PostgREST syntax): resolve the term against
  `parties` and `sites` directly, then fetch leads via
  `.or('party_id.in.(...),site_id.in.(...)')`.
  - **Lead** results link to `/leads/:id`. **Site** results are read-only —
    **there is no `/sites/:id` page anywhere in this app.**

### LeadQuickCapture (`src/pages/LeadQuickCapture.jsx`)

`/leads/new` — deliberately not a structured form. Allowed to `owner` too,
deliberately: an owner can personally log leads.

**Validation is exactly `lead_needs_an_anchor`**: at least one of client /
site nickname / other party filled. Walk-in is the exception — see below.

**Field order:** Where from → (coordinator's "Who is this for?") → Client
name → Address → Site nickname → Site stage → Other's name. Source first,
because it decides what the rest of the form shows. A sticky Save footer at
mobile widths.

* **Where from** (required) — a 5-button tap-select over
  `sourceTypeOptions.js` filtered through `CAPTURE_SOURCES`: Scanning, Lixil,
  Referral, Architect referral, Walk-in. Renders via `.vip-choice-grid-5`.
* **Office territory** (required, every source, all roles) —
  `territoryOptions.js`: Ludhiana / Amritsar / Jalandhar / Patiala / Others.
  A lead has both a source and an office; they're independent facts.
  `.vip-choice-grid-5`. Nullable at the DB layer, required only in the UI:
  leads predating the column have no honest value, and a territory guessed
  from the owner's `office_location` would be a fabricated fact sitting in
  the same column as real ones.
* **Choice-grid classes — the option count picks which, and you apply
  exactly one.** `.vip-choice-row` (2 options, split evenly),
  `.vip-choice-grid` (4), `.vip-choice-grid-5` (5: 2 columns with the last
  spanning on a phone, 5 equal columns on desktop). Pairing two of them puts
  two `display` declarations on one element at equal specificity — the same
  cascade trap as `.vip-leads-layout`.
* **Address** (Scanning and Walk-in — the two sources that meet the site in
  person). **One `asksAddress` flag drives both the field and the write**, so
  the question asked and the value saved can't drift. It writes the **site's**
  `locality`, not `parties.address`: the address in scanning is the site's,
  and Lead Detail's Site details reads and writes that same column.
  `parties.address` is left in the schema, unused.
* **Site nickname** — Scanning only. A rep who walked past a site can
  describe it; a Lixil or referral lead is a phone call about a site nobody
  has seen. A direct insert, not `SiteSearchOrCreate` — nicknames are free
  text with nothing structured to search.
* **Site stage** (required, Scanning only) — a dropdown offering
  `SITE_STAGE_OPTIONS` and **nothing else**. The `Other…` escape hatch was
  removed at the owner's ruling; it "only brings ambiguity". **Don't restore
  it.** One free-typed stage re-fragments Dashboard's "Leads by site stage"
  and puts a value in the column All Leads' facet cannot offer.
  `resolvedSiteStage` is computed **once, next to `canSubmit`**, not again at
  submit time — a required field whose emptiness is decided twice eventually
  disagrees with its own button.
* **EVERY lead creates a `sites` row, unconditionally — this is
  load-bearing.** Nothing else in the app could create a site after capture
  until Lead Detail's "+ Add site details" existed, so a lead saved without
  one could never get a stage, locality, area or site contact for the rest of
  its life. Both columns are nullable, so the row is an honest empty record,
  not a stage guessed about a site nobody has seen. Consequence: those leads
  count under **"Not set"** on Leads by site stage, not "No site". **If a
  future change reintroduces a guard here, it must come with a way to create
  a site from Lead Detail.**
* **Referral is two sources**, and the split is the point: **Referral**
  (`referral_other` — a client sending a neighbour) and **Architect
  referral** (`referral_architect`). A referral lead created before the split
  is not evidence it came from an architect.
* **"Referral from"** (required on both referral sources) — writes
  `leads.referred_by_party_id`. On an architect referral it's locked to
  `typeOptions={['architect']}`. A general referral offers
  client/builder/pmc/other, **deliberately not `architect`** — that's what
  the other source is for.
  - **`key={sourceType}` on that picker is load-bearing.** Flipping between
    referral sources swaps `typeOptions` under an already-selected party, and
    unlike the create-form's own type, a *selected* party isn't re-validated.
    `selectSource()` clears the parent's copy for the same reason.
  - **It can also be an employee** (general referral only). A plain `<select>`
    above the field asks the TYPE first — client/builder/pmc/other plus
    **Employee** — and that decides what renders below, before any name is
    typed. Employee swaps in `EmployeeSearchSelect` and writes
    `leads.referred_by_employee_id` instead; the two columns are mutually
    exclusive, and an employee referrer is never treated as `party_id`.
    Architect referral doesn't get this dropdown at all — there's no real
    choice to make.
* **Firm** — its own `PartySearchOrCreate` (`typeOptions={['firm']}`),
  writing `parties.firm_party_id` on the **architect** via the shared
  `setPartyFirm`, not onto the lead. It renders under whichever field
  produced the architect. At most one can exist at a time, since the two
  fields never both offer that type, which is why one firm state serves both
  paths. Scanning and architect referral only — **don't widen it without
  asking.**
* **Walk-in** asks **Client name (required) and Address, and nothing else.**
  No site nickname, no site stage, no referrer, no firm, no other party.
  Client name is required *only here* because with nothing else offered it is
  the only thing that can satisfy `lead_needs_an_anchor` — better to grey Save
  out than surface a Postgres constraint error.
* **`selectSource()` clears `otherParty` too.** "Other's name" can unmount
  while its value is still held in the parent, and `PartySearchOrCreate` is
  uncontrolled, so on remount it would come back blank while state still
  carried the old party — writing an `other_party_id` the rep can't see. The
  accepted cost is re-asking when switching between two sources that both
  show the field. Note this is the opposite treatment from `siteStage`, which
  is safe to merely resolve away because its `<select>` is controlled.
* `party_id` = the client if given, else the referrer, else the other party.
  `other_party_id` is always set when an "other" party is resolved,
  regardless of source, purely so Lead Detail can later suggest linking that
  party as a site contact.
* **No DB transaction wraps the site + lead inserts.** If the site succeeds
  and the lead fails, the site row is orphaned; the error surfaces the site
  id but nothing auto-cleans up.

### LeadDetail (`src/pages/LeadDetail.jsx`) — the Lead Profile

`/leads/:id`, reachable from everywhere a lead or client appears. A client
and their lead are the same record in this app's UI (a confirmed decision,
not a schema merge — `parties`/`leads` are still separate tables).

Below 1024px the four edit sections collapse into tap-to-expand summary rows
that push the *same* section component into a full-screen `.vip-dd-panel`,
and the quick actions / Log activity / Call client controls move into a
sticky bottom bar. Desktop keeps them inline. See Mobile redesign.

**Permissions.** `canEdit` = owner, coordinator, or the lead's own exec. The
coordinator test is the bare role with no team check beside it, deliberately:
`leads` SELECT only reaches a coordinator through `coordinator_team_select`,
so a lead they can load is by definition their team's. A `sales_manager` on a
team lead gets `canQuickAct` but **not** `canEdit`, mirroring the database
lock. `canLogActivityHere` withholds "Log activity" from a manager on a team
lead — without it, `/activity?lead=<id>` preselects the lead and bypasses the
picker's own owner scoping, letting a manager credit themselves with a rep's
work.

**Both mounts of `LeadQuickActions` spread one `quickActionsProps` object.**
They used to build props separately — the same drift shape that cost a
coordinator the desktop nav. Don't re-split them.

**"Log activity" is a `<Link to="/activity?lead=<id>">`, not a bare `<a>`.**
A bare anchor forces a full document reload in an SPA (re-downloading the
shell on a poor field connection) and lands on an empty anchor picker.
"Call client" stays a real `tel:` link — not an in-app route.

**Identity band** — avatar, name (via `leadDisplayName`), a status pill
(`Customer` once won / `Lost` / `At risk` / `Open lead`, derived, not stored)
and a health pill from days-since-touch, using `attention.js`'s own
`STALE_DAYS`/`ATTENTION_DAYS` constants rather than repeating the numbers.
**`showTouchHealth = isOpen && !isOnHold`** — a won, lost or paused lead
shows no staleness colour or day count at all.

#### Quick actions (`LeadQuickActions.jsx`)

Each behind its own toggle, so at most one is open.

* **Change stage** — mounts the same `LeadStageSection` rather than
  reimplementing it. Open to all three editing roles, but **a sales executive
  may only move a lead forward.** `src/lib/stageProgress.js` holds the rule
  (`isBackwardStageMove`); the picker greys blocked chips out with a reason
  rather than hiding them. **That is a UI convenience, not the boundary** —
  `enforce_owner_only_stage_change()` enforces it server-side.
  **Ranking an on-hold lead at the stage it paused at is load-bearing in both
  copies**: `on_hold` has no rank of its own, so without it
  `negotiation → on_hold → calling` reads as two legal moves and launders a
  reversal.
* **Set follow-up** — mounts the **same `FollowUpForm`** Home uses, so a
  reminder set from a lead is a real `follow_ups` row with a real push. Two
  differences: `lead` is passed in so the picker isn't rendered, and
  `assignedTo` is the **lead's owner**, not whoever clicked — an owner
  setting a reminder on a rep's lead is reminding the rep, and it's the rep's
  device the push should reach.
* **Reassign owner** — owner + coordinator only (a sales exec who owns the
  lead gets the other two but not this; moving a lead between people is an
  oversight action). A coordinator's bounds come from the database:
  `coordinator_team_update`'s `WITH CHECK` keeps the new owner inside their
  team, and `is_my_team_member()` is false for their own id, so they can't
  assign to themselves. Writes `leads.owner_employee_id` and inserts into
  `lead_owner_history`; the two writes are independent, so a failed history
  insert still reassigns and surfaces an inline warning.
  **Known gap:** the dropdown lists every active rep. For a **coordinator**
  that's misleading, since the database refuses an out-of-team target. For a
  **manager** it is correct — they may hand a lead to any active exec.

#### Deal progress stepper

Built off `FUNNEL_STAGES` (`LEAD_STAGE_OPTIONS` minus `on_hold`/`won`/`lost`).

* Every reached segment is coloured by its own stage (`stageFg`); stages
  still to come stay neutral grey rather than previewing a hue they haven't
  earned.
* **Only the current stage's column widens and shows its label + date**;
  every other is a colour-only strip with a native `title` tooltip —
  otherwise 10-11 labels crowd into illegible truncated text.
* **`on_hold` is not a fixed column.** It's spliced in at whatever position
  the lead actually paused at (the most recent non-on-hold `stage_history`
  row, falling back to `calling`/`created_at`).
* **`won`/`lost` are never both shown.** A single trailing outcome column is
  appended only once a lead reaches one; an open lead shows none.
* Header note reads `stage X of Y` (Y varies with the above),
  `closed won · {date}`, or `on hold · resumes {date}`.

Beside it, 4 deal stats: Deal value (`max(order_value, quote_value)` — a
lifetime headline figure, deliberately a different formula from
`pipelineValue.js`'s aggregate rule), Probability, Expected close (rendering
`slipped` when past and open), Last touch.

**Probability is never inferred from stage** (the owner's ruling). A
`STAGE_PROBABILITY_DEFAULTS` map used to fill an unset value in, so a lead
nobody had assessed showed a confident "70%" for sitting at negotiation, with
no way to tell it from a typed one. An unset probability renders `—` in
`TONE_NEUTRAL` with the sub-line `not set` — **including on a won lead**.
Same "blank means blank" rule as `dealValueOrNull`.
**Deliberately NOT changed, flagged for the owner** (both move dashboard
figures): the weighted-forecast totals still treat a null probability as 0,
and `buildForecastPanel`'s "At risk" tile still counts `(prob ?? 0) < 40`, so
unassessed leads pool in with genuinely at-risk ones there.

#### Main column and rail

**Quotes & orders** — at most 2 real rows (one from `quote_value`/
`quote_sent_at` if `quote_sent`, one from `order_value` if set, dated via the
`stage_history` `'won'` row since `leads` has no order-date column). Not a
fabricated multi-document list. Its 5-column grid is `.vip-only-desktop`;
**mobile gets a separate two-line stacked row** (`.vip-linegrid-mrow`) with
no header, because 296px of fixed columns doesn't fit a phone track and the
Scope column computed to 0 width and printed on top of Value.

**Products in scope** — one real row from `product_id`, since this app tracks
one product per lead, not per-SKU line items.

Then `LeadActivityTimeline` (merges `stage_history` + `activities` +
`lead_owner_history`). Right rail: **Deal owner** (links to `/employees/:id`,
plus ownership history, plus "Added by sales coordinator {name}" when
`created_by_employee_id` differs from the owner) and **Contact**, then the
four edit sections.

**Known RLS asymmetry, not a bug:** `stage_history` SELECT is open to every
active employee while `activities` SELECT is own-data-or-owner, so a
non-owning exec sees stage history but an empty activity feed.

**Every section's save merges, never replaces** — the save queries have no
`employees` embed, so a wholesale replace would drop `lead.employees`.

#### The Client card (`ClientDetailsSection.jsx`)

Three states, **always rendered** (the old `party &&` gate hid the row on
exactly the leads that needed it):

* **a client on file** — Name / Mobile / City, plus **Change client**. A
  blank name is refused: the lead would have nothing to be called. Editing
  the name renames that party on every lead they appear on, which the card
  says.
* **a non-client party in the slot** — says so plainly.
  **`leads.party_id` is not "the client"** (capture resolves it to the
  client, ELSE the referrer, else the other party), so this card was
  routinely showing an architect under the heading "Client details".
* **no party at all** — the picker alone.

**`handleSetClient` promotes the client into `leads.party_id`** rather than
adding a `client_party_id` column: that column already means "the most
identifying person on this lead", so promoting makes `leadName.js`'s priority
resolve on every screen at once, with no migration and no display query
embedding a second party.

* **It is lossless.** Whatever `party_id` fell back to was also written to
  its own column at capture. A legacy-imported lead is the exception
  (`party_id` set directly, no `other_party_id`), so an outgoing party
  recorded nowhere else is parked in `other_party_id` — never over an
  occupied one.
* **A displaced CLIENT is deliberately NOT parked**, and that distinction is
  the whole of this control: promoting a client over an architect is a
  *promotion* and the architect is still attached; replacing one client with
  another is a *correction*, and filing the wrong name away as an "other
  party" would leave a permanent contact nobody meant to record.
* The party is created with `created_by` = **the lead's owner**, not whoever
  clicked (see `PartySearchOrCreate`'s `createdByEmployeeId`).
* Picking an architect shows an inline note that the save will name the lead
  but leave it with no client. **Warn and allow** — an architect really can
  be the buyer on their own house.
* **A `sales_manager` doesn't get this card on a team lead**, correctly:
  `enforce_manager_lock()` permits only stage / follow-up / order value /
  owner, so a promote would be refused by the database anyway.

#### "+ Add site details"

`siteDetailsEditor` is a ternary, not `site && …`: with no site linked it
renders a card whose button inserts a `sites` row and links it with no
reload. The mobile summary row lost its own gate for the same reason.
`discovered_by` is **the lead's owner, not whoever clicks** — it's their
site, and it's what keeps the write legal for all three editing roles, since
Postgres applies the SELECT policy to `INSERT … RETURNING` and `sites`'
policy falls back to `discovered_by = current_employee_id()` for an exec. The
row is created deliberately empty. **Expect this card to be unreachable** —
every lead has created a `sites` row since 2026-08-17 and the legacy stranded
leads were backfilled. It is a safety net for a state that can no longer
arise.

#### SalesProgressSection

Reads in four groups, in the order a deal moves: **Product → RFQ → Quote →
Closing** (Probability, Estimated close), separated by `.vip-section-split`
hairlines and deliberately **without** group headings — four labels cost more
height than they buy on a phone, where this opens as a full-screen panel.

* **Save `quote_value` whenever it's non-empty, independent of the "Quote
  sent" checkbox.** It used to be nulled on every save where the box wasn't
  ticked, even though the field sits above the box and is always editable, so
  a typed value was silently lost. `rfq_raised_at`/`quote_sent_at` don't have
  this problem — those inputs only render once their own box is ticked, so
  visibility already matches the save condition.
* **There is no Order value field here, and don't re-add one.** It existed
  briefly and was removed at the owner's ruling: the `won`-stage prompt
  demands the figure at the one moment it becomes a fact, and keeping the
  field as well meant asking for a booked value on every still-open lead —
  exactly how leads end up with `order_value` set while not won. It is absent
  from `handleSave`'s payload too, not just the form, so saving this card
  leaves a booked lead's real figure untouched.
* **The RFQ block is read-only**, two derived rows from
  `summariseRfqHistory(activities, lead)` (`src/lib/rfqKind.js`). Logging an
  RFQ Raised activity already stamps the date and advances the stage, so a
  checkbox was a second place to record one fact — and they disagreed, since
  `ActivityLog` rewrites `rfq_raised_at` on *every* RFQ while the card is
  meant to lead with the first.
  - **Fresh RFQ · {date}** — the earliest RFQ Raised activity **not tagged
    `revised`**. **This date never moves**, however many revisions follow —
    the owner's stated invariant, and why revisions are excluded from the
    calculation rather than it just taking the first row of any kind. A lead
    whose first *logged* RFQ is a revision shows no fresh row at all rather
    than relabelling it.
  - **Revised RFQ · {date}** — only when revisions exist, showing the latest
    plus `(N revisions)` from 2 up.
  - **A revised row needs an explicit `rfq_kind = 'revised'` tag.** Untagged
    legacy activities never produce one; nothing is inferred from ordering.
  - **With no RFQ activity at all it falls back to the lead's own
    `rfq_raised_at`/`rfq_raised`** — the legacy imports wrote those columns
    directly on hundreds of leads whose RFQ was never logged. `rfq_raised`
    true with no date renders "date not recorded" rather than inventing a day.
  - **It never trusts the caller's order** — `LeadDetail` fetches activities
    newest-first, so trusting it would report the newest RFQ as the fresh one.
  - The columns are still maintained by `ActivityLog` and still read by Needs
    Attention's `pending_rfq` bucket. This form simply stopped writing them,
    which is why they're absent from `handleSave` — leaving them in would
    null a real `rfq_raised` on every save.

#### AdditionalContactsSection

Both firm inputs are `PartySearchOrCreate` firm pickers writing
`firm_party_id` via the shared `setPartyFirm`, shown **only when the contact
is an individual `architect`** (a client or builder has no practice behind
them). **`addSiteContact` must keep its `.select()`** — an unchecked
`.update()` can no-op silently under `parties`' own-data-or-owner RLS on a
party another rep added, and nobody would ever know; it returns a warning now
and the contact saves either way.

### Lead stage taxonomy (`leadStageOptions.js`, `statusColors.js`)

`current_stage` is free text at the DB layer (locked in, see DECISIONS.md).
The app-layer list, grouped in sales-team language:

* **New** (blue, light→dark): `calling` → `presentation` →
  `joinery_follow_up`
* **Warm** (amber): `rfq` ("RFQ Raised") → `quote_submission`
* **Hot** (green): `negotiation`
* **Won** (deeper green) / **Lost** (red — reserved for a genuinely lost deal)
* **On hold** (grey) — independent of the funnel, reachable from any stage

`LEAD_STAGE_OPTIONS` values are the literal `current_stage` strings and
double as CSS chip-class suffixes, so they stay single-token slugs.
`LEAD_STAGE_LABELS`/`stageLabel()` are what's shown. `FUNNEL_SEQUENCE` is 6
stages. Every `?? 'calling'` fallback across the codebase matches — including
`pipelineValue.js`'s `isOpenLead`, the most load-bearing instance.

`measurements` and `design_discussion` are **retired** (folded into
`joinery_follow_up` and `rfq`). The picker has **no free-text "Other…"
option** — every stage a rep can pick is a real chip. The app-wide fallback
rendering for an unrecognised stage stays, for values predating that.

**On Hold's write flow** is gated like `lost`, per DECISIONS.md's "no
skip-for-now escape hatch" rule, but demands a reason **and** a compulsory
follow-up date. The panel has exactly two inputs — a reason textarea and a
plain `<input type="date">`, deliberately **no** preset quick-pick chips,
since a hold can resume in days, months or years. On confirm, in order:
(1) `createFollowUp` inserts a real `follow_ups` row (reusing the Follow-ups
feature rather than inventing a second reminder mechanism), then (2) only
once that succeeds, `applyStage('on_hold', { next_followup_date })` writes
the stage and date together. A lead can therefore never be `on_hold` with no
reason or reminder on file. `LeadDetail` also shows the reason inline as soon
as a lead is on hold, so opening it doesn't require waiting for the push.

`on_hold` is excluded from `buildPipelinePanel`'s stage-to-stage
`progression` chain (like `lost`) — a parallel pause isn't "the next step
after" anything, and including it produces a nonsensical conversion rate.
Neither is excluded from breakdowns that just count leads per bucket: an
on-hold lead is still open pipeline, just paused.

#### LeadStageSection — the three gated stages

`current_stage` is a row of tappable `vip-chip-select` pills tinted via
`stageFg`. Tapping one applies it immediately **except `lost`, `on_hold` and
`won`**, which all withhold the write until their own prompt is confirmed.

**Nothing is written until confirm, and that ordering is the fix for a real
bug**: `applyStage` used to commit `current_stage`/`stage_history` for `lost`
*before* the reason prompt opened, so closing the sheet left a lost lead with
no reason on file. Every prompt has a Cancel that writes nothing at all.

* **`lost`** requires a loss reason from `LOSS_REASON_OPTIONS`.
  **Its `loss_reasons` insert deliberately has no `.select()`** — that
  table's SELECT is owner-only while its INSERT is open to any active
  employee, and Postgres applies the SELECT policy to `INSERT … RETURNING`,
  so adding one would break marking a lead lost for every non-owner.
* **`on_hold`** — see the On Hold write flow above.
* **`won`** requires an order value, pre-filled from the lead's existing
  `order_value`/`quote_value` so re-confirming an already-quoted deal is a
  one-click accept rather than a re-type. This exists because `order_value`
  used to be writable from exactly one place (the exec-only Booking Update
  activity), so an owner could work a lead to won and contribute ₹0 to every
  booked-value metric.

**Re-tapping Won on an already-won lead opens the same prompt as a
correction** ("Save order value" instead of "Save & mark won"), and
**must not route through `applyStage`.** That is the whole point: `applyStage`
writes a `stage_history` row, and booked value is attributed to the date of a
lead's most recent `'won'` row — so logging one today would silently move an
old deal's value into this month's booked figure. It UPDATEs `order_value`
and nothing else, calling `onStageChanged(data, null)`.
**The same-stage no-op guard is therefore `won`-only**; every other stage
still no-ops on a re-tap. Moving the stage off `won` and back is the wrong
workaround for the same reason, and shouldn't be suggested to anyone.

### Lead naming (`src/lib/leadName.js`)

**How a lead is referenced, everywhere. One definition — do not hand-roll
another.** There were fourteen copies before, which had drifted into three
different answers for the same lead.

**The rule:** a lead is referenced by the most identifying thing known about
it, and that answer **moves as the record fills in**, with nothing stored and
no per-lead setting:

1. the lead's party — `leads.party_id` → `parties.name`
2. the site's address — `sites.locality`, plus `house_no` when set
3. the site's nickname — `sites.nickname`
4. `Lead #<id>`

* **Tier 1 is ONE tier, not three, deliberately.** The owner's priority names
  client, then other party, then referrer — but **`leads.party_id` already
  resolves exactly that order** at capture. So the person half costs one
  column and **no display query has to embed three parties**. The price is
  that promoting a later-added client is a **write**, not a change of read
  order.
* **Address beats nickname.** This reversed every previous call site. A
  scanned lead's nickname is often the address typed again with extra on the
  end, so the old order showed the worse copy of the same fact.
* **`leadSiteLabel` returns ONE descriptor, the best one the NAME didn't
  take** — never both joined, never the nickname by default. Joining them is
  the obvious version and it is wrong on real data (one cell read
  `DUGRI, 450-D · 450-D, DUGRI, LUDHIANA · plot upto 200 sq yds`). Caught by
  looking at the rendered list; the unit tests were green.
  `LeadDetail`'s rail facts row is the deliberate exception — it answers
  "what is this lead's site", so it prints both, **deduped**.
* **A query missing its `sites` embed silently loses tiers 2 and 3** and
  falls to `Lead #id`. Every lead-naming query must select
  `sites(nickname, locality, house_no)`.
* `leadNameTier()` says which tier answered, so a surface can tell "named
  after a person" from "named after a place" without re-deriving the chain.
* `dayReview.js`'s `leadName` and `FollowUpList`'s `followUpLinkLabel` keep
  one extra step: an activity or reminder can be anchored on a **party with
  no lead at all**, which `leadDisplayName` knows nothing about.

### Meeting buckets (`src/lib/meetingBucket.js`)

Every Client Meeting belongs to one of two umbrellas, decided by the CRM when
it is logged:

* **Old Meeting** (`client_meeting_old`) — the lead was at **RFQ or later**:
  `rfq`, `quote_submission`, `negotiation`, and also `on_hold`, `won`, `lost`.
  Those last three have no funnel rank (`stageRank` returns null), so they're
  listed explicitly rather than given one — ranking them would misrepresent
  the funnel everywhere else that helper is used.
* **New Meeting** (`client_meeting_new`) — anything earlier. **An unset or
  unrecognised legacy stage falls back to New**, not Old.

`meetingTypeForStage(stage)` derives from `FUNNEL_SEQUENCE`'s own order so it
can't drift from the taxonomy.

**The bucket is FROZEN at logging time, not derived live — this is the whole
point.** An activity records what a rep did on a day. Computing it from the
lead's *current* stage would let a stage move next week silently rewrite last
month's report. So the bucket **is** the stored `activity_type`, which also
means every meeting-showing surface splits in two for free, with no
per-site special-casing. **Expect Old meetings sitting on below-RFQ leads and
vice versa: that is correct, not drift — don't "fix" it.**

**Two targetable metrics, not one** (the owner's ruling over a combined
quota — a single meeting target would hide the very split the buckets exist
to show).

**The rep still taps ONE "Client Meeting" button.** Log Activity renders
`LOGGABLE_ACTIVITY_TYPES` (8 entries, one Client Meeting) while every
*display* surface renders `ACTIVITY_TYPES` (9, the two buckets). **Don't
collapse those two lists back together** — the split exists so the CRM
classifies the day rather than asking a rep on a phone to do it.
`client_meeting` survives only as `PICKABLE_MEETING` (the button value, never
stored on an activity, still legal on `follow_ups`) and as an
`ACTIVITY_LABELS` key so a stray legacy row renders a label, not a slug.

### EmployeeProfile (`/employees/:id`) — the Sales Exec Profile

**Who can open it** (enforced inside the component, not by `ProtectedRoute`):
`owner` → anyone; a `sales_manager` → their own reports; anyone else → **their
own page only**, redirected to `/dashboard` otherwise. A sales exec viewing
their own page never sees the rank pill or any peer-relative element.

**Gate the fetches on the same flag as the redirect.** They used to fire
before it, because the guard was its own `useEffect` and React runs every
initial-mount effect in one pass, so `navigate()` doesn't preempt them.

A Week/Month/Quarter filter (default Month, reflected as `?period=`) drives
every figure. Identity band: avatar, name, a **rank pill** (position by
blended attainment among active sales execs, tinted by tertile), and a
sub-line using `office_location` for "territory" and `created_at` for "with
VIPSAR since" — **both flagged in the UI copy as approximations**, since this
app tracks neither a real territory nor a hire date.

Then 5 head stats (Attainment / Booked / Open pipeline / Win rate / Stale
leads) and 6 metric tiles (Order value / Site visits / Calls made / RFQs
raised / Offers sent / Bookings). **That 6 is a separate list from
`METRIC_OPTIONS`** — don't merge them; only the attainment cap constant is
kept in step. "Offers sent" and "Bookings" compute from
`computeQuoteSentActuals`/`computeWonCountActuals`, exported from
`TargetsVsActualsCard.jsx` so this page and `SetTargetForm` read one
definition.

**Stale leads uses `computeStale7Bucket`** (STALE_DAYS/7), matching its own
copy — it used to read the 14-day queue bucket while labelled "7+ days".

#### The Activity card (theme section 27, `vip-actx-*`)

Three parts, one card: a **hero total** in display type (keyed on
`${preset}-${selectedType}` so it re-animates when the question changes), a
**rhythm strip** of one bar per bucket (working day / ISO week / calendar
month, per the period filter) with **no y-axis, no gridlines, no legend**,
and **chips** for all 9 `ACTIVITY_TYPES` sorted high to low, tinted by share,
with a never-logged type shown as a dashed ghost rather than hidden.

**The chips ARE the filter** — clicking one re-scopes the strip and hero to
that type. That reuse is what earns them their space; a legend that only
labelled would not have.

Strip and chips read the same `myActivities` array partitioned two ways, so
their totals structurally cannot disagree — the class of bug that started the
rebuild.

**Three things here are load-bearing and easy to undo by accident:**

1. **The bar height is a PERCENTAGE of a flexed track, never a pixel
   figure.** JS owning pixels while CSS owned the container silently clipped
   the tallest bar's value label at both widths. Measuring said "76px,
   correct"; only looking showed the missing number.
2. **Magnitude is a tint, not a length.** Two length encodings were built and
   both lied. Don't reintroduce one without equal-width columns behind it.
3. **Entry animations use `backwards`, never `both`, and never animate a
   dimension that carries data.** A backgrounded tab freezes animations at
   frame 0; with `both` the whole strip measures 0px tall.

**"Offers sent" and "Bookings" are deliberately absent here** — they were
never `activity_type` values, just `quote_sent_at` and a won transition, and
the tiles above already show them. Mixing them into "activity mix" is a
category error.

**`fetchActivityCounts()` must select `created_at`.** Omitting it made every
`inBucket(a.created_at, …)` compare `undefined`, so two series rendered zero
for every exec at every period — caught only because the tiles directly above
showed the right numbers.

Below: a **Leads assigned** table (open leads, worst-touch-first), and a rail
of **Conversion funnel** (computed bottom-up so it can't contradict the
Bookings tile — both read the same won-count query), **Pipeline owned**,
**Activity log** and **Follow-ups**.

### My Team (`/team`)

**owner + sales_manager.** A card-grid directory, reached from the desktop
sidebar and, on mobile, from an owner-only `.vip-tile` row at the top of
Dashboard (its only mobile path since Home's tile grid was removed).

* **`fetchTeamMembers()` returns every employee including other owners.** It
  used to `.neq('role', 'owner')`, so a co-owner never appeared. The only row
  that must never appear is the **viewer's own**, excluded client-side by id,
  not by role. A `sales_manager` viewer is further filtered to
  `manager_id === employee.id`; an owner row has no `manager_id`, so a
  co-owner never surfaces for a manager.
* **Inactive employees still show**, with a muted "Inactive" pill — deactivate,
  never hide, same as everywhere else in this app.
* Name search and a role filter built from `[...new Set(employees.map(role))]`
  rather than a hardcoded list, so a new role appears as its own chip
  automatically. Labels come from `roles.js`'s `roleLabel()`, never a local map.
* Per-card stats (Open leads, Open pipeline, **Needs attn.** — the sum of all
  5 `computeAttentionBuckets` counts, red at 5+) computed client-side from
  the same shared `fetchLeadsForBreakdown()`. No dedicated per-employee query.
* **`.vip-team-grid` uses `auto-fit`, not a fixed column count** — headcount
  is open-ended, unlike Needs Attention's always-5 buckets. `auto-fit`
  collapses unused tracks so filtering down to one result still fills the row.
* Each card is a `<Link>` to that employee's profile — no `EmployeeLink`
  needed, the whole card is the one click target.

### Follow-ups (personal + owner-assigned reminders, with push)

> ⚠️ **SUPERSEDED by `FOLLOWUPS.md` (repo root).** Read that file before
> touching anything that creates, shows, completes or counts a reminder. Three
> audits found the feature materially different from the intent below: six
> create-flows exist and three create no reminder at all, 78% of leads
> carrying a `next_followup_date` have no `follow_ups` row, and rescheduling a
> notified reminder permanently kills its push. The text here records what was
> *intended*, not what is.

`follow_ups` (self-service reminders, not tied to logging an activity) plus
`push_subscriptions` (one row per browser/device). Required: due date and a
short title. Optional: time, a linked lead, an activity-type tag, notes.

* **`FollowUpForm`/`FollowUpList`** are the shared create form and row list,
  reused by all four surfaces. Date presets come from
  `followupDates.js`'s `FOLLOWUP_OPTIONS`/`followupDateFor`.
  - **Linking is by lead, picked explicitly.** It used to be a party picker
    whose most recent lead was silently resolved behind the scenes, so a
    party with no lead linked nothing and a party with several linked
    whichever was newest. `party_id` is still written, derived from the
    chosen lead. The lead stays optional.
  - If a lead is linked, saving **also** sets that lead's
    `next_followup_date`, so this doesn't create a second out-of-sync
    "when's the next touch" field.
  - `FollowUpList` names the linked lead through the same `leadName.js` chain
    as everywhere else; `FOLLOW_UP_SELECT` embeds `leads(...)` for that.
  - Activity type reuses `ACTIVITY_TYPES` plus `other`, not a parallel
    taxonomy.
* **Four mounts:** Home ("Your reminders", locked to yourself),
  EmployeeProfile ("+ Assign follow-up", locked to that exec — the real
  owner-to-exec entry point, showing "Assigned by {name}" when `created_by`
  differs from `assigned_to`), `LeadQuickActions` (lead preset, assigned to
  the lead's owner), and `TeamTodayPanel` (coordinator to team exec).
* **Profile** shows this device's `Notification.permission` state and a
  checkbox toggling its push subscription.
* **`NotificationPrompt.jsx`** — a one-time dismissible banner, necessary for
  discoverability: without it push never fires for anyone who doesn't
  independently find the toggle buried in Profile.

**`todayISO()`/`toISODate()` in `followupDates.js` are the one place this app
computes "today" as a date string.** Import them; never write
`new Date().toISOString().slice(0,10)` again — `toISOString()` converts to
UTC first, so between midnight and 05:30 IST it returns *yesterday*. Three
files had each hand-rolled their own identically-broken copy.

**Push delivery:**

* `pushSubscription.js` wraps the browser's `Notification`/`PushManager` APIs
  and upserts/deletes the matching `push_subscriptions` row keyed on
  `endpoint`, so a device re-subscribing updates rather than duplicates.
* **`vite.config.js` uses `injectManifest`, not `generateSW`**, specifically
  because `generateSW` can't add custom event listeners. `src/sw.js` is a
  real checked-in worker carrying the `push`/`notificationclick` handlers.
  Since the precache was removed, **push is the only reason it exists**.
* The Edge Function uses the `service_role` key — the one legitimate place in
  this app that reads across every employee's rows, since a cron job has no
  `auth.uid()`. It stamps `notified_at` only once a send was actually
  attempted (an employee with no subscribed device is retried next run, never
  silently marked notified), and prunes any subscription a send 404/410s
  against. `due_date`/`due_time` have no timezone, so it treats them as IST
  explicitly, defaulting to 09:00.
* VAPID public half lives in `.env` as `VITE_VAPID_PUBLIC_KEY` (safe
  client-side, that's the point of VAPID); the private half is a Supabase
  Edge Function secret, never committed.
* **Test via `npm run build && npm run preview`, never `npm run dev`** — no
  service worker registers under `dev` at all, so everything SW-dependent is
  inert there.

**Not verified against a real device:** the full "grant permission → receive a
push on a locked phone" path.

### Lead assignment notifications (`notifications` table)

When a lead changes hands the person **receiving** it is told, on their phone
and in the app. **Only the new owner** (the owner's choice over also telling
the previous one), and **reassignment only** — creating a lead for somebody,
which a coordinator does routinely, deliberately does not fire this.

* **The row is written by a Postgres trigger, never by app code.**
  `owner_employee_id` is written from `LeadQuickActions`, from hand-written
  SQL, and from the Supabase table editor; the first call site anyone forgets
  is a rep who is never told they own a lead.
* **Bulk reassignments must opt out**, or one UPDATE touching 200 leads sends
  200 pushes: wrap them in
  `SET LOCAL app.skip_assignment_notifications = 'on'` (`SET LOCAL`, so it
  expires with the transaction). The Edge Function also caps itself at 50 per
  run, so a forgotten opt-out is a trickle someone can stop rather than a
  phone that won't stop buzzing.
* **`notified_at` and `seen_at` are independent.** The first means a push
  went out; the second that the recipient acknowledged it in-app. A rep who
  denied permission never gets a `notified_at` and must still be able to
  clear the card.
* **`notifications` has no INSERT policy for anyone**, and `REVOKE ALL` runs
  before its grants — a client that could insert here could fabricate a "you
  have been assigned a lead" alert for a colleague. SELECT/UPDATE/DELETE are
  own-row with **no owner-role exception even on read**. `service_role` is
  granted explicitly, without which the Edge Function fails with a plain
  "permission denied".
* **Delivery is instant AND scheduled, deliberately both.** The existing
  reminder Edge Function gained a second drain, so this needed no new cron.
  `LeadQuickActions` also calls it with `{ only: 'assignments' }` the moment a
  reassignment succeeds. **That call is never awaited and its result never
  read** — the lead has already changed hands, the cron is the guarantee, and
  a slow function must not hold up the UI. The two racing is harmless: the
  drain is idempotent.
* **⚠️ A browser-invoked Edge Function needs CORS headers; a cron-invoked one
  does not, and the two look identical in the source.** supabase-js sends an
  `Authorization` header, which makes the call cross-origin and therefore
  **preflighted with OPTIONS**. The first deploy had neither
  `Access-Control-Allow-Origin` nor an OPTIONS branch, so the instant call
  never happened at all. **The OPTIONS branch must return before any work is
  done**, or every browser call runs the drain twice. Origin `*` is
  deliberate: the function verifies a JWT, and even a caller holding one can
  only ask it to flush notifications a trigger already decided to create.
  It failed safe — the scheduled run still delivered everything minutes later
  — which is the design working rather than luck.
* **`AssignedLeadsCard` is not a nicety.** Push is the only signal that
  reaches a pocketed phone and the easiest to never receive: a rep who
  declined the permission gets nothing, and **on iPhone web push does not
  work at all unless the CRM is installed to the home screen**, which is most
  of this team. It is mounted **inside `TodayGreetingHeader`**, not by each
  Today screen — four call sites is exactly the drift this codebase keeps
  paying for, and a fifth Today screen would ship without it with nothing
  failing to say so. It returns null when empty, so no screen pays for it
  otherwise. Teal, not amber or red: being handed a lead is work arriving,
  not an alert.
* `src/sw.js`'s push handler passes `tag` (repeats about one lead collapse
  into a single banner) and `requireInteraction` through. Both are undefined
  for a reminder, so reminders behave exactly as before. iOS ignores
  `requireInteraction`, which is the other half of why the in-app card exists.
* **`src/lib/selfAssignTest.js` is OFF and should stay off.** "Reassign
  owner" offers `fetchActiveSalesExecs()`, which is `CARRIES_OWN_LEADS` only,
  so an owner is correctly absent — which also leaves them no way to test a
  push on their own phone. `withSelfAssignTestOption` appends the logged-in
  owner to that one dropdown; `SELF_ASSIGN_TEST_ENABLED` is the whole switch.
  **It is kept rather than deleted**: re-deriving *why* an owner is excluded
  is the expensive part, not the six lines. Its test reads the flag rather
  than assuming a value, so the suite is green in both states.
  Turning it on does not make the owner a rep — they still don't appear in
  the heatmap, Day Review, targets, ranking or All Leads' owner filter, so a
  lead parked there is invisible to every per-rep report until handed back.
* **Unexercised:** the `app.skip_assignment_notifications` suppression, and
  the whole feature for any role other than `owner`.

### ActivityLog (`src/pages/ActivityLog.jsx`)

`/activity` — **not the owner** (exec, coordinator and manager). Owners don't
do field work; they see every rep's activity through Dashboard and a lead's
timeline. `LeadDetail` hides "Log activity" from a `canEdit` owner for the
same reason. A sticky "Log it" footer at mobile widths.

Tap one of 8 `LOGGABLE_ACTIVITY_TYPES` — Site Visit, Call, Client Meeting,
Architect Meeting, RFQ Raised, Design Sheet, Office Day, Booking Update. That
list's declaration order **is** the on-screen order, grouped so field and
meeting work sit together and paperwork sits together.

#### One grammar for every type: what happened, then what's next

Every branch reads **type → anchor → type-specific facts → Notes → [hairline
rule] → Next follow-up → "What's the follow-up for?"**. Office Day is the one
exception and needs none of it.

Reps were mixing up the two free-text boxes. **Three things caused it, and
fixing only the order would not have worked:**

- **The future question used to be asked first**, so the first box a rep hit
  collected the story of the call regardless of its label.
- **The follow-up note was the better-explained field.** It carried a
  concrete placeholder while Notes had `"Short note"`. **Whichever field is
  explained best is the one that gets filled in** — keep the two placeholders
  equally specific.
- **That placeholder taught the confusion**, reading as a next action
  followed by something that had already happened. `NOTES_PLACEHOLDER` and
  `FOLLOWUP_NOTE_PLACEHOLDER` are now one teaching device: the same subject
  written once in past tense and once in future. **Don't reword one without
  the other.**

**`FOLLOWUP_NOTE_PLACEHOLDER` must stay short, and that's a measurement, not
taste.** It renders in a single-line `<input>`: the fuller sentence this
started as measured 575px against 316px of available width at 375px, so more
than half was invisible on exactly the phone this form is built for. A
placeholder cannot wrap. Re-measure if it grows.

The follow-up pair sits in one `nextStepBlock` **defined once** near the top
of the render and spread into all three branches — it used to be copy-pasted
three times. A "Next step" heading and an explainer line were built above the
rule and **removed the same day at the owner's direction**; the rule alone
marks the seam. Don't re-add them without asking.

**`.vip-next-step` draws that rule with `--vip-line`, deliberately NOT
`.vip-section-split`'s `--vip-line-soft`** — that token is lighter than this
form's own background, so the hairline rendered invisible here while reading
correctly inside a white card elsewhere. Both values are tokens, so dark mode
repaints it with no override.

#### Anchoring

Every type except Office Day and Architect Meeting shows `LeadSearchSelect`,
scoped to the acting employee's own leads. Office Day skips the anchor step
entirely (matching the loosened `activity_needs_an_anchor` CHECK); Architect
Meeting anchors on a party instead.

**`?lead=<id>` preselects a lead on load**, collapsing the anchor step to a
confirmation row with a "Change" link rather than showing the picker. "Log
another activity" restores that preselection rather than clearing it, since a
rep logging a Site Visit then a Call against one lead is the common case.

**Party is not a fallback anchor.** Site Visit and Booking Update used to
accept "lead, party, or both", which silently hid Next follow-up / Order
value / Site stage — all of which write onto a lead — with no way to fill
them in. `activities.party_id` is now only ever set for Architect Meeting.

#### Per-type fields

* **Site Visit** — lead → **Site stage** (preset + "Other…", shown only once
  the lead has a linked site, so a lead with no site shows nothing rather
  than a meaningless control) → **Accompanied by** (optional, `employees`
  minus yourself — the one activity where bringing a colleague is a normal,
  trackable thing) → Notes → Next follow-up. Site stage is synced to the
  lead's current stage by its own effect and, on submit, writes
  `sites.site_stage` in a separate UPDATE — **skipped entirely if the value
  didn't change**, so picking a lead and submitting never fires a no-op write.
* **Client Meeting** — a **required** Site/Office tap-select
  (`meetingLocationOptions.js` → `activities.meeting_location`), directly
  under the lead picker and ahead of the follow-up/order-value fields, which
  are about the deal rather than the meeting. It renders via
  **`.vip-choice-row`, not `.vip-choice-grid`** — two options split evenly,
  where the grid's `repeat(4, 1fr)` would leave two quarter-width buttons.
  `resolvedMeetingType` (see Meeting buckets) is computed **once beside
  `canSubmit`**, not again inside `handleSubmit` — the bucket the form
  PROMISES in its hint and the one it WRITES have to be the same, or the
  confirmation lies.
* **Architect Meeting** — its own `PartySearchOrCreate`
  (`typeOptions={['architect', 'firm']}`, so the Type dropdown does show
  here) labelled "Architect name", then **Firm** (optional, shown **only when
  the picked party is an individual `architect`** — a `firm` party already
  *is* the firm), Notes, Next follow-up. Firm is gated on the selected
  party's own `party_type`, not the picker's dropdown, so it's correct for an
  existing party too. It's `key`'d on the architect's id with
  `initialSelected={architect.firm}`, so **picking a known architect brings
  up their firm on its own** — the behaviour the feature exists for.
  There's no lead, so "Next follow-up" creates a real `follow_ups` row via
  `createFollowUp` (`activityType: 'other'`, since the literal
  `'architect_meeting'` isn't in that table's CHECK) rather than a second
  reminder mechanism.
  **Its `notes` deliberately does NOT fall back to the activity's own
  notes.** It used to, so a rep who left the follow-up note blank got the
  story of the meeting they had just had copied into the reminder for the
  next one — the app performing, at the data layer, exactly the mix-up the
  form's ordering was reshaped to prevent. Blank stays blank.
* **RFQ Raised** — sets the lead's `rfq_raised`/`rfq_raised_at`, and is
  classified **Fresh or Revised at the moment it's logged**
  (`src/lib/rfqKind.js`). The first RFQ on a lead is fresh; one logged when
  the lead is already at `rfq`/`quote_submission`/`negotiation`/`won`/`lost`
  is revised. For an `on_hold` lead it uses the stage it actually *paused*
  at, not the literal `on_hold`, which has no funnel rank.
  **No retroactive classification** — everything logged before this keeps
  `rfq_kind = NULL`.
  **A fresh RFQ auto-advances the lead to RFQ Raised**, writing a real
  `stage_history` row alongside the `leads` update (`changed_by` the real
  actor, which matters when a coordinator logs on an exec's behalf). It
  **never** fires for a revised RFQ or an `on_hold`/`won`/`lost` lead —
  silently resuming a paused lead or reopening a decided one as a side effect
  of logging an activity would contradict this app's own reason-gating. A
  hint above the button says so before the rep submits.
  **Only fresh RFQs count toward the RFQ Raised target** (the owner's ruling
  — a revision is real work, but not toward that quota); an untagged legacy
  row still counts. `ActivityCountsCard`'s raw tally is deliberately **not**
  filtered: "how much RFQ paperwork happened" and "how much fresh RFQ quota
  was hit" are different questions.
* **Booking Update** — an optional `order_value`, labelled **"Order value
  without GST" here and only here**, at the owner's direction. It's the same
  column; every other screen still reads plain "Order value". Don't "fix" the
  others to match without asking.
* **Office Day** — **What did you do?** (textarea, required) → **Time range**
  (From/Till, both required) → Notes. All three gated by `officeDaySatisfied`;
  Office Day used to save with nothing filled at all. **Till must be strictly
  after From**, which also blocks the equal case — a zero-length office day is
  a typo too. Compared as plain strings, since `<input type="time">` always
  yields zero-padded `"HH:MM"`, so lexical order is clock order and there's no
  `Date` and no timezone to get wrong. Deliberately **not** a DB CHECK: a
  constraint violation would surface as an opaque Postgres error on a form the
  rep can't argue with. The intended consequence is that an office day
  spanning midnight can't be logged as one entry.
  `work_summary` is its own column, not folded into `notes` — the screen asks
  both questions separately, so merging would make either unreadable alone.
  The old "Leads generated" input is gone, but `activities.leads_generated` is
  **deliberately not dropped**: entries logged while it existed are real, and
  the log drill-down still falls back to them.
* **Client Meeting and Design Sheet** fall into the generic branch and needed
  no code in this file. **The owner will specify further fields later —
  don't add any without asking.** Client Meeting is targetable; **Design
  Sheet is not** — it's a deliverable following from work already done rather
  than outbound effort a rep gets a number for, the same reasoning that keeps
  Office Day and Booking Update out.

#### Rules that hold across every type

* **Switching activity type clears every type-specific field group**, and so
  does "Log another activity" — so a required value typed and then abandoned
  can't be written by a form that never showed it.
* **Lead/site/follow-up side effects run as separate calls after the
  `activities` insert succeeds.** A failure in any surfaces as a warning on
  the success screen without blocking the activity from being logged.
* **Not in scope here:** lead stage changes beyond the RFQ auto-advance
  (that's Lead Detail's job), and browsing past activities.

#### The architect → firm tree

A firm is a real `firm` party, not a typed label, so it can be walked both
ways. `partyQueries.js` owns all of it — `PARTY_COLUMNS`, `attachFirms`
(resolve `.firm`) and `setPartyFirm` (the one writer, owning the
no-op-when-unchanged case and the silent-RLS-rejection warning). Three screens
use it: Architect Meeting, New Lead, and Lead Detail's Contacts.

**`parties.firm_name` is legacy text, still read only as a fallback.** Nothing
writes it. A display that reads the link and a display that reads the fallback
look identical when the two agree — so verify with an architect whose stored
`firm_name` and linked firm **differ**.

**⚠️ PostgREST cannot embed a self-referencing FK by column hint — use two
queries.** The same FK describes both directions, and
`parties!firm_party_id(...)` **silently resolves the REVERSE one**, returning
an empty array for an architect whose link is genuinely set, with no error at
all. The constraint-name form fails outright with `PGRST200`. `attachFirms()`
selects `firm_party_id` and resolves those ids in one bounded follow-up query
instead — the same "two plain queries beat one fragile piece of PostgREST
syntax" reasoning `searchQueries.js` already documents.

### Dashboard (`src/pages/Dashboard.jsx`)

One page at `/dashboard` for every role. Role branching is one derived
boolean, **`seesOthersData`** — reuse it; don't write a fresh role check.

**`isOwner ? … : …` is the recurring bug shape on this page.** The
"not an owner means a rep" assumption shipped repeatedly: the Leads header
said "My leads" to someone who owns none, Reports said "Your performance",
drill-down eyebrows carried the coordinator's own name, and
`sourceOptionsForRole` hid a coordinator's own team's Lixil and referral
leads. Related: `employees` comes from `fetchActiveSalesExecs()`, which
returns **every** rep in the company (RLS on `employees` is deliberately
open), so **scope it once at that fetch** and let the Day Review table, the
per-exec breakdowns and All Leads' owner filter follow. Don't re-add a
per-consumer role check.

**No in-page tab buttons.** `activeTab` (`'reports' | 'leads'`) is driven
purely by `?tab=` — `?tab=leads` reaches All Leads, anything else means
Reports. `LeadsListCard` fetches independently of the Reports effects, since
it isn't date-range-scoped.

**A `sales_manager` gets a page-level My / Team switch**, defaulting to My,
applied **once** to the fetched rows (`all*` state + scoped `useMemo`s) rather
than taught to twelve cards. `inScope()` returns true immediately unless the
viewer is a manager, so it's an exact no-op for the other three roles.
`seesOthersData` follows the **switch**, not the role.

#### Pipeline / deal value (`src/lib/pipelineValue.js`)

**The canonical "how much is this lead worth" figure.** At least nine call
sites each hand-rolled their own version before this existed, and they drifted
into different numbers on screen at the same moment for one concept.

The rule: `order_value` is only ever written once a deal is booked, so for a
lead that is **still open** (not `won`/`lost`) `order_value` is deliberately
ignored even if present, and the lead is worth its latest `quote_value`
alone. A `won`/`lost` lead keeps `order_value ?? quote_value ?? 0`.

* **`dealValueFor(lead)` is for SUMS; `dealValueOrNull()` is for DISPLAY.**
  The first coerces unknown to `0`, which is right for adding up and wrong
  for showing — a lead nobody has quoted is not a deal worth ₹0. Every
  per-lead display site used to read `dealValueFor` and print ₹0, which on
  real data was most of All Leads. **Don't "simplify" by making
  `dealValueFor` return null** — `sumOpenPipelineValue` and the four
  category cards add its result, and null would poison every total.
* `sumOpenPipelineValue(leads)` is the open-leads-only total.
* `LeadDetail`'s own "Deal value" stat is deliberately a separate formula —
  a single lead's lifetime headline number, not a pipeline aggregate.

#### Date range (`DateRangeSelector.jsx`, `src/lib/dateRanges.js`)

**Today** (the Day Review — it *replaces* the card grid rather than
re-filtering it) / **Week** (Monday–today) / **15D** (rolling, not
calendar-aligned) / **Month** / **Quarter** / **Custom**. An incomplete
custom range returns `null` and the page prompts instead of querying.

Week/Month/Quarter line up with a `targets.period_type`. **15D and Custom
render Targets vs. actuals not at all**, rather than with a fallback message
— 15D is a rolling window with no fixed `period_value` identity a target
could be keyed by. The gate is `isTargetPeriod = periodForPreset(preset) !=
null`, reusing `periodForPreset` rather than a second week/month/quarter
check that could drift from it.

#### Needs Attention (`NeedsAttentionCard.jsx` + `src/lib/attention.js`)

Five queues: no activity in `ATTENTION_DAYS`, quotes sent 5+ days ago with
nothing since, overdue follow-ups, slipped close dates, and RFQs raised 3+
days ago with no quote. Thresholds are named constants at the top of
`attention.js` — **tune there, never inline.**

* **`STALE_DAYS` (7) and `ATTENTION_DAYS` (14) are two different questions.**
  `STALE_DAYS` is when a lead starts *reading* as neglected and drives labels
  and colour only; `ATTENTION_DAYS` is when it actually *enters the queue*.
  Re-confirmed verbatim by the owner. `attention.test.js` pins the invariant
  (a lead at exactly `STALE_DAYS` must not be queued), so merging them back
  fails the suite rather than quietly changing every dashboard.
  **Any new surface that colours or labels by staleness must import these
  constants — never repeat the literals.** That mistake has now been made
  three separate times (Lead Profile's health pill, `EmployeeProfile`'s
  `touchColor`, and `RightNowStrip`'s "Stale" tile, which reused the 14-day
  bucket under a 7-day label). `computeStale7Bucket`/
  `computeStale7BucketFromRpc` give STALE_DAYS its own real bucket with its
  own `stale_7d` key.
  **The Phase 9 brief's separate 10-day red-flag figure does not exist in
  this codebase and must not be reintroduced from it.**
* **An `on_hold` lead is excluded from the stale bucket outright**, however
  long the pause has run — On Hold deliberately takes a lead off the clock.
  When it resumes, the clock restarts from that day: the "since touch"
  reference is `GREATEST(last activity, last stage change)`, so the very
  stage change that ends the pause counts as a touch.
* **`HISTORY_STARTS_AT` (`'2026-09-02'`) — the legacy-import reset.** The
  imports brought in 431 leads with real dates back to 2023 but **no activity
  history at all** for 306 of them, so the `created_at` fallback stopped
  answering "when was this last touched?" and started answering "when did our
  records start?" — measured, Needs Attention would have gone 165 → 396 rows
  overnight, 334 of them stale. **A blank record is not evidence of neglect.**
  On an imported lead, a signal dated before the floor is treated as though
  it arrived on the floor, and each bucket's own threshold then does its
  normal job. Three things about it are load-bearing:
  - **It is scoped by provenance, not by date** — `isImportedLead` tests
    `external_reference_id LIKE 'legacy-%'`. A global date floor also silenced
    an app-created lead whose follow-up was genuinely overdue. Both
    `fetchLeadsForBreakdown` and `fetchLeadsList` must keep selecting
    `external_reference_id`, or the clamp silently stops applying there.
  - **Only the threshold test is clamped, never the displayed age.** A lead
    silent since 2023 still reports its true age when it surfaces.
  - **The label surfaces clamp too**, via the exported `staleGateDays`. All
    Leads shouting a red "847d silent" while Needs Attention reports nothing
    to do is the contradiction the STALE/ATTENTION split exists to end.
  It self-expires once every lead has real history. Deleting it restores the
  flood.
* Every row opens the `ageing` drill-down; the KPI row's "Stale leads" tile
  reuses the identical call.
* `wide` switches the 5 buckets to a tile grid, **fixed at `repeat(5, 1fr)`,
  not `auto-fit`** — `attention.js` always produces exactly 5, and an
  `auto-fit` count that doesn't divide 5 leaves a visible empty cell.
  Below 1024px it caps to 3 buckets + a "+N more" link regardless of `wide`.

#### Report cards

* **"Right now" strip** (`RightNowStrip.jsx`) — time-independent
  point-in-time counts, unaffected by the date-range selector. Its "Stale
  Leads" tile reads `computeStale7Bucket` (STALE_DAYS/7), **not** the
  ATTENTION_DAYS queue bucket it once reused under a 7-day label. Background
  in `TIME-INDEPENDENT-METRICS-LOG.md` (repo root).
* **KPI band** — `KpiSparkRow.jsx`'s 6 tiles at every width (Order value
  booked / Activities logged / Open pipeline / Win rate / Stale leads /
  Weighted forecast). **Only the three with real per-event timestamps to
  bucket by week carry a delta and an 8-week sparkline**; the other three are
  point-in-time snapshots with nothing stored over time and render value-only
  rather than fabricate a trend. Open pipeline is the one exception, reusing
  the delta slot for a lead count with `up: null` so it renders plain and
  muted rather than as a green/red trend.
* **Activity counts** — one row per `ACTIVITY_TYPES` entry, a fixed height
  regardless of headcount. Its old "by exec" matrix was dropped for exactly
  that reason; per-exec counts live on the heatmap, and "Details" opens the
  `attain` panel broken down by type.
* **New leads by source** — a sales exec sees only `SALES_EXEC_SOURCES`
  (Scanning/Walk-in); Lixil and referrals are distributed by the owner, not
  something a rep sources, so showing all 5 was mostly zeros. Donut + legend
  at ≥1024px, bar rows below.
* **Closure forecast** — not-won/not-lost leads with `quote_sent` or a
  probability set, sorted by `estimated_close_date` ascending (nulls last).
  Deliberately **not** date-range-scoped: a snapshot of the current pipeline,
  not of when leads were created. Capped to the soonest 6 rows with a
  "+N more" into the `forecast` drill-down.
* **Leads by area / site stage / product** — one generic
  `LeadsByCategoryCard` reused 3×, fed by the shared `fetchLeadsForBreakdown`.
  Pipeline snapshots, **not** date-range-scoped. `categoryOrder` pins a fixed
  bucket set shown even at zero count (Site Stage only); Area and Product
  discover buckets from the data and sort by count. `maxRows` caps Area and
  Product, **not** Site Stage, whose pinned list is already short.
  **When a `categoryOrder` card runs longer than its fixed list, suspect the
  data before reaching for `maxRows`** — a cap on a pinned-order card hides
  whichever duplicate sorts last, not the overflow you meant. Site Stage once
  grew to 13 rows from casing variants of the same stage, where capping would
  have hidden the *larger* duplicate and made the card read more wrongly
  while looking tidier. Normalising the column fixed it.
* **Pipeline by stage** — inline in `Dashboard.jsx`, count + value per stage
  as a plain bar-row list, all buckets shown even at zero. **It is a list plus
  a "Details ›" link, nothing else. Don't reintroduce a second view mode
  without asking** — a Kanban board and an inline split view were both tried
  and both reverted, and this card is why the "ask before you build" rule at
  the top of this file exists.
  Each bar opens a `stageLeads` sub-panel (every lead at that stage, with an
  owner `<select>`), **prebuilt eagerly** by `buildPipelinePanel`.
* **Sales funnel** — reach-count + avg-days-in-stage per stage. One team-wide
  table, deliberately **no** per-employee breakdown: funnel shape is a
  whole-pipeline metric. **No "Details" link** — it used to open the identical
  `pipeline` panel Pipeline by stage already opens.
  **`stage_history` only logs the destination of an explicit change**, so a
  lead going straight `calling → lost` gets one row and never a `calling`
  one, and a lead untouched since creation has zero rows. Reading it alone
  undercounts. Each lead's reached-set is therefore **seeded** from its own
  `current_stage` plus the schema default before being widened with actual
  history. Avg-days is unaffected — it should only reflect real transitions.
  `stage_history` SELECT is open to everyone, so the embedded `leads` comes
  back `null` for rows a sales exec doesn't own and is dropped client-side to
  get the same scoping every other card gets for free.
* **Why we lose** (`LossReasonsCard`) — **owner-only in RLS itself**, so this
  is a hard constraint, not a UI nicety; the fetch is skipped entirely for a
  sales exec rather than firing a request RLS would return empty.
  **It counts CURRENTLY-lost leads, not loss events.** `loss_reasons` is
  append-only, so a lead marked lost and later reopened keeps its reason
  forever and used to keep being counted, making this card total higher than
  the `lost` stage count. **The filter lives in `Dashboard.jsx` where the
  fetch resolves**, not in the card — the same array feeds the card and
  `buildLossPanel`, so filtering once at the source is what stops the two
  disagreeing. **The two figures should now always match**; if this card ever
  again totals more than the `lost` count, that filter has been lost.

#### Targets vs. actuals (`TargetsVsActualsCard.jsx`)

Only mounted for Week/Month/Quarter. **`metric_name` is a closed list**
(`src/lib/targetMetrics.js`), deliberately not the "suggested + Other…"
free-text pattern used for `current_stage`/`site_stage` — an arbitrary metric
would have a target but no computable actual.

The six, in render order: `scanning_leads` ("Scanning Leads" — new *leads*,
not activities, whose source is Scanning, counted by lead owner off the
`breakdownLeads` array the card already has, no new query),
`client_meeting_old`, `client_meeting_new`, `call`, `rfq_raised`, and
`order_value` (labelled "Order Value Booked" **here specifically**; the
column and every other screen say plain "Order value").

**Site Visit, Architect Meeting and Bookings are no longer targetable** —
still loggable and visible everywhere else. Any `targets` row still keyed on
a retired metric computes no actual and needs re-entering; the same goes for
rows keyed on the retired combined `client_meeting`.

`ACTIVITY_METRIC_OPTIONS` (the four activity-shaped metrics) is exported for
`DashboardHeatmap`'s columns and `buildOverallAttainPanel` to share, so an
edit here can't leave the heatmap and its drill-down disagreeing;
`scanning_leads` and `order_value` are added on top at both call sites.

**Actuals.** The activity metrics count straight from the same `activities`
array `ActivityCountsCard` already fetched — no duplicate query. `order_value`
has no timestamp of its own, so it's approximated via `stage_history`: sum
`order_value` for leads whose most recent `'won'` row falls inside the period
(deduped client-side to one row per lead, since the query is pre-sorted). A
deliberate, discussed approximation — see DECISIONS.md.

**Attainment is capped per metric at 100% before averaging** (`ATTAINMENT_CAP`
— the owner's ruling: a metric wildly over target counts as fully met, no
extra credit). `blendedAttainmentFor` is the one implementation; the heatmap's
"Overall" cell and `buildOverallAttainPanel` both **call it** rather than
re-deriving an average — they used to have their own uncapped inline versions,
which showed 63% where the capped rule gave 43% for the same person and
period. `EmployeeProfile`'s rank pill iterates a deliberately different metric
set but keeps the same cap constant. A panel's "Line by line" rows still show
the honest uncapped ratio; only the blended headline caps.

**Views.** Owner at ≥1024px gets `DashboardHeatmap` (one row per exec, one
column per metric plus a blended Overall). `--vip-heatmap-cols` is fed
`COLS.length`, so adding a metric scales it. A sales exec keeps a plain
bar-list at every width, with every metric shown even at zero and
`no target set` rendered explicitly rather than the row being omitted. Below
1024px the owner gets one collapsed `ExecAttainmentRow` per exec (name ·
blended attainment · one bar) expanding to the full breakdown — the flat
employee × metric list measured 3,388px on this card alone.

**Drill-downs.** Activity cells fetch that exec's log entries **on demand**,
never preloaded for everyone. Order value and Scanning Leads build
synchronously from state already on the page.
**The entry list is scoped to the selected period**, matching the panel's own
headline count — it used to list everything fetched (up to ~60 days) with
nothing on screen to say the entries fell outside the period. The
"Logging rhythm · last 20 working days" section is deliberately **unchanged**:
a separate, clearly-labelled rolling window.

**"Cancel this target"** appears on any single-employee cell with a real
target, as a plain link expanding to a two-step confirm — **never a native
`window.confirm`**. **Gated on `isOwner` specifically, not `seesOthersData`**:
`targets` DELETE is owner-only in RLS with no "own data" exception, unlike
INSERT/UPDATE, so offering it to anyone else is a button that always fails
with a 42501. The blended Overall column never gets it — there's no single row
to cancel.

#### Set a target (`SetTargetForm.jsx`)

Collapsed behind a "+ Set a target" toggle. **Gated purely by
`showByEmployee`** — there is no separate `isOwner` check, which is why it
correctly opened to coordinators and managers the moment `seesOthersData`
grew to include them. The employee dropdown is narrowed to their own team by
the same roster scoping every other team-scoped card reads.

**`period_value` is a stepper, never a text box.** It used to auto-prefill an
ISO code (`2026-W37`) but stay editable, which is both unreadable at a glance
and an easy way to save a target under the wrong period. A `‹`/`›` stepper
walks one whole week/month/quarter at a time and **its middle slot shows the
human date range** ("14 – 20 Sep 2026" / "September 2026" / "1 Jul – 30 Sep
2026 (Q3)"), not the underlying start date, which signified nothing on its
own. A real `<input type="date">` stays functional underneath
(`.vip-period-picker-input`, invisible, layered over the visible label), so
tapping opens the native picker and can jump anywhere. `period_value` on the
wire is unchanged; this is display/input only.

**The form seeds from the period the dashboard is SHOWING**, not a hardcoded
Week. The argument is failure mode, not convenience: both defaults cost the
same one dropdown change when wrong, but the old one could silently write a
*weekly* target while the owner was looking at monthly ones. Seeding from
`displayPeriod` can only land a target under the period already on screen,
where a mistake is visible immediately. **Seeded, not controlled** — they're
`useState` initialisers, so changing the range while the form is open
deliberately doesn't move the period under someone mid-entry; the form
remounts on every open.

**`mergeTargetRow` owns the merge contract, and this is the bug worth
knowing.** A target set for next week really did show up under the current
week, and **the database was right the whole time; only the screen lied.**
Two defects with one root cause:

- **`fetchTargetsForPeriod` didn't select `period_type`/`period_value`**,
  omitted as redundant since the query already filters on both. That
  redundancy was load-bearing: **every fetched row carried `undefined` for
  both.**
- The inline merge compared those two columns to decide replace-vs-append, so
  the test never matched and it **always appended** — a next-week row landing
  in the array holding this week's targets. `targetFor()` has no period filter
  (the array is supposed to be period-scoped already), so it returned it.

Its quieter twin: correcting a current-week target appeared to do nothing,
because `insertTarget` is an upsert, the correction came back as the same row
id, and `targetFor` returns its FIRST match — the stale copy.

**The fix is one enforcement point.** `mergeTargetRow` **drops** a row whose
period isn't the one on screen, and for one that is, matches on **employee +
metric alone** — never re-reading the period off a stored row.
`fetchTargetsForPeriod` selects both columns so the array is at least
homogeneous, and `Dashboard.jsx` reads one `targetPeriod` memo from the fetch,
the render gate and the merge. Eight tests pin it, confirmed to fail against
the old merge rather than merely to pass now.

**It was only ever wrong in the session that pressed Set** — a reload
refetches scoped to the displayed period and washes it away, which is why an
earlier reproduction across a reload found nothing.

**`SetTargetForm` always names the period it saved for** ("Saved for 14 – 20
Sep 2026."), adding "The table above is showing …, so it won't appear there."
when they differ. Without that, correct behaviour reads as a second bug.

**"Already set for {range}"** lists what exists for the period the stepper
points at, from a **local** fetch kept deliberately out of `Dashboard.jsx`'s
own period-scoped `targets` array. **It exists because there is nowhere else
in the app to see a future period's targets** — every Week/Month/Quarter in
the product resolves against `now()`, so a target set for next week is
invisible everywhere until next week begins. Fixing the merge without this
would have read as the targets vanishing. It's scoped to the selected employee
once one is picked, filtered to the `employees` the card was handed (not
whatever RLS returns), refetched after a save, debounced 250ms, and rendered
in `METRIC_OPTIONS` order so it doesn't reshuffle as rows are added.

**Flagged, not changed:** `insertTarget` is an upsert, so re-entering a target
replaces rather than duplicates.

#### All Leads (`LeadsListCard.jsx`, `?tab=leads`)

A browsable, filterable list of individual leads, ordered `created_at` desc,
paginated. Deliberately **not** wired to the Reports date-range selector —
it's a browse tool, not a period report. The whole page is `.vip-wide` for
both tabs.

**Every facet applies server-side** via `fetchLeadsList({ employeeId, stage,
siteStage, source, status, minValue, maxValue })` — correct under the row
cap, unlike filtering client-side would be. Search is client-side over the
fetched page, same precedent as Search and My Team.

**Layout: a horizontal filter toolbar above a full-width 8-column table**, the
standard CRM list-view shape. A 240px left rail was tried and removed —
adding Site stage took the table to eight columns, and permanently parked
dropdowns are a poor trade against that. Search and a Status segmented control
(All / **Active** / **Closed** — "Inactive" was renamed because it always
meant won-or-lost, while *stale* is what "inactive" means everywhere else
here) sit permanently visible at both widths; the rest is a one-row
`.vip-leads-filterbar` on desktop and stays behind the Filters toggle on a
phone.

* **Stage is a dropdown, not a nine-chip cloud** — that wrap was the tallest
  thing in the old rail. Owner likewise lost its segmented-button variant: a
  different *kind* of control among five dropdowns is what makes a filter row
  hard to scan.
* **`filterFields` is not one monolithic block** — each facet is its own
  const composed into the two arrangements. Still one definition per field,
  but a field can sit in the toolbar at one width and the panel at the other.
* **Column tracks are MEASURED, not guessed.** Every cell on a real page was
  cloned and sized to content; the mins sit just above what must never
  truncate and well below site, where a full address is 400px and truncating
  is correct. All eight fit at 1024px without touching `overflow-x`, which is
  a safety net rather than the normal case.
* **Site stage renders as a NEUTRAL tag**, never a coloured pill — the lead
  stage beside it is the row's one colour-carrying signal, and a second
  tinted pill is exactly the noise this pass removed.
* **The Site stage filter needs `sites!inner(...)`, and that hint is
  load-bearing.** `site_stage` lives on the embedded row, and PostgREST
  applied to a *plain* embed keeps the parent lead and merely nulls the
  embed — the filter silently does nothing to the rows OR the count. The
  select string swaps to `!inner` **only while the facet is active**; making
  it unconditional would drop every lead with no `sites` row from the
  unfiltered list. This is a plain equality filter on an embedded resource,
  deliberately **not** the "resolve ids first, then `.in()`" shape
  `resolveLeadsSearchFilter` uses — that exists because an ILIKE can match
  hundreds of ids and blow up the request URL, whereas one site stage matches
  a comparable number, so pushing the join into Postgres is simpler and
  bounded. **Not set** is `.is('sites.site_stage', null)` — a site row exists
  but carries no stage, which is the honest "nobody has recorded it" worklist.
* **Status is binary**, mirroring `fetchClosureForecast`'s own not-won-not-lost
  filter, since picking one exact stage is what the Stage facet is for.
* **Quote value filters on `quote_value` specifically**, not `order_value`, so
  a row's displayed figure can rarely sit outside a range that still matched
  it. Accepted edge case.
* **Owner renders only when `showOwnerFilter` is true.** That prop used to be
  named `isOwner`, which read as a role check and is exactly why a coordinator
  was denied the facet. The card's title is likewise passed in as `title`
  rather than derived from the same flag, so the card and `AppNav`'s header
  can't disagree about whose leads are on screen.
* **Mobile is a flat list**, one `.vip-lead-row` per lead carrying stage chip
  and site-stage tag in `.vip-lead-row-meta` with `site · source` beside them.
  **The two stages are tags rather than text for a measured reason**: folded
  into the text line, a long site name (routinely 300px+) truncated the site
  stage away on exactly the rows it was added for. `.vip-lead-row-side` is
  capped at 36% so the one long recency string this app produces ("no activity
  on record", true of every legacy-imported lead) can't take a third of the
  row from the party name.
* There is **no Delete-a-lead tool anywhere in the app**; cleaning up a stray
  lead needs direct Supabase access.

### Day Review (Dashboard's `Today` period)

A **daily accountability read, not a report**: what each exec logged, what
they changed on each lead, which follow-ups closed, and how that compares
across the team. **Every number is bounded to a single calendar day**, and it
is deliberately **not a scored leaderboard** — raw counts only, no weighting,
no composite index, no ranking badge. Sorting is the only ordering.

Picking `Today` **replaces the whole Reports card grid** — a pipeline total or
a month's attainment says nothing about eight hours, so re-filtering the
standing cards would be worse than not showing them.

* **The audit trail is `lead_change_log`, written ONLY by a Postgres trigger
  on `leads`, never by app code.** There is no single lead-update service
  here (`leads` is written from four LeadDetail sections, `LeadStageSection`,
  `LeadQuickActions` and three side-effect paths in `ActivityLog`), so a JS
  helper would have to be called from all of them and the first missed call
  site becomes a silently absent audit row. The trigger also catches direct
  edits in the Supabase table editor. `field` is a closed set. **Append-only
  at both layers** — no INSERT/UPDATE/DELETE grant or policy for anyone.
* **Stage changes are NOT in that table** — they come from `stage_history`,
  which already records exactly that and has real history from the start of
  the project. Logging both would create two sources of truth for one fact
  and leave the day sheet blank for every date before the migration. Won/Lost
  are stages here, not a separate status field, so the handoff's `status` and
  `stage` change types collapse into one.
* **`leads.created_by_employee_id`** is what the "New leads" column counts.
  Using `owner_employee_id` would re-credit every reassigned lead to whoever
  holds it now, retroactively rewriting a day sheet for a date before the
  reassignment happened.
* **Deliberately not logged:** owner reassignment (`lead_owner_history` has
  it), contact/address/source edits, and lead notes — **there is no notes
  column on `leads` at all**, only on `activities`, which already show in the
  day sheet. The spec's pre-formatted `old_display`/`new_display` columns were
  dropped too: `format.js` already formats every rupee figure, and a second
  baked-in copy can drift from the renderer.
* **`dayReviewQueries.js`** runs seven parallel day-bounded fetches plus a
  second-round `fetchPriorStages` for the `old chip → new chip` diff
  (`stage_history` only records the destination). `dayBounds()` runs
  midnight-to-midnight in the **browser's** local timezone, matching
  `todayISO()`/`rangeForPreset()` rather than inventing a second definition of
  "today". The change-log query's error is surfaced separately
  (`changesUnavailable`) so a missing migration degrades that one block
  instead of failing the screen.
* **`dayReview.js`** does all shaping and no network calls, the same division
  of labour `drilldownBuilders.js` follows.
* **The pending vs missed rule:** an open follow-up is **pending** while the
  day is still running and only **missed** once it's over. There's no
  configured end-of-working-day, so the boundary is midnight. Calling an open
  reminder a miss at 10am would be a lie a manager acts on. The cell renders
  `done / pending` in amber during the day and `done / missed` in red after.
* **The team table** is a real grid with group headers, sortable headers, a
  Team total footer, and **a zero rendered as an em-dash** except in the Total
  column and the done/missed pair. A zero-activity exec is muted and sinks to
  the bottom on its own — no badge, no red band, no pinning. The handoff
  called this desktop-only; **that was overridden on purpose** (the owner
  works from a phone), so below 1024px the same rows render as stacked
  `.vip-daycard`s opening the same day sheet.
* **The day sheet** is a `daySheet` drill-down kind, three blocks in the order
  a manager actually asks: follow-ups (missed first, with **the one action
  this panel allows** — Reschedule) → activities logged → changes made. Each
  block caps its list with a "+N more" line. `DrilldownPanel`'s head gained an
  optional `avatar` and its value row is conditional — a day sheet leads with
  a person, not a headline figure.
* **A sales exec sees only their own row.** Their queries are already
  RLS-scoped, so listing the whole team would render every colleague as an
  all-zero row.

### Profile (`/profile`)

The merged replacement for the old `Account` and owner-only `Settings`
screens. No tab or sidebar link — reached only by tapping an avatar.
Initials come from `getInitials` (`src/lib/initials.js`, first + surname
letter, falling back to the first two letters of a single-word name).

Top to bottom: **identity facts** (read-only), **Notifications** (this
device's permission state + push toggle), **Appearance** (Light/Dark/System,
both roles, every width), the **owner-only settings block**, **Change
password**, **Log out**.

The owner-only block is `.vip-only-desktop` — mobile Profile stays a lean
personal screen. **Manage employees is the exception**, deliberately moved
out of that block: reshuffling reporting lines is a phone-reasonable task.

* **Add employee** — collapsed behind a "+ Add" toggle. It creates the
  **CRM-side record only**; the actual Supabase Auth login still has to be
  made by hand in the Supabase dashboard and its UUID pasted in, for the same
  reason a `service_role` key must never reach the browser.
* **Manage employees** — search-only, nothing shown until a name matches. Per
  row: editable mobile, role dropdown, Active/Inactive toggle, and a
  "Reports to" dropdown shown only when the *saved* role is
  `sales_executive`. Role and Active are disabled for the owner's own row, so
  an owner can't demote or deactivate themselves via RLS's caller-is-owner
  (not row-stays-owner) policy.
  **`updateEmployeeRole()` clears `coordinator_id`/`manager_id` in the same
  statement** when the new role isn't exec, or the validation trigger rejects
  the write. Demoting an exec who still holds data **warns with real counts
  and allows**; demoting a coordinator or manager who still has reports is
  **hard-blocked by the database** (an orphaned pointer breaks visibility for
  a whole team).
* **Delete a party** — search-only, then a two-step inline confirm. It
  replaced Delete-a-lead entirely; the actual need was cleaning up a wrongly
  added architect/PMC contact. **`leads.party_id`, `activities.party_id` and
  `site_contacts.party_id` have no `ON DELETE` clause** (plain `RESTRICT`) —
  only `referred_by_party_id`/`other_party_id` are `SET NULL`. So deleting a
  party who is anyone's actual lead anchor fails with a Postgres FK error,
  surfaced verbatim rather than pre-checked client-side. That's exactly why
  this tool works for a wrongly-added referrer and not for a real client.
* **Change password** — **re-authenticates with the current password first**
  (`signInWithPassword`) before `updateUser({ password })`, deliberately over
  the simpler "just call `updateUser`" that Supabase allows on any valid
  session with no old-password check. The point is to stop a password change
  from a device merely left unlocked. Client-side validation (≥6 chars, new
  === confirm) runs before the round trip.

### Mobile redesign (below 1024px)

Desktop is untouched throughout — every rule here is gated by
`.vip-only-mobile`/`.vip-only-desktop` or CSS scoped to
`@media (max-width: 1023.98px)`. No schema change and no new query: every
value shown was already produced by an existing query function.

* **Navigation** — 4 mobile tabs (Today / Leads / Dashboard / Search) plus a
  centre **FAB** opening `FabSheet.jsx` (New Lead / Log Activity, the latter
  omitted for an owner). The FAB sits in a **reserved 76px `.vip-fab-slot`
  gap between tabs, not an absolutely-centred circle over 4 equal tabs** —
  that clipped through the Dashboard label. **The slot div renders even when
  the button inside it doesn't**: it's the gap the tabs lay out around.
  The new tab links sit right after Home in the DOM so the desktop sidebar's
  link order is undisturbed.
* **`.vip-drilled`** (added by `ProtectedRoute` for every route outside
  `TAB_ROUTES`) hides `BottomNav` entirely below 1024px, replaced by each
  page's own `.vip-sticky-footer` or nothing. A page using that footer gives
  its content `.vip-pad-sticky-footer` so the footer doesn't permanently
  cover the last field; the three tab routes that show the FAB use
  `.vip-pad-fab-overhang` instead, because the FAB pokes 14px above the bar's
  own top edge and the base padding only cleared the bar.
* **Lead Detail** collapses its four edit sections into `.vip-detail-row`
  summary lines derived from already-loaded state (no new fetch); tapping one
  pushes the *same* section component into a full-screen `.vip-dd-panel`,
  reusing the drill-down's backdrop and panel CSS for a form rather than a
  data view.
* **Queue drill-down row actions** — `buildAgeingPanel`'s `queueActions` flag
  makes `AgeingBody` render `SwipeAgeRow` instead of a plain `<Link>`: drag
  left (touch or mouse, **no drag library**) to reveal Log call and Set date,
  snapping open past 40% travel. Dashboard's own Needs Attention rows pass
  `false` explicitly and are unaffected.
  **`allowLogCall` defaults to `queueActions` but is separate**, because the
  two aren't the same kind of action: Set date creates a follow-up **assigned
  to the lead's owner** (a supervisor nudging a rep), while Log call inserts
  an activity crediting whoever clicked. Only the first belongs on a team
  queue.
* **There is no offline write queue.** A "saves on this phone, syncs later"
  note was added to New Lead's footer and removed, because it wasn't true — a
  save attempted with no signal just fails. `OfflineIndicator.jsx` is the one
  honest source of connectivity status; **don't reintroduce a second,
  conflicting one on a specific form without actually building the queue.**

### Numeric keypad (`NumPadInput.jsx`, mobile-only)

A CRM-styled on-screen keypad. **Mobile-only** — desktop renders the exact
original `<input>`, untouched.

* **Two variants:** `decimal` (money/target fields) and `integer`
  (Probability, and **mobile-number fields**, since a phone number has no
  decimal point either — reusing the variant rather than adding a third).
* **A drop-in swap, not a rewrite** — it takes the same `value`/`onChange` a
  plain `<input>` does and calls `onChange({target:{value}})` per keystroke,
  so every call site's existing state and `Number(x)` conversion needed no
  change.
* **`useIsMobile.js` mirrors the same `(max-width: 1023.98px)` breakpoint the
  stylesheet uses**, kept as one source. Needed in JS because desktop and
  mobile render genuinely different input behaviour, which a CSS-only switch
  can't express.
* **`inputMode="none"` at mobile widths only** suppresses the OS keyboard.
  The field stays a real, focusable, screen-reader-visible control, and a
  hardware keyboard or paste still reaches it through `onChange` — this
  component only ever ADDS a way to type, never removes one.
* It reuses section 9's `.vip-sheet` bottom-sheet chrome at a **higher
  z-index (60/61) than every other overlay** (FAB sheet 50/51, drill-down
  40/41), since a numpad field can be nested inside either. A readout in the
  sheet header keeps the value legible when the field itself is hidden behind
  the sheet, with a **Done** button beside it.
* **A `Paste` button sits beside Done**, because `inputMode="none"` makes the
  field's own long-press paste menu unreliable on several mobile browsers. It
  strips everything but digits (the decimal variant keeps one `.`), so a
  copied `"+91 98765-43210"` lands as `9198765432`. Clipboard failure shows
  an inline note rather than throwing, leaving the existing value untouched.
* **`maxLength` is enforced twice, and both are needed**: as the native
  attribute (typed entry, autofill, native paste) **and** by hand in
  `pressDigit`/`pressPaste`, since the on-screen keypad writes via a synthetic
  `onChange` the native attribute never sees. **Every phone-number field
  passes `maxLength={10}`.**
* Search boxes that filter by name-or-mobile (`DeletePartySection`, `Search`)
  are deliberately **left uncapped and unwired** — truncating a partial search
  term would break searching by a short digit sequence.
* Pressing a digit on a lone `"0"` replaces it rather than producing `"05"`.
* Two of the wired fields sit inside Profile's owner-only desktop block, so
  they never show the keypad today. Wiring them was still correct — nothing
  has to change if that block reopens to mobile.

### Roles

Four roles. **`src/lib/roles.js` is canonical** (`ROLE_OPTIONS`/`ROLE_LABELS`/
`roleLabel()`/`canHaveCoordinator()`) — adding the third role found the same
label table hand-rolled in four files, two of them listing only two roles.
Use it; don't write a fifth copy.

**Nav gates on capabilities, not `role !== 'owner'`.** That shorthand means
"anyone who isn't an owner is a rep" and offered a coordinator the Activity
Log link and FAB row, both routing to a page they couldn't reach.
`BottomNav` computes `canLogActivity`/`canCreateLead` and passes them down.
**These are ONE flag per capability — do not re-split them.**

#### Sales Coordinator

Oversight between owner and rep. Owns no leads, activities or targets of
their own, supervises a fixed set of execs via `employees.coordinator_id`,
and is fully isolated from every other coordinator's team.

* **`is_my_team_member(employee_id)`** is the one helper every team-scoped
  policy routes through. Coordinator policies are added as **separate,
  additively-permissive `coordinator_team_*` policies**, never edits to the
  existing `own_data_or_owner_role_*` ones, so owner/exec behaviour is
  byte-for-byte unchanged.
* **A coordinator's team view follows the person, not the calendar.**
  `coordinator_id` holds current state only and no history table records
  reassignment (deliberate). So when an exec moves between coordinators,
  **their whole history moves with them, retroactively** — work done months
  earlier under the previous reporting line appears in the new coordinator's
  aggregates and vanishes from the old one's. **This is intended. Don't "fix"
  it and don't report it as a mismatch.** The cure would be a
  `coordinator_history` table plus time-aware queries on every
  coordinator-facing screen — declined for the pilot, and **it must not be
  attempted piecemeal**: half the screens time-aware is worse than either
  consistent answer.
* **A sales exec's `parties`/`sites` read is scoped to their own leads**,
  reversing the earlier open-read decision. Company-wide dedup is no longer
  guaranteed and cross-team duplicates are accepted. **The
  `created_by`/`discovered_by` branch in those policies is load-bearing** —
  Postgres applies the SELECT policy to `INSERT ... RETURNING`, and
  `PartySearchOrCreate` does `.insert().select().single()` on a party that has
  no lead yet, so without it New Lead breaks outright.
* **`entered_by_role` on `leads`/`activities` is a LOCK FLAG, not an audit
  field** — the only one of its kind. `NULL` = the assigned exec hasn't saved
  it yet, so the coordinator who entered it may still edit;
  `'sales_executive'` = the exec has taken it over. Written **only by the
  `stamp_entered_by_role()` trigger**, never app code.
  **The lock on `leads` was removed; the one on `activities` remains.** A
  coordinator may edit a team lead's details at any time (the owner's
  ruling). **What that knowingly gives up:** an exec no longer has any
  guarantee that a record they saved can't be edited underneath them —
  `entered_by_role` is still stamped and readable, it just stops being a
  lock, and `lead_change_log` still records every value edit and who made it.
  The `activities` lock is deliberately untouched: an activity is a record of
  something a person did on a date, not a property of the lead.
* **Entry on behalf.** Execs often phone their coordinator to log a visit or
  hand over a lead. `/leads/new` and `/activity` both render a mandatory
  **"Who is this for?"** picker (`fetchMyTeamExecs()`) for this role, and
  every write that would use the logged-in employee's id uses the picked
  exec's instead: `leads.owner_employee_id`, `activities.employee_id`,
  `sites.discovered_by`, and `parties.created_by`. The record therefore
  belongs to the exec in every sense the rest of the app reads.
  **"Done by the coordinator" is recorded, not inferred**:
  `leads.created_by_employee_id` and `activities.logged_by_employee_id` are
  both trigger-stamped, and Lead Detail and both activity feeds surface them.
  Arriving from a lead's own "Log activity" link auto-fills the picker from
  that lead's real owner rather than asking again.
* **Follow-up assignment uses `follow_ups`, not `plans`.** The spec asked for
  `plans.assigned_by`, but `plans` has zero code references anywhere and
  `follow_ups` already carries `assigned_to`/`created_by`, already renders
  "Assigned by {name}", and already fires a push. No column was added.

#### Sales Manager

**A working sales executive who also supervises.** That sentence is the whole
design, and the two halves are deliberately separate. An exec now reports to
**two independent authorities**: `coordinator_id` and `manager_id` are
separate nullable columns, both optional, neither implying the other, and
neither supervisor can see into the other's supervision.

* **As a rep, a manager needed NO new policy** — every
  `own_data_or_owner_role_*` policy keys on `= current_employee_id()`, not a
  role name, so they were covered the moment the role value became legal.
  They own leads, log their own activities, carry personal targets, and are
  **ranked among the execs**.
* **As a supervisor** they read everything about their team's leads and may
  write only four columns.

| | coordinator | manager |
|---|---|---|
| own leads/targets | none | yes |
| edits team lead details | freely | **stage / follow-up / order value / owner only** |
| stage direction | any | **forward only**, like an exec |
| entry on behalf | yes | **never** — logs only their own work |
| edits an exec's activities | yes (unlocked ones) | never (SELECT only) |
| loss reasons | cannot see | can, for their team |
| reassign | within their team | **any active exec, plus onto themselves** |

* **`is_my_managed_member()` is a SECOND helper, not a widened
  `is_my_team_member()`.** ~13 live coordinator policies route through the
  latter; teaching it a second reporting line would change all of them at
  once, and a mistake there is a silent cross-team leak on a role already in
  production.
* **`enforce_manager_lock()` and the leads UPDATE policy are a PAIR.** RLS
  restricts rows, never columns, so the policy hands the manager the whole
  team row and the trigger draws the line inside it. Removing either half
  silently guts the other. `owner_employee_id` is in the allowed list only
  because reassignment was explicitly asked for; its BOUNDS come from the
  policy's `WITH CHECK`, not the trigger.
* **Deactivating or demoting a manager who still has reports is HARD
  BLOCKED** — stricter than the coordinator rule, which blocks only the role
  change. Called out deliberately rather than quietly widened to both.
* **`fetchActiveSalesExecs()` filters on `CARRIES_OWN_LEADS`, not the literal
  `'sales_executive'`.** Managers work their own pipeline, so excluding them
  left their work invisible to every owner-facing report. Safe for the two
  team-scoped wrappers: a manager has neither a `coordinator_id` nor a
  `manager_id`, so `fetchMyTeamExecs`/`fetchMyManagedExecs` still return
  executives only — which is what keeps "a manager's team is their execs, not
  themselves" true.
* **`.vip-role-tag`** badges a manager `MGR` in the owner's Day Review table
  and heatmap — they're ranked among the execs, so without it their row is
  indistinguishable from a rep's.
* **Known gap:** the two real managers own no leads until their Excel import
  lands, so the populated "My day" half is only verified through a test
  account.

### Data isolation — audited, don't re-litigate

A full audit traced "a sales exec only sees their own data and only changes
their own leads" against `rls_policies.sql` and every call site. **Verified
clean:** all writes are backed by real RLS `WITH CHECK` clauses, so a UI gate
bypass fails server-side and UI gates are convenience, not the boundary;
`/team`, `/employees/:id`'s role check and the owner-only Dashboard cards all
hard-block rather than CSS-hide; Home, Needs Attention, Search's "Worked
with", Closure forecast and Targets vs. actuals read only RLS-scoped tables.

What it found, all since fixed:

* **`stage_history` SELECT was open to every active employee.** The
  *displayed* numbers were never wrong — each consumer drops rows whose
  embedded `leads(...)` came back null — but the raw network response carried
  other reps' rows. Scoped at the RLS layer; the client-side null-embed
  filters are deliberately kept as belt-and-braces.
* **`EmployeeProfile` fired its fetches before the role redirect** (see that
  section).
* **`employees` SELECT is open to any active employee** (name, mobile, email,
  role) — a documented, deliberate exception needed for name lookups,
  `EmployeeLink` and the "Accompanied by" dropdown. Left as-is, but
  `fetchEmployeeProfile` stopped selecting `mobile`, which it never rendered.
* **Drill-down panels were labelled "Company" for everyone.** Every
  `build*Panel` now takes a `scopeLabel` defaulting to `'Company'`, and
  `Dashboard.jsx` passes the viewer's own name for a non-owner. Note
  `buildAgeingPanel`'s fourth arg, `queueActions`: Dashboard passes `false`
  explicitly, because that flag used to be *derived* from
  `scopeLabel !== 'Company'` and would otherwise have switched Needs
  Attention's rows into Today's swipe queue as a side effect of the label.

### PWA installability

Icons were generated from the source PDF. **The PDF's artwork had rounded
corners baked in, which is wrong for a maskable icon** (Android expects a
flat full-bleed square and applies its own mask), so the mark was extracted
pixel-precise and recomposited onto a plain square with no pre-rounding. The
regeneration script was a one-off and isn't in the repo.

**`src/sw.js` must call `skipWaiting()` and `clients.claim()` itself — do not
remove them.** `registerType: 'autoUpdate'` only injects those under the
default `generateSW` strategy; this project uses `injectManifest`, so the
config read as "auto update" while the built worker contained neither call. A
worker without `skipWaiting()` sits in **waiting** until every client for the
scope closes — a tab closes routinely, but **an installed PWA is backgrounded
rather than closed**, so it kept serving the old shell indefinitely. That was
the "the app and the website look different on mobile" production bug.
`cleanupOutdatedCaches()` went in alongside, or every deploy leaves another
full shell copy in storage forever.

**There are no `display-mode: standalone` rules anywhere in the stylesheet**,
so standalone and browser render identically apart from
`env(safe-area-inset-*)` resolving to real values. **If the two ever look
different again, suspect a stale worker before suspecting CSS.**

**The app-shell precache was removed.** `src/sw.js` caches nothing; it is a
few hundred bytes of push handlers plus a deliberate no-op `fetch` listener
that exists only to keep the app installable. **Don't reintroduce precaching
to "make it work offline" without also building offline data storage** —
there was never a `runtimeCaching` rule for Supabase, so the app was never
usable offline anyway (a rep with no signal got a shell and no data), and
`vercel.json` already serves `/assets/*` as `immutable`. The shell alone was
never the missing piece, and it costs the staleness trap below.

**`devOptions.enabled` is off deliberately.** It was tried and reverted —
workbox's dev-mode precache went stale on every source edit. **Test real
PWA/offline behaviour via `npm run build && npm run preview`, never
`npm run dev`**, where no service worker registers at all.

* `InstallPrompt.jsx` — Chrome/Android captures `beforeinstallprompt` and
  replays it; iOS Safari (UA-sniffed, excluding `CriOS`/`FxiOS`/`EdgiOS`, with
  a `MacIntel && maxTouchPoints > 1` fallback for iPadOS) shows a "tap Share,
  then Add to Home Screen" hint, since the event never fires there. Both
  dismiss flags are **`localStorage`, not `sessionStorage`** — session storage
  reset on every fresh app open, which on an installed PWA is constantly, so
  the banner kept reappearing. The flag is set when the banner is *shown*, not
  only on an explicit dismiss. `NotificationPrompt.jsx` follows the identical
  pattern. The whole component renders nothing when already standalone.
* `OfflineIndicator.jsx` — a sticky banner off `window`'s online/offline
  events. Deliberately no background sync or auto-retry, and no handling for
  iOS's more aggressive cache-clearing on inactive PWAs — both real, both out
  of scope.
* Both mount globally in `App.jsx`, outside `ProtectedRoute`, so they show on
  `/login` too.

### Auto-update (`src/lib/appUpdate.js`, `UpdateBanner.jsx`)

The app takes new builds by itself. **Nobody should ever be told to clear a
cache again — if that advice becomes necessary, something here has broken, so
fix it rather than reviving the instruction.**

**Detection compares hashed asset filenames.** It fetches the app's own HTML
with `cache: 'no-cache'` and compares the `/assets/…` names in it against the
ones this page actually loaded, read off the DOM at startup. Vite renames
those on any build whose output differs, so a mismatch IS a deploy. `<link>`
is read as well as `<script>`, so a CSS-only deploy is caught.

It originally listened for the service worker's `controllerchange`, which was
correct while `sw.js` carried a precache manifest that changed every build.
**Once the precache was removed, `sw.js` became byte-identical between
deploys, so that event would never have fired again** — the auto-update would
have silently stopped with nothing failing loudly to say so. Worth
remembering as a shape: removing the precache quietly invalidated a mechanism
in a different file that depended on it changing.

**`isNewBuild()` returns false whenever either side is empty**, and that guard
is the important half: a dropped connection, a captive portal, an error page
or an unreadable DOM must never be mistaken for a deploy. Missing a check
delays the update by minutes; a false positive reloads a working page,
possibly on a loop.

**Checks are event-driven first, timer second, for cost reasons.** On
regaining focus, on `visibilitychange`, and on `online` (which forces past the
20s throttle), plus a **5-minute** backstop that **does not run while the tab
is hidden**. Reps pocket and re-open their phones constantly, so the focus
check fires at exactly the moments that matter. Polling at 60s would be ~95k
edge requests/month across nine people for almost no benefit.
`UPDATE_POLL_MS` is the one constant to retune.

**`decideReload()` is the whole design** — a pure function returning
`{reload, reason}`. **The order is load-bearing**, so the reason reported is
the real one:

1. **`page-hidden`** — never reload a hidden document. See below.
2. **`auth-refresh-pending`** — the stored access token has already expired,
   so a fresh load would have no choice but to rotate immediately. Reads
   `storedAccessTokenExpired()`, which **fails open** on anything unreadable:
   a wrong `true` would hold every future update back forever, which is worse
   than the bug.
3. **`save-in-flight`** — a write is on the wire, via `pendingWriteCount()`.
   This is the one case that can cost *committed* data: for a POST, cancelling
   leaves it genuinely unknowable whether the row landed. Counted around the
   **whole retry loop**, not per attempt, or a write sleeping out its backoff
   would leave a gap. Reads aren't counted — a cancelled GET costs nothing.
4. **`field-focused`** — the cursor is in a field **and `document.hasFocus()`**.
   That second half matters: a field left focused on a window the rep walked
   away from must not hold an update back forever.
5. **`recent-typing`** — a part-filled form typed into within
   `TYPING_IDLE_MS` (3 min). **Both halves are required**: content with no
   recent typing is an abandoned form, recent typing with nothing on screen
   was a search box. Either alone means never updating.
6. **`cooldown`** — an auto-reload already happened within 30s. A stale build
   is bad; a page that reloads forever is unusable.

Otherwise it reloads silently. **`type="search"` inputs are excluded from the
dirty-form test** — a filter left with text in it is very common here, and
blocking on one would mean an employee who types a filter once never updates.

**⚠️ THE HIDDEN-PAGE RELOAD SIGNED PEOPLE OUT. Do not reintroduce it.** This
module originally applied a pending update on `visibilitychange` → hidden,
reasoning that nobody is looking so a reload costs nothing. **The moment
nobody is watching is the moment nothing is guaranteed to finish.** A pocketed
phone freezes the page seconds after it goes hidden; a reload issued into that
window starts a load that immediately asks auth-js to rotate an expired
refresh token, the rotation reaches Supabase but the response is never
persisted, and **refresh tokens are single-use** — so the stored one is now
consumed and the next open gets "Invalid Refresh Token: Already Used", which
auth-js treats as non-retryable and answers with `_removeSession()`. Result:
the login screen after every deploy.

Three things generalise from that:

* **The `pendingWrites` guard could not have caught it.** It is a real guard —
  auth requests do go through `supabaseFetch` — but the dangerous request
  belonged to the **next** page load. A guard that inspects the current page
  cannot see a hazard you are about to create in the following one.
* **Nothing in this app's own code ever signed anyone out**, and confirming
  that was most of the diagnosis. When the app is provably not doing it, read
  the auth library's own teardown conditions rather than adding defensive code.
* **Nothing is lost by waiting** — the update applies on the next
  `visibilitychange` → visible, i.e. the instant the rep opens the app.

**`UpdateBanner.jsx` is the held-back case only**, and most people never see
it: it appears solely when `decideReload` says no, re-tests every 10s, and
carries an "Update now" button. Theme section 26 anchors it above
`--vip-bottom-nav-h`, which clears the tab bar on a tab route and lands flush
above `.vip-sticky-footer`'s Save button on a drilled route.

**Not verified: a real phone.** The installed-PWA and iOS-Safari paths are
reasoned through, not observed.

## Conventions

### Secrets

Supabase URL/keys and every other secret go in a git-ignored `.env`.
`.env.example` documents the variable names with placeholders. **This repo is
public** — credentials must never reach a tracked file. Test-account logins
live in `.claude/test-logins.local.md` (git-ignored).

### Schema changes

**The anon key this app runs on cannot execute DDL.** Every schema change has
to be handed to the user as SQL to run in the Supabase SQL Editor. Deploying
or configuring anything that needs the user's own credentials — the initial
`supabase login`, Vercel env vars, Edge Function secrets — is likewise theirs
to do. Once `supabase login`/`link` have been run locally, subsequent
`supabase functions deploy` calls work fine from a normal shell.

**Verify against the live database, not against this file.** A `Schema/` file
existing does not mean it ran, and prose here describing live state has gone
stale more than once. Probing a column costs one request;
`phase9_verify_state.sql` (repo root) is a ready-made read-only introspection
query covering every policy, trigger, helper function, grant and CHECK the app
depends on. Prefer it over trusting a sentence.

**⚠️ RLS migration order is load-bearing, and later files silently revert
earlier ones.** Several migrations `CREATE OR REPLACE` the same policies,
triggers and functions, so re-running an older one undoes a newer one's work
with no error. The layered order is:

1. `rls_policies.sql`
2. `migration_backlog_2026_08_10.sql`
3. `migration_sales_coordinator.sql` → `migration_coordinator_entry.sql`
4. `migration_lead_edit_rights.sql`
5. `migration_sales_manager.sql`
6. `migration_rls_performance_*.sql`
7. `migration_manager_reassign_any_employee.sql`,
   `migration_architects_universal_visibility.sql`

**If you re-run anything, re-run everything after it too.** Trigger and
function names are deliberately kept even when historically inaccurate
(`enforce_owner_only_stage_change` no longer means owner-only) — renaming
would let an older file's re-run install a *second*, stricter trigger
alongside the current one instead of cleanly overwriting it.

Two further ordering traps, both hit for real:

* **A `LANGUAGE sql` function's body is validated at CREATE time**, so
  defining one before a column it references exists fails the whole file.
  Prefer reordering over switching to plpgsql, whose late binding hides the
  problem until runtime.
* **The owner-only-stage trigger fires even for roles that bypass RLS**
  (triggers aren't part of RLS), and the SQL Editor has no `auth.uid()`, so
  bulk data `UPDATE`s must land **before** it is installed. The function
  carries an `auth.uid() IS NOT NULL` guard so admin SQL keeps working, but
  sequence the steps anyway.

**When a migration retires a value the running build still writes, split it
in two around the deploy** — PART A leaves all values legal, then deploy, then
PART B removes the old one. The breakage window is symmetric: migrate fully
first and the live old build writes an outlawed value; deploy first and the
new build writes a value the CHECK doesn't allow yet.

**A migration that adds a column the new code SELECTs must run BEFORE the
deploy, not after** — the usual "code can go out ahead of the migration and
just have one feature not work yet" pattern does not apply. Selecting a column
that doesn't exist fails the **whole query**, not just the part that wanted
it, so one missing column takes out an entire screen for every role. The write
side is usually safe, since a payload key can be added conditionally; it's the
reads that have no such guard.

**Two-sided changes.** A closed list enforced in both SQL and JS needs both
halves changed together, or the app offers an option that fails to save:
`leads.office_territory` ↔ `territoryOptions.js`, `sites.site_stage` ↔
`siteStageOptions.js` (pinned by `siteStageClosedList.test.js`),
`activities.meeting_location` ↔ `meetingLocationOptions.js`. Adding an
activity type needs **two** CHECKs widened — `activities.activity_type` *and*
`follow_ups.activity_type`, since `FollowUpForm`'s chip picker reads the same
list and would otherwise offer a chip that fails to save on any reminder.

**`Schema/DESTRUCTIVE_reset_all_data.sql` is not a migration** — never include
it in a run-everything list. It deliberately does not touch `auth.users`, so
it leaves orphaned Auth logins to clean up by hand; scripting that risks
removing your own login.

### Outstanding migrations

* **`migration_manager_reassign_any_employee.sql`** — lets a manager reassign
  a lead they can already reach to **any** active exec, not just their own
  team. **Deliberately narrow — no visibility change**: only the `WITH CHECK`
  widens; `USING` is untouched. A version that also made `leads` SELECT
  unconditional for managers was drafted and **explicitly rejected**, since it
  would have made All Leads and Search go company-wide for them.
  Its `WITH CHECK` role guard is load-bearing, not decorative: WITH CHECK
  clauses are OR'd across every applicable policy regardless of which one's
  USING matched, so an unconditional `true` would hand every other role the
  same unrestricted right.
* **`migration_architects_universal_visibility.sql`** — makes
  `party_type IN ('architect','firm')` visible to every active employee
  regardless of team, since an architect is shared infrastructure and
  team-scoping meant reps just created duplicates. **Edit rights deliberately
  do not widen**: the creator-or-owner rule is unchanged and the coordinator's
  team-fallback edit policy is *narrowed* to exclude architect/firm rows.
* **The trigger half of
  `migration_retire_measurements_design_discussion.sql`** — the data half is
  confirmed, but whether `enforce_owner_only_stage_change()` was redeployed
  with the 6-stage funnel array cannot be seen through PostgREST. Until
  checked, **don't assume the forward-only rule matches `FUNNEL_SEQUENCE`.**

**Verify each as a real logged-in session of the affected role — never from
the SQL Editor**, which runs as `postgres` with BYPASSRLS and no `auth.uid()`,
so every policy evaluates the same whether or not the change worked.

### Row Level Security

Full policies in `Schema/rls_policies.sql`. Every policy routes through one
of two `SECURITY DEFINER` helpers, `current_employee_id()` /
`current_employee_role()`, **both filtered to `is_active = true` and both
resolving to `NULL` for a deactivated employee**. That is what makes
deactivating someone actually revoke their database access rather than only
hiding the UI.

* `activities`/`leads`/`plans`/`targets`/`follow_ups` — "own data or owner
  role" for SELECT/INSERT/UPDATE, plus **owner-only DELETE with no own-data
  exception**: a rep can create and edit their own rows but not delete even
  those.
* `employees` — SELECT for any active employee (deliberate, see Data
  isolation); INSERT/UPDATE/DELETE owner-only with **no self-update
  exception**, so a sales exec can never set their own role to `owner`.
* `sites`/`parties` — SELECT team-scoped; UPDATE "own data or owner role"
  (`discovered_by`/`created_by`); DELETE owner-only.
* `areas`/`site_contacts`/`products` — SELECT/INSERT for any active employee,
  UPDATE/DELETE owner-only (shared master data, no per-row "own" concept).
* `stage_history`/`lead_owner_history`/`loss_reasons`/`lead_change_log` —
  **append-only forever**, no UPDATE or DELETE for anyone including the owner.
  `loss_reasons` SELECT is **owner-only**, which is what makes "Why we lose"
  a hard constraint rather than a UI nicety.
* `push_subscriptions`/`employee_preferences`/`notifications` — own-row, with
  **no owner-role exception on write** (a subscription is tied to one browser;
  an owner has no legitimate reason to set someone else's theme).
  `notifications` additionally has **no INSERT policy for anyone**.

**A write needs both the table GRANT and the policy to agree.**

Four traps worth knowing:

* **An INSERT that asks for the row back is subject to the SELECT policy
  too.** Postgres applies it to `INSERT ... RETURNING`, and supabase-js emits
  that for `.insert().select()`. So on a table whose SELECT is narrower than
  its INSERT, adding a `.select()` breaks the write for everyone the SELECT
  excludes.
* **An RLS-rejected UPDATE with no `.select()` fails SILENTLY.** RLS filters
  an UPDATE's target rows the way it would a SELECT, so a rejected row simply
  isn't matched — a 0-row no-op, not an error any `warnings.push()` can
  catch. This shipped: a coordinator set a site stage, got a clean success
  message, and nothing was written. **Always `.select()` an UPDATE whose
  rejection would matter.** The same shape makes a cross-team mass UPDATE
  report success while touching 0 rows.
* **`service_role` does NOT automatically get access to a new table** on this
  project — new entities are not auto-exposed, matching the current cloud
  default. Any table an Edge Function touches needs an explicit
  `GRANT ... TO service_role`, or it fails with a plain "permission denied".
  The split is by creation date, not table kind: tables from the original
  schema file predate the change and still have full DML.
* **Every new table arrives broadly writable and must be `REVOKE`d
  explicitly.** `rls_policies.sql`'s `ALTER DEFAULT PRIVILEGES` grants
  SELECT/INSERT/UPDATE/DELETE, and Supabase's own baseline adds
  TRUNCATE/REFERENCES/TRIGGER. So the append-only tables are protected by
  **one layer, not two**: `authenticated` holds UPDATE on `stage_history`,
  DELETE on `lead_owner_history` and TRUNCATE on `lead_change_log`. Not
  exploitable today (no matching policy exists, and PostgREST exposes no
  TRUNCATE verb), but one careless permissive policy makes the grant live.

**RLS performance: hoist helper calls into `(select ...)` form and guard each
team predicate behind a cheap role test.** An exec's queries were slow in
proportion to the rows they **cannot** see, not the rows they can: Postgres
short-circuits an OR, so a rep's own row matches the first cheap test, but
every row belonging to someone else evaluates every branch — including two
`SECURITY DEFINER` helpers that each query `employees` **per row** and can
never be inlined away. Writing
`(select current_employee_role()) = 'sales_coordinator' AND (select is_my_team_member(...))`
folds the whole branch to a constant `false` for an exec. Safe because both
helpers already require the matching role internally, so the guard is a no-op
on the truth table and a pure win on execution. **A "wrap every policy on
table X" migration needs a grep across every file that has EVER touched X's
policies** — a coordinator-entry feature quietly added UPDATE policies to two
tables a performance pass had no reason to expect.

### Dates and timestamps

Two separate bugs, two separate rules. Both have shipped.

**1. Naive `TIMESTAMP` columns — parse with `parseTimestamp`.** Most timestamp
columns in this schema are `TIMESTAMP` *without* time zone, filled from
`now()` on a UTC database, so they hold a UTC wall clock with nothing marking
it as such; PostgREST serialises that as `"2026-08-09T09:49:01"`. Handing
that to `new Date()` parses it as **local** time (the spec's rule for an
offset-less date-time), so every such timestamp rendered **5½ hours early** in
IST. **`src/lib/dbTime.js`'s `parseTimestamp` is the one correct way** — it
appends the missing `Z` and passes a zone-carrying string through untouched,
so it's safe on any timestamp column. **Still unfixed, deliberately:** the
many places that only *compare* or sort naive timestamps, where a uniform
offset mostly cancels out. A period boundary can still misclassify an event
inside a 5½-hour window; that wants its own audit, not a scattergun edit.

**2. `DATE` columns — compare as a calendar string, never against an
instant.** `next_followup_date`, `estimated_close_date`, `due_date`,
`quote_sent_at`, `rfq_raised_at` and `lost_at` are `DATE`, and
`new Date('2026-08-13')` parses to **UTC midnight = 05:30 IST** — so
`new Date(col).getTime() < Date.now()` says a date of *today* is already past,
from 05:30 IST until midnight. That shipped: a follow-up due today was
reported overdue for ~18½ hours of every day. Compare `col < todayISO()` —
both are `YYYY-MM-DD`, so string order is date order. Appending the time
(`` `${date}T00:00:00` ``) is the other correct pattern, forcing local parsing.

**"Today" as a date string comes from `followupDates.js`'s `todayISO()`** —
see the Follow-ups section.

### Querying Supabase

**Every query that can return more than one row goes through
`fetchAllRows()`.** Full stop — not a per-table judgement about whether
today's row count makes it safe, since wrapping an 8-row table costs exactly
one request, identical to not wrapping it.

**A query with no `.limit()` does NOT mean "all rows".** PostgREST caps every
response at `max-rows` (1,000 here) whether or not a limit was asked for, and
nothing in the response says so: no error, no flag, just a shorter array.
This shipped as a reported bug once `leads` passed 1,000 rows — **₹3.16 Cr of
open pipeline missing, 14%**, across Dashboard, every Today screen, My Team,
EmployeeProfile, Needs Attention, the funnel and every drill-down.

**The failure mode is what makes it worth remembering.** Those queries had no
`ORDER BY` either, so Postgres returned heap order — and an UPDATE writes a
new tuple version at the **end** of the heap. So *editing* a lead moved it
past the cap: the act of curating a record is what hid it.

`fetchAllRows` does both halves, and both are required: it pages until the
rows run out, **and** appends a deterministic `id` order, because `.range()`
paging with no `ORDER BY` gives no guarantee two OFFSET queries walk the same
order — pages can silently repeat or skip rows. Two things to get right:

* **Pass `{ count: 'exact' }`** in the `.select()`. Paging then costs exactly
  `ceil(total / cap)` requests instead of one extra round trip. Forgetting it
  is slow, never wrong.
* **Pass `{ ascending: false }`** whenever the caller's own sort is descending
  **and** a consumer reduces with "first row per key wins"
  (`mostRecentLeadByParty`, `computeOrderValueActuals`, `fetchPriorStages`).
  An ascending tiebreaker hands those the *oldest* of a set of rows sharing a
  timestamp — and the legacy imports wrote whole sheets inside one
  transaction, so shared timestamps are the norm here, not an edge case.

Two guards back this up: `queryPaging.test.js` statically scans every file for
an unwrapped multi-row `.from()` chain, and `supabaseFetch.js` carries a
dev-only runtime check that warns by name the moment PostgREST's cap silently
truncates an unbounded GET.

**`ROW-COUNTS.md` (repo root) tracks which tables have passed the cap.** Five
already have — `stage_history`, `parties`, `lead_change_log`, `sites` and
`leads` — with `activities` next.

**⚠️ `speculativePages` was removed from every call site and should not come
back without a role-aware reason.** It fetched page 2 alongside page 1 for
tables known to exceed one page — but **"this table exceeds one page" is an
OWNER-SCOPE fact**, and RLS is what each viewer actually queries. A sales exec
sees a few dozen leads, so the speculative page was always out of range for
every non-owner role. **A `.range()` past the end of a result set is an ERROR
from PostgREST, not an empty page** (416 / `PGRST103` when an exact count was
requested), which `fetchAllRows` propagated as a failure of the whole query —
so Dashboard, Today, My Team, EmployeeProfile and the funnel rendered every
figure as zero for every non-owner. Activity counts and All Leads still showed
real numbers, because neither set the flag; **that split is the fingerprint of
this bug.**

`fetchAllRows` now **discards a speculative page once page 0's count proves it
was never needed**, whatever came back. That is deliberately **not** an
error-code test: the out-of-range page on `leads` returned 416, but on
`stage_history` it returned **`57014` statement timeout**, because PostgREST
must compute the exact count before it can call a range unsatisfiable. The
same missed guess surfaces as two different errors depending on the table.
Asking "did we need this page?" is right for every table and every future
failure mode. Page 0 is never covered by either rule, so a genuine first-page
failure still surfaces.

**Generalise both**: a perf change gated on row counts **must be verified as
the role with the FEWEST rows**, not the most — verifying as the owner
verifies the one case guaranteed to work. And **when a test helper models a
server, the model is load-bearing**: `fakeTable` modelled an out-of-range page
as an empty array, so two tests literally named "is harmless when the table
turns out to fit in one page" passed while the real thing was catastrophic.

**PostgREST embeds.**

* **Embedding `parties` from `leads` needs an explicit FK hint**
  (`parties!party_id(...)`) — `leads` has three FKs to `parties`, so a bare
  embed fails with "more than one relationship was found".
* **A self-referencing FK cannot be embedded by column hint at all** — see the
  architect → firm tree in the ActivityLog section.
* **Filtering on a plain embed silently does nothing** — it keeps the parent
  row and nulls the embed. Use `!inner`, and only while the facet is active
  (see All Leads' Site stage filter).
* **DDL alone isn't enough for a new relationship** — PostgREST caches the
  schema, so a migration adding one must end with
  `NOTIFY pgrst, 'reload schema'`.

### Transport, caching and retries

**Every Supabase request goes through `src/lib/supabaseFetch.js`** (wired via
`createClient`'s `global.fetch`), a retry + timeout wrapper.

It exists because of a real bug: on an **installed iPhone PWA**, saving sat
for seconds and then failed with "Load Failed", while pressing Save again
saved instantly every time; desktop was flawless on the same wifi. iOS reaps
idle HTTPS connections, and a request sent on a torn-down connection rejects
at the network layer — WebKit's wording for that is exactly
`TypeError: Load failed`. **Only saves failed because of a rule inside
postgrest-js**: it retries idempotent methods and deliberately re-throws
immediately for everything else, so the identical drop was merely *slow* on a
page load and *fatal* on a Save. Desktop browsers retry a dead keep-alive
internally; iOS surfaces it.

The rules, and don't loosen them casually:

* Idempotent methods (GET/HEAD/OPTIONS/PUT/PATCH/DELETE) retry up to 3
  attempts on either a network rejection or the 20s timeout.
* **POST retries once on a network rejection and NEVER on a timeout.** A
  rejection means the request was never delivered (which is why the rep's own
  second tap never produced a duplicate); a timeout leaves genuinely open
  whether the server already ran it, and guessing wrong writes a row nobody
  asked for.
* A caller's own abort is never retried, and an HTTP 4xx/5xx passes straight
  through — that's the server answering, not a dropped connection.

**`errorMessage.js`** turns a surviving network failure into "Couldn't reach
the server. Check your connection and try again." It deliberately does **not**
claim "nothing was saved", since for an un-retried timed-out POST that isn't
knowable.

**`src/lib/queryCache.js`** gives the heavy company-wide reads in-flight
de-duplication and a 90s cache, wrapped **inside the query modules** so no
call site changed. Identical concurrent requests collapse into one, which also
kills React StrictMode's dev double-fetch.

* **A cache key MUST encode every argument that changes the result.**
* **Errors are never cached** — a dropped connection must not be replayed for
  90s.
* **Invalidation happens ONCE, at the transport layer**: `supabaseFetch` drops
  the cache after any successful non-GET (excluding `/rpc/`, a read here).
  Deliberately not per call site, for the same reason `lead_change_log` is
  trigger-written — `leads` alone is written from eight paths, and "remember
  to invalidate" fails the first time someone adds a ninth.
* **`signOut` clears the cache before ending the session**, since these are
  shared office machines and the payloads are whole-company aggregates.
* **If this outgrows the module, adopt TanStack Query rather than growing
  it** — the API deliberately mirrors its vocabulary so the swap is
  mechanical.

**📄 `PERFORMANCE.md` (repo root) is the standing reference** — read it before
adding a screen, card or query. The measured diagnosis was that "everything is
slow" came from **32 concurrent requests starving each other, not slow
queries** (the same `leads` fetch measured 868ms alone and 5,143ms during a
real page load). Its two most important rules: **never download rows just to
reduce them in the browser**, and **`fetchAllRows()` is a transitional escape
hatch, not the goal** — it is O(table size) and every new use should be
questioned rather than copied.

**Server-side aggregation.** `leads_category_breakdown()` and
`leads_needing_attention()` do the counting in Postgres instead of shipping
every lead to the browser. Both are **`SECURITY INVOKER`** — Postgres's
default, stated explicitly, and the load-bearing property: as `SECURITY
DEFINER` a sales exec calling one would see the whole company. Consumers
**fail soft**, falling back to the exact client-side computation, so a missing
RPC degrades rather than breaks.

For the attention RPC, **SQL owns the PREDICATES and JS owns the
PRESENTATION** — it decides only bucket membership, and `attention.js` still
builds every row and label through the shared `assembleBuckets`, so the card
and its drill-down cannot drift. Two bugs it caught that a count-only check
would have missed: `NULL LIKE 'legacy-%'` is NULL rather than false, which
silently dropped **every app-created lead** from two buckets (hence the
`COALESCE(..., false)`, which must not be removed); and buckets sort by age
with a *stable* sort, so equal-age leads keep insertion order — without an
explicit `ORDER BY id` the two paths agreed on *which* leads were stale while
disagreeing on their order.

**A `sales_manager` viewing their own "Team" scope deliberately never uses the
fast path** — the RPC's RLS-scoped result can't replicate that role's
client-side My/Team toggle. Every other role has no such toggle, so plain RLS
scoping is already correct.

### Cleaning up test data

**Clean up your own test rows at the end of a live trial** — the owner asked
for this explicitly, so they don't have to run SQL by hand. An exec or
coordinator session has **no DELETE grant**, so the delete must run from an
**owner** session. With an owner logged in on a role port,
`const { supabase } = await import('/src/lib/supabaseClient.js')` reuses the
real authenticated client, then `.delete().in('id', […]).select('id')` and
re-select to confirm.

**Delete only rows the current session actually created** — read the table
back first and match on id/`created_at`/the distinctive text you typed. Rows
from earlier sessions or the owner's own testing are not yours to remove;
list them for the owner instead. **Prefer trials that write a new row over
ones that mutate an existing lead** — a modified `next_followup_date`,
`order_value` or `site_stage` has no undo.

### Libraries

**No GPS, geocoding, drag-and-drop or icon libraries** — all deliberate.
`NavIcons.jsx` hand-authors inline SVG; extend that file rather than adding a
package. Everything else icon-shaped stays plain text/CSS.

## Commands

- `npm run dev` — dev server (default port 5173)
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — Oxlint
- `npm test` — Vitest

## Local environment notes

`.claude/launch.json` and `.claude/dev-server.cmd` let the preview tooling
start the dev server even if Node isn't on PATH in a fresh shell
(`export PATH="/c/Program Files/nodejs:$PATH"` fixes that manually).
`.claude/preview-server.cmd` is a second config (`tostem-crm-preview`, port
4173) running `npm run build && npm run preview` — **use that one, not the
dev server, for any PWA / service-worker / offline testing.**

**Claude cannot type a password into the login form.** Entering credentials
into any field is off-limits, so storing them changes nothing. The working
flow is that **the user logs in once per origin** and Claude drives the
already-authenticated app; sessions persist per origin, which is what the
three role ports are for. **When nothing is logged in, say so and ask** —
don't assume a fresh tab means a fresh session, and don't silently fall back
to reasoning-only verification.

**The preview's Supabase session is shared across every tab on an origin**,
including tabs a human tester opened. A login for one manual test silently
carries over into a later "unauthenticated" check, producing false-positive
real writes. Confirm which state a tab is actually in (expect
`permission denied` from an intentionally logged-out check, or check which
employee name renders) rather than assuming.

**The documented fallback when a login genuinely isn't available** is a
throwaway Vite harness mounting the real component with
`supabaseClient`/`AuthContext` aliased to stubs. It proves render, ordering
and gating — never a real write under RLS.

## Open TODOs

Deliberately deferred, not forgotten. Full detail in `PHASE9_LOG.md`.

1. **Append-only tables are protected by one layer, not two** — see the RLS
   grants bullet in Conventions. Not exploitable today; wants a small REVOKE
   migration before full rollout.
2. **No test covers the create-flow submit handlers.** New Lead and Log
   Activity are verified to render and populate for every role, and the writes
   behind them are proven, but submitting was deliberately not exercised —
   it would add rows that couldn't be cleanly reversed. Untested: field
   validation, the `lead_needs_an_anchor` CHECK surfacing as a UI error, the
   post-submit reset, and `ActivityLog`'s side-effect warning path.
3. **Deferred verification:** push notifications end to end (needs a real
   device), real-device iOS/Android rendering, and installed-PWA (standalone)
   rendering.
4. **The mobile quick-actions sheet on Lead Detail has never been opened by a
   real tap** — the sandbox's mouse input wedges at 375px. Both mounts spread
   one props object, so its contents follow from the desktop mount that was
   verified; that's an argument from construction, not an observation.

## Roadmap

0. ✅ Environment + scaffold
1. ✅ Supabase project, schema, RLS policies
2. ✅ Employee login (Supabase Auth), AuthContext, protected/role-based routing
3. ✅ Party/site/lead intake (search-before-create)
4. ✅ Activity logging (`/activity`)
5. ✅ Dashboards, employee management, Home hub, global search, reporting cards
6. ✅ PWA polish (installable). Out of scope: background sync / auto-retry of
   failed submissions, and iOS's cache-clearing on inactive PWAs.
7. ✅ Deploy + pilot. Follow-ups, the mobile redesign, the Day Review and the
   Today Briefing rebuild all shipped during this phase.
8. ✅ Sales Coordinator role (role 3 of 4), including entry-on-behalf and the
   team Today screen. Out of scope by decision: push notifications for red
   flags, company-wide comparison views for a coordinator, and de-duplicating
   parties/sites created across teams after the scoping change.
9. ✅ QA audit across all roles and both breakpoints — findings and the
   deferred items in `PHASE9_LOG.md`.
10. ⬅️ **current — Sales Manager role** (role 4 of 4). Schema, RLS and every
    screen shipped and were driven across all four roles at both widths.
    Still open: the two real managers own no leads until their Excel import
    lands, and the coordinator's "Reassign owner" dropdown still offers every
    active rep although the database refuses an out-of-team target.

For domain model, lead-sourcing logic, and locked-in design decisions, see
`DECISIONS.md`.
