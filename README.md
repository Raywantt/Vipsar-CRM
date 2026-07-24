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
                *Section components)
  pages/        top-level views (Login, OwnerDashboard, LeadQuickCapture,
                LeadDetail, ActivityLog, ...)
  contexts/     AuthContext — session + employee (id/name/role) lookup
  hooks/        custom React hooks
  lib/          integrations & utilities (supabaseClient.js, sanitizeForIlike.js,
                siteStageOptions.js)
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
