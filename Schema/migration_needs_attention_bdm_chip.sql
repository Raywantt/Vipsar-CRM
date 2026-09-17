-- ============================================================
-- MIGRATION: leads_needing_attention() — add bdm_employee_id for the BDM
-- source chip (2026-09-17)
--
-- THE PROBLEM. The BDM chip (src/components/BdmChip.jsx) marks which BDM
-- brought a lead in, on every lead row app-wide — the owner's ruling was
-- that every role who can already see a lead should see this too, not just
-- BDM/owner screens. Most lead lists get the data for free: BREAKDOWN_LEAD_
-- COLUMNS (src/lib/dashboardQueries.js) and fetchLeadsList() already select
-- leads.bdm_employee_id. This RPC's rows are the one path that doesn't —
-- Needs Attention's five buckets and the KPI row's "Stale leads" drill-down
-- read attention.js's computeAttentionBucketsFromRpc()/
-- computeStale7BucketFromRpc(), which shape THIS function's rows into the
-- same lead-like object toRow() reads from — and toRow() now reads
-- lead.next_followup_date for hasOpenFollowUp AND would need
-- lead.bdm_employee_id for the chip, neither of which the RPC returns today
-- for that second one.
--
-- THE FIX. bdm_employee_id added as a plain passthrough column: selected in
-- the `base` CTE (already joins from `leads l`, so this is a zero-cost
-- addition, no new join), carried through instants/gated/flagged via their
-- existing `.*`, and added to the final SELECT list. No WHERE clause,
-- threshold or bucket membership rule changes — this migration only adds a
-- column, it does not change which rows come back or why.
--
-- ⚠️ THIS FILE IS LAYERED ON TOP OF migration_bdm_handoff.sql, NOT
-- migration_stale_7day_tile.sql — the base CTE's pool-exclusion clause
-- (`AND (l.owner_employee_id IS NOT NULL OR l.bdm_employee_id IS NULL OR
-- (SELECT current_employee_role()) = 'business_development_manager')`) is
-- copied verbatim from the CURRENT live definition, not the pre-BDM one. Run
-- this AFTER migration_bdm_handoff.sql, and — per CLAUDE.md's standing
-- warning — if migration_bdm_handoff.sql is ever re-run for any other
-- reason, re-run THIS file again immediately after: CREATE OR REPLACE
-- FUNCTION on that older body would silently drop the bdm_employee_id
-- column added here.
--
-- Adding a column to a TABLE-returning function's shape is a return-type
-- change, which CREATE OR REPLACE FUNCTION cannot perform in place — hence
-- the DROP FUNCTION below, same reasoning as migration_stale_7day_tile.sql.
-- Safe: this function is read-only, has exactly one caller
-- (fetchLeadsNeedingAttention), and PostgREST re-reads the schema on its
-- next request either way.
--
-- Fails soft until run: BdmChip renders nothing for a lead with no
-- bdm_employee_id, and a row from the not-yet-migrated RPC simply has no
-- such field at all, which reads the same way — so Needs Attention and the
-- Stale leads drill-down just show no chip on any row until this runs,
-- never an error. The client-side fallback path (computeAttentionBuckets(),
-- used for a sales_manager's Team view or whenever the RPC call itself
-- fails) already has the column via BREAKDOWN_LEAD_COLUMNS and is correct
-- starting immediately, with no migration needed.
-- Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date);

CREATE FUNCTION leads_needing_attention(
  p_now               timestamptz,
  p_today             date,
  p_tz_offset_minutes integer,
  p_attention_days    integer DEFAULT 14,
  p_stale_days        integer DEFAULT 7,
  p_silent_quote_days integer DEFAULT 5,
  p_pending_rfq_days  integer DEFAULT 3,
  p_history_starts_at date    DEFAULT DATE '2026-09-02'
)
RETURNS TABLE (
  lead_id              integer,
  party                text,
  owner_name           text,
  owner_id             integer,
  bdm_employee_id      integer,
  current_stage        text,
  quote_value          numeric,
  order_value          numeric,
  last_activity_at     timestamp,
  last_stage_change_at timestamp,
  lead_created_at      timestamp,
  quote_sent_at        date,
  next_followup_date   date,
  estimated_close_date date,
  rfq_raised_at        date,
  is_stale             boolean,
  is_stale_7d          boolean,
  is_silent_quote      boolean,
  is_followup_overdue  boolean,
  is_slipped           boolean,
  is_pending_rfq       boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH last_activity AS (
    -- Mirrors fetchLastActivityPerLead() + Dashboard's client-side reduction
    -- to one row per lead (it keeps the greatest created_at).
    SELECT a.lead_id, MAX(a.created_at) AS last_at
    FROM activities a
    WHERE a.lead_id IS NOT NULL
    GROUP BY a.lead_id
  ),
  last_stage_change AS (
    -- Mirrors src/lib/attention.js's buildLastStageChangeByLead() — the most
    -- recent stage_history row per lead, regardless of what it was to or
    -- from. Deliberately unfiltered by stage: the row that matters here is
    -- whichever came last, which for a resumed lead is the very change that
    -- took it off on_hold.
    SELECT sh.lead_id, MAX(sh.changed_at) AS changed_at
    FROM stage_history sh
    GROUP BY sh.lead_id
  ),
  base AS (
    SELECT
      l.id,
      COALESCE(l.current_stage, 'calling')                          AS stage,
      l.quote_value,
      l.order_value,
      l.owner_employee_id,
      l.bdm_employee_id,
      l.created_at,
      l.quote_sent,
      l.quote_sent_at,
      l.rfq_raised,
      l.rfq_raised_at,
      l.next_followup_date,
      l.estimated_close_date,
      -- isImportedLead(): provenance, never date. The marker the legacy
      -- import files stamp and nothing in the app ever writes. A lead
      -- without it is treated as app-created, i.e. never clamped.
      --
      -- THE COALESCE IS LOAD-BEARING — do not remove it. See
      -- migration_needs_attention_rpc.sql's original comment: without it
      -- every app-created lead's `NOT imported` evaluates to NULL, which
      -- silently dropped leads from the followups_overdue and slipped
      -- buckets (lead #320 among them).
      COALESCE(l.external_reference_id LIKE 'legacy-%', false)      AS imported,
      -- partyLabel(): parties.name ?? sites.nickname ?? sites.locality
      -- ?? '(no party)'. LEFT JOINs so an RLS-invisible party degrades to
      -- the same fallback the embedded-null case produces today.
      COALESCE(p.name, s.nickname, s.locality, '(no party)')        AS party_label,
      COALESCE(e.name, 'Unassigned')                                AS owner_label,
      la.last_at,
      lsc.changed_at AS last_stage_change_at
    FROM leads l
    LEFT JOIN parties   p  ON p.id = l.party_id
    LEFT JOIN sites     s  ON s.id = l.site_id
    LEFT JOIN employees e  ON e.id = l.owner_employee_id
    LEFT JOIN last_activity la ON la.lead_id = l.id
    LEFT JOIN last_stage_change lsc ON lsc.lead_id = l.id
    -- isOpen(): every bucket below only ever considers open leads.
    WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
      -- BDM pool leads stay out of every company figure until assigned
      -- (migration_bdm_handoff.sql) — except for the BDM who brought them in.
      AND (l.owner_employee_id IS NOT NULL OR l.bdm_employee_id IS NULL
           OR (SELECT current_employee_role()) = 'business_development_manager')
  ),
  instants AS (
    SELECT
      b.*,
      -- JS reads a naive timestamp as LOCAL time.
      (b.created_at - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS created_instant,
      (b.last_at    - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS last_instant,
      (b.last_stage_change_at - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS stage_instant,
      -- JS reads a date-only string as UTC midnight.
      (b.quote_sent_at::timestamp) AT TIME ZONE 'UTC'                                AS quote_instant,
      (b.rfq_raised_at::timestamp) AT TIME ZONE 'UTC'                                AS rfq_instant,
      -- HISTORY_STARTS_AT is built in JS as new Date('<date>T00:00:00') —
      -- no zone suffix, so LOCAL midnight, not UTC midnight.
      (p_history_starts_at - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS history_floor
    FROM base b
  ),
  gated AS (
    SELECT
      i.*,
      -- queueAge()/staleSinceTouch(): the touch reference the stale gates
      -- test, GREATEST(last activity, last stage change) — a stage change
      -- is as real a touch as a logged activity (see
      -- migration_needs_attention_hold_exclusion.sql). GREATEST ignores NULL
      -- arguments and only returns NULL if every argument is NULL, matching
      -- laterOf(...) ?? createdAt exactly. Shared by BOTH is_stale and
      -- is_stale_7d below — only the threshold they compare it against
      -- differs.
      FLOOR(EXTRACT(EPOCH FROM (p_now - CASE
        WHEN i.imported AND GREATEST(i.last_instant, i.stage_instant, i.created_instant) < i.history_floor
          THEN i.history_floor
        ELSE GREATEST(i.last_instant, i.stage_instant, i.created_instant)
      END)) / 86400)::int AS touch_gate,
      FLOOR(EXTRACT(EPOCH FROM (p_now - CASE
        WHEN i.imported AND i.quote_instant < i.history_floor THEN i.history_floor
        ELSE i.quote_instant
      END)) / 86400)::int AS quote_gate,
      FLOOR(EXTRACT(EPOCH FROM (p_now - CASE
        WHEN i.imported AND i.rfq_instant < i.history_floor THEN i.history_floor
        ELSE i.rfq_instant
      END)) / 86400)::int AS rfq_gate,
      -- inheritedGraceIsOver(): an inherited promised date gets one standard
      -- ATTENTION_DAYS runway before it counts against anyone. Dates set
      -- inside this CRM are unaffected and fire immediately. Deliberately
      -- still keyed on p_attention_days, not p_stale_days — this grace
      -- period is about the followups_overdue/slipped buckets, unrelated to
      -- the stale-tile flag.
      (FLOOR(EXTRACT(EPOCH FROM (p_now - i.history_floor)) / 86400)::int >= p_attention_days) AS grace_over
    FROM instants i
  ),
  flagged AS (
    SELECT
      g.*,
      (
        -- A lead currently on hold is excluded from "stale" outright,
        -- however long the pause has run — see
        -- migration_needs_attention_hold_exclusion.sql.
        g.stage <> 'on_hold'
        AND g.touch_gate IS NOT NULL
        AND g.touch_gate >= p_attention_days
      ) AS f_stale,
      (
        -- Same rule, earlier threshold. Always true whenever f_stale is
        -- (touch_gate >= 14 implies touch_gate >= 7), so this is a strict
        -- superset; it exists as its own flag so JS can tell "just gone
        -- quiet" apart from "in the Needs Attention queue" instead of only
        -- ever seeing the later number.
        g.stage <> 'on_hold'
        AND g.touch_gate IS NOT NULL
        AND g.touch_gate >= p_stale_days
      ) AS f_stale_7d,
      (
        g.quote_sent IS TRUE
        AND g.quote_sent_at IS NOT NULL
        AND g.quote_gate IS NOT NULL
        AND g.quote_gate >= p_silent_quote_days
        -- touchedSinceQuote: last activity strictly after the quote date.
        AND NOT (g.last_instant IS NOT NULL AND g.last_instant > g.quote_instant)
      ) AS f_silent_quote,
      (
        g.next_followup_date IS NOT NULL
        AND g.next_followup_date < p_today
        AND (NOT g.imported OR g.next_followup_date >= p_history_starts_at OR g.grace_over)
      ) AS f_followup_overdue,
      (
        g.estimated_close_date IS NOT NULL
        AND g.estimated_close_date < p_today
        AND (NOT g.imported OR g.estimated_close_date >= p_history_starts_at OR g.grace_over)
      ) AS f_slipped,
      (
        g.rfq_raised IS TRUE
        AND g.quote_sent IS DISTINCT FROM TRUE
        AND g.rfq_raised_at IS NOT NULL
        AND g.rfq_gate IS NOT NULL
        AND g.rfq_gate >= p_pending_rfq_days
      ) AS f_pending_rfq
    FROM gated g
  )
  SELECT
    f.id, f.party_label, f.owner_label, f.owner_employee_id, f.bdm_employee_id, f.stage,
    f.quote_value, f.order_value,
    f.last_at, f.last_stage_change_at, f.created_at,
    f.quote_sent_at, f.next_followup_date, f.estimated_close_date, f.rfq_raised_at,
    f.f_stale, f.f_stale_7d, f.f_silent_quote, f.f_followup_overdue, f.f_slipped, f.f_pending_rfq
  FROM flagged f
  WHERE f.f_stale OR f.f_stale_7d OR f.f_silent_quote OR f.f_followup_overdue OR f.f_slipped OR f.f_pending_rfq
  -- ORDER BY id is REQUIRED, not cosmetic — see migration_needs_attention_rpc.sql.
  ORDER BY f.id
$$;

GRANT EXECUTE ON FUNCTION leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date) TO authenticated;


-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Exists, is SECURITY INVOKER, and returns the new column:
--
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'leads_needing_attention';
-- SELECT * FROM leads_needing_attention(now(), CURRENT_DATE, -330) LIMIT 1;
--   -- confirm `bdm_employee_id` is present in the result columns.

-- 2. The pool rule survived (this is the regression this file's header
--    warns about — confirm it explicitly, don't just trust the copy-paste):
--
-- SELECT pg_get_functiondef(oid) LIKE '%bdm_employee_id IS NULL%'
--   FROM pg_proc WHERE proname = 'leads_needing_attention';
--   -- must be true.

-- 3. THE REAL TEST, as always with this function, is run from the app: log
--    into a real session as the role you're checking and confirm the BDM
--    chip now renders on Needs Attention / Stale leads drill-down rows for
--    a lead you know carries a bdm_employee_id. Never run this comparison
--    from the SQL Editor — it executes as `postgres` with BYPASSRLS and no
--    auth.uid(), so it proves nothing about RLS-scoped behaviour.
