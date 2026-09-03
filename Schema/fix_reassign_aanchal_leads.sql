-- =============================================================
-- CORRECTION to import_vipul_legacy.sql (already committed)   -- v2
--
-- The legacy sheet's "CALLING NAME" column reads AT on 8 rows, and the
-- import created Aanchal Tripathi and gave her those leads. The decision
-- afterwards was that ALL 148 leads belong to Vipul and Aanchal should not
-- have been created at all.
--
-- WHAT MOVES (8 leads, about Rs 4.39 crore of open pipeline):
--   legacy #49 Varun Mittal . #70 RK Sethi . #22 Rajan Luthra . #131 Rajan
--   #124 Charanjit Singh Cheema . #123 Honey Bansal . #7 Aman Bansal
--   #40 Vinay Singla
--
-- v1 FAILED on lead_change_log_changed_by_fkey and rolled back, changing
-- nothing. Cause: the import's own INSERT trigger had already written 8
-- 'created' audit rows stamped with Aanchal, because stamp_lead_creator()
-- falls back to owner_employee_id when there is no logged-in user. v1 only
-- moved the seven references it expected. This version sweeps EVERY foreign
-- key that points at employees, so the delete cannot fail on a missed one.
--
-- ABOUT THE AUDIT ROWS - READ THIS
-- lead_change_log is append-only by design and this script REWRITES 8 of its
-- rows, repointing them from Aanchal to Vipul. That is defensible only
-- because those rows were written by the import itself minutes ago and
-- record an attribution that was never true: no person ever created those
-- leads as Aanchal. Leaving them would also contradict leads.created_by_
-- employee_id, which this script sets to Vipul.
-- If you would rather keep the audit trail untouched, run STEP 1 only and
-- skip STEP 2 - Aanchal's record then stays in employees, deactivated,
-- owning nothing. Both outcomes are defensible; this one is tidier, that
-- one is stricter.
--
-- Changing owner_employee_id creates no NEW audit rows - the UPDATE branch
-- of log_lead_changes() only records quote_value, order_value and product.
--
-- Deliberately NOT writing lead_owner_history rows: nothing was really
-- handed over, and a history entry would claim a reassignment that never
-- happened.
-- =============================================================

BEGIN;

CREATE TEMP TABLE fix ON COMMIT DROP AS
SELECT
  (SELECT id FROM employees WHERE lower(btrim(name)) = 'vipul sharma')     AS vipul,
  (SELECT id FROM employees WHERE lower(btrim(name)) = 'aanchal tripathi') AS aanchal;

DO $$
DECLARE v int; a int;
BEGIN
  SELECT vipul, aanchal INTO v, a FROM fix;
  IF v IS NULL THEN
    RAISE EXCEPTION 'No employee called Vipul Sharma - nothing was changed';
  END IF;
  IF a IS NULL THEN
    RAISE NOTICE 'No employee called Aanchal Tripathi - nothing to move';
  ELSE
    RAISE NOTICE 'Moving every reference from employee % (Aanchal) to employee % (Vipul)', a, v;
  END IF;
END $$;

SELECT 'BEFORE' AS phase, 'leads owned by Aanchal'      AS what, count(*)::text AS n FROM leads      WHERE owner_employee_id       = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','leads referred by Aanchal',        count(*)::text FROM leads           WHERE referred_by_employee_id = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','sites discovered by Aanchal',      count(*)::text FROM sites           WHERE discovered_by           = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','parties created by Aanchal',       count(*)::text FROM parties         WHERE created_by              = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','activities by Aanchal',            count(*)::text FROM activities      WHERE employee_id             = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','stage history by Aanchal',         count(*)::text FROM stage_history   WHERE changed_by              = (SELECT aanchal FROM fix)
UNION ALL SELECT 'BEFORE','AUDIT rows naming Aanchal',        count(*)::text FROM lead_change_log WHERE changed_by              = (SELECT aanchal FROM fix);

-- ---------- STEP 1: repoint every reference onto Vipul ----------
UPDATE leads SET owner_employee_id      = (SELECT vipul FROM fix) WHERE owner_employee_id      = (SELECT aanchal FROM fix);
UPDATE leads SET created_by_employee_id = (SELECT vipul FROM fix) WHERE created_by_employee_id = (SELECT aanchal FROM fix);
-- referral credit is dropped, not transferred: Vipul did not refer his own leads
UPDATE leads SET referred_by_employee_id = NULL                   WHERE referred_by_employee_id = (SELECT aanchal FROM fix);

UPDATE sites      SET discovered_by = (SELECT vipul FROM fix) WHERE discovered_by = (SELECT aanchal FROM fix);
UPDATE parties    SET created_by    = (SELECT vipul FROM fix) WHERE created_by    = (SELECT aanchal FROM fix);

UPDATE activities SET employee_id           = (SELECT vipul FROM fix) WHERE employee_id           = (SELECT aanchal FROM fix);
UPDATE activities SET logged_by_employee_id = (SELECT vipul FROM fix) WHERE logged_by_employee_id = (SELECT aanchal FROM fix);
UPDATE activities SET accompanied_by        = NULL                    WHERE accompanied_by        = (SELECT aanchal FROM fix);

UPDATE stage_history   SET changed_by = (SELECT vipul FROM fix) WHERE changed_by = (SELECT aanchal FROM fix);
UPDATE lead_change_log SET changed_by = (SELECT vipul FROM fix) WHERE changed_by = (SELECT aanchal FROM fix);

-- these should all be zero-row no-ops; included so the delete cannot fail
UPDATE lead_owner_history SET old_owner_id = (SELECT vipul FROM fix) WHERE old_owner_id = (SELECT aanchal FROM fix);
UPDATE lead_owner_history SET new_owner_id = (SELECT vipul FROM fix) WHERE new_owner_id = (SELECT aanchal FROM fix);
UPDATE lead_owner_history SET changed_by   = (SELECT vipul FROM fix) WHERE changed_by   = (SELECT aanchal FROM fix);
UPDATE plans     SET employee_id = (SELECT vipul FROM fix) WHERE employee_id = (SELECT aanchal FROM fix);
UPDATE targets   SET employee_id = (SELECT vipul FROM fix) WHERE employee_id = (SELECT aanchal FROM fix);
UPDATE follow_ups SET assigned_to = (SELECT vipul FROM fix) WHERE assigned_to = (SELECT aanchal FROM fix);
UPDATE follow_ups SET created_by  = (SELECT vipul FROM fix) WHERE created_by  = (SELECT aanchal FROM fix);
DELETE FROM push_subscriptions WHERE employee_id = (SELECT aanchal FROM fix);
UPDATE employees SET coordinator_id = NULL WHERE coordinator_id = (SELECT aanchal FROM fix);

-- employee_preferences only exists if migration_employee_theme_preference.sql
-- has been run, so touch it only when it is actually there
DO $$
DECLARE a int;
BEGIN
  SELECT aanchal INTO a FROM fix;
  IF a IS NOT NULL AND to_regclass('public.employee_preferences') IS NOT NULL THEN
    EXECUTE 'DELETE FROM employee_preferences WHERE employee_id = $1' USING a;
  END IF;
END $$;

-- ---------- STEP 2: remove the employee record ----------
-- She was created by the import with no login attached, so nothing is left
-- orphaned in auth.users. Skip this statement if you would rather keep the
-- audit trail's original attribution - see the note at the top.
DELETE FROM employees WHERE id = (SELECT aanchal FROM fix);

-- ---------- confirm ----------
SELECT 'AFTER' AS phase, 'imported leads owned by Vipul' AS what, count(*)::text AS n
  FROM leads WHERE owner_employee_id = (SELECT vipul FROM fix) AND external_reference_id LIKE 'legacy-%'
UNION ALL SELECT 'AFTER','imported leads in total', count(*)::text
  FROM leads WHERE external_reference_id LIKE 'legacy-%'
UNION ALL SELECT 'AFTER','ANY row still naming Aanchal', (
    (SELECT count(*) FROM leads           WHERE owner_employee_id       = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM leads           WHERE referred_by_employee_id = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM leads           WHERE created_by_employee_id  = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM sites           WHERE discovered_by           = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM parties         WHERE created_by              = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM activities      WHERE employee_id             = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM activities      WHERE logged_by_employee_id   = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM stage_history   WHERE changed_by              = (SELECT aanchal FROM fix))
  + (SELECT count(*) FROM lead_change_log WHERE changed_by              = (SELECT aanchal FROM fix))
  )::text
UNION ALL SELECT 'AFTER','Aanchal employee records left', count(*)::text
  FROM employees WHERE lower(btrim(name)) = 'aanchal tripathi'
UNION ALL SELECT 'AFTER','Vipul open pipeline (quotes)',
  to_char(COALESCE(SUM(quote_value),0),'FM99,99,99,999')
  FROM leads WHERE external_reference_id LIKE 'legacy-%' AND current_stage NOT IN ('won','lost')
UNION ALL SELECT 'AFTER','Vipul booked (won) value',
  to_char(COALESCE(SUM(order_value),0),'FM99,99,99,999')
  FROM leads WHERE external_reference_id LIKE 'legacy-%';

-- Expect: leads owned by Vipul = 148, still naming Aanchal = 0,
--         Aanchal employee records left = 0.
COMMIT;
