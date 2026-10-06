-- ============================================================
-- MIGRATION: RFQ desk — reporting (RFQ-DESK.md Step 6, 2026-10-06)
--
-- Three things, all read by the app on the `rfq-desk` branch:
--
--   1. rfqs.counts_toward_target — an RFQ counts toward the exec's RFQ
--      Raised target ONCE, on the day it passes the technical check
--      (RFQ-DESK.md §3), and it is decided at that moment, then frozen:
--        * one per lead — the lead's first approval of an RFQ that is not a
--          price revision. A fresh RFQ sent back counts when its corrected
--          revision passes (§3); later revisions never count.
--        * the lead's RFQs must have started fresh AFTER the desk went live
--          (rfq_desk_settings.live_from). An RFQ logged before the cutover
--          counted the old way, by the day it was logged (§8 Step 8), so a
--          revision of it approved later must not count it a second time.
--          Launch day re-stamps live_from, so the pre-launch backlog never
--          counts here either.
--        * it stays counted if estimation later sends it back (owner's
--          ruling, Step 6) — a month's figures never change after the fact.
--      Credited to the RFQ's raised_by_employee_id, dated by approved_at.
--
--   2. rfqs_raised_by_select — the exec who raised an RFQ (and their
--      coordinator / manager) keeps reading it after the lead is handed to
--      someone else. That is how activities already behave (own rows stay
--      visible), and the target count reads these rows: without it an exec's
--      own RFQ figure would drop the day a lead was reassigned while the
--      owner's view still credited them.
--
--   3. leads_needing_attention() — the "RFQs pending a quote" item becomes
--      "RFQs back with the exec" (owner's ruling, Step 6). For a lead with a
--      desk RFQ, its newest one that wasn't withdrawn decides:
--        * sent back, and nothing re-logged since, for 2+ days; or
--        * Lixil's quote in, and not marked sent to the client since the day
--          it came in, for 2+ days.
--      A lead with no desk RFQ (handled in Excel) keeps today's rule — RFQ
--      raised 3+ days ago, no quote sent — until it clears.
--      Two output columns are added, so this is a DROP + CREATE (a
--      table-returning function's shape can't change in place): rfq_back_kind
--      ('sent_back' / 'quote_in', NULL for the Excel rule) and rfq_back_at.
--      Everything else is migration_needs_attention_bdm_chip.sql's body,
--      unchanged.
--
-- ⚠️ ORDER. Run AFTER migration_rfq_desk.sql (+ its advance fix) and after
-- migration_needs_attention_bdm_chip.sql. Re-running
-- migration_needs_attention_bdm_chip.sql, migration_bdm_handoff.sql,
-- migration_stale_7day_tile.sql or any older file that defines
-- leads_needing_attention() puts the old "pending a quote" rule back — re-run
-- THIS file straight after.
--
-- ⚠️ RUN BEFORE THE rfq-desk BRANCH IS MERGED: the branch's Dashboard reads
-- rfqs.counts_toward_target, and a column that doesn't exist fails the whole
-- read. Safe to run any time before that: nothing on master approves an RFQ,
-- and the new attention rule only differs for leads with a desk RFQ.
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run. Then run
-- Schema/verify_rfq_desk.sql and read its report (T40–T50 are this file's).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 1: counts_toward_target, decided at approval
-- ------------------------------------------------------------
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS counts_toward_target BOOLEAN NOT NULL DEFAULT false;

-- The Dashboard's read: counted RFQs approved inside a period.
CREATE INDEX IF NOT EXISTS idx_rfqs_counted ON rfqs (approved_at) WHERE counts_toward_target;

-- BEFORE UPDATE, so the approval's own UPDATE carries the decision and
-- rfq_approve()'s RETURNING hands it straight back to the app. Fires only on
-- the approval itself (the WHEN clause), so nothing else can set or clear it —
-- the action functions never touch the column, and nobody has a write grant
-- on rfqs.
CREATE OR REPLACE FUNCTION rfqs_count_toward_target()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_live_from timestamptz;
BEGIN
  IF NEW.kind = 'price_revision' THEN
    NEW.counts_toward_target := false;
    RETURN NEW;
  END IF;

  -- Two revisions of one lead approved at the same moment must not both
  -- count: hold the lead while deciding (the approval's AFTER trigger updates
  -- this row anyway, in the same transaction).
  PERFORM 1 FROM leads WHERE id = NEW.lead_id FOR UPDATE;

  SELECT live_from INTO v_live_from FROM rfq_desk_settings;

  NEW.counts_toward_target :=
    v_live_from IS NOT NULL
    -- the lead's RFQs started fresh once the desk was live (this one, or the
    -- fresh one it corrects)
    AND EXISTS (SELECT 1 FROM rfqs f
                 WHERE f.lead_id = NEW.lead_id AND f.kind = 'fresh' AND f.raised_at >= v_live_from)
    -- and nothing on the lead has counted yet
    AND NOT EXISTS (SELECT 1 FROM rfqs c
                     WHERE c.lead_id = NEW.lead_id AND c.id <> NEW.id AND c.counts_toward_target);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rfqs_count_toward_target ON rfqs;
CREATE TRIGGER rfqs_count_toward_target
  BEFORE UPDATE OF status ON rfqs
  FOR EACH ROW
  WHEN (OLD.status = 'with_technical' AND NEW.status = 'with_estimation')
  EXECUTE FUNCTION rfqs_count_toward_target();


-- ------------------------------------------------------------
-- STEP 2: the raiser keeps reading their RFQs
--
-- Additive (policies are OR'd), on top of migration_rfq_desk.sql's
-- rfqs_desk_select / rfqs_lead_select; the restrictive hide_test_accounts
-- still applies. Mirrors activities' own_data / coordinator_team_select /
-- manager_team_select, with the same hoisted id arrays
-- (migration_rls_performance_activities_team_select.sql).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "rfqs_raised_by_select" ON rfqs;
CREATE POLICY "rfqs_raised_by_select" ON rfqs FOR SELECT TO authenticated USING (
  raised_by_employee_id = (SELECT current_employee_id())
  OR ((SELECT current_employee_role()) = 'sales_coordinator'
      AND raised_by_employee_id = ANY ((SELECT my_team_member_ids())::integer[]))
  OR ((SELECT current_employee_role()) = 'sales_manager'
      AND raised_by_employee_id = ANY ((SELECT my_managed_member_ids())::integer[]))
);


-- ------------------------------------------------------------
-- STEP 3: leads_needing_attention() — "RFQs back with the exec"
--
-- is_pending_rfq keeps its name (the app reads it); what it means is above.
-- SECURITY INVOKER as before, so the rfqs read inside is the viewer's own.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date);
DROP FUNCTION IF EXISTS leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date, integer);

CREATE FUNCTION leads_needing_attention(
  p_now               timestamptz,
  p_today             date,
  p_tz_offset_minutes integer,
  p_attention_days    integer DEFAULT 14,
  p_stale_days        integer DEFAULT 7,
  p_silent_quote_days integer DEFAULT 5,
  p_pending_rfq_days  integer DEFAULT 3,
  p_history_starts_at date    DEFAULT DATE '2026-09-02',
  -- attention.js's RFQ_BACK_DAYS — change both together.
  p_rfq_back_days     integer DEFAULT 2
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
  is_pending_rfq       boolean,
  rfq_back_kind        text,
  rfq_back_at          timestamptz
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
  latest_desk AS (
    -- Mirrors rfqDesk.js's latestDeskRfqByLead(): each lead's newest desk RFQ
    -- that wasn't withdrawn — newest raised_at, then highest id. A withdrawn
    -- price revision leaves the quote before it in charge.
    SELECT DISTINCT ON (r.lead_id)
      r.lead_id, r.status, r.sent_back_at, r.quote_received_at
    FROM rfqs r
    WHERE r.status <> 'withdrawn'
    ORDER BY r.lead_id, r.raised_at DESC, r.id DESC
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
      lsc.changed_at AS last_stage_change_at,
      d.lead_id IS NOT NULL                                         AS has_desk_rfq,
      d.status                                                      AS desk_status,
      d.sent_back_at                                                AS desk_sent_back_at,
      d.quote_received_at                                           AS desk_quote_at
    FROM leads l
    LEFT JOIN parties   p  ON p.id = l.party_id
    LEFT JOIN sites     s  ON s.id = l.site_id
    LEFT JOIN employees e  ON e.id = l.owner_employee_id
    LEFT JOIN last_activity la ON la.lead_id = l.id
    LEFT JOIN last_stage_change lsc ON lsc.lead_id = l.id
    LEFT JOIN latest_desk d ON d.lead_id = l.id
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
      (p_history_starts_at - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC' AS history_floor,
      -- The browser's calendar day the quote came in on (toISODate of a
      -- TIMESTAMPTZ — local date parts).
      ((b.desk_quote_at AT TIME ZONE 'UTC') + make_interval(mins => p_tz_offset_minutes))::date AS desk_quote_day
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
      -- dateMath.js's daysSince() of a TIMESTAMPTZ: whole days, floored. No
      -- import clamp — every desk timestamp is newer than the floor.
      FLOOR(EXTRACT(EPOCH FROM (p_now - i.desk_sent_back_at)) / 86400)::int AS sent_back_gate,
      FLOOR(EXTRACT(EPOCH FROM (p_now - i.desk_quote_at)) / 86400)::int     AS quote_in_gate,
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
      COALESCE(CASE
        WHEN g.has_desk_rfq THEN
          -- rfqDesk.js's rfqBackWithExec(): the desk's newest RFQ is the
          -- exec's to act on, and has been for p_rfq_back_days.
          (g.desk_status = 'sent_back' AND g.sent_back_gate >= p_rfq_back_days)
          OR (g.desk_status = 'quoted' AND g.quote_in_gate >= p_rfq_back_days
              -- quoteSentToClient(): marked sent on or after the day it came in
              AND NOT (g.quote_sent IS TRUE AND g.quote_sent_at IS NOT NULL
                       AND g.quote_sent_at >= g.desk_quote_day))
        ELSE
          -- No desk RFQ (handled in Excel): the rule from before the desk.
          g.rfq_raised IS TRUE
          AND g.quote_sent IS DISTINCT FROM TRUE
          AND g.rfq_raised_at IS NOT NULL
          AND g.rfq_gate IS NOT NULL
          AND g.rfq_gate >= p_pending_rfq_days
      END, false) AS f_pending_rfq
    FROM gated g
  )
  SELECT
    f.id, f.party_label, f.owner_label, f.owner_employee_id, f.bdm_employee_id, f.stage,
    f.quote_value, f.order_value,
    f.last_at, f.last_stage_change_at, f.created_at,
    f.quote_sent_at, f.next_followup_date, f.estimated_close_date, f.rfq_raised_at,
    f.f_stale, f.f_stale_7d, f.f_silent_quote, f.f_followup_overdue, f.f_slipped, f.f_pending_rfq,
    CASE WHEN f.has_desk_rfq AND f.desk_status = 'sent_back' THEN 'sent_back'
         WHEN f.has_desk_rfq AND f.desk_status = 'quoted' THEN 'quote_in' END,
    CASE WHEN f.has_desk_rfq AND f.desk_status = 'sent_back' THEN f.desk_sent_back_at
         WHEN f.has_desk_rfq AND f.desk_status = 'quoted' THEN f.desk_quote_at END
  FROM flagged f
  WHERE f.f_stale OR f.f_stale_7d OR f.f_silent_quote OR f.f_followup_overdue OR f.f_slipped OR f.f_pending_rfq
  -- ORDER BY id is REQUIRED, not cosmetic — see migration_needs_attention_rpc.sql.
  ORDER BY f.id
$$;

REVOKE ALL ON FUNCTION leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION leads_needing_attention(timestamptz, date, integer, integer, integer, integer, integer, date, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CHECKS (read-only) — run any of these afterwards
-- ============================================================
-- The column and its trigger:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'rfqs' AND column_name = 'counts_toward_target';
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'rfqs'::regclass AND NOT tgisinternal;
-- The pool rule survived in the new attention function (must be true):
--   SELECT pg_get_functiondef(oid) LIKE '%bdm_employee_id IS NULL%' FROM pg_proc WHERE proname = 'leads_needing_attention';
-- Then the behavioural test, as real sessions: Schema/verify_rfq_desk.sql
-- (T40–T50). Never judge RLS from the SQL Editor itself — it runs as
-- postgres, past every policy.
