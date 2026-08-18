-- ============================================================
-- MIGRATION: activities — Office Day fields + Client Meeting location
--            (2026-08-18)
--
-- Three unrelated-looking columns, one migration because they land on the
-- same table from the same pass on the Log Activity screen:
--
--   1. work_summary            — Office Day's "What did you do?"
--   2. start_time / end_time   — Office Day's time range (From / Till)
--   3. meeting_location        — Client Meeting's Site / Office tap-select
--
-- Run this in the Supabase SQL Editor. Until it runs, saving an Office Day
-- or a Client Meeting fails outright with, respectively:
--     column "work_summary" of relation "activities" does not exist
--     column "meeting_location" of relation "activities" does not exist
-- surfaced as a normal inline error on the form. The other six activity
-- types are unaffected either way — they write none of these columns.
--
-- Safe to re-run: every statement is IF NOT EXISTS / DROP ... IF EXISTS.
--
-- ORDERING: independent of every other migration in this folder. It touches
-- no policy, trigger or function, so it can run before or after any of them.
-- New columns inherit the table's existing grants and RLS policies, so
-- nothing in rls_policies.sql needs re-running either.
-- ============================================================


-- ---------- STEP 1: Office Day — what the rep actually did ----------
--
-- Deliberately its own column rather than reusing `notes`. The screen asks
-- both questions ("What did you do?" and a free Notes box), so folding them
-- into one column would silently merge two fields the rep filled separately
-- and make either one unreadable on its own afterwards.
--
-- NULLABLE even though the UI makes it required, for the same reason
-- leads.office_territory is: every Office Day logged before today has no
-- summary, and there is nothing honest to backfill one with. NULL reads as
-- "logged before we asked this", which is true.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS work_summary TEXT;


-- ---------- STEP 2: Office Day — the time range ----------
--
-- TIME, not TIMESTAMP: these are clock times within the day the activity was
-- logged, not instants. Same type and same reasoning as follow_ups.due_time,
-- which is the only other clock-time column in this schema.
--
-- NOTE this schema's timestamps are naive (see the Day Review section of
-- CLAUDE.md) — a TIME column sidesteps that entirely, since there is no zone
-- to lose. A rep typing 09:30 means half past nine where they are standing.
--
-- No CHECK that end_time > start_time. Ordering is a data-quality question,
-- not a structural one, and a constraint violation here would surface as an
-- opaque Postgres error on a form the rep can't argue with.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS end_time TIME;


-- ---------- STEP 3: Client Meeting — where it happened ----------
--
-- A closed list with a real CHECK, matching leads.source_type and
-- leads.office_territory — a fixed business fact picked from a tap-select,
-- not a judgement a rep types. The `IS NULL OR` branch is what lets every
-- client meeting logged before today stay valid.
--
-- Values are the lowercase slugs the app stores; the human labels live in
-- src/lib/meetingLocationOptions.js. Keep the two in sync.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS meeting_location TEXT;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_meeting_location_check;
ALTER TABLE activities
  ADD CONSTRAINT activities_meeting_location_check
  CHECK (meeting_location IS NULL OR meeting_location IN ('site','office'));


-- ============================================================
-- VERIFICATION — run these after.
-- ============================================================

-- 1. All four columns exist, all nullable:
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'activities'
--    AND column_name IN ('work_summary','start_time','end_time','meeting_location')
--  ORDER BY column_name;
--
--    Expect 4 rows: end_time | time without time zone | YES
--                   meeting_location | text | YES
--                   start_time | time without time zone | YES
--                   work_summary | text | YES

-- 2. The CHECK is installed with both values:
--
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'activities_meeting_location_check';
--
--    Expect a CHECK listing 'site' and 'office'.

-- 3. Nothing was disturbed — every existing activity still reads NULL on all
--    four, and the row count is unchanged:
--
-- SELECT count(*) AS total,
--        count(work_summary)     AS with_summary,
--        count(start_time)       AS with_start,
--        count(meeting_location) AS with_location
--   FROM activities;
--
--    Expect with_summary / with_start / with_location all 0 before any new
--    Office Day or Client Meeting is logged through the app.


-- ============================================================
-- ADDING A MEETING LOCATION LATER
-- ============================================================
-- A third location ("client's home", say) needs BOTH halves changed, or the
-- app offers a button that fails to save:
--
--   1. src/lib/meetingLocationOptions.js — add { value: 'x', label: 'X' }
--   2. this CHECK — re-run STEP 3 with the new value in the IN list
--
-- Same two-sided change leads.office_territory documents for its own list.
