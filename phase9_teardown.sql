-- ============================================================
-- PHASE 9 — TEARDOWN (run in the Supabase SQL Editor)
--
-- ⚠️  DESTRUCTIVE. Removes every row created by the Phase 9 simulation and
-- restores the database to its verified Phase 0 baseline:
--     employees        -> exactly 1 row (id 3, "Raywant", owner)
--     every other table -> 0 rows
--
-- DO NOT RUN UNTIL THE USER EXPLICITLY CONFIRMS THEY ARE FINISHED WITH THE
-- SEEDED DATA. They may want the populated CRM for demos first.
--
-- NOT A MIGRATION. Never include this in a run-in-order list.
--
-- ------------------------------------------------------------
-- WHY THIS EXISTS AS A SQL FILE RATHER THAN API CALLS
--
-- Designed up front in Phase 0 (at the user's direction) rather than
-- discovered in Phase 8. Probed live 2026-08-12 — the four append-only
-- tables do NOT behave uniformly, and the split is by WHEN THE TABLE WAS
-- CREATED, not by whether it is append-only:
--
--   TABLE                service_role SELECT   service_role DELETE
--   stage_history        ✅ 200                ✅ 204
--   loss_reasons         ✅ 200                ✅ 204
--   lead_change_log      ❌ 42501              ❌ 42501
--   lead_owner_history   ❌ 42501              ❌ 42501
--
-- stage_history and loss_reasons ship in the original tostem_crm_schema.sql,
-- created before this project's Supabase instance moved to the
-- `auto_expose_new_tables = false` default — so service_role still holds full
-- DML on them and they COULD be torn down over the API.
-- lead_change_log (migration_lead_change_log.sql) and lead_owner_history
-- (migration_pilot_outstanding.sql, 2026-08-09) were both created after that
-- change and were granted only to `authenticated`. service_role has nothing
-- on them.
--
-- Since two of the four are unreachable from any API path, the whole teardown
-- runs here instead — one transaction, one place, no partial state.
--
-- `postgres` (this editor) bypasses RLS entirely and holds every grant, so
-- the append-only policies cannot trap seeded rows. That asymmetry is
-- deliberate: an audit trail should not be erasable by the application.
-- ------------------------------------------------------------

BEGIN;

-- The owner row to keep. Verified live in Phase 0; also the FK target that
-- must survive every delete below.
DO $$
DECLARE
  keep_employee_id  CONSTANT integer := 3;
  keep_auth_user_id CONSTANT uuid    := '1c1c072a-51d5-4027-a592-c79e3c3d46f8';
  n integer;
BEGIN
  -- Guard: refuse to run if the baseline row isn't what Phase 0 recorded.
  IF NOT EXISTS (
    SELECT 1 FROM employees
     WHERE id = keep_employee_id
       AND auth_user_id = keep_auth_user_id
       AND role = 'owner'
  ) THEN
    RAISE EXCEPTION
      'Refusing to run: employees id % / auth_user_id % is not a present owner row. The Phase 0 baseline does not match — investigate before tearing anything down.',
      keep_employee_id, keep_auth_user_id;
  END IF;

  -- ---------- deletion order follows the FK graph, leaves first ----------
  -- Each RAISE NOTICE prints to the SQL Editor's Messages pane so the run is
  -- auditable rather than silent.

  DELETE FROM lead_change_log;                    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'lead_change_log      %', n;
  DELETE FROM loss_reasons;                       GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'loss_reasons         %', n;
  DELETE FROM stage_history;                      GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'stage_history        %', n;
  DELETE FROM lead_owner_history;                 GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'lead_owner_history   %', n;
  DELETE FROM follow_ups;                         GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'follow_ups           %', n;
  DELETE FROM activities;                         GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'activities           %', n;
  DELETE FROM targets;                            GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'targets              %', n;
  DELETE FROM plans;                              GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'plans                % (expected 0 — excluded by decision)', n;

  DELETE FROM push_subscriptions
   WHERE employee_id <> keep_employee_id;         GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'push_subscriptions   %', n;

  DELETE FROM leads;                              GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'leads                %', n;
  DELETE FROM site_contacts;                      GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'site_contacts        %', n;

  -- sites.primary_contact_party_id -> parties, so sites must go first.
  DELETE FROM sites;                              GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'sites                %', n;
  -- parties.created_by -> employees, so parties must precede employees.
  DELETE FROM parties;                            GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'parties              %', n;

  -- Both were EMPTY at the Phase 0 baseline — contrary to the original brief,
  -- which said they were preserved configuration. Everything in them is
  -- Phase 9-created, so both empty completely.
  DELETE FROM products;                           GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'products             %', n;
  DELETE FROM areas;                              GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'areas                %', n;

  -- employees.coordinator_id is a self-FK with ON DELETE SET NULL, so
  -- removing the coordinators before their reports is safe.
  DELETE FROM employees
   WHERE id <> keep_employee_id;                  GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'employees            %', n;
END $$;

COMMIT;


-- ============================================================
-- VERIFY — must match the Phase 0 baseline exactly
-- ============================================================
SELECT 'employees'          AS t, count(*) AS rows, '1 (id 3, Raywant)' AS expected FROM employees
UNION ALL SELECT 'activities',         count(*), '0' FROM activities
UNION ALL SELECT 'areas',              count(*), '0' FROM areas
UNION ALL SELECT 'follow_ups',         count(*), '0' FROM follow_ups
UNION ALL SELECT 'lead_change_log',    count(*), '0' FROM lead_change_log
UNION ALL SELECT 'lead_owner_history', count(*), '0' FROM lead_owner_history
UNION ALL SELECT 'leads',              count(*), '0' FROM leads
UNION ALL SELECT 'loss_reasons',       count(*), '0' FROM loss_reasons
UNION ALL SELECT 'parties',            count(*), '0' FROM parties
UNION ALL SELECT 'plans',              count(*), '0' FROM plans
UNION ALL SELECT 'products',           count(*), '0' FROM products
UNION ALL SELECT 'push_subscriptions', count(*), '0' FROM push_subscriptions
UNION ALL SELECT 'site_contacts',      count(*), '0' FROM site_contacts
UNION ALL SELECT 'sites',              count(*), '0' FROM sites
UNION ALL SELECT 'stage_history',      count(*), '0' FROM stage_history
UNION ALL SELECT 'targets',            count(*), '0' FROM targets
ORDER BY t;

-- Confirm the preserved row survived intact:
SELECT id, auth_user_id, name, role, is_active FROM employees;


-- ============================================================
-- STILL TO DO BY HAND AFTERWARDS — auth.users
--
-- Deleting an employees row does NOT delete its Supabase Auth login. The 8
-- seeded logins (2 coordinators + 6 sales executives) remain in
-- Authentication -> Users, pointing at nothing. Harmless, but untidy.
--
-- Delete them individually in the Dashboard, using the exact UUID list in
-- seed_manifest.json -> auth_users_created.
--
-- DO NOT bulk-delete auth.users, and never delete
--   1c1c072a-51d5-4027-a592-c79e3c3d46f8
-- — that is the owner's own login, and removing it locks them out of the
-- project.
--
-- Alternatively, once the service_role key is rotated, the Admin API can
-- delete them by id: DELETE /auth/v1/admin/users/{uuid}
-- ============================================================
