-- ============================================================
-- MIGRATION: the two RFQ-desk roles (2026-10-05)
--
-- Adds two values to employees.role, so the owner can add the back-office
-- people from Profile -> Add employee / Manage employees:
--
--   production_executive  — "Production Executive" (Harjot): checks a sales
--                           exec's RFQ against Lixil's technical limits.
--   estimation_executive  — "Estimation Executive" (Harpreet): raises an
--                           approved RFQ with Lixil and records the quote.
--
-- See RFQ-DESK.md (repo root) for the whole plan. THIS FILE IS ONLY THE ROLE
-- VALUES — no RFQ table, no policy, no trigger. Until the desk is built, a
-- person with either role signs in to a "being set up" screen and Profile,
-- nothing else (that gating is in the app: roles.js / App.jsx / Today.jsx).
-- They get no new data access either: every existing policy keys on
-- "own data or owner role", and these roles own nothing.
--
-- validate_employee_role_assignment() needs no change: it already refuses a
-- coordinator_id or manager_id on any role but exec/manager, so neither new
-- role can report to anyone or be reported to.
--
-- ORDER: run AFTER migration_bdm_role.sql. Run it before adding anyone with
-- one of these roles (before then, saving that role fails with
-- "violates check constraint employees_role_check" — nothing else breaks).
--
-- ⚠ RE-RUN TRAP: migration_bdm_role.sql re-creates this same CHECK with the
-- five older roles only. Re-running it once a production/estimation employee
-- exists makes that ADD CONSTRAINT fail (an existing row breaks the narrower
-- CHECK). Re-run THIS file straight after it if you ever re-run that one.
--
-- Safe to re-run: widening a CHECK never invalidates existing rows.
-- ============================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','sales_executive','sales_coordinator','sales_manager',
                  'business_development_manager',
                  'production_executive','estimation_executive'));

-- Check (read-only): should list all seven values.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'employees_role_check';
