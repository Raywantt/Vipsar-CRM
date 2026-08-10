-- ============================================================
-- ⚠️  DESTRUCTIVE — DELETES EVERY RECORD IN THE CRM
--
-- Empties all 16 tables except for ONE owner's employee row. Written
-- 2026-08-10 to give Phase 8 (the sales_coordinator role) a clean database.
--
-- THERE IS NO UNDO. Supabase's free tier has no point-in-time recovery. The
-- pilot's leads, parties, sites, activities, quote values and stage history
-- are gone permanently once this runs.
--
-- NOT A MIGRATION. Never add this to a run-everything-in-order list, and
-- never run it just because it's in this folder. It lives here only so the
-- wipe is documented and repeatable, and is named so it can't be mistaken
-- for schema.
--
-- HOW TO RUN: set keep_auth_user_id below to your own Supabase Auth user id
-- (Authentication → Users, the UUID column), paste this whole file into the
-- SQL Editor, and hit Run. It is all-or-nothing — any error rolls everything
-- back, so a failure loses nothing.
--
-- The id is left as a placeholder rather than committed with a real value:
-- this repository is public, and there's no reason to publish a real
-- account identifier. The block refuses to run until you replace it.
--
-- WHAT SURVIVES: the owner row matching keep_auth_user_id, that person's
-- push_subscriptions, and the entire schema (tables, policies, triggers,
-- indexes, functions).
--
-- WHAT THIS DOES NOT DO: deleting an employees row does NOT delete that
-- person's Supabase Auth login. Those stay in Authentication → Users pointing
-- at nothing — harmless (they can't sign in to anything; ProtectedRoute shows
-- "Account not linked" and every RLS policy resolves NULL for them) but still
-- listed. Remove them by hand in the dashboard if you want them gone.
-- Deliberately NOT scripted: a bad bulk delete on auth.users could remove
-- your own login and lock you out of the project.
--
-- REBUILDING A TEAM AFTERWARDS is manual, per person:
--   1. Authentication → Users → Add user  (turn ON "Auto Confirm User")
--   2. copy the new UUID
--   3. Profile → Add employee, paste the UUID in
-- Step 1 can't be done from inside the app — see AddEmployeeForm.jsx for why.
--
-- WHY THIS CAN'T RUN FROM THE APP: stage_history, lead_owner_history,
-- loss_reasons and lead_change_log are permanently append-only — no DELETE
-- grant and no DELETE policy for anyone, including the owner. The SQL Editor
-- runs as `postgres`, which bypasses RLS and holds the grants. That asymmetry
-- is the point: an audit trail shouldn't be erasable by the application.
-- ============================================================


-- ------------------------------------------------------------
-- THE WIPE
--
-- keep_auth_user_id is the Supabase Auth user id (Authentication → Users),
-- not the employees.id integer — the block resolves that itself.
--
-- Two guards: the id must match an employees row, and that row must be an
-- owner. A wrong id (including the placeholder below) therefore deletes
-- nothing at all, rather than wiping everything including the row you meant
-- to keep.
--
-- DELETE ORDER IS LOAD-BEARING. Most foreign keys here have no ON DELETE
-- clause, meaning RESTRICT — leads.party_id, activities.party_id and
-- site_contacts.party_id each block a parties delete while any row still
-- points at them. Children go before parents throughout. Reordering these
-- lines fails partway with a foreign-key violation.
-- ------------------------------------------------------------
DO $$
DECLARE
  keep_auth_user_id uuid := '00000000-0000-0000-0000-000000000000';  -- <<< YOUR Auth user id
  keep_id   integer;
  kept_name text;
BEGIN
  SELECT id, name INTO keep_id, kept_name
    FROM employees
   WHERE auth_user_id = keep_auth_user_id;

  IF keep_id IS NULL THEN
    RAISE EXCEPTION 'No employees row has auth_user_id = %. Nothing deleted.', keep_auth_user_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = keep_id AND role = 'owner') THEN
    RAISE EXCEPTION 'Employee % (%) is not an owner. Nothing deleted.', keep_id, kept_name;
  END IF;

  -- children of leads
  DELETE FROM lead_change_log;
  DELETE FROM loss_reasons;
  DELETE FROM stage_history;
  DELETE FROM lead_owner_history;
  DELETE FROM follow_ups;

  -- employee-scoped records
  DELETE FROM push_subscriptions WHERE employee_id <> keep_id;
  DELETE FROM activities;
  DELETE FROM plans;
  DELETE FROM targets;

  -- the core records, then what they point at
  DELETE FROM leads;
  DELETE FROM site_contacts;
  DELETE FROM sites;
  DELETE FROM parties;

  -- reference lists
  DELETE FROM products;
  DELETE FROM areas;

  -- everyone but you. coordinator_id is ON DELETE SET NULL, so a coordinator
  -- and their reports can go in one statement without ordering games.
  DELETE FROM employees WHERE id <> keep_id;

  RAISE NOTICE 'Done. Kept employee % (%). Every other record deleted.', keep_id, kept_name;
END $$;


-- ------------------------------------------------------------
-- Restart the id counters at 1 — cosmetic only. Without it your first new
-- lead is #78, since SERIAL sequences don't rewind when rows are deleted.
-- employees is excluded on purpose: your surviving row still holds an id, and
-- resetting that sequence would hand the same id to the next person created.
-- ------------------------------------------------------------
SELECT setval(pg_get_serial_sequence('public.' || t, 'id'), 1, false)
  FROM unnest(ARRAY[
    'areas','products','parties','sites','site_contacts','leads','activities',
    'plans','stage_history','lead_owner_history','targets','loss_reasons',
    'follow_ups','push_subscriptions','lead_change_log'
  ]) AS t;


-- ------------------------------------------------------------
-- Confirmation — this is the table the editor will show you when it finishes.
-- Every count should be 0 except employees, which should be 1.
-- ------------------------------------------------------------
SELECT 'leads' AS table_name, count(*) FROM leads
UNION ALL SELECT 'activities',        count(*) FROM activities
UNION ALL SELECT 'parties',           count(*) FROM parties
UNION ALL SELECT 'sites',             count(*) FROM sites
UNION ALL SELECT 'site_contacts',     count(*) FROM site_contacts
UNION ALL SELECT 'stage_history',     count(*) FROM stage_history
UNION ALL SELECT 'lead_owner_history',count(*) FROM lead_owner_history
UNION ALL SELECT 'lead_change_log',   count(*) FROM lead_change_log
UNION ALL SELECT 'loss_reasons',      count(*) FROM loss_reasons
UNION ALL SELECT 'follow_ups',        count(*) FROM follow_ups
UNION ALL SELECT 'targets',           count(*) FROM targets
UNION ALL SELECT 'plans',             count(*) FROM plans
UNION ALL SELECT 'areas',             count(*) FROM areas
UNION ALL SELECT 'products',          count(*) FROM products
UNION ALL SELECT 'employees',         count(*) FROM employees
 ORDER BY 1;
