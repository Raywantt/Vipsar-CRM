-- ============================================================
-- VIPSAR CRM — FULL OUTSTANDING MIGRATION BACKLOG (as of 2026-08-10)
--
-- Paste this whole file into the Supabase Dashboard's SQL Editor and Run.
-- It is safe to run in full, and safe to run again (every step is either
-- idempotent or a no-op the second time).
--
-- This supersedes running these individually:
--   Schema/migration_architect_meeting.sql
--   Schema/migration_scope_stage_history.sql
--   Schema/migration_owner_only_stage.sql
--   + the lead-stage taxonomy rename, which had no file of its own
--     (it lived only as loose statements in CLAUDE.md's Conventions)
--
-- ORDER MATTERS, and not in an obvious way. Step 4's trigger blocks any
-- stage change made by a non-owner. A trigger fires even for roles that
-- bypass RLS — triggers are not part of RLS — and in the SQL Editor there
-- is no JWT, so current_employee_role() returns NULL. If step 4 ran before
-- step 2, step 2's UPDATEs would abort with "Only an owner can change a
-- lead's stage". Step 4's function carries an `auth.uid() IS NOT NULL`
-- guard so admin SQL keeps working afterwards, but the ordering here is
-- belt-and-braces on top of that. Don't reshuffle these.
--
-- Step 5 at the bottom is verification — it changes nothing, just prints
-- what landed so you can confirm each step took.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 — Architect Meeting activity type
-- Fixes: tapping "Architect Meeting" in Log Activity fails to save with
-- `violates check constraint "activities_activity_type_check"`, and the
-- matching chip in any follow-up form fails the same way.
--
-- The constraint name is discovered rather than assumed — the activities
-- one was confirmed against a real live error, the follow_ups one never
-- was, which is why the original file made you run a SELECT by hand first.
-- The DO block removes that manual step, and makes this re-runnable (it
-- drops whichever check constraint currently governs activity_type,
-- including one this file added on a previous run).
-- ------------------------------------------------------------
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'activities'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%activity_type%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE activities DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN
    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting'));

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'follow_ups'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%activity_type%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE follow_ups DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_activity_type_check
  CHECK (activity_type IS NULL OR activity_type IN
    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting','other'));


-- ------------------------------------------------------------
-- STEP 2 — Lead stage taxonomy rename (one-time data migration)
-- The app's stage list was rebuilt into sales-team language; three values
-- were genuinely renamed and one retired. Until this runs, any live lead
-- still sitting at an old value renders as a plain grey chip showing the
-- raw string instead of a proper coloured stage chip.
--
--   new   -> calling
--   hot   -> negotiation   (the 'hot' value is retired entirely)
--   quote -> quote_submission
--
-- No CHECK constraint to alter — leads.current_stage and
-- stage_history.stage are both free text by design (see DECISIONS.md).
-- stage_history is remapped too, so the historical trail stays consistent
-- with the leads it describes.
-- ------------------------------------------------------------
ALTER TABLE leads ALTER COLUMN current_stage SET DEFAULT 'calling';

UPDATE leads SET current_stage = 'calling'          WHERE current_stage = 'new';
UPDATE leads SET current_stage = 'negotiation'      WHERE current_stage = 'hot';
UPDATE leads SET current_stage = 'quote_submission' WHERE current_stage = 'quote';

-- 'new' is included here for completeness even though stage_history should
-- never hold it (the initial stage is a column DEFAULT, never a logged
-- "change") — costs nothing if it matches zero rows, and prevents a stray
-- imported/hand-edited row from rendering as an unrecognized stage forever.
UPDATE stage_history SET stage = 'calling'          WHERE stage = 'new';
UPDATE stage_history SET stage = 'negotiation'      WHERE stage = 'hot';
UPDATE stage_history SET stage = 'quote_submission' WHERE stage = 'quote';


-- ------------------------------------------------------------
-- STEP 3 — Scope stage_history reads to your own leads
-- stage_history SELECT was open to any active employee, so a sales exec's
-- browser received lead_id/stage/changed_at for every lead in the company
-- on every Dashboard/Today/Profile load. Nothing displayed those rows (the
-- app drops them client-side), but they were in the raw network response.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_select" ON stage_history;
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON stage_history;
CREATE POLICY "own_data_or_owner_role_select" ON stage_history
  FOR SELECT USING (
    current_employee_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = stage_history.lead_id
        AND leads.owner_employee_id = current_employee_id()
    )
  );


-- ------------------------------------------------------------
-- STEP 4 — Only an owner may change a lead's stage
-- The app already hides "Change stage" from a sales exec; this is the
-- enforcement behind that, so it can't be done through the API either.
--
-- Why a trigger and not a policy: RLS decides which ROWS you may update,
-- not which COLUMNS. A sales exec must keep updating their own lead
-- (quote value, close date, follow-up date), so the row policy has to
-- stay permissive. Column-level GRANTs can't help either — both roles
-- authenticate as `authenticated`, so revoking UPDATE(current_stage)
-- would lock the owner out too.
--
-- NOTE: after this, a sales exec can no longer mark their own deal Won or
-- Lost — that becomes the owner's action. Reps still record the money
-- (Activity Log's Booking Update, and the Order value field on Sales
-- progress). If you'd rather reps could still close their own deals,
-- add `AND NEW.current_stage NOT IN ('won','lost')` to the IF below.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.uid() IS NOT NULL keeps admin SQL (this file included) and the
  -- service_role Edge Function working — both already bypass every policy
  -- in this schema, and `anon` still can't update leads because the RLS
  -- policy needs current_employee_id()/role, which are NULL for it. A
  -- deactivated employee IS still blocked: real auth.uid(), NULL role.
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

-- A stage change and its history row are written together by the app, so
-- leaving this INSERT open would let a rep record a stage change they can
-- no longer actually make. (stage_history has no UPDATE/DELETE policy for
-- anyone, including the owner — append-only by design.)
DROP POLICY IF EXISTS "authenticated_insert" ON stage_history;
DROP POLICY IF EXISTS "owner_only_insert" ON stage_history;
CREATE POLICY "owner_only_insert" ON stage_history
  FOR INSERT WITH CHECK (current_employee_role() = 'owner');


-- ------------------------------------------------------------
-- STEP 5 — VERIFICATION (read-only, changes nothing)
-- Run and eyeball. Each block says what "good" looks like.
-- ------------------------------------------------------------

-- 5a. Should return ZERO rows. Any row here means a lead is still on an
--     old stage value and will render as a grey unrecognized chip.
SELECT 'leads still on an old stage value' AS check_name,
       current_stage, count(*) AS rows
FROM leads
WHERE current_stage IN ('new','hot','quote')
GROUP BY current_stage;

-- 5b. Should return ZERO rows, same reason, for the historical trail.
SELECT 'stage_history still on an old stage value' AS check_name,
       stage, count(*) AS rows
FROM stage_history
WHERE stage IN ('new','hot','quote')
GROUP BY stage;

-- 5c. Both CHECK constraints should now list architect_meeting.
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('activities'::regclass, 'follow_ups'::regclass)
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%activity_type%';

-- 5d. stage_history should show exactly two policies:
--     own_data_or_owner_role_select (SELECT) and owner_only_insert (INSERT).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'stage_history'
ORDER BY cmd, policyname;

-- 5e. The trigger should exist and be enabled ('O' = enabled, origin).
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal;

-- 5f. Sanity: the current stage spread, so you can see the renames landed
--     where you expect (calling/negotiation/quote_submission populated).
SELECT current_stage, count(*) AS leads
FROM leads
GROUP BY current_stage
ORDER BY leads DESC;
