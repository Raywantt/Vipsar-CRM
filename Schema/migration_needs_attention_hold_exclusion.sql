-- ============================================================
-- MIGRATION: leads_needing_attention() — exclude on-hold leads from the
-- "stale" bucket, and reset the stale clock on resume (2026-09-07)
--
-- THE PROBLEM. Needs Attention's "stale" bucket (no activity in
-- ATTENTION_DAYS+ days) judged an on_hold lead the same as any open one — a
-- lead paused for months landed here with a many-months-old "days since
-- touch", which is unfair: the whole point of On Hold is that nobody is
-- meant to be working the lead right now. And the moment a paused lead
-- resumed (its stage changed to anything else), this function kept scoring
-- it off whatever activity/created_at predated the pause, so a lead that
-- had just come back into play could reappear as "stale" instantly instead
-- of getting a fresh clock from the day it resumed.
--
-- THE FIX, two independent pieces:
--   1. `g.stage <> 'on_hold'` is now part of f_stale itself — an on_hold
--      lead is excluded outright, however long the pause has run. It is
--      NOT given a floored/reset age the way HISTORY_STARTS_AT clamps an
--      imported lead's pre-history; it simply isn't judged at all while
--      paused.
--   2. The "since touch" reference used for the stale gate (and now
--      returned for JS to build the display age/description from) is
--      GREATEST(last activity, last stage change), not last activity
--      alone. A stage change is as real a touch as a logged activity —
--      src/lib/attention.js's client-side path has always treated
--      LeadDetail's own health pill this way (it folds every stage_history
--      row into its "last touched" calc) — so the very stage_history row
--      that takes a lead off hold IS the touch that resets this bucket's
--      clock, starting from the day of the resume rather than picking up
--      wherever the pause found it.
--
-- WHY A NEW COLUMN, `last_stage_change_at`, IN THE RETURN SHAPE.
-- attention.js's computeAttentionBucketsFromRpc() only trusts this
-- function's `is_stale` boolean for MEMBERSHIP (never re-decides it), but
-- it still builds the row's displayed age/description itself, via the same
-- staleSinceTouch()/staleDescription() helpers the client-side path uses.
-- Those need BOTH last_activity_at and last_stage_change_at to agree with
-- what actually decided is_stale here — returning only last_activity_at
-- would let is_stale correctly reset on a resume while the display kept
-- showing the old (from before the pause) age, which is the exact
-- inconsistency this migration exists to remove. See src/lib/attention.js.
--
-- Adding a column to a TABLE-returning function's shape is a return-type
-- change, which CREATE OR REPLACE FUNCTION cannot perform in place — hence
-- the DROP FUNCTION below. Safe: this function is read-only, has no
-- dependents other than the one RPC caller (fetchLeadsNeedingAttention),
-- and PostgREST re-reads the schema on its next request either way.
--
-- Everything else (SECURITY INVOKER, the naive-timestamp/date-only
-- instant handling, the p_now/p_today/p_tz_offset_minutes parameters, the
-- imported-lead HISTORY_STARTS_AT clamp, the ORDER BY id) is unchanged from
-- Schema/migration_needs_attention_rpc.sql — see that file for the full
-- reasoning behind each of those.
--
-- Fails soft until run, same as the original migration: Dashboard catches
-- a "function not found"/mismatched-shape error and falls back to the
-- existing client-side computeAttentionBuckets(), which already carries
-- this same fix (see src/lib/attention.js — it ships in the same release
-- as this file, so the client-side path is correct starting immediately;
-- only the RPC fast-path needs this migration run before it matches).
-- Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS leads_needing_attention(timestamptz, date, integer, integer, integer, integer, date);

CREATE FUNCTION leads_needing_attention(
  p_now               timestamptz,
  p_today             date,
  p_tz_offset_minutes integer,
  p_attention_days    integer DEFAULT 14,
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
      -- queueAge()/staleSinceTouch(): the touch reference the stale gate
      -- tests, GREATEST(last activity, last stage change) — a stage change
      -- is as real a touch as a logged activity (see this file's header).
      -- GREATEST ignores NULL arguments and only returns NULL if every
      -- argument is NULL, which matches laterOf(...) ?? createdAt exactly.
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
      -- inside this CRM are unaffected and fire immediately.
      (FLOOR(EXTRACT(EPOCH FROM (p_now - i.history_floor)) / 86400)::int >= p_attention_days) AS grace_over
    FROM instants i
  ),
  flagged AS (
    SELECT
      g.*,
      (
        -- A lead currently on hold is excluded from "stale" outright,
        -- however long the pause has run — see this file's header.
        g.stage <> 'on_hold'
        AND g.touch_gate IS NOT NULL
        AND g.touch_gate >= p_attention_days
      ) AS f_stale,
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
    f.f_stale, f.f_silent_quote, f.f_followup_overdue, f.f_slipped, f.f_pending_rfq
  FROM flagged f
  WHERE f.f_stale OR f.f_silent_quote OR f.f_followup_overdue OR f.f_slipped OR f.f_pending_rfq
  -- ORDER BY id is REQUIRED, not cosmetic — see migration_needs_attention_rpc.sql.
  ORDER BY f.id
$$;

GRANT EXECUTE ON FUNCTION leads_needing_attention(timestamptz, date, integer, integer, integer, integer, date) TO authenticated;


-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Exists, is SECURITY INVOKER, and returns the new column:
--
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'leads_needing_attention';
-- SELECT * FROM leads_needing_attention(now(), CURRENT_DATE, -330) LIMIT 1;
--   -- confirm `last_stage_change_at` is present in the result columns.

-- 2. Spot-check a real on-hold lead: pick one with current_stage = 'on_hold'
--    and a last activity or created_at well past ATTENTION_DAYS — confirm it
--    does NOT appear in this function's output (or, if it also matches
--    another bucket like followups_overdue, that its is_stale column reads
--    false).

-- 3. THE REAL TEST, as always with this function, is run from the app: log
--    into a real session as the role you're checking, compare this
--    function's stale-bucket lead-id set against
--    computeAttentionBuckets(breakdownLeads, lastActivityByLead,
--    lastStageChangeByLead) over the same data, and require an exact match.
--    Never run this comparison from the SQL Editor — it executes as
--    `postgres` with BYPASSRLS and no auth.uid(), so both sides would see
--    every lead in the company regardless of role and prove nothing about
--    RLS-scoped behaviour.
