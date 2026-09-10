-- ============================================================
-- MIGRATION: let a sales_coordinator's coordinator_id also be set on a
-- sales_manager row, not only a sales_executive (written 2026-09-10, at the
-- owner's request: "sales manager can also have coordinators... let a
-- coordinator see the data of a manager if I put a manager under any sc").
--
-- WHY THIS IS A ONE-CLAUSE CHANGE, NOT A NEW POLICY LAYER:
-- coordinator_id and is_my_team_member() were already fully generic on the
-- TARGET's role — the only place a sales_manager was ever excluded from
-- carrying a coordinator_id was one explicit check inside
-- validate_employee_role_assignment() (added by
-- migration_sales_coordinator.sql, reproduced verbatim by
-- migration_sales_manager.sql when it added the manager_id half beside it):
--
--   IF NEW.role <> 'sales_executive' THEN
--     RAISE EXCEPTION 'Only a sales executive can be assigned to a
--     coordinator (this employee is %)', NEW.role ...
--
-- Every coordinator_team_* RLS policy in the schema (leads/activities/
-- stage_history/site_contacts/follow_ups/targets/parties/sites) routes
-- through is_my_team_member(target_employee_id), and that function has never
-- filtered on the target's role — only on "does this row's coordinator_id
-- equal the caller, and is the caller really a sales_coordinator":
--
--   SELECT EXISTS (
--     SELECT 1 FROM employees e
--      WHERE e.id = target_employee_id
--        AND e.coordinator_id = (SELECT current_employee_id())
--        AND (SELECT current_employee_role()) = 'sales_coordinator'
--   );
--
-- So the instant a sales_manager row is allowed to carry a coordinator_id,
-- EVERY one of those policies — and every app-level consumer built on top of
-- them (fetchMyTeamExecs, TeamTodayPanel, Dashboard's coordinator scoping,
-- the Day Review table's MGR role badge) — already treats that manager
-- exactly like an assigned exec, with zero further schema or RLS work. This
-- migration widens the one clause that was stopping it.
--
-- WHAT THIS DOES NOT DO (confirmed with the owner before writing this):
--   - Does NOT make a coordinator and a manager report to each other by
--     default. They remain independent peers in the hierarchy — this only
--     makes coordinator_id a LEGAL, OPT-IN column value on a sales_manager
--     row; the owner still assigns it per employee, the same "Reports to"
--     admin action already used for execs (src/lib/roles.js's
--     canHaveCoordinator, widened in the same pass as this migration).
--   - Does NOT touch manager_id at all. A sales_manager still cannot carry
--     their own manager_id (the manager line's role check, right below the
--     coordinator line in the same function, is untouched) — a manager
--     cannot also report to another manager.
--   - Does NOT let a coordinator do anything to a manager's own reports
--     (the execs assigned to that manager via manager_id). is_my_team_member
--     only ever matches on the row's OWN coordinator_id — a manager's
--     reports have coordinator_id = NULL (unless the owner separately
--     assigns them too), so this does not cascade transitively.
--   - Does NOT change entry-on-behalf scope beyond what already follows from
--     fetchMyTeamExecs() returning a mixed roster — a coordinator could
--     already log a lead/activity "for" anyone that function returns, and a
--     manager assigned to them now appears in that same list the same way
--     an exec would. Not a new code path, the existing one just sees one
--     more row.
--
-- Safe to re-run: CREATE OR REPLACE, and the trigger DROP/CREATE mirrors the
-- exact pattern migration_sales_manager.sql already established.
--
-- ORDERING: must run after migration_sales_manager.sql (already live) —
-- this file's CREATE OR REPLACE reproduces that file's version of
-- validate_employee_role_assignment() verbatim except for the one widened
-- line. ⚠️ If migration_sales_coordinator.sql or migration_sales_manager.sql
-- is ever re-run AFTER this one, it will silently revert the coordinator
-- role check back to sales_executive-only — same reversion hazard this
-- schema folder already documents for migration_lead_edit_rights.sql vs
-- migration_sales_coordinator.sql. Re-run this file again to restore it.
-- ============================================================

CREATE OR REPLACE FUNCTION validate_employee_role_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  ---- coordinator line (widened: sales_executive OR sales_manager) ----
  IF NEW.coordinator_id IS NOT NULL THEN
    IF NEW.coordinator_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot be their own coordinator'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.role NOT IN ('sales_executive', 'sales_manager') THEN
      RAISE EXCEPTION 'Only a sales executive or sales manager can be assigned to a coordinator (this employee is %)', NEW.role
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
       WHERE id = NEW.coordinator_id AND role = 'sales_coordinator'
    ) THEN
      RAISE EXCEPTION 'coordinator_id must point at an employee whose role is sales_coordinator'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_coordinator'
     AND NEW.role IS DISTINCT FROM 'sales_coordinator'
     AND EXISTS (SELECT 1 FROM employees WHERE coordinator_id = OLD.id) THEN
    RAISE EXCEPTION 'This coordinator still has reports — reassign their team first'
      USING ERRCODE = 'check_violation';
  END IF;

  ---- manager line (unchanged from migration_sales_manager.sql) ----
  IF NEW.manager_id IS NOT NULL THEN
    IF NEW.manager_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot be their own manager'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.role <> 'sales_executive' THEN
      RAISE EXCEPTION 'Only a sales executive can be assigned to a manager (this employee is %)', NEW.role
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
       WHERE id = NEW.manager_id AND role = 'sales_manager'
    ) THEN
      RAISE EXCEPTION 'manager_id must point at an employee whose role is sales_manager'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_manager'
     AND NEW.role IS DISTINCT FROM 'sales_manager'
     AND EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id) THEN
    RAISE EXCEPTION 'This manager still has sales executives reporting to them — reassign their team first'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_manager'
     AND OLD.is_active = true
     AND NEW.is_active = false
     AND EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id) THEN
    RAISE EXCEPTION 'This manager still has sales executives reporting to them — reassign their team before deactivating them'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_employee_role_assignment ON employees;
CREATE TRIGGER validate_employee_role_assignment
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_employee_role_assignment();


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- Q1. The function's new source really contains the widened check (function
--     bodies aren't visible through PostgREST, so this has to run in the SQL
--     Editor as an introspection query, not a behavioural test):
-- SELECT pg_get_functiondef('validate_employee_role_assignment'::regproc);
--   Expect to see `IF NEW.role NOT IN ('sales_executive', 'sales_manager')`
--   in the coordinator block, and the manager block still reading
--   `IF NEW.role <> 'sales_executive'` unchanged.

-- Q2. THE BEHAVIOURAL CHECKS — run as real logged-in sessions, never
--     trusted from the SQL Editor alone for the RLS-visibility half (the
--     trigger checks above DO run correctly regardless of caller, since they
--     fire on every INSERT/UPDATE including ones made as postgres — but
--     is_my_team_member() depends on auth.uid(), which the SQL Editor has
--     none of, so it cannot prove a coordinator's own session actually sees
--     the manager's data).
--
--   1. As the owner, in Profile → Manage employees, open a real
--      sales_manager's row. The "Reports to" (coordinator) dropdown should
--      now render for them (it didn't before this migration). Pick a real
--      sales_coordinator and Save. Expect success, no error.
--   2. Still as owner: try setting that same manager's role to
--      sales_coordinator or owner without clearing coordinator_id in the
--      same statement (e.g. directly via the API) — expect the existing
--      rejection ('Only a sales executive or sales manager can be assigned
--      to a coordinator...'), unchanged from before.
--   3. Log in as that specific sales_coordinator. Confirm:
--      - The manager now appears in whatever "my team" listing that
--        coordinator sees (their Today screen's team table) alongside any
--        assigned execs, correctly badged MGR.
--      - Opening one of the manager's own leads/activities (something the
--        coordinator could not see before) now works — a real
--        previously-403/empty row is now visible.
--   4. Log in as a DIFFERENT sales_coordinator (not the one just assigned).
--      Confirm they still cannot see this manager's data — the scoping is
--      per-coordinator, not global.
--   5. Confirm demoting/deactivating a coordinator who now has a manager as
--      one of their reports is still blocked by the existing "still has
--      reports" rule (unchanged — it already counted a report of any role,
--      this migration didn't touch that check).
-- ============================================================
