-- ============================================================
-- MIGRATION: RLS performance — follow_ups (2026-09-16)
--
-- Run in the Supabase SQL Editor, whole file. Safe to re-run.
--
-- ORDER: after rls_policies.sql, migration_sales_coordinator.sql and
-- migration_sales_manager.sql (it rewrites the follow_ups policies those
-- three define). Re-running any of them afterwards silently reinstalls the
-- slow form — re-run this file after. Same hazard, and the same kind of
-- fix, as migration_rls_performance_leads_stage_history.sql. It does not
-- touch hide_test_accounts (already in the hoisted form).
--
-- ============================================================
-- MEASURED LIVE (2026-09-16), `select id from follow_ups`, 699 rows total:
--   owner        ~200 ms for 699 visible rows
--   exec         ~850 ms for 5
--   coordinator  ~1,190 ms for 5
--   manager      ~1,100 ms for 5 — and one real statement timeout (57014)
--                on the manager's Follow-ups tab under a page load.
--
-- CAUSE: the same one the leads migration documents — cost scales with the
-- rows a viewer CANNOT see. For every such row Postgres evaluates every
-- permissive branch: two bare current_employee_*() calls, then
-- is_my_team_member(assigned_to) and is_my_managed_member(assigned_to),
-- SECURITY DEFINER functions that can't be inlined and each run their own
-- employees lookup. ~700 rows x 4 opaque calls.
--
-- WHY NOT JUST THE LEADS RECIPE (a role guard in front of the helper): the
-- guard skips the helper for every OTHER role, but a manager IS the role the
-- manager branch checks, so they still paid one helper call per row. That
-- is exactly the viewer this file was written for.
--
-- THE FIX — two value-preserving shapes:
--
--   (a) SUBSTITUTION: current_employee_id() / current_employee_role() are
--       wrapped as (SELECT ...) so each is evaluated once per statement.
--
--   (b) ID LIST: is_my_team_member(assigned_to) becomes
--       assigned_to = ANY ((SELECT my_team_member_ids())::integer[])
--       (manager side likewise). The list is computed ONCE per statement.
--       Equivalence: is_my_team_member(x) is
--         EXISTS (employees e WHERE e.id = x AND e.coordinator_id = me
--                 AND my role = 'sales_coordinator')
--       and employees.id is unique, so that is exactly "x is in the set of
--       ids with coordinator_id = me, when my role is coordinator" — the set
--       my_team_member_ids() returns (empty for any other role). A NULL x is
--       false in both forms (assigned_to is NOT NULL regardless).
--       The helpers are SECURITY DEFINER exactly like the ones they mirror,
--       and return only the caller's own team's ids — which employees SELECT
--       (open to every active employee) already exposes.
--
-- is_my_team_member / is_my_managed_member are left in place and unchanged:
-- ~20 other policies still call them.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 1: the id-list helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_team_member_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(e.id), '{}')
    FROM employees e
   WHERE e.coordinator_id = (SELECT current_employee_id())
     AND (SELECT current_employee_role()) = 'sales_coordinator';
$$;

CREATE OR REPLACE FUNCTION my_managed_member_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(e.id), '{}')
    FROM employees e
   WHERE e.manager_id = (SELECT current_employee_id())
     AND (SELECT current_employee_role()) = 'sales_manager';
$$;

REVOKE ALL ON FUNCTION my_team_member_ids(), my_managed_member_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_team_member_ids(), my_managed_member_ids() TO authenticated;


-- ------------------------------------------------------------
-- STEP 2: own_data_or_owner_role_* and owner_only_delete — SUBSTITUTION.
-- Original bodies: rls_policies.sql STEP H.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_select" ON follow_ups
  FOR SELECT USING (
    assigned_to = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_insert" ON follow_ups
  FOR INSERT WITH CHECK (
    assigned_to = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON follow_ups;
CREATE POLICY "own_data_or_owner_role_update" ON follow_ups
  FOR UPDATE USING (
    assigned_to = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  ) WITH CHECK (
    assigned_to = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

DROP POLICY IF EXISTS "owner_only_delete" ON follow_ups;
CREATE POLICY "owner_only_delete" ON follow_ups
  FOR DELETE USING ((SELECT current_employee_role()) = 'owner');


-- ------------------------------------------------------------
-- STEP 3: coordinator_team_* — ID LIST.
-- Original: USING / WITH CHECK (is_my_team_member(assigned_to)),
-- migration_sales_coordinator.sql STEP 7.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_select" ON follow_ups;
CREATE POLICY "coordinator_team_select" ON follow_ups
  FOR SELECT USING (assigned_to = ANY ((SELECT my_team_member_ids())::integer[]));

DROP POLICY IF EXISTS "coordinator_team_insert" ON follow_ups;
CREATE POLICY "coordinator_team_insert" ON follow_ups
  FOR INSERT WITH CHECK (assigned_to = ANY ((SELECT my_team_member_ids())::integer[]));

DROP POLICY IF EXISTS "coordinator_team_update" ON follow_ups;
CREATE POLICY "coordinator_team_update" ON follow_ups
  FOR UPDATE USING (assigned_to = ANY ((SELECT my_team_member_ids())::integer[]))
  WITH CHECK (assigned_to = ANY ((SELECT my_team_member_ids())::integer[]));


-- ------------------------------------------------------------
-- STEP 4: manager_team_* — ID LIST.
-- Original: USING / WITH CHECK (is_my_managed_member(assigned_to)),
-- migration_sales_manager.sql STEP 6.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "manager_team_select" ON follow_ups;
CREATE POLICY "manager_team_select" ON follow_ups
  FOR SELECT USING (assigned_to = ANY ((SELECT my_managed_member_ids())::integer[]));

DROP POLICY IF EXISTS "manager_team_insert" ON follow_ups;
CREATE POLICY "manager_team_insert" ON follow_ups
  FOR INSERT WITH CHECK (assigned_to = ANY ((SELECT my_managed_member_ids())::integer[]));

DROP POLICY IF EXISTS "manager_team_update" ON follow_ups;
CREATE POLICY "manager_team_update" ON follow_ups
  FOR UPDATE USING (assigned_to = ANY ((SELECT my_managed_member_ids())::integer[]))
  WITH CHECK (assigned_to = ANY ((SELECT my_managed_member_ids())::integer[]));

COMMIT;


-- ============================================================
-- CHECK (read-only). Expect 10 policies on follow_ups (the 9 above plus
-- hide_test_accounts), none calling is_my_team_member/is_my_managed_member:
-- ============================================================
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--  WHERE tablename = 'follow_ups' ORDER BY policyname;
--
-- Then re-time `select id from follow_ups` as a logged-in manager and
-- coordinator (not from the SQL Editor — it bypasses RLS), and confirm each
-- still sees exactly the same rows as before.
