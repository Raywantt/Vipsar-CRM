-- ============================================================
-- MIGRATION: RLS performance — team READ policies on activities
-- (2026-09-18)
--
-- Run in the Supabase SQL Editor, whole file. Safe to re-run.
--
-- ORDER: after migration_rls_performance_parties_sites_activities.sql, which
-- defines the two policies replaced here. Re-running that file (or
-- migration_sales_coordinator.sql / migration_sales_manager.sql) afterwards
-- silently reinstalls the slow form — re-run this file after it.
-- Touches ONLY these two SELECT policies. Every INSERT/UPDATE policy on
-- activities is left exactly as it is (they check one row per write).
--
-- ============================================================
-- THE BUG IT FIXES: a sales manager's Dashboard showed
--   "current transaction is aborted, commands ignored until end of
--    transaction block"
-- in place of the Reports cards. That banner is Dashboard.jsx's
-- fetchActivityCounts / fetchNewLeadsBySource pair failing.
--
-- MEASURED LIVE (2026-09-18, test manager `sm`, 9 visible activities):
--   select id from activities         alone: 1,260-1,690 ms
--   Dashboard page load (concurrent): activities reads 5,196-5,265 ms,
--                                     leads_needing_attention 4,876 ms
-- The authenticated role's statement_timeout is 8 s, so under a real
-- page load on a real connection these reads run out of time.
--
-- CAUSE: identical to migration_rls_performance_team_select.sql. The role
-- guard skips the team helper for every OTHER role, but a manager IS the
-- role the manager branch names, so is_my_managed_member() ran once per
-- activity row they can't see — every activity in the company.
-- Coordinator likewise.
--
-- THE FIX: the same ID LIST shape.
--   (SELECT is_my_managed_member(employee_id))
-- becomes
--   employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
-- computed once per statement. Equivalent because is_my_managed_member(x)
-- is "x has manager_id = me, and my role is manager", employees.id is
-- unique, and my_managed_member_ids() is exactly that set (empty for any
-- other role). A NULL employee_id is false in both forms. No visibility
-- change for any role.
-- ============================================================

BEGIN;

-- Same bodies as migration_rls_performance_follow_ups.sql /
-- migration_rls_performance_team_select.sql, restated so this file stands
-- alone.
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


-- Was: role = 'sales_coordinator' AND (SELECT is_my_team_member(employee_id))
DROP POLICY IF EXISTS "coordinator_team_select" ON activities;
CREATE POLICY "coordinator_team_select" ON activities
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND employee_id = ANY ((SELECT my_team_member_ids())::integer[])
  );

-- Was: role = 'sales_manager' AND (SELECT is_my_managed_member(employee_id))
DROP POLICY IF EXISTS "manager_team_select" ON activities;
CREATE POLICY "manager_team_select" ON activities
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
  );

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CHECK (read-only): neither should mention is_my_*_member now.
-- ============================================================
-- SELECT policyname, qual FROM pg_policies
--  WHERE tablename = 'activities'
--    AND policyname IN ('coordinator_team_select', 'manager_team_select');
--
-- Then re-time as a logged-in manager (never the SQL Editor, which bypasses
-- RLS). Before, `sm` saw activities 1235-1240, 1312-1314 — expect exactly
-- the same ids.
