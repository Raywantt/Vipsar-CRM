-- ============================================================
-- Adds the new "Architect Meeting" activity type (2026-08-09).
-- Run this in the Supabase Dashboard's SQL Editor — the anon key this app
-- runs on can't execute DDL. Both sections are independent; if one errors
-- you can still safely run the other.
-- ============================================================


-- ------------------------------------------------------------
-- 1) activities.activity_type: add 'architect_meeting'
--    Fixes: Log Activity's new "Architect Meeting" button fails to save.
--
--    Run this SELECT FIRST to confirm the real constraint name (this one
--    was never confirmed against a live error).
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
    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting'));


-- ------------------------------------------------------------
-- 2) follow_ups.activity_type: add 'architect_meeting'
--    Fixes: FollowUpForm's "Type of follow-up" chip picker now offers
--    Architect Meeting (it's built off the same ACTIVITY_TYPES list as
--    Activity Log) — without this, picking that chip on a manually-created
--    reminder (Home's "+ Add reminder", a Sales Exec Profile's "+ Assign
--    follow-up") would fail to save.
--
--    Run this SELECT FIRST too, same reasoning as above.
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
    ('site_visit','call','rfq_raised','office_day','booking_update','architect_meeting','other'));
