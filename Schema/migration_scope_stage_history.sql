-- ============================================================
-- MIGRATION: scope stage_history SELECT to "own data or owner role"
-- Run this in the Supabase SQL Editor. Safe to re-run (DROP POLICY IF
-- EXISTS precedes the CREATE POLICY below).
--
-- WHY: stage_history's SELECT policy was `current_employee_role() IS NOT
-- NULL` — any active employee, not scoped to their own leads. A sales
-- exec's browser therefore received `lead_id`, `stage`, and `changed_at`
-- for every lead in the company (not just their own) any time it queried
-- this table — via SalesFunnelCard's fetchStageHistoryForFunnel,
-- TargetsVsActualsCard/EmployeeProfile's fetchWonStageHistory, and
-- Dashboard/KpiSparkRow's fetchDecidedStageHistory, all three of which run
-- unconditionally on every Dashboard/Home/EmployeeProfile load regardless
-- of role. The app's own client-side aggregation already drops rows whose
-- embedded `leads(...)` comes back null (RLS on that embed) before
-- rendering anything, so the numbers shown on screen were never wrong —
-- but the raw network response still carried every other employee's
-- lead_id/stage/timestamp, visible via the browser's Network tab with no
-- UI needed. This migration closes that at the actual RLS boundary
-- instead of relying on client-side filtering, matching the same "own
-- data or owner role" shape leads/activities/targets already use.
--
-- INSERT stays unchanged (any active employee can still log a stage
-- change) — only SELECT is tightened. lead_owner_history has the exact
-- same open-SELECT shape as stage_history did; deliberately left
-- unchanged here since it wasn't part of the audited leak (nothing reads
-- lead_owner_history unscoped the way the three stage_history fetches
-- did) — revisit separately if that changes.
-- ============================================================

DROP POLICY IF EXISTS "authenticated_select" ON stage_history;
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON stage_history;
CREATE POLICY "own_data_or_owner_role_select" ON stage_history
  FOR SELECT USING (
    current_employee_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = stage_history.lead_id
        AND leads.owner_employee_id = current_employee_id()
    )
  );
