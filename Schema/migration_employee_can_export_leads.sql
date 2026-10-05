-- ============================================================
-- MIGRATION: employees.can_export_leads (2026-10-05)
--
-- All Leads' "Download Excel" used to be owner-only (roles.js's
-- canExportLeads). The owner now wants to hand it to ONE named person at a
-- time — first Aanchal Tripathi (a sales manager), for her own leads and her
-- team's. This column is that per-person switch. Default false, so nobody
-- else's screen changes. The owner flips it from Profile -> Manage employees.
--
-- WHY A COLUMN ON employees (not employee_preferences, which the theme uses):
-- employees' UPDATE policy is OWNER-ONLY with no self-update exception
-- (rls_policies.sql "owner_only_update"). For a theme that was the reason to
-- avoid this table; for a PERMISSION it is exactly what's wanted — only an
-- owner can ever switch it on, so a rep can't grant it to themselves.
--
-- WHAT THIS IS AND ISN'T: a gate on the BUTTON, like the owner-only gate it
-- extends. It adds no data access — the file holds the leads the person's own
-- All Leads screen already lists, under their own RLS. (A manager's "Mine" is
-- their own leads, "Team" their reports'.)
--
-- THIS FILE ALSO SWITCHES IT ON FOR AANCHAL TRIPATHI (STEP 2), and stops with
-- an error rather than guess if her name matches zero or several employees.
-- Skip STEP 2 and use Manage employees instead if you prefer.
--
-- ORDER: run this BEFORE deploying the code that reads the column. The
-- Manage-employees list selects it, so a deploy that lands first makes that
-- one owner screen fail until this has run. Nothing else breaks: the account
-- lookup in AuthContext does not select it, and the All Leads button reads it
-- in its own request that fails soft to "no button".
--
-- Independent of every other migration in this folder (touches no policy,
-- trigger or function), so it can run before or after any of them.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS; STEP 2 sets a flag to true.
-- ============================================================

-- ------------------------------------------------------------
-- STEP 1: the column
-- ------------------------------------------------------------
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_export_leads BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- STEP 2: switch it on for Aanchal Tripathi
-- ------------------------------------------------------------
DO $$
DECLARE
  matched INTEGER;
BEGIN
  SELECT count(*) INTO matched
    FROM employees
   WHERE lower(trim(name)) = 'aanchal tripathi';

  IF matched <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one employee named Aanchal Tripathi, found % — nothing changed. Use Profile -> Manage employees instead.', matched;
  END IF;

  UPDATE employees
     SET can_export_leads = true
   WHERE lower(trim(name)) = 'aanchal tripathi';
END
$$;

-- PostgREST caches the schema — without this the new column may not be
-- readable through the Data API until its next natural refresh.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFICATION — run after.
-- ============================================================
--
-- 1. The column exists, defaults to false, and only Aanchal has it on:
-- SELECT name, role, is_active, can_export_leads
--   FROM employees
--  WHERE can_export_leads OR lower(name) LIKE '%aanchal%'
--  ORDER BY name;
--
-- 2. As a real logged-in OWNER (not the SQL Editor), Profile -> Manage
--    employees -> search "Aanchal" shows the checkbox ticked.
--
-- 3. To take it away again (or use the checkbox):
-- UPDATE employees SET can_export_leads = false
--  WHERE lower(trim(name)) = 'aanchal tripathi';
