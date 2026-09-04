-- ============================================================
-- MIGRATION: targets — one row per employee/period/metric, enforced  (2026-09-04)
--
-- WHY: "Set a target" (SetTargetForm.jsx) has always done a plain INSERT,
-- with no check for an existing target and no UNIQUE constraint in the
-- schema to stop one. So correcting a target — the owner's own description
-- of what happened here — silently created a SECOND, conflicting row next
-- to the first instead of replacing it. targetFor() (the one place a target
-- is looked up, TargetsVsActualsCard.jsx) takes the FIRST matching row with
-- no tiebreak of its own, so which of several conflicting targets "won" on
-- screen depended purely on query order — undefined before the 2026-09-04
-- row-cap fix, and deterministic-by-id after it, but never something the
-- owner could see or control either way.
--
-- Found live on 2026-09-04, auditing the pipeline dashboard after a separate
-- reported bug: employee 33 (Vipul Sharma) carried THREE order_value targets
-- for the same week (2026-W36) — ₹25L, ₹5L, ₹50L, ids 135/136/139 — with the
-- heatmap silently showing 38% attainment against the ₹25L row while the
-- other two sat unused. A second, harmless duplicate (same value both times)
-- was found for employee 27's month site_visit target, ids 125/127.
--
-- THE FIX HAS TWO HALVES, BOTH NEEDED:
--   1. This migration — clears today's duplicates (keeping the HIGHEST id in
--      each group, i.e. the most recently created row — the owner's own
--      choice for the Vipul case, keeping ₹50L / id 139) and adds a UNIQUE
--      constraint so a duplicate can never be created again.
--   2. src/lib/targetQueries.js's insertTarget() — changed from a plain
--      .insert() to a .upsert() keyed on this exact constraint, so "Set a
--      target" now genuinely REPLACES an existing target instead of stacking
--      a new row beside it. That code is already pushed; it depends on the
--      constraint below existing, so until this migration runs, Set a target
--      fails with a Postgres "no unique or exclusion constraint matching the
--      ON CONFLICT specification" error, surfaced inline like any other save
--      error (the exact same "ship the code, land the migration, accept a
--      clean error in between" pattern this repo already follows for e.g.
--      migration_architect_meeting.sql) — RUN THIS PROMPTLY, since target-
--      setting is a routinely-used feature, not a rare one.
--
-- Safe to re-run: STEP 1's DELETE only ever matches a row that has a higher-
-- id sibling in the same group, so a second run (once no duplicates remain)
-- deletes 0 rows. STEP 2 uses DROP CONSTRAINT IF EXISTS before the ADD.
--
-- ORDERING: independent of every other migration in this folder — touches
-- only the targets table, no trigger/function/other-table policy involved.
-- ============================================================


-- ============================================================
-- STEP 0 — LOOK FIRST. Expect exactly two groups on 2026-09-04 data:
--   employee_id 27, month, 2026-09, site_visit  → 2 rows, both value 40
--   employee_id 33, week,  2026-W36, order_value → 3 rows: 2500000, 500000, 5000000
-- ============================================================

SELECT employee_id, period_type, period_value, metric_name,
       COUNT(*) AS row_count,
       array_agg(id ORDER BY id)           AS ids,
       array_agg(target_value ORDER BY id) AS values_in_id_order
  FROM targets
 GROUP BY employee_id, period_type, period_value, metric_name
HAVING COUNT(*) > 1
 ORDER BY employee_id, period_type, period_value, metric_name;


-- ============================================================
-- STEP 1 — keep the highest-id row per group (the most recently created —
-- the real, latest-intended target), delete the rest.
-- ============================================================

DELETE FROM targets t
 WHERE EXISTS (
   SELECT 1
     FROM targets t2
    WHERE t2.employee_id  = t.employee_id
      AND t2.period_type  = t.period_type
      AND t2.period_value = t.period_value
      AND t2.metric_name  = t.metric_name
      AND t2.id > t.id
 );


-- ============================================================
-- STEP 2 — make a duplicate impossible going forward. This is the
-- constraint insertTarget()'s .upsert(..., { onConflict: '...' }) needs to
-- exist at all; without it, Postgres refuses ON CONFLICT with "there is no
-- unique or exclusion constraint matching the specification".
-- ============================================================

ALTER TABLE targets DROP CONSTRAINT IF EXISTS targets_employee_period_metric_unique;
ALTER TABLE targets
  ADD CONSTRAINT targets_employee_period_metric_unique
  UNIQUE (employee_id, period_type, period_value, metric_name);


-- ============================================================
-- VERIFICATION — run after STEP 1 and STEP 2.
-- ============================================================
--
-- 1. No group should have more than one row left:
--      SELECT employee_id, period_type, period_value, metric_name, COUNT(*)
--        FROM targets GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
--    Expect ZERO rows back.
--
-- 2. Vipul's week order_value target is now exactly the ₹50L row:
--      SELECT id, target_value FROM targets
--       WHERE employee_id = 33 AND period_type = 'week'
--         AND period_value = '2026-W36' AND metric_name = 'order_value';
--    Expect exactly one row: id 139, target_value 5000000.
--
-- 3. Total row count dropped by exactly 2 (18 → 16) — this migration only
--    ever removes rows, it never adds or edits one.
--      SELECT COUNT(*) FROM targets;
--
-- 4. The constraint exists:
--      SELECT conname FROM pg_constraint
--       WHERE conname = 'targets_employee_period_metric_unique';
--    Expect one row back.
