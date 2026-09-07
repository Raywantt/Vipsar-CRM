-- ============================================================
-- MIGRATION: fix migration_manager_reassign_any_employee.sql — that file's
-- WITH CHECK widening alone does NOT work, for a real Postgres RLS reason
-- discovered live, empirically, on 2026-09-07. Read this before touching
-- manager_team_update or enforce_manager_lock again.
--
-- WHAT WENT WRONG, PROVEN LIVE: migration_manager_reassign_any_employee.sql
-- widened leads' manager_team_update policy's WITH CHECK to
-- `(SELECT current_employee_role()) = 'sales_manager'`, expecting that once
-- USING let a manager touch their own lead or a team lead, the new,
-- unconditional WITH CHECK would accept ANY new owner. It was run live and
-- confirmed present via `pg_policies` — and reassigning to an outside-team
-- exec STILL failed with 42501 "new row violates row-level security policy
-- for table leads", every time, for both a manager's own lead and a team
-- lead. Verified via seven live UPDATEs from a real sales_manager session
-- (Aanchal Tripathi), each one immediately reverted:
--   own lead    -> team member (Harish)      SUCCEEDED
--   own lead    -> outside-team manager (Pawan)   FAILED (42501)
--   team lead   -> outside-team manager (Pawan)   FAILED (42501)
--   team lead   -> outside-team exec (Vishal)     FAILED (42501)
--   (the "team lead -> Pawan" case also failed with NO .select() chained —
--    i.e. no RETURNING at all — ruling out a RETURNING/visibility
--    explanation and confirming this is a genuine WITH CHECK-level reject)
-- Full pg_policies dump for `leads` was pulled live and confirmed: no
-- RESTRICTIVE policy exists, and manager_team_update's with_check was
-- exactly the new, unconditional text. The failure pattern exactly matched
-- the OLD (pre-migration) team-or-self rule regardless.
--
-- THE ACTUAL MECHANISM (empirically confirmed, not found documented
-- anywhere obvious — worth remembering generally for any future RLS work
-- in this schema): for UPDATE, when a policy provides an explicit WITH
-- CHECK, Postgres does NOT treat it as an independent OR-term across all
-- applicable policies' WITH CHECK clauses. That SAME policy's own USING
-- clause is effectively ALSO re-evaluated against the NEW row, and BOTH
-- must hold for that policy to authorise the write — the WITH CHECK adds a
-- constraint, it does not replace or loosen USING's own reach onto the new
-- row. So manager_team_update's USING (`is_my_managed_member(owner_
-- employee_id)`) was silently gating the NEW row's owner_employee_id too,
-- no matter what WITH CHECK said — which is exactly why "own -> team
-- member" kept working (manager_team_update's USING(new)=
-- is_my_managed_member(team member)=true) while "own/team -> outsider"
-- never could (USING(new)=is_my_managed_member(outsider)=false, always).
-- A single UPDATE policy therefore CANNOT express "old row restricted to
-- my team, new row unrestricted" — its own USING clause inherently
-- constrains both.
--
-- THE FIX moves the "was this lead already reachable by me" question out of
-- RLS entirely and into enforce_manager_lock() — a BEFORE UPDATE trigger,
-- which (unlike one RLS policy) sees OLD and NEW independently and can
-- apply a restriction to one without applying it to the other. This is not
-- a new pattern for this schema: enforce_manager_lock() already does
-- exactly this for COLUMN restrictions (STEP 7 of
-- migration_sales_manager.sql), and enforce_owner_only_stage_change()/
-- validate_employee_role_assignment() are the same shape of trigger-as-
-- real-boundary elsewhere in this file. With the reachability check moved
-- to the trigger, manager_team_update's RLS policy can safely become
-- exactly as unconditional as the owner's own own_data_or_owner_role_update
-- (`current_employee_role() = 'owner'`, no further restriction) — RLS's
-- job becomes "yes, a real sales_manager may attempt this UPDATE at all",
-- and the trigger decides the specifics, same division of labour as always
-- in this schema.
--
-- WHAT THIS DOES NOT DO: does not touch own_data_or_owner_role_update,
-- coordinator_team_update, or any SELECT policy — a manager's set of
-- reachable/visible leads (LeadDetail, Dashboard, All Leads, Search, My
-- Team) is completely unaffected; this migration only concerns what
-- happens once an UPDATE is already underway on a row RLS let them target.
--
-- ONE BEHAVIOURAL SIDE EFFECT, worth knowing and accepted as harmless: a
-- manager who tries to UPDATE a lead entirely outside their reach via a
-- direct API call (never reachable through the UI at all, since SELECT
-- policies are unchanged and LeadDetail can't even load such a lead) now
-- gets a real error from the trigger instead of a silent "0 rows matched"
-- from RLS filtering it out beforehand. No data is exposed either way —
-- the trigger's message names no lead details, and the UI never surfaces
-- this path since it never reaches an unreachable lead's detail page.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS before
-- CREATE POLICY, DROP TRIGGER IF EXISTS before CREATE TRIGGER.
--
-- ORDERING: must run after migration_sales_manager.sql and
-- migration_manager_reassign_any_employee.sql (both already live) — this
-- file's CREATE OR REPLACE FUNCTION enforce_manager_lock() and DROP/CREATE
-- POLICY manager_team_update fully supersede what those left in place. If
-- migration_rls_performance_leads_stage_history.sql or
-- migration_sales_manager.sql is ever re-run after this file, it will
-- revert BOTH the policy and the trigger back to their team-scoped/
-- non-reachability-checking originals — same reversion hazard this
-- schema's other superseding migrations already carry. Re-run this file
-- again afterward to restore it.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: enforce_manager_lock() — add the OLD-row reachability check
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_manager_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed CONSTANT text[] := ARRAY[
    'current_stage','next_followup_date','order_value','owner_employee_id'
  ];
BEGIN
  IF current_employee_role() IS DISTINCT FROM 'sales_manager' THEN
    RETURN NEW;   -- owner, coordinator and the exec themselves are unaffected
  END IF;

  IF OLD.owner_employee_id IS NOT DISTINCT FROM current_employee_id() THEN
    RETURN NEW;   -- a manager's OWN lead: they are a rep here, no limits
  END IF;

  -- NEW (this migration): the lead must already be reachable by this
  -- manager — their own (handled above) or their team's. RLS's USING used
  -- to gate this, but manager_team_update's USING can no longer carry a
  -- team restriction (see this file's header for why: USING is re-checked
  -- against the NEW row too, which is exactly what made cross-team
  -- reassignment impossible while USING stayed team-scoped). This is the
  -- one place OLD is available independent of NEW, so it's the one place
  -- this check can live without also constraining the new owner.
  IF NOT is_my_managed_member(OLD.owner_employee_id) THEN
    RAISE EXCEPTION
      'You can only change a lead that is your own or belongs to one of your sales executives'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'This lead belongs to one of your sales executives — a manager can change its stage, follow-up date, order value and owner, but not its other details'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (already fires BEFORE UPDATE on
-- every row) — re-stated only so this file is complete and re-runnable on
-- its own without needing migration_sales_manager.sql open alongside it.
DROP TRIGGER IF EXISTS enforce_manager_lock ON leads;
CREATE TRIGGER enforce_manager_lock
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_manager_lock();


-- ------------------------------------------------------------
-- STEP 2: manager_team_update — now genuinely unconditional by role, same
-- shape as the owner's own own_data_or_owner_role_update. The trigger above
-- is what actually decides whether a given row may be touched at all.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "manager_team_update" ON leads;
CREATE POLICY "manager_team_update" ON leads
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_manager'
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'sales_manager'
  );


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- Q1. The trigger function's new check is present.
-- SELECT prosrc LIKE '%is_my_managed_member(OLD.owner_employee_id)%' AS has_reachability_check
--   FROM pg_proc WHERE proname = 'enforce_manager_lock';
--    Expect true.

-- Q2. manager_team_update no longer mentions is_my_managed_member at all.
-- SELECT qual, with_check FROM pg_policies
--  WHERE tablename = 'leads' AND policyname = 'manager_team_update';

-- Q3. THE BEHAVIOURAL CHECK — run as a real logged-in sales_manager, never
--     from the SQL Editor (postgres, BYPASSRLS, no auth.uid() — every branch
--     above evaluates false/null regardless of whether this worked).
--
--   1. Reassign your OWN lead to an exec OUTSIDE your team. Expect success.
--   2. Reassign one of your TEAM's leads to an exec outside your team.
--      Expect success.
--   3. Reassign a lead back onto your team (or yourself) — the path that
--      already worked before either migration — still works.
--   4. Confirm a NON-reachability column edit is STILL refused on a lead
--      outside your reach: as this manager, attempt to change quote_value
--      (not one of the 4 allowed columns) on any lead that is neither yours
--      nor your team's. Expect the SAME reachability exception this
--      migration added — you should never get far enough to hit the
--      column-restriction message, since reachability is checked first.
--   5. Confirm the EXISTING column lock still holds on a genuine team lead:
--      as this manager, attempt to change something NOT in the allowed list
--      (e.g. quote_value) on one of your OWN team's leads. Expect the
--      original "can change its stage, follow-up date, order value and
--      owner, but not its other details" message — unaffected by this file.
--   6. As a DIFFERENT role (exec, coordinator, owner), confirm nothing
--      changed for them — this trigger returns immediately for any
--      non-manager actor, and coordinator_team_update/
--      own_data_or_owner_role_update were not touched.
-- ============================================================
