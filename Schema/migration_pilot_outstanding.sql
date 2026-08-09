-- ============================================================
-- Three outstanding live-DB fixes, flagged in CLAUDE.md's Conventions
-- section as shipped-but-never-migrated. Run this in the Supabase
-- Dashboard's SQL Editor before the pilot — see the chat response for
-- step-by-step instructions on where to paste this.
--
-- Run the three numbered sections in order. Each is independent, so if
-- one errors you can still safely run the others.
-- ============================================================


-- ------------------------------------------------------------
-- 1) parties.party_type: add 'pmc'
--    Fixes: New Lead's "architect / PMC / anyone else" field fails to
--    save whenever Type = PMC is picked.
-- ------------------------------------------------------------
ALTER TABLE parties DROP CONSTRAINT parties_party_type_check;
ALTER TABLE parties ADD CONSTRAINT parties_party_type_check
  CHECK (party_type IN ('client','architect','builder','firm','other','pmc'));


-- ------------------------------------------------------------
-- 2) targets.period_type: add 'quarter'
--    Fixes: Set-a-target with Period = Quarter fails to save.
--
--    Run this SELECT FIRST to confirm the real constraint name (this
--    one was never confirmed against a live error, unlike #1 above).
-- ------------------------------------------------------------
SELECT conname
FROM pg_constraint
WHERE conrelid = 'targets'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%period_type%';

-- If that returned targets_period_type_check, run these two lines as-is.
-- If it returned a different name, swap that name into both lines below.
ALTER TABLE targets DROP CONSTRAINT targets_period_type_check;
ALTER TABLE targets ADD CONSTRAINT targets_period_type_check
  CHECK (period_type IN ('week','month','quarter','year'));


-- ------------------------------------------------------------
-- 3) lead_owner_history: create the table
--    Fixes: "Reassign owner" on a Lead Profile succeeds on the leads
--    write but warns that logging the ownership history failed.
--
--    After this CREATE TABLE succeeds, separately open
--    Schema/rls_policies.sql, copy its ENTIRE contents, and run that
--    whole file in the SQL Editor too (it's explicitly designed to be
--    safe to re-run — see its own header comment). That picks up:
--      - GRANT SELECT/INSERT/UPDATE to `authenticated` on this table
--        (the wildcard grant in Step A only covers tables that exist
--        at the moment it runs, which is why this table has to be
--        created first)
--      - ALTER TABLE lead_owner_history ENABLE ROW LEVEL SECURITY
--      - the authenticated_select / authenticated_insert policies for
--        it (append-only, same shape as stage_history)
--    Nothing else already live changes — every other CREATE POLICY in
--    that file is a no-op replace of what's already there.
-- ------------------------------------------------------------
CREATE TABLE lead_owner_history (
  id            SERIAL PRIMARY KEY,
  lead_id       INTEGER NOT NULL REFERENCES leads(id),
  old_owner_id  INTEGER REFERENCES employees(id),
  new_owner_id  INTEGER NOT NULL REFERENCES employees(id),
  changed_by    INTEGER REFERENCES employees(id),
  changed_at    TIMESTAMP DEFAULT now()
);
