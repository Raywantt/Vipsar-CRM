-- ============================================================
-- MIGRATION: retire the `measurements` and `design_discussion` lead
--            stages, and rename `rfq`'s label to "RFQ Raised".
--
-- Owner's ruling, 2026-09-08:
--   * `measurements` is removed as a stage. Every lead currently sitting at
--     `measurements` moves to `joinery_follow_up`.
--   * `design_discussion` is removed as a stage. Every lead currently
--     sitting at `design_discussion` moves to `rfq`.
--   * `rfq` itself is unaffected as a VALUE — only its display label
--     changes, app-side, to "RFQ Raised" (src/lib/leadStageOptions.js).
--     That half needs no SQL at all.
--
-- current_stage / stage_history.stage are still free text at the DB layer
-- (no CHECK constraint — see DECISIONS.md), so this is a pure DATA
-- migration: no ALTER of any constraint, same shape as the earlier
-- new/hot/quote -> calling/negotiation/quote_submission rename in
-- migration_backlog_2026_08_10.sql. Safe to re-run — every UPDATE below
-- matches zero rows once it has already run once.
--
-- The funnel-order trigger (enforce_owner_only_stage_change, which
-- enforces the sales_executive/sales_manager forward-only rule) hardcodes
-- the same funnel sequence as src/lib/stageProgress.js's FUNNEL_SEQUENCE —
-- see that function's own comment: "keep the two in step". STEP 3 below
-- redeploys it with the two retired stages removed from its `seq` array,
-- matching the app-layer list exactly.
--
-- ORDER: run this AFTER migration_sales_manager.sql (already live) — STEP 3
-- replaces the version of enforce_owner_only_stage_change() that file
-- installs. Re-running migration_sales_manager.sql, migration_lead_edit_
-- rights.sql, migration_sales_coordinator.sql or migration_backlog_
-- 2026_08_10.sql afterward would silently revert STEP 3 back to a `seq`
-- array that still contains the two retired stages — re-run this file
-- again if that ever happens.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: leads.current_stage
-- ------------------------------------------------------------
UPDATE leads SET current_stage = 'joinery_follow_up' WHERE current_stage = 'measurements';
UPDATE leads SET current_stage = 'rfq'               WHERE current_stage = 'design_discussion';


-- ------------------------------------------------------------
-- STEP 2: stage_history.stage — keep the historical trail consistent with
-- the live column above. Costs nothing if it matches zero rows.
-- ------------------------------------------------------------
UPDATE stage_history SET stage = 'joinery_follow_up' WHERE stage = 'measurements';
UPDATE stage_history SET stage = 'rfq'               WHERE stage = 'design_discussion';


-- ------------------------------------------------------------
-- STEP 3: redeploy the funnel-order trigger with the corrected sequence
--
-- Reproduced VERBATIM from migration_sales_manager.sql's STEP 8 (the
-- version currently live), with only the `seq` array's contents changed —
-- everything else (which roles land on which side of the forward-only
-- branch, the won/lost reopening rule, the on_hold laundering defence, the
-- admin-SQL guard) is untouched.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The 6 sequential funnel stages. Mirrors FUNNEL_SEQUENCE in
  -- src/lib/stageProgress.js — keep the two in step. (measurements and
  -- design_discussion retired 2026-09-08 — see this file's own header.)
  seq CONSTANT text[] := ARRAY[
    'calling','presentation','joinery_follow_up',
    'rfq','quote_submission','negotiation'
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
  -- current_employee_role() is NULL there — without this, bulk stage fixes
  -- run by hand would abort. A deactivated employee has a real auth.uid()
  -- but a NULL role, so they are still caught by the role test below.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := COALESCE(current_employee_role(), '');

  IF caller_role NOT IN ('owner','sales_coordinator','sales_executive','sales_manager') THEN
    RAISE EXCEPTION 'You do not have permission to change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Owner and coordinator move a stage in any direction, including back.
  IF caller_role IN ('owner','sales_coordinator') THEN
    RETURN NEW;
  END IF;

  -- ---- sales_executive and sales_manager, from here down: forward only ----

  -- Reopening a decided deal moves money back out of a reported figure.
  -- Treated as the largest reversal there is, whatever it reopens into.
  IF OLD.current_stage IN ('won','lost') THEN
    RAISE EXCEPTION
      'This deal is already marked %. Ask a coordinator or the owner to reopen it.',
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
  -- unrecognised legacy current_stage has no rank either (which now
  -- includes a stray measurements/design_discussion row this migration
  -- somehow missed) — left alone rather than guessed at.
  IF from_rank IS NOT NULL AND to_rank IS NOT NULL AND to_rank < from_rank THEN
    RAISE EXCEPTION
      'You can only move a lead forward. Ask a coordinator or the owner to move it back.'
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


-- ============================================================
-- VERIFY — run these after the migration
-- ============================================================

-- 1. No lead is left at either retired stage. Expect 0 rows.
-- SELECT id, current_stage FROM leads
--  WHERE current_stage IN ('measurements','design_discussion');

-- 2. No stage_history row is left at either retired stage. Expect 0 rows.
-- SELECT id, stage FROM stage_history
--  WHERE stage IN ('measurements','design_discussion');

-- 3. The trigger function's body reflects the new 6-stage array (no
--    'measurements'/'design_discussion' literal left in it). Expect false.
-- SELECT prosrc LIKE '%measurements%' OR prosrc LIKE '%design_discussion%' AS still_has_retired_stages
--   FROM pg_proc WHERE proname = 'enforce_owner_only_stage_change';

-- 4. Spot-check counts moved where expected — compare against what STEP 1
--    reported as UPDATE ... rows before running this query (should now be 0
--    at the old values, and the joinery_follow_up/rfq counts should have
--    grown by the same amount).
-- SELECT current_stage, count(*) FROM leads GROUP BY current_stage ORDER BY current_stage;
