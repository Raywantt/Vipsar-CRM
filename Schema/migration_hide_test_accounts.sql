-- ============================================================
-- MIGRATION: hide test accounts and their data (2026-09-15)
--
-- WHY: the CRM is in daily real use, and the four test logins (sc, exec, sm,
-- Test BDM) and everything they created were showing up in rosters, reports,
-- dropdowns and company figures. The owner's ruling: hide them — don't
-- delete — and let an owner show them again with a Profile switch.
--
-- HOW: ONE database rule instead of a filter on every screen. Each affected
-- table gets a RESTRICTIVE SELECT policy. Restrictive policies are AND-ed on
-- top of the existing (permissive) ones, so they can only ever take rows
-- AWAY — nothing any role could see before becomes newly visible, and no
-- existing policy is touched. Because the rule lives in RLS it covers every
-- query, every dashboard RPC (all SECURITY INVOKER), Search and every screen
-- built later, with no app-side filter to forget.
--
-- WHO STILL SEES TEST DATA:
--   * a test account itself (so every role can still be tested for real);
--   * an owner who switched on Profile → "Show test accounts"
--     (employee_preferences.show_test_accounts);
--   * service_role (the Edge Function) and the SQL Editor — both bypass RLS.
--
-- WHAT COUNTS AS TEST DATA:
--   * employees marked is_test_account;
--   * a lead owned by, created by, or brought in (BDM tag) by a test account;
--   * that lead's stage/owner/change history, remarks and loss reason;
--   * activities by a test account or on a test lead;
--   * follow-ups assigned to / created by a test account, or on a test lead;
--   * targets for a test account;
--   * parties / sites created by a test account — UNLESS a real lead uses
--     them, so a real lead can never lose its client or site;
--   * site contacts on a hidden site.
--
-- NOTHING IS DELETED OR CHANGED except the two new columns and the flag on
-- the four accounts. To undo completely: drop the policies (bottom of file).
--
-- MARKING ANOTHER TEST ACCOUNT LATER (SQL only, by the owner's ruling):
--   UPDATE employees SET is_test_account = true WHERE id = <id>;
--
-- RUN THIS BEFORE deploying the app change that reads
-- employee_preferences.show_test_accounts (a missing column fails the query).
-- Safe to re-run.
-- ============================================================

BEGIN;

-- ---------------- 1. columns ----------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE employee_preferences
  ADD COLUMN IF NOT EXISTS show_test_accounts BOOLEAN NOT NULL DEFAULT false;

-- ---------------- 2. mark the four test logins ----------------
-- id AND name AND role must all match, so a typo can never flag a real rep.
UPDATE employees SET is_test_account = true
 WHERE (id, name, role) IN (
   (25, 'sc',       'sales_coordinator'),
   (26, 'exec',     'sales_executive'),
   (43, 'sm',       'sales_manager'),
   (46, 'Test BDM', 'business_development_manager')
 );

-- ---------------- 3. helpers ----------------
-- All SECURITY DEFINER (they read tables whose own RLS they feed, so running
-- as the caller would recurse) and STABLE; every policy calls them in the
-- hoisted `(SELECT fn())` form, so each runs once per statement, not per row.

-- Does the logged-in person see test data? A test account always does; an
-- owner only with their switch on; anyone else (or no active employee) never.
CREATE OR REPLACE FUNCTION viewer_sees_test_data()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT e.is_test_account
        OR (e.role = 'owner' AND COALESCE(p.show_test_accounts, false))
      FROM employees e
      LEFT JOIN employee_preferences p ON p.employee_id = e.id
     WHERE e.auth_user_id = auth.uid() AND e.is_active = true
  ), false);
$$;

CREATE OR REPLACE FUNCTION test_employee_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(id), '{}') FROM employees WHERE is_test_account;
$$;

CREATE OR REPLACE FUNCTION test_lead_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(l.id), '{}')
    FROM leads l
    JOIN employees e
      ON e.is_test_account
     AND e.id IN (l.owner_employee_id, l.created_by_employee_id, l.bdm_employee_id);
$$;

-- A party a test account created, unless a real (non-test) lead points at it.
CREATE OR REPLACE FUNCTION test_party_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tl AS (SELECT unnest(test_lead_ids()) AS id)
  SELECT COALESCE(array_agg(p.id), '{}')
    FROM parties p
   WHERE p.created_by = ANY(test_employee_ids())
     AND NOT EXISTS (
       SELECT 1 FROM leads l
        WHERE p.id IN (l.party_id, l.other_party_id, l.referred_by_party_id)
          AND l.id NOT IN (SELECT id FROM tl)
     );
$$;

-- A site a test account discovered, unless a real lead uses it.
CREATE OR REPLACE FUNCTION test_site_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tl AS (SELECT unnest(test_lead_ids()) AS id)
  SELECT COALESCE(array_agg(s.id), '{}')
    FROM sites s
   WHERE s.discovered_by = ANY(test_employee_ids())
     AND NOT EXISTS (
       SELECT 1 FROM leads l WHERE l.site_id = s.id AND l.id NOT IN (SELECT id FROM tl)
     );
$$;

GRANT EXECUTE ON FUNCTION viewer_sees_test_data(), test_employee_ids(), test_lead_ids(),
  test_party_ids(), test_site_ids() TO authenticated;

-- ---------------- 4. restrictive policies ----------------
-- Pattern: (SELECT viewer_sees_test_data()) OR <row is not test data>.
-- `col <> ALL(array)` is NULL when col is NULL, which RLS treats as "hide",
-- so every nullable column is wrapped in COALESCE(..., true).

DROP POLICY IF EXISTS hide_test_accounts ON employees;
CREATE POLICY hide_test_accounts ON employees AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR NOT is_test_account);

DROP POLICY IF EXISTS hide_test_accounts ON leads;
CREATE POLICY hide_test_accounts ON leads AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR id <> ALL((SELECT test_lead_ids())::integer[]));

DROP POLICY IF EXISTS hide_test_accounts ON activities;
CREATE POLICY hide_test_accounts ON activities AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT viewer_sees_test_data())
    OR (COALESCE(employee_id <> ALL((SELECT test_employee_ids())::integer[]), true)
        AND COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true))
  );

DROP POLICY IF EXISTS hide_test_accounts ON follow_ups;
CREATE POLICY hide_test_accounts ON follow_ups AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (SELECT viewer_sees_test_data())
    OR (COALESCE(assigned_to <> ALL((SELECT test_employee_ids())::integer[]), true)
        AND COALESCE(created_by <> ALL((SELECT test_employee_ids())::integer[]), true)
        AND COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true))
  );

DROP POLICY IF EXISTS hide_test_accounts ON targets;
CREATE POLICY hide_test_accounts ON targets AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(employee_id <> ALL((SELECT test_employee_ids())::integer[]), true));

DROP POLICY IF EXISTS hide_test_accounts ON parties;
CREATE POLICY hide_test_accounts ON parties AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR id <> ALL((SELECT test_party_ids())::integer[]));

DROP POLICY IF EXISTS hide_test_accounts ON sites;
CREATE POLICY hide_test_accounts ON sites AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR id <> ALL((SELECT test_site_ids())::integer[]));

DROP POLICY IF EXISTS hide_test_accounts ON site_contacts;
CREATE POLICY hide_test_accounts ON site_contacts AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(site_id <> ALL((SELECT test_site_ids())::integer[]), true));

-- The lead-history tables: hidden with their lead.
DROP POLICY IF EXISTS hide_test_accounts ON stage_history;
CREATE POLICY hide_test_accounts ON stage_history AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true));

DROP POLICY IF EXISTS hide_test_accounts ON lead_owner_history;
CREATE POLICY hide_test_accounts ON lead_owner_history AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true));

DROP POLICY IF EXISTS hide_test_accounts ON lead_change_log;
CREATE POLICY hide_test_accounts ON lead_change_log AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true));

DROP POLICY IF EXISTS hide_test_accounts ON lead_remarks;
CREATE POLICY hide_test_accounts ON lead_remarks AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true));

DROP POLICY IF EXISTS hide_test_accounts ON loss_reasons;
CREATE POLICY hide_test_accounts ON loss_reasons AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR COALESCE(lead_id <> ALL((SELECT test_lead_ids())::integer[]), true));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- CHECK (run after): expect 4 flagged accounts and 13 policies.
-- ============================================================
-- SELECT id, name, role FROM employees WHERE is_test_account ORDER BY id;
-- SELECT tablename FROM pg_policies WHERE policyname = 'hide_test_accounts' ORDER BY 1;
--
-- ============================================================
-- UNDO (only if ever needed): removes the hiding; data was never touched.
-- ============================================================
-- DO $$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['employees','leads','activities','follow_ups','targets','parties',
--     'sites','site_contacts','stage_history','lead_owner_history','lead_change_log',
--     'lead_remarks','loss_reasons'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS hide_test_accounts ON %I', t);
--   END LOOP; END $$;
