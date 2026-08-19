-- ============================================================
-- MIGRATION: leads.office_territory — add 'others'  (2026-08-19)
--
-- Widens the office territory CHECK to admit a fifth value, 'others', for a
-- lead that doesn't belong to any of the four named offices. Requested by
-- the owner straight after the Walk-in source, same day.
--
-- Run this in the Supabase SQL Editor. Until it runs, picking "Others" on
-- New Lead and saving fails with:
--     new row for relation "leads" violates check constraint
--     "leads_office_territory_check"
-- surfaced as a normal inline error on the form — nothing else about the
-- screen is affected, since the app-side option only needs this constraint
-- to actually accept the value.
--
-- Safe to re-run: DROP ... IF EXISTS before the ADD CONSTRAINT.
--
-- ORDERING: independent of every other migration in this folder — touches
-- no policy, trigger or function, so it can run before or after any of them.
-- Supersedes migration_office_territory.sql's own STEP 2; that file's
-- history is kept for the record, this one is what the live CHECK should
-- match going forward.
-- ============================================================

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_office_territory_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_office_territory_check
  CHECK (office_territory IS NULL OR office_territory IN
         ('ludhiana','amritsar','jalandhar','patiala','others'));


-- ============================================================
-- VERIFICATION — run after; should return a row listing all five values.
-- ============================================================
--
-- SELECT pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname = 'leads_office_territory_check';
--
--    Expect a CHECK listing ludhiana, amritsar, jalandhar, patiala, others.
