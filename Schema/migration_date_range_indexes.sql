-- ============================================================
-- MIGRATION: plain date indexes on activities/leads  (2026-09-04)
--
-- Same pattern as idx_leads_owner/idx_activities_employee (see
-- tostem_crm_schema.sql's own comment above those two: "own_data_or_owner_role
-- RLS policies compare leads.owner_employee_id / activities.employee_id on
-- every row of every leads/activities query — without these, each such query
-- is a sequential scan"), extended to cover a gap those two don't: a query
-- that filters ONLY on a date range, with no employee_id/owner_employee_id
-- predicate at all.
--
-- fetchActivityCounts() and fetchNewLeadsBySource() (src/lib/dashboardQueries.js)
-- do exactly that — `.gte('created_at', ...).lte('created_at', ...)` with no
-- other filter — and they re-run on every single Dashboard preset change
-- (Week/Month/Quarter/Custom), for every viewer. For a sales exec, RLS still
-- adds an implicit `employee_id = current_employee_id()` predicate under the
-- hood, so the EXISTING composite indexes (idx_activities_employee,
-- idx_leads_created_by_at) still help there. For the OWNER — the role that
-- sees the whole company and is also the role most likely to be sitting on
-- Dashboard flipping through date ranges — RLS's "own data OR owner role"
-- check is true for every row regardless of employee_id, so the planner gets
-- no useful leading-column filter out of either composite index and falls
-- back to a sequential scan of the whole table on every preset click.
--
-- Run this in the Supabase SQL Editor. Nothing in the app or RLS changes —
-- purely additive indexes the planner can choose to use instead of a
-- sequential scan. Safe to re-run (IF NOT EXISTS), independent of every
-- other migration in this folder.
-- ============================================================


CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at       ON leads(created_at);


-- ============================================================
-- VERIFICATION — run these after.
-- ============================================================

-- 1. Both indexes exist:
--
-- SELECT indexname FROM pg_indexes
--  WHERE indexname IN ('idx_activities_created_at', 'idx_leads_created_at');
--
--    Expect 2 rows.

-- 2. The planner picks the index for a plain date-range scan (the owner's
--    query shape — no employee/owner filter at all):
--
-- EXPLAIN ANALYZE
-- SELECT activity_type, employee_id FROM activities
--  WHERE created_at >= now() - interval '7 days' AND created_at <= now();
--
--    Expect "Index Scan using idx_activities_created_at" (or a Bitmap Index
--    Scan feeding a Bitmap Heap Scan) rather than "Seq Scan on activities".
--    Same query shape against `leads` for idx_leads_created_at.
