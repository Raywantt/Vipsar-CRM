-- ============================================================
-- MIGRATION: employee_preferences (2026-08-20)
--
-- Moves the Light/Dark/System appearance setting (Profile's Appearance
-- card, src/lib/theme.js) from a device-only localStorage value to a real
-- per-employee record, so it follows the person to any device/browser they
-- log into instead of defaulting back to System every time. localStorage is
-- still used too (src/lib/theme.js's getStoredTheme/setTheme are unchanged)
-- — it's what index.html's pre-paint inline script reads to avoid a flash
-- of the wrong theme before React/auth even loads; this table is the
-- account-level source of truth that gets synced back into localStorage on
-- login (see AuthContext.jsx).
--
-- A NEW TABLE, not a column on employees — employees' own UPDATE policy is
-- deliberately owner-only with NO self-update exception (see
-- rls_policies.sql's "owner_only_update", and CLAUDE.md's RLS section: "a
-- sales exec must never set their own role to 'owner'"). Adding a column
-- there would mean only the owner could ever save their own appearance
-- choice — every sales_executive/sales_coordinator would be locked out of
-- the very feature this migration adds. A separate table with its own
-- narrow policy sidesteps that entirely, the same way push_subscriptions
-- already does for a different personal, per-device/per-employee setting.
--
-- RLS mirrors push_subscriptions exactly: own row only, no owner-role
-- exception on write (an owner has no legitimate reason to set someone
-- else's appearance preference), owner gets read access for visibility only.
--
-- employee_id is the PRIMARY KEY (not a separate SERIAL id) — at most one
-- preferences row per employee, and it makes the app's write a plain
-- upsert keyed on employee_id.
--
-- Run this in the Supabase SQL Editor. Until it runs, the app degrades
-- silently, not loudly: AuthContext's post-login theme fetch and Profile's
-- save-to-account call are both wrapped so a missing table is swallowed as
-- "no account theme yet" / a small inline warning — the existing
-- device-local Light/Dark/System control keeps working exactly as it does
-- today either way (see src/lib/theme.js, src/contexts/AuthContext.jsx,
-- src/pages/Profile.jsx).
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.
--
-- ORDERING: independent of every other migration in this folder — touches
-- no existing table, policy, trigger or function, so it can run before or
-- after any of them.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_preferences (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  theme       TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  updated_at  TIMESTAMP DEFAULT now()
);

ALTER TABLE employee_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON employee_preferences;
CREATE POLICY "own_data_or_owner_role_select" ON employee_preferences
  FOR SELECT USING (
    employee_id = current_employee_id()
    OR current_employee_role() = 'owner'
  );

DROP POLICY IF EXISTS "own_data_insert" ON employee_preferences;
CREATE POLICY "own_data_insert" ON employee_preferences
  FOR INSERT WITH CHECK (
    employee_id = current_employee_id()
  );

DROP POLICY IF EXISTS "own_data_update" ON employee_preferences;
CREATE POLICY "own_data_update" ON employee_preferences
  FOR UPDATE USING (
    employee_id = current_employee_id()
  ) WITH CHECK (
    employee_id = current_employee_id()
  );

-- No DELETE policy/grant — nothing in the app ever deletes a preferences
-- row directly; ON DELETE CASCADE above cleans it up if the employee row
-- itself is ever removed. Matches the append-only-ish, no-DELETE-grant
-- shape this schema already uses for tables nothing should be able to wipe
-- (stage_history, loss_reasons, lead_owner_history).
GRANT SELECT, INSERT, UPDATE ON employee_preferences TO authenticated;

-- PostgREST caches the schema — without this, the new table/relationship
-- may not be visible to the Data API until the project's next natural
-- schema-cache refresh.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFICATION — run after.
-- ============================================================
--
-- 1. Table + CHECK exist:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'employee_preferences'
--  ORDER BY ordinal_position;
--
-- 2. Policies exist and are scoped to own row only (no OR owner_role on
--    insert/update, matching push_subscriptions):
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies
--  WHERE tablename = 'employee_preferences';
--
-- 3. authenticated can read/write, but only its own row — as the
--    logged-in user, this should succeed:
-- INSERT INTO employee_preferences (employee_id, theme)
--   VALUES (current_employee_id(), 'dark')
--   ON CONFLICT (employee_id) DO UPDATE SET theme = EXCLUDED.theme, updated_at = now();
-- SELECT * FROM employee_preferences WHERE employee_id = current_employee_id();
