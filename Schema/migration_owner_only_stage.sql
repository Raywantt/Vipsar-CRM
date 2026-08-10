-- ============================================================
-- MIGRATION: only an owner may change a lead's stage
-- Run this in the Supabase SQL Editor. Safe to re-run (CREATE OR
-- REPLACE + DROP TRIGGER IF EXISTS).
--
-- WHY A TRIGGER, NOT A POLICY: RLS decides which *rows* you may update,
-- not which *columns*. `leads` UPDATE is "own data or owner role" — a
-- sales exec legitimately needs to edit their own lead (quote value,
-- close date, site details, follow-up date), so the row-level policy has
-- to stay. Column-level GRANTs can't help either: both roles authenticate
-- as `authenticated`, so revoking UPDATE(current_stage) would lock the
-- owner out too. A BEFORE UPDATE trigger is the one mechanism that can
-- say "this specific column, only for this role".
--
-- The UI already hides the "Change stage" action from a sales exec (see
-- LeadQuickActions.jsx). This is the enforcement behind that gate, so a
-- rep can't move a lead through the funnel — or close it Won/Lost —
-- straight through the API. It does not restrict any other column: a rep
-- still edits their own lead freely otherwise.
--
-- stage_history is locked down to match, since a stage change and its
-- history row are written together by LeadStageSection.jsx — leaving the
-- history table open would let a rep fabricate a stage change that never
-- happened to the lead itself. It stays append-only for the owner (no
-- UPDATE/DELETE policy exists for anyone, by design).
--
-- WORTH KNOWING BEFORE YOU RUN IT: after this, a sales exec can no longer
-- mark their own deal Won or Lost — that becomes the owner's action. Reps
-- can still record the money either way (Activity Log's Booking Update,
-- and the Order value field on Sales progress), they just don't flip the
-- stage. If you'd rather reps could still close their own deals, change
-- the trigger's condition to allow NEW.current_stage IN ('won','lost').
-- ============================================================

-- The `auth.uid() IS NOT NULL` guard matters: a trigger fires even for a
-- role that bypasses RLS (table owners do; triggers are not part of RLS), so
-- without it this would block your own migrations and admin edits in the SQL
-- Editor — where there's no JWT, so current_employee_role() is NULL and
-- `NULL IS DISTINCT FROM 'owner'` is true. Skipping the check when there's no
-- authenticated app user at all is not a hole: that path is postgres or
-- service_role, both of which already bypass every policy in this file, and
-- `anon` can't update leads regardless (the RLS UPDATE policy needs
-- current_employee_id()/role, both NULL for it). A *deactivated* employee is
-- still blocked — they have a real auth.uid(), and current_employee_role()
-- resolves NULL for them, which is DISTINCT FROM 'owner'.
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage
     AND auth.uid() IS NOT NULL
     AND current_employee_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only an owner can change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_only_stage_change ON leads;
CREATE TRIGGER owner_only_stage_change
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_only_stage_change();

-- stage_history INSERT was "any active employee" — narrow it to the owner
-- so the audit trail can't be written by someone who can no longer cause
-- the change it claims to record. (SELECT was already scoped to own-leads-
-- or-owner by Schema/migration_scope_stage_history.sql; UPDATE/DELETE have
-- no policy for anyone, deliberately.)
DROP POLICY IF EXISTS "authenticated_insert" ON stage_history;
DROP POLICY IF EXISTS "owner_only_insert" ON stage_history;
CREATE POLICY "owner_only_insert" ON stage_history
  FOR INSERT WITH CHECK (current_employee_role() = 'owner');
