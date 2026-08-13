-- ============================================================
-- MIGRATION: Phase 9 RLS fixes
-- Run this in the Supabase SQL Editor. Safe to re-run
-- (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
--
-- Two independent fixes from the Phase 9 audit, plus one hygiene grant.
-- Nothing here changes owner or sales_executive behaviour on any table that
-- was already correctly scoped — each step only narrows a read that was too
-- wide, or widens one that a later feature made too narrow.
--
-- ORDER IS NOT LOAD-BEARING in this file. The three steps are independent and
-- may be run separately if you prefer.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 (F-P5-1): scope lead_owner_history SELECT to own leads or owner
--
-- THE PROBLEM. Its SELECT policy is `current_employee_role() IS NOT NULL` —
-- any active employee, with no own-leads and no team branch. Measured live
-- during the Phase 5 audit: all five roles tested could read every
-- reassignment row, including each coordinator reading the other team's.
--
-- WHY IT WAS MISSED. This is the same defect the 2026-08-10 data-isolation
-- audit found and fixed for stage_history (migration_scope_stage_history.sql),
-- and that fix is verifiably working today. lead_owner_history escaped only
-- because it was created a day earlier, by migration_pilot_outstanding.sql,
-- and was not in that audit's scope.
--
-- WHAT LEAKS. lead_id, old/new owner and who changed it — lead/employee
-- association metadata rather than commercial values. Modest, but it is exactly
-- the metadata every other policy in this schema is careful to hide.
--
-- The shape below deliberately mirrors stage_history's so the two read the
-- same way to anyone auditing this file later, including the coordinator team
-- branch (an SC supervises their team's leads and should see their history).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_select" ON lead_owner_history;
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON lead_owner_history;
CREATE POLICY "own_data_or_owner_role_select" ON lead_owner_history
  FOR SELECT USING (
    current_employee_role() = 'owner'
    OR EXISTS (
         SELECT 1 FROM leads l
          WHERE l.id = lead_owner_history.lead_id
            AND l.owner_employee_id = current_employee_id()
       )
  );

DROP POLICY IF EXISTS "coordinator_team_select" ON lead_owner_history;
CREATE POLICY "coordinator_team_select" ON lead_owner_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_owner_history.lead_id
         AND is_my_team_member(l.owner_employee_id)
    )
  );

-- INSERT is unchanged: still any active employee. A reassignment is written by
-- whoever performs it, and the leads UPDATE policy is what actually gates who
-- can perform one.


-- ------------------------------------------------------------
-- STEP 2 (F-P5-2): let a coordinator read their team's lead_change_log
--
-- THE PROBLEM. lead_change_log SELECT is own-leads-or-owner with no coordinator
-- branch, so an SC sees zero of its rows — measured live, 0 of 225. The Day
-- Review's "Changes" column reads this table, so for a coordinator it is
-- structurally always empty, on every date, for every exec on their team.
--
-- WHY IT WAS RIGHT WHEN WRITTEN, AND IS NOT NOW.
-- migration_sales_coordinator.sql's own "DELIBERATELY NOT CHANGED" block says:
--   "lead_change_log — SELECT stays own-leads-or-owner. The Day Review is not
--    part of the SC surface in this phase."
-- That was accurate. Phase 8 then built the coordinator Dashboard *including* a
-- team-scoped Day Review, and this policy was never revisited. The premise the
-- decision rested on is simply no longer true.
--
-- Added as a SEPARATE permissive policy, the same way every other
-- coordinator_team_* policy is, so owner/exec behaviour is untouched and this
-- drops cleanly if Phase 8 is ever rolled back.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_select" ON lead_change_log;
CREATE POLICY "coordinator_team_select" ON lead_change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_change_log.lead_id
         AND is_my_team_member(l.owner_employee_id)
    )
  );

-- No INSERT/UPDATE/DELETE policy is added, and none should ever be. The
-- SECURITY DEFINER trigger remains this table's only writer — that is what
-- makes the trail impossible to forge from the application.


-- ------------------------------------------------------------
-- STEP 3 (F-P5-5, hygiene): service_role SELECT on the two later tables
--
-- Not a vulnerability — it fails closed, and the app is unaffected because it
-- authenticates as `authenticated`, which already holds these grants. It only
-- bites tooling that reaches in with the service_role key (admin scripts, an
-- Edge Function, teardown), which currently gets 42501 on both.
--
-- Cause: this project has auto_expose_new_tables = false, so a table created
-- after that default changed is granted only to the roles its own migration
-- names. Neither of these named service_role.
-- ------------------------------------------------------------
GRANT SELECT ON public.lead_change_log     TO service_role;
GRANT SELECT ON public.lead_owner_history  TO service_role;


-- ============================================================
-- VERIFY — run after the migration
-- ============================================================

-- 1. Both tables should now carry the expected policy names.
--    lead_owner_history: own_data_or_owner_role_select + coordinator_team_select
--                        + authenticated_insert   (NO update/delete policy, ever)
--    lead_change_log:    own_data_or_owner_role_select + coordinator_team_select
--                        (NO insert/update/delete policy, ever)
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('lead_owner_history', 'lead_change_log')
 ORDER BY tablename, cmd, policyname;

-- 2. Still append-only: this must return ZERO rows for both tables.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('lead_owner_history', 'lead_change_log')
   AND cmd IN ('UPDATE', 'DELETE');

-- 3. service_role can now read both.
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'service_role'
   AND table_name IN ('lead_change_log', 'lead_owner_history')
 ORDER BY table_name, privilege_type;

-- 4. The real test is behavioural and CANNOT be run here: the SQL Editor is
--    `postgres` with BYPASSRLS and no auth.uid(), so every helper resolves NULL
--    and every policy evaluates false. Verify from a real session instead:
--        node phase9/security-audit.mjs
--    Expect: an exec sees only their own leads' reassignment rows, each
--    coordinator sees only their own team's, and a coordinator's
--    lead_change_log count goes from 0 to their team's real total.
