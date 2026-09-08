-- ============================================================
-- MIGRATION: leads_needing_attention() — add a STALE_DAYS(7) flag for
-- RightNowStrip's "Stale Leads" tile (2026-09-08)
--
-- THE PROBLEM. RightNowStrip's "Stale Leads" tile (src/components/
-- RightNowStrip.jsx) reused computeAttentionBuckets()'s 'stale' bucket
-- directly — the same one Needs Attention's "No activity in 14+ days" row
-- shows. So the two always displayed the identical number, under a label
-- ("Stale") that this app's own STALE_DAYS/ATTENTION_DAYS split (see
-- CLAUDE.md's Needs Attention entry, 2026-08-10) defines as a DIFFERENT,
-- earlier threshold: a lead starts reading as neglected at STALE_DAYS (7)
-- days untouched, and only enters the Needs Attention queue at ATTENTION_DAYS
-- (14). The tile was never actually showing the 7-day number. Reported
-- live (owner noticed both tiles read 72) and confirmed against the code.
--
-- THE FIX. This function gains a second, independent flag — `is_stale_7d`,
-- gated on a new `p_stale_days` parameter (default 7) — computed off the
-- exact same `touch_gate` as the existing `is_stale` (ATTENTION_DAYS/14)
-- flag, just compared against the earlier threshold. Same on_hold exclusion,
-- same GREATEST(last activity, last stage change) "since touch" reference —
-- a paused lead shouldn't read as neglected under either threshold, so this
-- reuses migration_needs_attention_hold_exclusion.sql's rule rather than
-- inventing a second one. `is_stale` (14-day) is untouched — Needs
-- Attention's own bucket and every consumer of it are unaffected by this
-- migration.
--
-- THE WHERE CLAUSE IS WIDENED, and that is the load-bearing part. Every
-- other threshold in this function; is_stale_7d included, only decides
-- membership in the RESULT SET this function already fetched. Since
-- `touch_gate >= 14` implies `touch_gate >= 7`, `is_stale_7d` is a SUPERSET
-- of `is_stale` — but a lead stale at, say, 9 days (not yet 14, and not
-- matching any of the other four bucket conditions) would previously not be
-- returned by this function AT ALL, since the old WHERE clause was
-- `f_stale OR f_silent_quote OR f_followup_overdue OR f_slipped OR
-- f_pending_rfq`. Without adding `OR f.f_stale_7d` to that list, the new
-- flag would only ever be observed to be true on rows some OTHER bucket
-- already pulled in — silently undercounting the tile for exactly the
-- 7-13-day leads it exists to surface. This does not change what any of the
-- five EXISTING buckets count: each of those still reads its own boolean
-- column per row, unaffected by which other rows happen to be present in
-- the result set.
--
-- DELIBERATELY NOT re-litigating the on_hold rule or the imported-lead
-- HISTORY_STARTS_AT clamp here — both are unchanged, reused as-is from
-- migration_needs_attention_hold_exclusion.sql. See that file (and
-- migration_needs_attention_rpc.sql before it) for the full reasoning behind
-- the date handling, SECURITY INVOKER requirement, and ORDER BY id.
--
-- Adding a column to a TABLE-returning function's shape is a return-type
-- change, which CREATE OR REPLACE FUNCTION cannot perform in place — hence
-- the DROP FUNCTION below, same as the previous migration. Safe: this
-- function is read-only, has exactly one caller (fetchLeadsNeedingAttention),
-- and PostgREST re-reads the schema on its next request either way.
--
-- Fails soft until run: src/lib/attention.js's computeStale7BucketFromRpc()
-- treats a row with no `is_stale_7d` field (the shape this function returns
-- before this migration) as simply not stale, so the RightNowStrip tile
-- reads 0 rather than erroring — an undercount, not a crash, until this is
-- run. The client-side fallback path (computeStale7Bucket(), used for a
-- sales_manager or whenever the RPC call itself fails) is correct starting
-- immediately, same split as every other migration in this pass.
-- Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS leads_needing_attention(timestamptz, date, integer, integer, integer, integer, date);

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
      -- laterOf(...) ?? createdAt exactly. Shared by BOTH is_stale and the
      -- new is_stale_7d below — only the threshold they compare it against
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
      -- the new stale-tile flag.
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
        -- Same rule, earlier threshold — see this file's own header. Always
        -- true whenever f_stale is (touch_gate >= 14 implies touch_gate >=
        -- 7), so this is a strict superset; it exists as its own flag so JS
        -- can tell "just gone quiet" apart from "in the Needs Attention
        -- queue" instead of only ever seeing the later number.
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
    f.id, f.party_label, f.owner_label, f.owner_employee_id, f.stage,
    f.quote_value, f.order_value,
    f.last_at, f.last_stage_change_at, f.created_at,
    f.quote_sent_at, f.next_followup_date, f.estimated_close_date, f.rfq_raised_at,
    f.f_stale, f.f_stale_7d, f.f_silent_quote, f.f_followup_overdue, f.f_slipped, f.f_pending_rfq
  FROM flagged f
  -- WIDENED: OR f.f_stale_7d is new, and is the reason this migration exists
  -- at all — see this file's header. f.f_stale is a subset of f.f_stale_7d
  -- and is kept in the list only for readability; removing it would change
  -- nothing.
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
--   -- confirm `is_stale_7d` is present in the result columns.

-- 2. Sanity check the superset relationship: every is_stale row must also be
--    is_stale_7d.
--
-- SELECT count(*) FROM leads_needing_attention(now(), CURRENT_DATE, -330)
--   WHERE is_stale AND NOT is_stale_7d;
--   -- must return 0.

-- 3. THE REAL TEST, as always with this function, is run from the app: log
--    into a real session as the role you're checking, and compare this
--    function's is_stale_7d-true lead-id set against
--    computeStale7Bucket(breakdownLeads, lastActivityByLead,
--    lastStageChangeByLead) over the same data — require an exact match.
--    Never run this comparison from the SQL Editor — it executes as
--    `postgres` with BYPASSRLS and no auth.uid(), so both sides would see
--    every lead in the company regardless of role and prove nothing about
--    RLS-scoped behaviour.
