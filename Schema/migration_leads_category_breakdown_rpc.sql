-- ============================================================
-- MIGRATION: leads_category_breakdown() RPC  (2026-09-04)
--
-- Part of the CRM-wide performance pass. Dashboard's three category
-- breakdown cards (Leads by area / site stage / product) and the Pipeline
-- by stage card currently get their numbers by downloading EVERY lead in
-- the company — with parties/sites/areas/employees/products all joined in —
-- and counting/summing them in the browser (src/lib/dashboardQueries.js's
-- fetchLeadsForBreakdown(), consumed by src/pages/Dashboard.jsx). That
-- happens on every Dashboard load, before any of those four cards can
-- render anything at all.
--
-- This function does the counting/summing in Postgres instead and returns
-- only the grouped totals (~30-40 rows) rather than every lead. It is
-- DELIBERATELY NARROW — it replaces only these four cards, which do pure
-- count+sum-by-group with no per-lead judgment calls. Needs Attention's
-- five buckets (src/lib/attention.js) are NOT touched by this migration —
-- that logic has a legacy-import date clamp, two different day thresholds,
-- and calendar-string date comparisons that have each been the source of a
-- real bug in this codebase before (see CLAUDE.md's Dashboard section,
-- HISTORY_STARTS_AT). Reimplementing it in SQL without a live database to
-- verify the numbers against was judged too risky to do in the same pass —
-- Needs Attention and every drill-down keep reading the full per-lead fetch,
-- unchanged, exactly as they do today.
--
-- SECURITY — READ THIS BEFORE CHANGING ANYTHING BELOW. This function is
-- SECURITY INVOKER (Postgres's own default, stated explicitly so a future
-- edit can't silently flip it), NOT SECURITY DEFINER like every other
-- function in this schema. That is deliberate and load-bearing: SECURITY
-- INVOKER means the query inside runs under the CALLING user's own RLS
-- policies — a sales exec calling this only ever sees their own leads
-- (own_data_or_owner_role_select), a coordinator only their team's
-- (coordinator_team_select), a manager only their own + their team's
-- (manager_team_select), exactly as if they'd run the query directly. If
-- this were ever changed to SECURITY DEFINER, it would run with the
-- function OWNER's privileges and bypass RLS entirely — every sales exec
-- calling it would see the whole company's leads. Do not change this.
--
-- `p_owner_ids` (optional): when passed, narrows the result to just those
-- owner_employee_id values, ON TOP OF whatever RLS already allows — this is
-- what lets Dashboard.jsx replicate the sales_manager role's own client-side
-- "My / Team" scope toggle (see managerScope/inScope in Dashboard.jsx) for
-- this RPC's result, the same way it already narrows allBreakdownLeads.
-- NULL (the default) means "don't narrow further", which is correct for
-- every other role — RLS alone already gives the right rows.
--
-- Mirrors src/lib/pipelineValue.js's dealValueFor() exactly (see that file's
-- own comments for why the rule differs between open and closed leads) and
-- the four getCategory() functions at the top of src/pages/Dashboard.jsx
-- (siteStageCategory/areaCategory/productCategory) plus its stageRows
-- computation (grouped by current_stage). If either JS source changes, this
-- function's CASE expressions must be updated to match, or the fast
-- (RPC-backed) path and the slow (client-side) fallback path will disagree.
--
-- Run this in the Supabase SQL Editor. Nothing else depends on it yet —
-- until it runs, the app just keeps using the existing client-side
-- computation (the code calling this RPC lands in the same deploy but fails
-- soft: see fetchCategoryBreakdown()'s own comment in dashboardQueries.js).
-- Safe to re-run (CREATE OR REPLACE), independent of every other migration
-- in this folder — it touches no table, column, or RLS policy, only adds a
-- new read-only function.
-- ============================================================

CREATE OR REPLACE FUNCTION leads_category_breakdown(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  category_group text,
  category       text,
  lead_count     bigint,
  deal_value     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_leads AS (
    SELECT
      l.id,
      COALESCE(l.current_stage, 'calling') AS current_stage,
      l.site_id,
      l.quote_value,
      l.order_value,
      s.site_stage,
      a.area_name,
      p.name AS product_name
    FROM leads l
    LEFT JOIN sites    s ON s.id = l.site_id
    LEFT JOIN areas    a ON a.id = s.area_id
    LEFT JOIN products p ON p.id = l.product_id
    WHERE p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids)
  ),
  -- Mirrors dealValueFor() exactly: an open lead's value is its quote alone
  -- (order_value is only ever set once a deal is booked — see that file's
  -- own header comment); a won/lost lead prefers order_value, falling back
  -- to quote_value. Both branches coalesce to 0 for the SUM below, matching
  -- dealValueFor()'s own "0 is correct for adding up" rule.
  valued AS (
    SELECT
      *,
      CASE
        WHEN current_stage IN ('won', 'lost') THEN COALESCE(order_value, quote_value, 0)
        ELSE COALESCE(quote_value, 0)
      END AS deal_value
    FROM scoped_leads
  )
  -- areaCategory(): !site_id -> 'No site'; else sites.areas.area_name ?? 'No area set'
  SELECT 'area', CASE WHEN site_id IS NULL THEN 'No site' ELSE COALESCE(area_name, 'No area set') END,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2

  UNION ALL

  -- siteStageCategory(): !site_id -> 'No site'; else sites.site_stage || 'Not set'
  -- (JS `||` treats '' as falsy too, unlike `??` — NULLIF is what mirrors that)
  SELECT 'site_stage', CASE WHEN site_id IS NULL THEN 'No site' ELSE COALESCE(NULLIF(site_stage, ''), 'Not set') END,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2

  UNION ALL

  -- productCategory(): products.name ?? 'Not specified'
  SELECT 'product', COALESCE(product_name, 'Not specified'),
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2

  UNION ALL

  -- stageRows: grouped by current_stage (already defaulted to 'calling'
  -- above). Dashboard.jsx zero-fills every LEAD_STAGE_OPTIONS value that
  -- doesn't come back here — this only needs to return stages that actually
  -- have at least one lead.
  SELECT 'stage', current_stage,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2
$$;

GRANT EXECUTE ON FUNCTION leads_category_breakdown(integer[]) TO authenticated;


-- ============================================================
-- VERIFICATION — run these after.
-- ============================================================

-- 1. Function exists and is SECURITY INVOKER (NOT DEFINER — this is the
--    security-critical check):
--
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'leads_category_breakdown';
--
--    Expect prosecdef = false (false means INVOKER, true would mean DEFINER
--    — if this ever comes back true, STOP and do not let the app call it).

-- 2. Call it as yourself in the SQL Editor (runs as the postgres/service
--    role there, so this just proves the function runs and returns a
--    sensible shape — it does NOT prove RLS scoping, which needs a real
--    logged-in session, see #3):
--
-- SELECT * FROM leads_category_breakdown() ORDER BY category_group, lead_count DESC;
--
--    Expect four `category_group` values (area, site_stage, product, stage), and
--    summing lead_count within one category_group should equal the total lead count.

-- 3. THE REAL TEST — from the app itself, with a real sales_executive
--    session logged in (not the SQL Editor, which bypasses RLS as an admin
--    role): confirm the browser network tab shows this RPC returning ONLY
--    that employee's own leads' worth of totals, matching what the existing
--    (slower) breakdownLeads-based cards show for the exact same numbers.
--    If they disagree, do not trust this function until the mismatch is
--    understood — see this file's header comment on why SECURITY INVOKER
--    is load-bearing here.
