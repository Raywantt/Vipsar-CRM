# Tostem CRM

A CRM (Customer Relationship Management) app built for a Tostem window & door
dealership. It's meant to help the team track leads, quotes, orders, and
installs for window and door sales in one place, and to be installable as a
Progressive Web App (PWA) on desktop and mobile.

## Status

Phase 1 done: Supabase project created, schema applied, app connected
(`src/lib/supabaseClient.js`), Row Level Security policies defined in
`Schema/rls_policies.sql`.

Phase 2 done: email/password login via Supabase Auth, with protected/
role-based routing (owner vs. sales_executive). Employee accounts are
created manually in the Supabase dashboard — there's no self-signup screen.

Phase 3 done: party/site search-before-create, a quick-capture lead intake
screen (the sales_executive's landing page) that creates parties/sites/leads
from three optional fields plus a required source quick-select, and a lead
enrichment screen for filling in full site/party/sales-progress details
after the fact.

Phase 4 done: activity logging (DPR replacement) at `/activity` — Site
Visit/Call/RFQ Raised/Office Day/Booking Update, linked to an existing lead
and/or party, with side effects on the lead (RFQ raised, order value, next
follow-up date) where applicable.

Phase 5 done: dashboards (replacing the manually-tallied Weekly Update /
Monthly Prospects / Yearly Performance sheets). A single `/dashboard` page
for both roles, originally split into two tabs: **Reports** (activity
counts, new leads by source, a closure forecast, and targets vs. actuals
with an owner-only target-setting form, since `targets` had no other way to
get data into it) filterable by a This Week/This Month/Custom date range
(targets vs. actuals excepted, since targets are keyed by week/month, not
arbitrary ranges); and **My Leads**/**All Leads**, a browsable leads list
with an owner-only sales-exec filter. A third tab, Parties, was added in a
later round — see below.

Post-Phase-5 interface simplification pass: narrower party-type choices on
lead intake (added a `pmc` party type), fewer anchor fields per activity
type in Activity Log, a sales-exec-scoped source list, and the Dashboard
tabs/employee-filter changes above — a round of UX cleanup based on real
usage, not a new roadmap phase.

Dashboard expansion + owner tooling (second post-Phase-5 round): three more
Reports cards (leads by stage/area/site stage), a third Dashboard tab
(**Parties** — a directory of every party ever created, filterable by type,
each showing which sales exec(s) they've worked with), the lead's owner now
shown wherever a lead appears, `LeadDetail` now read-only in the UI for a
sales exec viewing a lead that isn't theirs (RLS already blocked the write —
this closes the matching UX gap), and a new owner-only **Settings** page
(`/settings`) to add/manage employees and delete a lead. Settings can't yet
create an Auth login by itself — that still needs a manual step in the
Supabase dashboard, since automating it safely needs server-side
infrastructure (a Supabase Edge Function) this project doesn't have yet.

## Stack

- **React + Vite** — frontend app and dev/build tooling
- **vite-plugin-pwa** — makes the app installable (manifest + service worker)
- **react-router-dom** — routing, protected routes, role-based redirects
- **Supabase** — backend (database, auth, storage) — connected
- **Vercel** — planned hosting

## Project structure

```
src/
  components/   reusable UI pieces (ProtectedRoute, AppNav, PartySearchOrCreate,
                SiteSearchOrCreate, LeadSearchSelect, the four LeadDetail
                *Section components, DateRangeSelector, ActivityCountsCard,
                LeadsBySourceCard, ClosureForecastCard, TargetsVsActualsCard,
                SetTargetForm, LeadsListCard, LeadsByCategoryCard, PartiesCard,
                AddEmployeeForm, ManageEmployeesSection, DeleteLeadSection)
  pages/        top-level views (Login, Dashboard, LeadQuickCapture,
                LeadDetail, ActivityLog, Settings, ...)
  contexts/     AuthContext — session + employee (id/name/role) lookup
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js, leadStageOptions.js, activityTypes.js,
                sourceTypeOptions.js, dateRanges.js, dashboardQueries.js,
                format.js, targetMetrics.js, targetPeriods.js, targetQueries.js,
                partyQueries.js, employeeQueries.js)
  assets/       images, icons, etc.
  App.jsx       root component + routes
  main.jsx      React entry point
```

## Getting started

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

Build for production:

```bash
npm run build
```

## Environment variables

Secrets (Supabase URL/anon key) live in a local `.env` file, which is
git-ignored and never committed. Copy `.env.example` to `.env` and fill in
your own project's values to run this locally.
