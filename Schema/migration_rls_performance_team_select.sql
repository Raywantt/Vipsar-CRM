-- ============================================================
-- MIGRATION: RLS performance — team READ policies on leads and
-- stage_history (2026-09-16)
--
-- Run in the Supabase SQL Editor, whole file. Safe to re-run.
--
-- ORDER: after migration_rls_performance_leads_stage_history.sql, which
-- defines the four policies replaced here. Re-running that file (or
-- migration_sales_coordinator.sql / migration_sales_manager.sql) afterwards
-- silently reinstalls the slow form — re-run this file after it.
-- Touches ONLY these four SELECT policies. Every INSERT/UPDATE policy on
-- leads and stage_history is left exactly as it is (they check one row per
-- write, so they aren't the slow part, and manager_team_update has competing
-- versions across three files that must not be disturbed).
--
-- ============================================================
-- MEASURED LIVE (2026-09-16), before:
--   select id from leads          manager ~1,200 ms (5 rows)
--                                 coordinator ~1,040 ms (5 rows)
--                                 exec ~160 ms, owner ~150 ms (1,000 rows)
--   select id from stage_history  manager / coordinator ~1,000 ms (9 rows),
--                                 with spikes of 12-27 s
--
-- CAUSE: the role guard added by the leads performance pass skips the team
-- helper for every OTHER role — which is why exec is fast — but a manager IS
-- the role the manager branch names, so is_my_managed_member() still ran
-- once per lead they can't see (~1,265 of them). Coordinator likewise.
--
-- THE FIX: the same ID LIST shape as migration_rls_performance_follow_ups.sql.
--   (SELECT is_my_team_member(owner_employee_id))
-- becomes
--   owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
-- where the list is computed once per statement. Equivalent because
-- is_my_team_member(x) is "x has coordinator_id = me, and my role is
-- coordinator", employees.id is unique, and my_team_member_ids() is exactly
-- that set (empty for any other role). A NULL owner (a BDM pool lead) is
-- false in both forms. The existing role guard in front is kept — it costs
-- nothing and keeps each policy readable on its own. Manager side likewise.
-- ============================================================

BEGIN;

-- Same bodies as migration_rls_performance_follow_ups.sql, restated so this
-- file stands alone.
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
-- leads
-- ------------------------------------------------------------
-- Was: role = 'sales_coordinator' AND (SELECT is_my_team_member(owner_employee_id))
DROP POLICY IF EXISTS "coordinator_team_select" ON leads;
CREATE POLICY "coordinator_team_select" ON leads
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
  );

-- Was: role = 'sales_manager' AND (SELECT is_my_managed_member(owner_employee_id))
DROP POLICY IF EXISTS "manager_team_select" ON leads;
CREATE POLICY "manager_team_select" ON leads
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
  );


-- ------------------------------------------------------------
-- stage_history — the EXISTS lookup of the lead stays; only the helper call
-- inside it changes.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_select" ON stage_history;
CREATE POLICY "coordinator_team_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND leads.owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
    )
  );

DROP POLICY IF EXISTS "manager_team_select" ON stage_history;
CREATE POLICY "manager_team_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND leads.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
    )
  );

COMMIT;


-- ============================================================
-- CHECK (read-only): none of the four should mention is_my_*_member now.
-- ============================================================
-- SELECT tablename, policyname, qual FROM pg_policies
--  WHERE tablename IN ('leads', 'stage_history')
--    AND policyname IN ('coordinator_team_select', 'manager_team_select');
--
-- Then re-time as a logged-in manager and coordinator (never the SQL Editor,
-- which bypasses RLS). Before, both saw leads 159,437,438,439,443 and
-- stage_history 634,635,839-845 — expect exactly the same ids.
