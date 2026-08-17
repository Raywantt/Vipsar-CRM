-- ============================================================
-- Adds two new activity types, 'client_meeting' and 'design_sheet'
-- (2026-08-17).
--
-- Run this in the Supabase Dashboard's SQL Editor — the anon key this app
-- runs on can't execute DDL.
--
-- UNTIL THIS RUNS, the two new buttons on Log Activity render fine but fail
-- to save, with a CHECK-constraint violation surfaced as a normal inline
-- error. Nothing else in the app breaks in the meantime.
--
-- Both sections are independent; if one errors you can still safely run the
-- other. Both are safe to re-run (each drops its constraint before adding it
-- back), and neither touches existing rows — this only widens what's allowed.
-- ============================================================


-- ------------------------------------------------------------
-- 1) activities.activity_type: add 'client_meeting' and 'design_sheet'
--    Fixes: Log Activity's two new buttons fail to save.
--
--    The constraint name below was confirmed against a real live error when
--    'architect_meeting' was added, so it should be right — but run this
--    SELECT first anyway to be sure.
-- ------------------------------------------------------------
SELECT conname
FROM pg_constraint
WHERE conrelid = 'activities'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%activity_type%';

-- If that returned activities_activity_type_check, run these two lines as-is.
-- If it returned a different name, swap that name into both lines below.
ALTER TABLE activities DROP CONSTRAINT activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN
    ('site_visit','call','client_meeting','architect_meeting',
     'rfq_raised','design_sheet','office_day','booking_update'));


-- ------------------------------------------------------------
-- 2) follow_ups.activity_type: add the same two values
--    Fixes: FollowUpForm's "Type of follow-up" chip picker is built off the
--    same ACTIVITY_TYPES list as Log Activity, so it now offers Client
--    Meeting and Design Sheet chips. Without this, picking either on a
--    manually-created reminder (Home's "+ Add reminder", a Sales Exec
--    Profile's "+ Assign follow-up", a lead's "Set follow-up") would fail to
--    save — a failure with nothing to do with Log Activity, which is exactly
--    why this half is easy to forget.
--
--    Note this list also keeps 'other', which the two flows that create a
--    follow-up on the user's behalf rely on (LeadStageSection's On Hold, and
--    Log Activity's own Architect Meeting).
--
--    Run this SELECT first too, same reasoning as above.
-- ------------------------------------------------------------
SELECT conname
FROM pg_constraint
WHERE conrelid = 'follow_ups'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%activity_type%';

-- If that returned follow_ups_activity_type_check, run these two lines as-is.
-- If it returned a different name, swap that name into both lines below.
ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_activity_type_check;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_activity_type_check
  CHECK (activity_type IS NULL OR activity_type IN
    ('site_visit','call','client_meeting','architect_meeting',
     'rfq_raised','design_sheet','office_day','booking_update','other'));


-- ------------------------------------------------------------
-- 3) VERIFY — both should list the new values.
-- ------------------------------------------------------------
SELECT 'activities' AS table_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'activities'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%activity_type%'
UNION ALL
SELECT 'follow_ups', pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'follow_ups'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%activity_type%';
