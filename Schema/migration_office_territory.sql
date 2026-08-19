-- ============================================================
-- MIGRATION: leads.office_territory  (2026-08-13)
--
-- Adds the office territory captured on the New Lead screen: which of the
-- dealership's four offices a lead belongs to. Asked for EVERY source
-- (scanning / lixil / referral), not just scanning.
--
-- Run this in the Supabase SQL Editor. Until it runs, saving a lead from
-- New Lead fails outright with:
--     column "office_territory" of relation "leads" does not exist
-- surfaced as a normal inline error on the form. Nothing else in the app
-- reads this column yet, so nothing else is affected either way.
--
-- Safe to re-run: every statement is IF NOT EXISTS / DROP ... IF EXISTS.
--
-- ORDERING: independent of every other migration in this folder. It touches
-- no policy, trigger or function, so it can run before or after any of them.
-- ============================================================


-- ---------- STEP 1: the column ----------
--
-- NULLABLE on purpose, even though the UI makes it a required field.
-- Every lead created before today has no territory and there is no honest
-- value to backfill them with — an office guessed from the owner's
-- employees.office_location would be a fabricated fact sitting in the same
-- column as real ones, indistinguishable from it forever after. NULL reads
-- as "captured before we asked this", which is true.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS office_territory TEXT;


-- ---------- STEP 2: the CHECK ----------
--
-- A closed list with a real constraint, matching leads.source_type — the
-- closest analogue in this schema (also a tap-select on this same form, also
-- a fixed business fact). Deliberately NOT the free-text "suggested options"
-- treatment current_stage/site_stage get: those describe a judgement a rep
-- makes, this one names a real office.
--
-- The `IS NULL OR` branch is what lets STEP 1 leave old rows alone.
--
-- Values are the lowercase slugs stored by the app; the human labels live in
-- src/lib/territoryOptions.js. Keep the two in sync.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_office_territory_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_office_territory_check
  CHECK (office_territory IS NULL OR office_territory IN
         ('ludhiana','amritsar','jalandhar','patiala'));


-- ============================================================
-- VERIFICATION — run these after; both should return a row.
-- ============================================================

-- 1. Column exists and is nullable:
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'leads' AND column_name = 'office_territory';
--
--    Expect: office_territory | text | YES

-- 2. CHECK is installed with all four offices:
--
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'leads_office_territory_check';
--
--    Expect a CHECK listing ludhiana, amritsar, jalandhar, patiala.

-- 3. How many existing leads carry no territory (expected: all of them):
--
-- SELECT count(*) FILTER (WHERE office_territory IS NULL) AS no_territory,
--        count(*)                                        AS total
--   FROM leads;


-- ============================================================
-- ADDING A TERRITORY LATER
-- ============================================================
-- A new office needs BOTH halves changed, or the app offers a button that
-- fails to save:
--
--   1. src/lib/territoryOptions.js — add { value: 'x', label: 'X' }
--   2. this CHECK — re-run STEP 2 with the new value in the IN list
--
-- Same two-sided change parties.party_type needed when 'pmc' was added; see
-- Schema/migration_pilot_outstanding.sql for that precedent.
--
-- DONE ONCE ALREADY: Schema/migration_territory_others.sql (2026-08-19) added
-- a fifth value, 'others', following exactly this recipe — see that file
-- rather than re-running STEP 2 here with a stale four-value list.
