-- ============================================================
-- MIGRATION: targets — let a sales_coordinator/sales_manager set targets
-- for their own team's execs (written 2026-09-07)
--
-- WHY: SetTargetForm.jsx's "+ Set a target" button has no isOwner check of
-- its own — it's gated purely by TargetsVsActualsCard.jsx's showByEmployee
-- prop, which Dashboard.jsx has passed as seesOthersData since the Sales
-- Manager build (2026-09-03). seesOthersData already includes a
-- sales_coordinator and a sales_manager on the Team side of their My/Team
-- switch, so the button has been rendering for both roles since that date,
-- with the employee dropdown already correctly narrowed to their own team
-- by the same roster-scoping effect every other team-scoped card on that
-- page already reads (Dashboard.jsx's fetchActiveSalesExecs effect filters
-- to coordinator_id/manager_id client-side). None of that is new.
--
-- What's actually been missing is underneath: targets' RLS
-- (rls_policies.sql) only ever granted INSERT/UPDATE to the owner or to
-- `employee_id = current_employee_id()`. Both migration_sales_coordinator
-- .sql and migration_sales_manager.sql already added a team-scoped SELECT
-- policy on targets (coordinator_team_select / manager_team_select — that's
-- why the heatmap already shows a team's EXISTING targets correctly for
-- both roles), but neither one added INSERT or UPDATE. So today, a
-- coordinator or manager who opens the form, picks one of their own execs,
-- and taps "Set" hits a real Postgres RLS denial (42501) — a button the UI
-- never hid, wired to a write the database never allowed.
--
-- THIS MIGRATION adds the missing coordinator_team_insert/update and
-- manager_team_insert/update policies on targets, using the exact same
-- is_my_team_member()/is_my_managed_member() helpers every other
-- team-scoped policy in this schema already uses (defined in
-- migration_sales_coordinator.sql / migration_sales_manager.sql
-- respectively — both already live, this adds nothing new to either
-- function).
--
-- It ALSO rewrites the two existing *_team_select policies on targets into
-- the `(select current_employee_role()) = '<role>' AND (select
-- helper(...))` form the 2026-09-07 performance migrations
-- (migration_rls_performance_leads_stage_history.sql /
-- migration_rls_performance_parties_sites_activities.sql) established as
-- house style for every new team-scoped policy in this schema — purely for
-- consistency with that now-standard form, NOT because targets is large
-- enough for it to matter (it's on the order of a few dozen rows total;
-- the per-row function-call cost this form avoids is a non-issue here).
-- The role guard is a logical no-op either way, same proof as those two
-- migrations: both helper functions already require the matching role
-- internally (see their own CREATE FUNCTION bodies), so
-- `role = X AND helper(...)` can never disagree with `helper(...)` alone —
-- it just lets Postgres skip the function call for every row that isn't
-- even the right role.
--
-- WHAT THIS DOES NOT DO:
--   - Does not touch own_data_or_owner_role_select/insert/update (the base
--     owner/self policies on targets) or the owner_only_delete policy —
--     unchanged, exactly as before.
--   - Does not let a coordinator or manager set a target for THEMSELVES
--     through this button. That would go through
--     own_data_or_owner_role_insert/update instead (employee_id =
--     current_employee_id()), which already exists and is untouched here —
--     the UI simply never offers the button for that case today
--     (showByEmployee is false whenever a manager is on the "My" side of
--     their switch, and a coordinator carries no personal target row to
--     begin with). Not addressed by this file.
--   - Does not add any index. targets is far too small a table today for
--     one to matter, and is_my_team_member()/is_my_managed_member() are
--     already backed by idx_employees_coordinator/idx_employees_manager.
--
-- Safe to re-run: every policy below is DROP POLICY IF EXISTS before its
-- CREATE POLICY.
--
-- ORDERING: must run after migration_sales_coordinator.sql (defines
-- is_my_team_member()) and migration_sales_manager.sql (defines
-- is_my_managed_member(), and already adds manager_team_select on
-- targets) — both are already live per CLAUDE.md. Independent of
-- rls_policies.sql's base targets policies and of both 2026-09-07
-- performance migrations (neither of those touches targets at all).
-- ============================================================


-- ------------------------------------------------------------
-- coordinator — SELECT (rewritten, identical behaviour), INSERT, UPDATE
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "coordinator_team_select" ON targets;
CREATE POLICY "coordinator_team_select" ON targets
  FOR SELECT USING (
    (select current_employee_role()) = 'sales_coordinator'
    AND (select is_my_team_member(employee_id))
  );

DROP POLICY IF EXISTS "coordinator_team_insert" ON targets;
CREATE POLICY "coordinator_team_insert" ON targets
  FOR INSERT WITH CHECK (
    (select current_employee_role()) = 'sales_coordinator'
    AND (select is_my_team_member(employee_id))
  );

DROP POLICY IF EXISTS "coordinator_team_update" ON targets;
CREATE POLICY "coordinator_team_update" ON targets
  FOR UPDATE USING (
    (select current_employee_role()) = 'sales_coordinator'
    AND (select is_my_team_member(employee_id))
  ) WITH CHECK (
    (select current_employee_role()) = 'sales_coordinator'
    AND (select is_my_team_member(employee_id))
  );


-- ------------------------------------------------------------
-- manager — SELECT (rewritten, identical behaviour), INSERT, UPDATE
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "manager_team_select" ON targets;
CREATE POLICY "manager_team_select" ON targets
  FOR SELECT USING (
    (select current_employee_role()) = 'sales_manager'
    AND (select is_my_managed_member(employee_id))
  );

DROP POLICY IF EXISTS "manager_team_insert" ON targets;
CREATE POLICY "manager_team_insert" ON targets
  FOR INSERT WITH CHECK (
    (select current_employee_role()) = 'sales_manager'
    AND (select is_my_managed_member(employee_id))
  );

DROP POLICY IF EXISTS "manager_team_update" ON targets;
CREATE POLICY "manager_team_update" ON targets
  FOR UPDATE USING (
    (select current_employee_role()) = 'sales_manager'
    AND (select is_my_managed_member(employee_id))
  ) WITH CHECK (
    (select current_employee_role()) = 'sales_manager'
    AND (select is_my_managed_member(employee_id))
  );


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- Q1. All 6 team policies exist on targets, one row each.
--     Expect exactly: coordinator_team_select, coordinator_team_insert,
--     coordinator_team_update, manager_team_select, manager_team_insert,
--     manager_team_update.
-- SELECT policyname, cmd FROM pg_policies
--  WHERE tablename = 'targets' AND policyname LIKE '%_team_%'
--  ORDER BY policyname;

-- Q2. targets carries 10 policies total now (4 pre-existing base policies
--     + 6 team policies above).
-- SELECT COUNT(*) FROM pg_policies WHERE tablename = 'targets';

-- Q3. THE BEHAVIOURAL CHECK — this is the one that actually matters, and it
--     MUST be run as a real logged-in sales_coordinator, then a real
--     sales_manager. Never from the SQL Editor: that connects as postgres
--     with BYPASSRLS and no auth.uid(), so current_employee_role() and
--     every helper above evaluate NULL/false regardless of whether this
--     migration worked, and the check would look identical either way.
--
--   1. Log in as a coordinator, open Dashboard (Week/Month/Quarter — Today
--      and 15D/Custom don't show this card), expand "+ Set a target", pick
--      one of their own team's execs, and Set a target. Expect a clean
--      "Saved." with no error.
--   2. Submit again for the SAME employee/period/metric with a different
--      value. Expect it to REPLACE the first row, not add a second
--      (insertTarget()'s upsert) — confirm with:
--        SELECT id, target_value FROM targets
--         WHERE employee_id = <exec id> AND period_type = '<type>'
--           AND period_value = '<value>' AND metric_name = '<metric>';
--      Expect exactly one row, holding the second value.
--   3. As that same coordinator, confirm the employee dropdown does NOT
--      list an exec outside their own team (already true today via the
--      client-side roster scoping, unrelated to this migration, but worth
--      reconfirming alongside the new write path) — and, if reachable via
--      a direct API call, confirm inserting a target for an outside exec
--      is refused by the database, not just hidden by the UI.
--   4. Repeat steps 1-3 as a sales_manager with the page's My/Team switch
--      on Team, against one of their own reports.
-- ============================================================
