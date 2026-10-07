-- ============================================================
-- MIGRATION: a manager's activity on a team member's lead is seen, and counts
-- as a touch, by that lead's exec and coordinator (2026-10-07)
--
-- THE REQUEST. A sales manager sometimes makes the visit or meeting in place
-- of the exec who reports to them, because the exec needs help. Until now a
-- manager could log only on leads they own. They can now log their own work
-- against any lead in their team (Log Activity's picker, Lead Detail's "Log
-- activity" button).
--
-- THE OWNER'S RULINGS (2026-10-07):
--   * It is the MANAGER'S activity — employee_id is theirs, it counts toward
--     their numbers and their Day Review. It is NOT entry on behalf. That
--     needs NO new write policy: own_data_or_owner_role_insert already lets
--     any employee insert a row with employee_id = themselves, and nothing on
--     `activities` looks at who owns the lead.
--   * The exec who owns the lead SEES it (on the lead's timeline) and it
--     COUNTS AS A TOUCH — a lead their manager visited yesterday must not read
--     "14 days silent" on the exec's own Today. It never counts toward the
--     exec's own numbers.
--
-- WHY A FUNCTION AND NOT AN RLS POLICY — the same reason
-- migration_accompanied_activities.sql gave. A permissive SELECT policy that
-- let an exec read their manager's rows on their leads would make those rows
-- appear in EVERY query the exec runs, and several dashboard queries count
-- whatever RLS returns without filtering on employee_id (Activity counts,
-- the KPI sparkline, the Activities logged popup). The manager's visit would
-- be counted for the exec. So `activities` RLS is left exactly as it is, and
-- manager_activity_on_team_leads() is the ONLY path to these rows.
--
-- WHAT IT RETURNS, AND TO WHOM. Activities on a lead the viewer reaches as
-- its owner (a sales_executive) or as the owner's coordinator
-- (my_team_member_ids), logged by THAT LEAD OWNER'S manager
-- (employees.manager_id). Nobody else: not an owner (reads everything through
-- RLS), not the manager (reads their own rows through RLS), not another
-- exec, not a BDM, not the RFQ desk. The coordinator is included because they
-- supervise the same lead and would otherwise see it go stale on their screen
-- while their colleague the manager had just been there.
--
-- It is SECURITY DEFINER, so the RESTRICTIVE hide_test_accounts policy does
-- not apply inside it — the same rule is repeated below with the same helpers,
-- or a test manager logging on a test exec's lead would leak into a real
-- screen. A deactivated employee resolves current_employee_role() to NULL and
-- sees nothing.
--
-- THE TWO "LAST TOUCH" FUNCTIONS READ IT. last_activity_per_lead() and
-- leads_needing_attention() are SECURITY INVOKER and read `activities` under
-- the viewer's RLS, so on their own they would never see the manager's row.
-- Each now UNIONs in manager_activity_on_team_leads(). They stay INVOKER —
-- nothing else about what the viewer can see changes — and that is the whole
-- of "counts as a touch": every stale colour, All Leads' recency, the Needs
-- Attention queue and the "silent quote" rule follow, with no client change.
--
-- leads_needing_attention() below is migration_rfq_desk_reporting.sql's body
-- (the RFQ-back rule, the BDM pool rule, the import clamp, the hold exclusion)
-- with ONE change: the last_activity CTE. ⚠ It is a full re-creation, so it
-- must be layered AFTER every other file that defines it, and re-run straight
-- after any of them: migration_rfq_desk_reporting.sql,
-- migration_needs_attention_bdm_chip.sql, migration_bdm_handoff.sql,
-- migration_stale_7day_tile.sql. last_activity_per_lead() likewise follows
-- migration_rls_per_row_fixes.sql.
--
-- NEEDS (already live): current_employee_id(), current_employee_role(),
-- my_team_member_ids(), viewer_sees_test_data(), test_employee_ids(),
-- test_lead_ids() (migration_hide_test_accounts.sql,
-- migration_rls_performance_follow_ups.sql), employees.manager_id.
--
-- Fails soft until run, both ways: the app treats an error from the function
-- as "none", and the two functions it replaces keep working as they did. So it
-- can run before or after the deploy. Safe to re-run. One transaction.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 1: the read path.
-- p_lead_id narrows to one lead (Lead Detail asks for its own); NULL = every
-- lead the viewer reaches (the two last-touch functions below).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS manager_activity_on_team_leads(integer);

CREATE FUNCTION manager_activity_on_team_leads(p_lead_id integer DEFAULT NULL)
RETURNS TABLE (
  id                  integer,
  lead_id             integer,
  activity_type       text,
  rfq_kind            text,
  notes               text,
  created_at          timestamp,
  employee_id         integer,
  employee_name       text,
  accompanied_by      integer,
  accompanied_by_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id,
         a.lead_id,
         a.activity_type::text,
         a.rfq_kind::text,
         a.notes::text,
         a.created_at,
         a.employee_id,
         m.name::text,
         a.accompanied_by,
         c.name::text
    FROM leads l
    JOIN employees o    ON o.id = l.owner_employee_id
    -- Logged by the lead OWNER'S manager — the one relationship this opens.
    JOIN activities a   ON a.lead_id = l.id AND a.employee_id = o.manager_id
    JOIN employees m    ON m.id = a.employee_id
    LEFT JOIN employees c ON c.id = a.accompanied_by
   -- A one-time filter: for every other role this is false before a single
   -- row is read, so the owner's and manager's calls cost nothing.
   WHERE (SELECT current_employee_role()) IN ('sales_executive', 'sales_coordinator')
     AND (p_lead_id IS NULL OR l.id = p_lead_id)
     AND (
       l.owner_employee_id = (SELECT current_employee_id())
       OR ((SELECT current_employee_role()) = 'sales_coordinator'
           AND l.owner_employee_id = ANY((SELECT my_team_member_ids())::integer[]))
     )
     -- hide_test_accounts, repeated (see header).
     AND (
       (SELECT viewer_sees_test_data())
       OR (a.employee_id       <> ALL((SELECT test_employee_ids())::integer[])
           AND l.owner_employee_id <> ALL((SELECT test_employee_ids())::integer[])
           AND l.id            <> ALL((SELECT test_lead_ids())::integer[]))
     )
   ORDER BY a.created_at DESC, a.id DESC;
$$;

REVOKE ALL ON FUNCTION manager_activity_on_team_leads(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION manager_activity_on_team_leads(integer) TO authenticated;


-- ------------------------------------------------------------
-- STEP 2: last_activity_per_lead() — one row per lead, its latest activity.
-- Body as in migration_rls_per_row_fixes.sql, plus the manager's rows.
-- Still SECURITY INVOKER; same output shape.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.last_activity_per_lead()
RETURNS TABLE (lead_id integer, created_at timestamp without time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT t.lead_id, MAX(t.created_at)
    FROM (
      SELECT a.lead_id, a.created_at
        FROM activities a
       WHERE a.lead_id IS NOT NULL
      UNION ALL
      SELECT m.lead_id, m.created_at
        FROM manager_activity_on_team_leads() m
    ) t
   GROUP BY t.lead_id;
$$;

REVOKE ALL ON FUNCTION public.last_activity_per_lead() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.last_activity_per_lead() TO authenticated;


-- ------------------------------------------------------------
-- STEP 3: leads_needing_attention() — migration_rfq_desk_reporting.sql's body,
-- last_activity CTE the only change.
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
    -- to one row per lead (it keeps the greatest created_at). THE ONE CHANGE
    -- in this function: the viewer's own readable activities, plus what the
    -- lead owner's manager logged on it (see the header) — a manager's visit
    -- is a touch for the exec and the coordinator, who can't read that row.
    SELECT t.lead_id, MAX(t.created_at) AS last_at
    FROM (
      SELECT a.lead_id, a.created_at
      FROM activities a
      WHERE a.lead_id IS NOT NULL
      UNION ALL
      SELECT m.lead_id, m.created_at
      FROM manager_activity_on_team_leads() m
    ) t
    GROUP BY t.lead_id
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
-- The three functions exist:
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('manager_activity_on_team_leads','last_activity_per_lead','leads_needing_attention');
--   -> manager_activity_on_team_leads = true (DEFINER); the other two = false (INVOKER).
-- Every earlier rule survived in the attention function (all three must be true):
--   SELECT pg_get_functiondef(oid) LIKE '%bdm_employee_id IS NULL%'
--      AND pg_get_functiondef(oid) LIKE '%rfq_back_kind%'
--      AND pg_get_functiondef(oid) LIKE '%manager_activity_on_team_leads%'
--     FROM pg_proc WHERE proname = 'leads_needing_attention';
-- Then the behavioural test, as real sessions: Schema/verify_manager_team_activity.sql.
-- Never judge RLS from the SQL Editor itself — it runs as postgres, past
-- every policy.
