-- ============================================================
-- MIGRATION: shared lead edit rights (owner + coordinator + the lead's
--            own sales executive), and a one-way funnel for the exec.
--
-- Settled with the owner 2026-08-13. THREE people may change a lead —
-- anything about it, including its stage:
--     1. the sales executive who owns the lead
--     2. that executive's sales coordinator
--     3. the owner
-- Another sales executive may change nothing. That last part already
-- holds and is untouched here: `leads` UPDATE is "own data or owner role",
-- so RLS never matches another rep's row in the first place.
--
-- ONE new restriction, in the opposite direction: a sales executive may
-- only move a lead FORWARD through the funnel. Walking it back to an
-- earlier stage — or reopening a deal already marked won/lost — stays a
-- coordinator/owner action.
--
-- ------------------------------------------------------------
-- THIS REVERSES TWO EARLIER DECISIONS. Both were deliberate; both were
-- re-confirmed as intentional reversals before this file was written, so
-- neither should be "restored" as a bug fix later:
--
--   1. migration_owner_only_stage.sql (2026-08-10) made stage changes
--      owner-only, at the owner's request — "a sales executive cannot
--      change stage of a lead". Reps get that back here, forward-only.
--
--   2. migration_sales_coordinator.sql STEP 4b's enforce_coordinator_lock()
--      dropped a coordinator to stage/follow-up/order-value only, once the
--      lead's exec had saved it themselves. That lock is REMOVED — a
--      coordinator now edits a team lead's details at any time.
--
--      Note what this gives up: an exec no longer has a guarantee that a
--      record they saved cannot be edited underneath them. `entered_by_role`
--      keeps being stamped by stamp_entered_by_role() and stays readable as
--      an audit field — it simply stops being a lock. lead_change_log still
--      records every value edit and who made it, so the history survives.
--
-- ------------------------------------------------------------
-- ORDER: run this AFTER migration_sales_coordinator.sql, which is itself
-- after migration_backlog_2026_08_10.sql. Both of those install the
-- owner-only version of the stage trigger this file replaces; running them
-- afterwards would silently revert STEP 1 back to owner-only. The function
-- and trigger NAMES are kept as-is (`enforce_owner_only_stage_change` /
-- `owner_only_stage_change`) even though the name is now historical —
-- renaming would mean an older file's re-run installs a SECOND, stricter
-- trigger alongside this one rather than cleanly overwriting it.
--
-- Safe to re-run.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: stage changes — all three roles, forward-only for the exec
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The 8 sequential funnel stages. Mirrors FUNNEL_SEQUENCE in
  -- src/lib/stageProgress.js — keep the two in step.
  seq CONSTANT text[] := ARRAY[
    'calling','presentation','joinery_follow_up','measurements',
    'design_discussion','rfq','quote_submission','negotiation'
  ];
  caller_role text;
  from_stage  text;
  from_rank   int;
  to_rank     int;
BEGIN
  IF NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN
    RETURN NEW;
  END IF;

  -- Admin SQL run in the Supabase SQL Editor has no auth.uid(), so
  -- current_employee_role() is NULL there. Carried over unchanged from
  -- migration_owner_only_stage.sql: without this, bulk stage fixes run by
  -- hand would abort. A deactivated employee has a real auth.uid() but a
  -- NULL role, so they are still caught by the role test below.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := COALESCE(current_employee_role(), '');

  IF caller_role NOT IN ('owner','sales_coordinator','sales_executive') THEN
    RAISE EXCEPTION 'You do not have permission to change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Owner and coordinator move a stage in any direction, including back.
  IF caller_role <> 'sales_executive' THEN
    RETURN NEW;
  END IF;

  -- ---- sales_executive only, from here down: forward moves only ----

  -- Reopening a decided deal moves money back out of a reported figure.
  -- Treated as the largest reversal there is, whatever it reopens into.
  IF OLD.current_stage IN ('won','lost') THEN
    RAISE EXCEPTION
      'This deal is already marked %. Ask your coordinator or the owner to reopen it.',
      OLD.current_stage
      USING ERRCODE = 'check_violation';
  END IF;

  -- An on-hold lead is ranked at the stage it actually paused at, so a
  -- detour through On hold cannot launder a backward move (negotiation ->
  -- on_hold -> calling). Same derivation LeadDetail's stepper uses: the
  -- most recent non-on-hold history row, falling back to 'calling' for a
  -- lead never explicitly moved (its 'calling' is a column DEFAULT, not a
  -- logged change, so no stage_history row exists for it).
  IF OLD.current_stage = 'on_hold' THEN
    SELECT sh.stage INTO from_stage
      FROM stage_history sh
     WHERE sh.lead_id = OLD.id
       AND sh.stage <> 'on_hold'
     ORDER BY sh.changed_at DESC
     LIMIT 1;
    from_stage := COALESCE(from_stage, 'calling');
  ELSE
    from_stage := OLD.current_stage;
  END IF;

  from_rank := array_position(seq, from_stage);
  to_rank   := array_position(seq, NEW.current_stage);

  -- An off-funnel destination (on_hold / won / lost) has no rank and is
  -- never "backward" — pausing or closing a deal is always allowed. An
  -- unrecognised legacy current_stage has no rank either, and is left
  -- alone rather than guessed at.
  IF from_rank IS NOT NULL AND to_rank IS NOT NULL AND to_rank < from_rank THEN
    RAISE EXCEPTION
      'A sales executive can only move a lead forward. Ask your coordinator or the owner to move it back.'
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


-- ------------------------------------------------------------
-- STEP 2: stage_history INSERT — add the lead's own executive
--
-- LeadStageSection.jsx writes `leads` and `stage_history` together, so a
-- rep who can now change a stage must be able to record it, or the change
-- succeeds and its audit row fails. Added as a SEPARATE permissive policy
-- (they OR together) so the existing owner_only_insert and
-- coordinator_team_insert are untouched.
--
-- stage_history stays append-only for everyone: no UPDATE or DELETE policy
-- exists for any role, and none is added here.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "own_lead_insert" ON stage_history;
CREATE POLICY "own_lead_insert" ON stage_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND leads.owner_employee_id = current_employee_id()
    )
  );


-- ------------------------------------------------------------
-- STEP 3: remove the coordinator lock on leads
--
-- The column-level lock that restricted a coordinator to
-- current_stage / next_followup_date / order_value once the lead's exec
-- had saved it. Dropping the trigger is what actually lifts the
-- restriction; the function is dropped too so it cannot be re-attached by
-- accident and read as still-live.
--
-- DELIBERATELY NOT TOUCHED: the matching row-level lock on `activities`
-- (coordinator_team_update's `entered_by_role IS DISTINCT FROM
-- 'sales_executive'` clause, migration_sales_coordinator.sql STEP 5). An
-- activity is a record of something a person did on a date, not a property
-- of the lead — editing someone else's is a different question from
-- editing the lead, and was not part of what was asked for. Say so if that
-- should change too.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS enforce_coordinator_lock ON leads;
DROP FUNCTION IF EXISTS enforce_coordinator_lock();


-- ============================================================
-- VERIFY — run these after the migration
-- ============================================================

-- 1. The lock trigger is gone; the stage trigger is still present.
--    Expect exactly one row: owner_only_stage_change (plus the unrelated
--    log_lead_changes_* / stamp_* triggers).
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal
--  ORDER BY tgname;

-- 2. enforce_coordinator_lock() no longer exists. Expect 0 rows.
-- SELECT proname FROM pg_proc WHERE proname = 'enforce_coordinator_lock';

-- 3. The stage function admits all three roles. Expect the body to contain
--    'sales_executive'.
-- SELECT prosrc LIKE '%sales_executive%' AS admits_exec
--   FROM pg_proc WHERE proname = 'enforce_owner_only_stage_change';

-- 4. stage_history INSERT policies. Expect three: coordinator_team_insert,
--    own_lead_insert, owner_only_insert.
-- SELECT policyname FROM pg_policies
--  WHERE tablename = 'stage_history' AND cmd = 'INSERT'
--  ORDER BY policyname;
