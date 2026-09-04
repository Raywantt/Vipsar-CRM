-- ============================================================
-- MIGRATION: leads_needing_attention() RPC  (2026-09-05)
--
-- The last and largest piece of the performance pass. Needs Attention's five
-- buckets (src/lib/attention.js) were the only remaining reason Dashboard
-- downloads every lead in the company: computeAttentionBuckets() takes the
-- full 1,209-row fetchLeadsForBreakdown() result plus every activity row,
-- and filters it down to ~66 leads in the browser. This function does that
-- filtering in Postgres and returns only the leads that actually match.
--
-- DELIBERATELY SPLIT: SQL OWNS THE PREDICATES, JS OWNS THE PRESENTATION.
-- This function decides ONLY which leads land in which bucket, and returns
-- the raw columns each row needs. It computes no labels, no ages for
-- display, no currency, no sort order. attention.js still builds every row
-- through the same toRow()/sortByAgeDesc()/bucket-metadata code it always
-- has, so the drill-down panel and the card cannot drift from what they
-- render today. That split is what makes this safe to verify: only the
-- filters moved, and a filter is a set of lead ids, which can be compared
-- exactly against the old implementation.
--
-- SECURITY INVOKER (Postgres's default, stated explicitly so a future edit
-- can't silently flip it) — the same requirement as
-- leads_category_breakdown(). It MUST run under the caller's own RLS: a
-- sales exec sees only their own leads, a coordinator their team's. If this
-- ever became SECURITY DEFINER, every exec would see the whole company.
--
-- ---------------------------------------------------------------------------
-- WHY THE DATE HANDLING BELOW LOOKS FUSSY — read before changing any of it.
--
-- attention.js runs in the browser, so its thresholds are decided by
-- JavaScript's Date parsing, and JS parses the two kinds of column in this
-- schema DIFFERENTLY:
--
--   * A naive TIMESTAMP (leads.created_at, activities.created_at) serialises
--     as "2026-08-09T09:49:01" with no zone, and `new Date(...)` reads that
--     as LOCAL time (IST here) — see CLAUDE.md's Day Review timestamp note.
--   * A DATE (quote_sent_at, rfq_raised_at, next_followup_date,
--     estimated_close_date) serialises as "2026-08-20", and `new Date(...)`
--     reads a date-only string as UTC MIDNIGHT.
--
-- So the same instant is derived two different ways depending on the column,
-- and this function has to reproduce both or leads will fall on the wrong
-- side of a threshold near the boundary. Hence naive_to_instant() vs
-- date_to_instant() below. This is NOT tidiness — matching the existing
-- behaviour exactly is the whole point, including where that behaviour is
-- itself quirky.
--
-- "Now" and "today" are PARAMETERS, not now()/CURRENT_DATE. The database
-- runs in UTC; the reps are in IST. Between 00:00 and 05:30 IST the UTC date
-- is still yesterday, so a server-side CURRENT_DATE would silently mark
-- follow-ups overdue a day early (or late) for five and a half hours every
-- night. attention.js already computes these from the browser's own clock
-- (todayISO(), Date.now()) and they are passed in so both paths agree by
-- construction.
--
-- Run this in the Supabase SQL Editor. Fails soft until then: Dashboard
-- catches the "function not found" error and falls back to the existing
-- client-side computation, exactly as before.
-- Safe to re-run (CREATE OR REPLACE). Independent of every other migration —
-- it adds one read-only function and touches no table, column or policy.
-- ============================================================

CREATE OR REPLACE FUNCTION leads_needing_attention(
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
      -- THE COALESCE IS LOAD-BEARING — do not remove it. `NULL LIKE
      -- 'legacy-%'` is NULL, not false, so without it every app-created
      -- lead (external_reference_id IS NULL) made `NOT imported` evaluate
      -- to NULL, which turned the whole inherited-date guard below into
      -- NULL and silently dropped the lead from the followups_overdue and
      -- slipped buckets. That is not hypothetical: the first cut of this
      -- function lost all 6 slipped leads and lead #320 — the very lead
      -- CLAUDE.md records as having been wrongly hidden once before by an
      -- earlier version of this same clamp. JS's isImportedLead() returns a
      -- real false here (it tests typeof), so this must too.
      COALESCE(l.external_reference_id LIKE 'legacy-%', false)      AS imported,
      -- partyLabel(): parties.name ?? sites.nickname ?? sites.locality
      -- ?? '(no party)'. LEFT JOINs so an RLS-invisible party degrades to
      -- the same fallback the embedded-null case produces today.
      COALESCE(p.name, s.nickname, s.locality, '(no party)')        AS party_label,
      COALESCE(e.name, 'Unassigned')                                AS owner_label,
      la.last_at
    FROM leads l
    LEFT JOIN parties   p  ON p.id = l.party_id
    LEFT JOIN sites     s  ON s.id = l.site_id
    LEFT JOIN employees e  ON e.id = l.owner_employee_id
    LEFT JOIN last_activity la ON la.lead_id = l.id
    -- isOpen(): every bucket below only ever considers open leads.
    WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
  ),
  instants AS (
    SELECT
      b.*,
      -- JS reads a naive timestamp as LOCAL time.
      (b.created_at - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS created_instant,
      (b.last_at    - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS last_instant,
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
      -- queueAge(): the age a threshold is tested against. For an imported
      -- lead a signal older than the floor counts as though it arrived on
      -- the floor; an app-created lead is never clamped. NOTE this is the
      -- GATE only — the age these rows DISPLAY is recomputed unclamped in
      -- JS, exactly as it is today.
      FLOOR(EXTRACT(EPOCH FROM (p_now - CASE
        WHEN i.imported AND COALESCE(i.last_instant, i.created_instant) < i.history_floor
          THEN i.history_floor
        ELSE COALESCE(i.last_instant, i.created_instant)
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
      (g.touch_gate IS NOT NULL AND g.touch_gate >= p_attention_days) AS f_stale,
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
    f.last_at, f.created_at,
    f.quote_sent_at, f.next_followup_date, f.estimated_close_date, f.rfq_raised_at,
    f.f_stale, f.f_silent_quote, f.f_followup_overdue, f.f_slipped, f.f_pending_rfq
  FROM flagged f
  WHERE f.f_stale OR f.f_silent_quote OR f.f_followup_overdue OR f.f_slipped OR f.f_pending_rfq
  -- ORDER BY id is REQUIRED, not cosmetic. attention.js sorts each bucket by
  -- age descending, and Array.prototype.sort is stable — so leads of EQUAL
  -- age come out in whatever order they were inserted. The client-side path
  -- inserts in id order (fetchAllRows appends `.order('id')`), so without
  -- this the two paths agreed on WHICH leads were in the stale bucket while
  -- disagreeing on their order: identical sets, 207 differing row positions.
  ORDER BY f.id
$$;

GRANT EXECUTE ON FUNCTION leads_needing_attention(timestamptz, date, integer, integer, integer, integer, date) TO authenticated;


-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Exists and is SECURITY INVOKER (prosecdef must be false):
--
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'leads_needing_attention';

-- 2. THE REAL TEST is not run here — it is run from the app, comparing this
--    function's bucket membership against computeAttentionBuckets() over the
--    same leads, and requiring the lead-id sets to match EXACTLY for all
--    five buckets. See CLAUDE.md's Needs Attention entry for the result of
--    that comparison. A count that merely "looks about right" is not
--    evidence: the whole risk in this migration is a lead silently landing
--    in the wrong bucket near a threshold.
