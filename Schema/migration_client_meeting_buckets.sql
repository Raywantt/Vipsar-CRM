-- =====================================================================
-- Client Meeting -> two umbrellas: Old Meeting / New Meeting
-- Written 2026-09-07. Safe to re-run.
--
-- WHAT THIS DOES
--   A Client Meeting is no longer one activity type. Every meeting is now
--   stored as either 'client_meeting_old' or 'client_meeting_new', decided
--   from the LEAD'S STAGE AT THE MOMENT IT IS LOGGED:
--
--       RFQ and later  ->  Old Meeting
--         rfq, quote_submission, negotiation, and also on_hold / won / lost
--       Anything earlier -> New Meeting
--         calling, presentation, joinery_follow_up, measurements,
--         design_discussion (and any unrecognised legacy stage)
--
--   The app-layer copy of that rule is src/lib/meetingBucket.js. Keep the two
--   in step; this file is only the storage half.
--
-- WHY THE BUCKET IS STORED, NOT DERIVED
--   An activity records what a rep did on a day. If the bucket were computed
--   live from the lead's current stage, a stage move next week would silently
--   rewrite last month's activity report — a meeting held while the lead was
--   at 'calling' would retroactively become an Old Meeting. Freezing it at
--   insert time is the only version of this that a manager can trust.
--
-- ⚠️ RUN THIS IN TWO PARTS, WITH THE DEPLOY IN BETWEEN. THE ORDER MATTERS.
--
--     PART A (steps 1-2)  ->  deploy the new build  ->  PART B (step 3)
--
--   Doing it in one go leaves a window in which Client Meeting logging is
--   BROKEN for every rep, whichever end you start from -- and the window is
--   symmetric, which is easy to miss:
--     * migrate everything first, deploy later -> the build still live writes
--       the plain 'client_meeting', which PART B has just outlawed.
--     * deploy first, migrate later -> the new build writes
--       'client_meeting_old'/'_new', which the CHECK does not allow yet.
--   PART A alone closes both, because it leaves ALL THREE values legal: the
--   old build and the new build can both write successfully while the deploy
--   rolls out. PART B then removes the retired value once nothing writes it.
--   There is no rush on PART B -- minutes or days later is equally fine, and
--   nothing is broken while it waits.
--
-- WHY THE UNBUCKETED VALUE IS REMOVED FROM THE CHECK (PART B / STEP 3)
--   The owner asked for the CRM to bucket meetings "on its own". A CHECK that
--   refuses the plain 'client_meeting' value is what makes that a guarantee
--   rather than a convention: no future write path — app code, an import
--   script, or a hand-typed INSERT in the SQL editor — can create a meeting
--   that sits outside both umbrellas and therefore gets counted by neither
--   Dashboard row. STEP 2 runs first precisely so the constraint has nothing
--   left to reject.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   * follow_ups.activity_type -- still allows 'client_meeting' and gains
--     neither new value. A reminder is about work not yet done, so it has no
--     bucket to belong to; FollowUpForm's chip picker reads
--     LOGGABLE_ACTIVITY_TYPES, which keeps the single Client Meeting chip.
--   * targets rows keyed on metric_name = 'client_meeting'. Client Meeting is
--     now TWO targetable metrics (the owner's ruling), so an old combined
--     target no longer computes an actual and is simply never displayed —
--     inert, not harmful. STEP 4 lists any that exist so they can be
--     re-entered against whichever umbrella they were really meant for.
--     Nothing is guessed at automatically.
--
-- ORDERING: independent of every other migration in this folder. It touches
-- no policy, trigger or function, and new CHECK values inherit the table's
-- existing grants and RLS, so nothing in rls_policies.sql needs re-running.
-- =====================================================================


-- =====================================================================
-- PART A -- RUN THIS FIRST, BEFORE DEPLOYING THE NEW BUILD.
--           Nothing is broken while PART A is live on its own: all three
--           values are legal, so whichever build a rep happens to be running
--           can log a Client Meeting successfully.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 -- allow the two new values, alongside the old one.
-- ---------------------------------------------------------------------
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;

ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN
    ('site_visit','call','client_meeting','client_meeting_old','client_meeting_new',
     'architect_meeting','rfq_raised','design_sheet','office_day','booking_update'));


-- ---------------------------------------------------------------------
-- STEP 2 -- backfill every pre-existing meeting as an OLD MEETING.
--
-- The owner's ruling (2026-09-07), chosen over bucketing each row by its
-- lead's stage TODAY. Roughly 187 of these came from the legacy imports, and
-- their leads have moved on since — so "the stage now" is not the stage the
-- meeting was actually held at, and per-row it would produce a confident but
-- fabricated answer. One stated blanket assumption is honest; 187 individual
-- guesses that read identically to real data are not.
--
-- Re-running is a no-op: after this there are no 'client_meeting' rows left,
-- and STEP 3's constraint makes it impossible to create another.
-- ---------------------------------------------------------------------
UPDATE activities
   SET activity_type = 'client_meeting_old'
 WHERE activity_type = 'client_meeting';


-- =====================================================================
-- PART B -- RUN THIS ONLY AFTER THE NEW BUILD IS LIVE AND A REAL CLIENT
--           MEETING HAS LOGGED SUCCESSFULLY. Safe to leave for later; the
--           CRM is fully working without it. All it does is make the
--           retired value permanently unwritable.
--
--           If you run PART B while an OLD build is still being served to
--           anyone (a phone that has not picked up the deploy yet -- see
--           the Auto-update section of CLAUDE.md), that person's Client
--           Meeting saves will fail until their app updates.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 3 -- close the door on the unbucketed value. See the header note.
-- ---------------------------------------------------------------------
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;

ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN
    ('site_visit','call','client_meeting_old','client_meeting_new',
     'architect_meeting','rfq_raised','design_sheet','office_day','booking_update'));


-- ---------------------------------------------------------------------
-- STEP 4 -- VERIFY. Run these and read the output; none of them change data.
--           4a/4b/4d are meaningful right after PART A; 4c only passes once
--           PART B has run.
-- ---------------------------------------------------------------------

-- 4a. Expect: zero rows. Any row here means STEP 2 did not run.
SELECT count(*) AS unbucketed_meetings_should_be_zero
  FROM activities
 WHERE activity_type = 'client_meeting';

-- 4b. Expect: client_meeting_old carrying every historical meeting, and
--     client_meeting_new at 0 until the first one is logged through the app.
SELECT activity_type, count(*) AS rows
  FROM activities
 WHERE activity_type IN ('client_meeting','client_meeting_old','client_meeting_new')
 GROUP BY activity_type
 ORDER BY activity_type;

-- 4c. Expect: the constraint listing client_meeting_old and client_meeting_new
--     and NOT plain client_meeting.
SELECT pg_get_constraintdef(oid) AS activity_type_check
  FROM pg_constraint
 WHERE conname = 'activities_activity_type_check';

-- 4d. Targets stranded on the retired combined metric. Anything listed here
--     needs re-entering via Dashboard -> "+ Set a target" against Old
--     Meetings and/or New Meetings. Expect: often zero rows.
SELECT t.id, e.name AS employee, t.period_type, t.period_value, t.target_value
  FROM targets t
  JOIN employees e ON e.id = t.employee_id
 WHERE t.metric_name = 'client_meeting'
 ORDER BY e.name;

-- 4e. Sanity-check the rule itself against live data: how today's meetings
--     line up with their leads' CURRENT stage. Rows where an OLD meeting sits
--     on a below-RFQ lead (or vice versa) are EXPECTED and correct — the
--     bucket is frozen at logging time and the lead has moved since. This is
--     here to read, not to "fix".
SELECT a.activity_type, l.current_stage, count(*) AS rows
  FROM activities a
  LEFT JOIN leads l ON l.id = a.lead_id
 WHERE a.activity_type IN ('client_meeting_old','client_meeting_new')
 GROUP BY a.activity_type, l.current_stage
 ORDER BY a.activity_type, count(*) DESC;
