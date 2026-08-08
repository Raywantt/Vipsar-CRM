-- ============================================================
-- TOSTEM DEALERSHIP CRM — ROW LEVEL SECURITY (Phase 1)
-- Run this in the Supabase SQL Editor after tostem_crm_schema.sql
-- has already been applied and the connection has been confirmed.
--
-- Two separate layers are at play here, and both are required:
--   1. Table-level GRANTs — does the `authenticated` role have any
--      permission to touch this table at all? (Without this you get
--      a flat "permission denied for table X" / 42501, before RLS is
--      even consulted — this is exactly what blocked the smoke test.)
--   2. Row Level Security policies — of the rows the role could
--      touch, which specific rows can it actually see/change?
--
-- SAFE TO RE-RUN IN FULL: every CREATE POLICY below is preceded by a
-- matching DROP POLICY IF EXISTS, so running this whole file again
-- (e.g. to pick up the current_employee_id()/current_employee_role()
-- change below) replaces the live policies in place instead of
-- erroring on "policy already exists".
-- ============================================================


-- ------------------------------------------------------------
-- STEP A: BASELINE GRANTS
-- All real usage goes through a logged-in employee (Supabase Auth,
-- Phase 2) — there's no genuine anonymous-user flow in this app, so
-- everything is granted to `authenticated`, not `anon`.
--
-- SELECT/INSERT/UPDATE go to every table. DELETE is granted only on
-- employees, areas, sites, site_contacts, parties, products, leads,
-- activities, plans, and targets — the ten tables that actually have
-- an owner_only_delete policy (STEP C/D/E/F below); RLS still
-- restricts the grant to 'owner' rows in practice. stage_history and
-- loss_reasons get NO delete grant at all — they have no delete
-- policy either, so they're permanently non-deletable at both layers,
-- for everyone including owner, by design (STEP G).
--
-- The sequence GRANT is easy to miss and causes its own 42501: SERIAL
-- columns need USAGE on their backing sequence for INSERT to work.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT DELETE ON employees, areas, sites, site_contacts, parties, products, leads, activities, plans, targets TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- So the same grants automatically apply to any table added later.
-- (A future table would still need its own delete policy to actually
-- be deletable — this just avoids repeating the same manual GRANT
-- DELETE gap that caused today's 42501.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- NOTE: the temporary `GRANT SELECT ON public.employees TO anon;` run
-- earlier to smoke-test the connection can stay or go — once RLS is
-- enabled below, an unauthenticated (anon) request has no auth.uid(),
-- so every policy below evaluates to false/null for it regardless of
-- that grant. Revoke it whenever you want the tidy-up:
--   REVOKE SELECT ON public.employees FROM anon;


-- ------------------------------------------------------------
-- STEP A2: ACTIVE-EMPLOYEE HELPER FUNCTIONS
-- Every policy below that used to inline
-- `(SELECT id/role FROM employees WHERE auth_user_id = auth.uid())`
-- now calls one of these two functions instead. The reason this
-- exists: a deactivated employee (is_active = false) still has a
-- real employees row with a real id/role, so every one of those
-- ~40 repeated inline subqueries kept resolving normally regardless
-- — deactivating someone via Manage Employees never actually revoked
-- anything at the database layer, only the app's own newly-added
-- client-side ProtectedRoute check does that part. Centralizing the
-- lookup here means "deactivated" only has to be taught to the
-- database once, and every policy that resolves "who's calling"
-- (not just the "own data" ones — this also covers the previously
-- wide-open `USING (true)` reads like the party directory) goes
-- through it.
--
-- SECURITY DEFINER + a fixed search_path: these run as the function
-- owner (whoever runs this migration — normally the `postgres` role
-- in the Supabase SQL Editor, which has BYPASSRLS), not as the
-- calling `authenticated` role. That's required, not just an
-- optimization: without it, employees' own SELECT policy (STEP C,
-- now also gated through these functions) would recurse into itself
-- — deciding whether a row is visible would call current_employee_role(),
-- which queries employees, which is itself subject to employees'
-- SELECT policy, forever. A fixed search_path closes the standard
-- search-path-hijack hole on a SECURITY DEFINER function. STABLE
-- (not VOLATILE) lets Postgres reuse one result per statement instead
-- of re-querying per row. auth.uid() itself can't be spoofed by the
-- caller — it's derived server-side from the verified JWT, not a
-- client-supplied value — and neither function takes an argument, so
-- there's nothing for a caller to manipulate.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM employees WHERE auth_user_id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION current_employee_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM employees WHERE auth_user_id = auth.uid() AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION current_employee_role() TO authenticated;


-- ------------------------------------------------------------
-- STEP B: ENABLE RLS ON EVERY TABLE
-- IMPORTANT: enabling RLS with no matching policy = nobody (except
-- the service_role key, which bypasses RLS entirely) can read or
-- write that table — full lockout, not "open by default". Every
-- table below gets real policies in the steps that follow.
-- ------------------------------------------------------------
ALTER TABLE employees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_owner_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE loss_reasons   ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- STEP C: EMPLOYEES — SPECIAL CASE, READ CAREFULLY
-- SELECT is no longer unconditionally open (`USING (true)`) — it now
-- requires the caller to resolve to *some* active employee via
-- current_employee_role(), the same "must be an active employee at
-- all" gate every other table gets below. This doesn't filter which
-- rows come back (an active owner still sees every employee, active
-- or not — Manage Employees still needs that), only whether the
-- caller is allowed to query the table at all. INSERT/UPDATE/DELETE
-- stay owner-only, with no exception for a row matching your own
-- auth_user_id: employee records, including role changes, are
-- managed by an owner only.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_select" ON employees;
CREATE POLICY "authenticated_select" ON employees
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "owner_only_insert" ON employees;
CREATE POLICY "owner_only_insert" ON employees
  FOR INSERT WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_update" ON employees;
CREATE POLICY "owner_only_update" ON employees
  FOR UPDATE USING (
    current_employee_role() = 'owner'
  ) WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON employees;
CREATE POLICY "owner_only_delete" ON employees
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );


-- ------------------------------------------------------------
-- STEP D: "OWN DATA OR OWNER ROLE" POLICIES, OWNER-ONLY DELETE
-- Same shape on all four tables: a logged-in, active employee can
-- see/insert/update a row if it's theirs, OR if their role is
-- 'owner'. Only the "owning" column differs per table. DELETE is
-- narrower than that — owner only, no "own data" exception, same
-- owner_only_delete pattern used everywhere else in this file (a
-- sales exec can create/edit their own leads/activities/plans/
-- targets, but only an owner can remove one). A deactivated
-- employee's current_employee_id()/current_employee_role() both
-- resolve NULL, so every one of these predicates collapses to false
-- for them — "own data" no longer matches their own historical rows,
-- and "owner role" no longer matches even if their stored role is
-- still 'owner'.
--
-- `parties` deliberately does NOT live here despite having a
-- created_by column — it was originally grouped with this pattern,
-- but that breaks search-before-create across reps (Rep B can't see
-- a party Rep A already created, so duplicate-checking silently
-- fails). parties now lives in STEP E instead, as shared org-wide
-- data like areas/sites/site_contacts.
-- ------------------------------------------------------------

-- activities.employee_id — who logged the activity
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON activities;
CREATE POLICY "own_data_or_owner_role_select" ON activities
  FOR SELECT USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON activities;
CREATE POLICY "own_data_or_owner_role_insert" ON activities
  FOR INSERT WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON activities;
CREATE POLICY "own_data_or_owner_role_update" ON activities
  FOR UPDATE USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON activities;
CREATE POLICY "owner_only_delete" ON activities
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- leads.owner_employee_id — who's carrying the opportunity
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON leads;
CREATE POLICY "own_data_or_owner_role_select" ON leads
  FOR SELECT USING (
    owner_employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON leads;
CREATE POLICY "own_data_or_owner_role_insert" ON leads
  FOR INSERT WITH CHECK (
    owner_employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON leads;
CREATE POLICY "own_data_or_owner_role_update" ON leads
  FOR UPDATE USING (
    owner_employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    owner_employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON leads;
CREATE POLICY "owner_only_delete" ON leads
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- plans.employee_id — whose plan this is
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON plans;
CREATE POLICY "own_data_or_owner_role_select" ON plans
  FOR SELECT USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON plans;
CREATE POLICY "own_data_or_owner_role_insert" ON plans
  FOR INSERT WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON plans;
CREATE POLICY "own_data_or_owner_role_update" ON plans
  FOR UPDATE USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON plans;
CREATE POLICY "owner_only_delete" ON plans
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- targets.employee_id — whose target this is
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON targets;
CREATE POLICY "own_data_or_owner_role_select" ON targets
  FOR SELECT USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON targets;
CREATE POLICY "own_data_or_owner_role_insert" ON targets
  FOR INSERT WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON targets;
CREATE POLICY "own_data_or_owner_role_update" ON targets
  FOR UPDATE USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON targets;
CREATE POLICY "owner_only_delete" ON targets
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );


-- ------------------------------------------------------------
-- STEP E: AUTHENTICATED READ/WRITE, OWNER-RESTRICTED DELETE
-- areas, sites, site_contacts, parties: any *active* employee can
-- read and create rows (these fill in progressively as scanning/
-- intake happens — parties included, so search-before-create actually
-- finds rows other reps created). "Authenticated" here now means
-- "resolves to an active employee" (current_employee_role() IS NOT
-- NULL), not just "has a valid Supabase Auth session" — previously
-- these were `USING (true)`/`WITH CHECK (true)`, which is exactly how
-- a deactivated rep kept full read/write access to the whole party
-- directory even after being switched off in Manage Employees. DELETE
-- stays owner-only on all four. UPDATE differs per table: areas and
-- site_contacts stay owner-only (shared master data / append-style
-- join rows respectively), but sites and parties use "own data or
-- owner role" instead — the Lead enrichment screen needs a rep to
-- edit the site they discovered or the party they created, not just
-- an owner.
-- ------------------------------------------------------------

-- parties.created_by — who first added this person/firm
-- Drops old policy names from earlier revisions of this file — safe
-- to run even if they were never applied.
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON parties;
DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON parties;
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON parties;
DROP POLICY IF EXISTS "owner_only_update" ON parties;
DROP POLICY IF EXISTS "authenticated_select" ON parties;
DROP POLICY IF EXISTS "authenticated_insert" ON parties;
DROP POLICY IF EXISTS "owner_only_delete" ON parties;

CREATE POLICY "authenticated_select" ON parties
  FOR SELECT USING (current_employee_role() IS NOT NULL);

CREATE POLICY "authenticated_insert" ON parties
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

-- NOTE: created_by is nullable in the schema. A party row with a NULL
-- created_by is only editable by 'owner' — the equality check can
-- never match NULL.
CREATE POLICY "own_data_or_owner_role_update" ON parties
  FOR UPDATE USING (
    created_by = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    created_by = current_employee_id()
    OR current_employee_role() = 'owner'
  );

CREATE POLICY "owner_only_delete" ON parties
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- areas
DROP POLICY IF EXISTS "authenticated_select" ON areas;
CREATE POLICY "authenticated_select" ON areas
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_insert" ON areas;
CREATE POLICY "authenticated_insert" ON areas
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "owner_only_update" ON areas;
CREATE POLICY "owner_only_update" ON areas
  FOR UPDATE USING (
    current_employee_role() = 'owner'
  ) WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON areas;
CREATE POLICY "owner_only_delete" ON areas
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- sites.discovered_by — who found/logged this site
DROP POLICY IF EXISTS "owner_only_update" ON sites;
DROP POLICY IF EXISTS "authenticated_select" ON sites;
DROP POLICY IF EXISTS "authenticated_insert" ON sites;
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON sites;
DROP POLICY IF EXISTS "owner_only_delete" ON sites;

CREATE POLICY "authenticated_select" ON sites
  FOR SELECT USING (current_employee_role() IS NOT NULL);

CREATE POLICY "authenticated_insert" ON sites
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

-- NOTE: discovered_by is nullable in the schema. A site row with a
-- NULL discovered_by is only editable by 'owner' — the equality check
-- can never match NULL.
CREATE POLICY "own_data_or_owner_role_update" ON sites
  FOR UPDATE USING (
    discovered_by = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    discovered_by = current_employee_id()
    OR current_employee_role() = 'owner'
  );

CREATE POLICY "owner_only_delete" ON sites
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- site_contacts
DROP POLICY IF EXISTS "authenticated_select" ON site_contacts;
CREATE POLICY "authenticated_select" ON site_contacts
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_insert" ON site_contacts;
CREATE POLICY "authenticated_insert" ON site_contacts
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "owner_only_update" ON site_contacts;
CREATE POLICY "owner_only_update" ON site_contacts
  FOR UPDATE USING (
    current_employee_role() = 'owner'
  ) WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON site_contacts;
CREATE POLICY "owner_only_delete" ON site_contacts
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );


-- ------------------------------------------------------------
-- STEP F: PRODUCTS — ACTIVE-EMPLOYEE READ, OWNER-ONLY WRITE
-- The product catalog (window/door types) is small and stable; every
-- active employee can read it, but only an owner curates it.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_select" ON products;
CREATE POLICY "authenticated_select" ON products
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "owner_only_insert" ON products;
CREATE POLICY "owner_only_insert" ON products
  FOR INSERT WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_update" ON products;
CREATE POLICY "owner_only_update" ON products
  FOR UPDATE USING (
    current_employee_role() = 'owner'
  ) WITH CHECK (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON products;
CREATE POLICY "owner_only_delete" ON products
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );


-- ------------------------------------------------------------
-- STEP G: APPEND-ONLY TABLES
-- No UPDATE or DELETE policy exists for any table in this step —
-- that's not an oversight, it's the point. With RLS enabled and no
-- policy for an operation, that operation is refused for everyone
-- (service_role excepted), so these rows are permanently write-once.
-- SELECT/INSERT are scoped to "resolves to an active employee" the
-- same way STEP E's shared tables are, not left wide open.
-- ------------------------------------------------------------

-- stage_history: every stage change, logged by any active employee,
-- readable by all active employees
DROP POLICY IF EXISTS "authenticated_select" ON stage_history;
CREATE POLICY "authenticated_select" ON stage_history
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_insert" ON stage_history;
CREATE POLICY "authenticated_insert" ON stage_history
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

-- lead_owner_history: every owner reassignment, logged by any active
-- employee, readable by all active employees — same append-only
-- shape/policy as stage_history.
DROP POLICY IF EXISTS "authenticated_select" ON lead_owner_history;
CREATE POLICY "authenticated_select" ON lead_owner_history
  FOR SELECT USING (current_employee_role() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated_insert" ON lead_owner_history;
CREATE POLICY "authenticated_insert" ON lead_owner_history
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);

-- loss_reasons: any active employee can log why a lead was lost, but
-- only an active owner can see the collected reasons (competitor
-- names, etc.)
DROP POLICY IF EXISTS "owner_only_select" ON loss_reasons;
CREATE POLICY "owner_only_select" ON loss_reasons
  FOR SELECT USING (
    current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "authenticated_insert" ON loss_reasons;
CREATE POLICY "authenticated_insert" ON loss_reasons
  FOR INSERT WITH CHECK (current_employee_role() IS NOT NULL);


-- ------------------------------------------------------------
-- STEP H: FOLLOW-UPS + PUSH SUBSCRIPTIONS
-- follow_ups uses the same "own data or owner role" shape as
-- activities/leads/plans/targets, keyed on assigned_to (the person it's
-- for, not who created it) — an active sales exec can only INSERT a row
-- assigned to themselves; only an active owner can insert one assigned
-- to someone else. That's the real enforcement behind "owner can
-- assign, sales exec can only self-assign" — the app UI simply never
-- exposes the disallowed case.
-- ------------------------------------------------------------
ALTER TABLE follow_ups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_select" ON follow_ups
  FOR SELECT USING (
    assigned_to = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_insert" ON follow_ups
  FOR INSERT WITH CHECK (
    assigned_to = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_update" ON follow_ups
  FOR UPDATE USING (
    assigned_to = current_employee_id()
    OR current_employee_role() = 'owner'
  ) WITH CHECK (
    assigned_to = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON follow_ups;
CREATE POLICY "owner_only_delete" ON follow_ups
  FOR DELETE USING (
    current_employee_role() = 'owner'
  );

-- push_subscriptions: a device manages only its own row (no "owner role"
-- exception on write — a subscription is tied to one specific browser
-- instance, an owner registering one on someone else's behalf makes no
-- sense). Owner gets read access for visibility only. Real cleanup of
-- dead/expired subscriptions happens server-side via the Edge Function's
-- service_role key, which bypasses RLS entirely (and current_employee_id()/
-- current_employee_role() are irrelevant there too — service_role has no
-- auth.uid() and doesn't go through these policies at all).
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON push_subscriptions;
CREATE POLICY "own_data_or_owner_role_select" ON push_subscriptions
  FOR SELECT USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_insert" ON push_subscriptions;
CREATE POLICY "own_data_insert" ON push_subscriptions
  FOR INSERT WITH CHECK (
    employee_id = current_employee_id()
  );

DROP POLICY IF EXISTS "own_data_update" ON push_subscriptions;
CREATE POLICY "own_data_update" ON push_subscriptions
  FOR UPDATE USING (
    employee_id = current_employee_id()
  ) WITH CHECK (
    employee_id = current_employee_id()
  );

DROP POLICY IF EXISTS "own_data_delete" ON push_subscriptions;
CREATE POLICY "own_data_delete" ON push_subscriptions
  FOR DELETE USING (
    employee_id = current_employee_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON follow_ups, push_subscriptions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE follow_ups_id_seq, push_subscriptions_id_seq TO authenticated;

-- follow_ups/push_subscriptions were the first tables this project needed
-- service_role to read/write directly (the send-followup-reminders Edge
-- Function uses the service_role key specifically to bypass RLS — see
-- CLAUDE.md's Follow-ups section). Discovered the hard way: this project's
-- Supabase instance is on the newer "don't auto-expose new tables to any
-- Data API role" default (see supabase/config.toml's `auto_expose_new_tables`
-- comment) — service_role does NOT automatically get access to a new table
-- either, unlike the older assumption that service_role always bypasses
-- everything. Every table service_role needs to touch requires this same
-- explicit GRANT — plain "the RLS bypass role couldn't read its own table"
-- is the failure mode if a future service_role-using feature skips this.
GRANT SELECT, INSERT, UPDATE, DELETE ON follow_ups, push_subscriptions TO service_role;


-- ------------------------------------------------------------
-- Adding a third role later (e.g. 'manager') is a one-line change:
-- add it to the CHECK list on employees.role, then add a matching
-- `OR current_employee_role() = 'manager'` branch to each policy
-- above. No structural change needed — deactivation already applies
-- to any role, since current_employee_role() returns NULL for a
-- deactivated row regardless of what that row's role column says.
-- ------------------------------------------------------------
