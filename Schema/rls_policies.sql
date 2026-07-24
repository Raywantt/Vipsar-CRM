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
-- ============================================================


-- ------------------------------------------------------------
-- STEP A: BASELINE GRANTS
-- All real usage goes through a logged-in employee (Supabase Auth,
-- Phase 2) — there's no genuine anonymous-user flow in this app, so
-- everything is granted to `authenticated`, not `anon`.
--
-- SELECT/INSERT/UPDATE go to every table. DELETE is granted only on
-- employees, areas, sites, site_contacts, parties, and products — the
-- six tables that actually have an owner_only_delete policy (STEP
-- C/E/F below); RLS still restricts the grant to 'owner' rows in
-- practice. activities, leads, plans, and targets get NO delete grant
-- at all — they have no delete policy either, so they're non-
-- deletable at both layers, by design, not by omission.
--
-- The sequence GRANT is easy to miss and causes its own 42501: SERIAL
-- columns need USAGE on their backing sequence for INSERT to work.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT DELETE ON employees, areas, sites, site_contacts, parties, products TO authenticated;
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
-- so every "own_data_or_owner_role" policy evaluates to false for it
-- regardless of that grant. Revoke it whenever you want the tidy-up:
--   REVOKE SELECT ON public.employees FROM anon;


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
ALTER TABLE targets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE loss_reasons   ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- STEP C: EMPLOYEES — SPECIAL CASE, READ CAREFULLY
-- Anyone logged in can see the employee directory (SELECT is open),
-- but INSERT/UPDATE/DELETE are owner-only, with NO exception for a
-- row matching your own auth_user_id. This is deliberate: if a sales
-- exec could update their own employees row, they could set their own
-- role to 'owner' and grant themselves full access — employee
-- records, including role changes, are managed by an owner only.
-- ------------------------------------------------------------
CREATE POLICY "authenticated_select" ON employees
  FOR SELECT USING (true);

CREATE POLICY "owner_only_insert" ON employees
  FOR INSERT WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_update" ON employees
  FOR UPDATE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON employees
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );


-- ------------------------------------------------------------
-- STEP D: "OWN DATA OR OWNER ROLE" POLICIES
-- Same shape on all four tables: a logged-in user can see/insert/
-- update a row if it's theirs, OR if their role is 'owner'. Only the
-- "owning" column differs per table.
--
-- `parties` deliberately does NOT live here despite having a
-- created_by column — it was originally grouped with this pattern,
-- but that breaks search-before-create across reps (Rep B can't see
-- a party Rep A already created, so duplicate-checking silently
-- fails). parties now lives in STEP E instead, as shared org-wide
-- data like areas/sites/site_contacts.
-- ------------------------------------------------------------

-- activities.employee_id — who logged the activity
CREATE POLICY "own_data_or_owner_role_select" ON activities
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_insert" ON activities
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_update" ON activities
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- leads.owner_employee_id — who's carrying the opportunity
CREATE POLICY "own_data_or_owner_role_select" ON leads
  FOR SELECT USING (
    owner_employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_insert" ON leads
  FOR INSERT WITH CHECK (
    owner_employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_update" ON leads
  FOR UPDATE USING (
    owner_employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    owner_employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- plans.employee_id — whose plan this is
CREATE POLICY "own_data_or_owner_role_select" ON plans
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_insert" ON plans
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_update" ON plans
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- targets.employee_id — whose target this is
CREATE POLICY "own_data_or_owner_role_select" ON targets
  FOR SELECT USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_insert" ON targets
  FOR INSERT WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "own_data_or_owner_role_update" ON targets
  FOR UPDATE USING (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    employee_id = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );


-- ------------------------------------------------------------
-- STEP E: AUTHENTICATED READ/WRITE, OWNER-RESTRICTED DELETE
-- areas, sites, site_contacts, parties: any authenticated employee can
-- read and create rows (these fill in progressively as scanning/
-- intake happens — parties included, so search-before-create actually
-- finds rows other reps created). DELETE stays owner-only on all four.
-- UPDATE differs per table: areas and site_contacts stay owner-only
-- (shared master data / append-style join rows respectively), but
-- sites and parties use "own data or owner role" instead — the Lead
-- enrichment screen (Phase 3) needs a rep to edit the site they
-- discovered or the party they created, not just an owner.
-- ------------------------------------------------------------

-- parties.created_by — who first added this person/firm
-- Drops the old "own data or owner role" policies from an earlier
-- version of this file — safe to run even if they were never applied.
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON parties;
DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON parties;
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON parties;
DROP POLICY IF EXISTS "owner_only_update" ON parties;

CREATE POLICY "authenticated_select" ON parties
  FOR SELECT USING (true);

CREATE POLICY "authenticated_insert" ON parties
  FOR INSERT WITH CHECK (true);

-- NOTE: created_by is nullable in the schema. A party row with a NULL
-- created_by is only editable by 'owner' — the equality check can
-- never match NULL.
CREATE POLICY "own_data_or_owner_role_update" ON parties
  FOR UPDATE USING (
    created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    created_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON parties
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- areas
CREATE POLICY "authenticated_select" ON areas
  FOR SELECT USING (true);

CREATE POLICY "authenticated_insert" ON areas
  FOR INSERT WITH CHECK (true);

CREATE POLICY "owner_only_update" ON areas
  FOR UPDATE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON areas
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- sites.discovered_by — who found/logged this site
DROP POLICY IF EXISTS "owner_only_update" ON sites;

CREATE POLICY "authenticated_select" ON sites
  FOR SELECT USING (true);

CREATE POLICY "authenticated_insert" ON sites
  FOR INSERT WITH CHECK (true);

-- NOTE: discovered_by is nullable in the schema. A site row with a
-- NULL discovered_by is only editable by 'owner' — the equality check
-- can never match NULL.
CREATE POLICY "own_data_or_owner_role_update" ON sites
  FOR UPDATE USING (
    discovered_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    discovered_by = (SELECT id FROM employees WHERE auth_user_id = auth.uid())
    OR (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON sites
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

-- site_contacts
CREATE POLICY "authenticated_select" ON site_contacts
  FOR SELECT USING (true);

CREATE POLICY "authenticated_insert" ON site_contacts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "owner_only_update" ON site_contacts
  FOR UPDATE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON site_contacts
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );


-- ------------------------------------------------------------
-- STEP F: PRODUCTS — PUBLIC READ, OWNER-ONLY WRITE
-- The product catalog (window/door types) is small and stable; every
-- employee can read it, but only an owner curates it.
-- ------------------------------------------------------------
CREATE POLICY "authenticated_select" ON products
  FOR SELECT USING (true);

CREATE POLICY "owner_only_insert" ON products
  FOR INSERT WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_update" ON products
  FOR UPDATE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  ) WITH CHECK (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "owner_only_delete" ON products
  FOR DELETE USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );


-- ------------------------------------------------------------
-- STEP G: APPEND-ONLY TABLES
-- No UPDATE or DELETE policy exists for either table below — that's
-- not an oversight, it's the point. With RLS enabled and no policy
-- for an operation, that operation is refused for everyone (service_
-- role excepted), so these rows are permanently write-once.
-- ------------------------------------------------------------

-- stage_history: every stage change, logged by anyone, readable by all
CREATE POLICY "authenticated_select" ON stage_history
  FOR SELECT USING (true);

CREATE POLICY "authenticated_insert" ON stage_history
  FOR INSERT WITH CHECK (true);

-- loss_reasons: any employee can log why a lead was lost, but only an
-- owner can see the collected reasons (competitor names, etc.)
CREATE POLICY "owner_only_select" ON loss_reasons
  FOR SELECT USING (
    (SELECT role FROM employees WHERE auth_user_id = auth.uid()) = 'owner'
  );

CREATE POLICY "authenticated_insert" ON loss_reasons
  FOR INSERT WITH CHECK (true);


-- ------------------------------------------------------------
-- Adding a third role later (e.g. 'manager') is a one-line change:
-- add it to the CHECK list on employees.role, then add a matching
-- `OR (SELECT role ...) = 'manager'` branch to each policy above.
-- No structural change needed.
-- ------------------------------------------------------------
