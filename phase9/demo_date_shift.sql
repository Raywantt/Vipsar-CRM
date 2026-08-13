-- ===========================================================================
-- PHASE 9 — DEMO DATE SHIFT (optional, run only if the demo slips)
--
-- NOT a migration and NOT part of the seed. The plan pins a handful of rows to
-- REFERENCE_DATE 2026-08-12: follow-ups categorised due_today /
-- due_tomorrow, and the nearest leads.next_followup_date values. Everything
-- else was seeded with margin around its threshold and does not need touching.
--
-- Runs in the Supabase SQL Editor as-is: the shift is computed from the
-- database's own CURRENT_DATE against the reference date, so there is nothing
-- to edit and no psql meta-command (\set) — the SQL Editor does not support
-- those. Running it on 2026-08-12 itself is a no-op.
--
-- ⚠️ RUN THIS ONCE. It is NOT idempotent — it applies a delta, so running it
-- twice on the same day shifts everything twice. There is no marker column to
-- detect a previous run from. Preview first with the SELECT immediately below;
-- if the "would move to" dates already look right, do not run the UPDATEs.
--
-- Shifting only the near-future rows keeps the historical record intact —
-- it never touches created_at, changed_at, or any completed follow-up.
-- ===========================================================================

-- PREVIEW (safe, read-only) — run this on its own first.
SELECT
  CURRENT_DATE - DATE '2026-08-12'                   AS shift_days,
  count(*) FILTER (WHERE is_done = false
                     AND due_date >= DATE '2026-08-12') AS open_follow_ups_affected,
  min(due_date) FILTER (WHERE is_done = false
                     AND due_date >= DATE '2026-08-12') AS earliest_now,
  min(due_date) FILTER (WHERE is_done = false
                     AND due_date >= DATE '2026-08-12')
    + (CURRENT_DATE - DATE '2026-08-12')             AS earliest_would_move_to
FROM follow_ups;

BEGIN;

-- Open follow-ups only. A done follow-up is history and must not move.
UPDATE follow_ups
   SET due_date = due_date + (CURRENT_DATE - DATE '2026-08-12')
 WHERE is_done = false
   AND due_date >= DATE '2026-08-12';

-- Future follow-up dates on leads. Anything already in the past is a real
-- overdue signal the dashboards are meant to show — leave it alone.
UPDATE leads
   SET next_followup_date = next_followup_date + (CURRENT_DATE - DATE '2026-08-12')
 WHERE next_followup_date >= DATE '2026-08-12';

COMMIT;

SELECT 'follow_ups open, due today' AS what, count(*) FROM follow_ups WHERE is_done = false AND due_date = CURRENT_DATE
UNION ALL
SELECT 'follow_ups open, overdue',            count(*) FROM follow_ups WHERE is_done = false AND due_date < CURRENT_DATE
UNION ALL
SELECT 'leads with follow-up due today',      count(*) FROM leads WHERE next_followup_date = CURRENT_DATE
UNION ALL
SELECT 'leads with follow-up overdue',        count(*) FROM leads WHERE next_followup_date < CURRENT_DATE;
