-- ============================================================
-- MIGRATION: time-independent dashboard metrics — snapshot RPC + detail RPCs
--                                                              (2026-09-08)
--
-- Read dashboard-time-independent-metrics-prompt.md and
-- TIME-INDEPENDENT-METRICS-LOG.md (both repo root) first — this is Milestone
-- 2's SQL for the "Right now" strip: seven point-in-time pipeline metrics
-- (Active/On-hold pipeline split, Stale leads [already built, untouched],
-- On-hold pipeline insights, Lead data completeness, Follow-up coverage gap,
-- Team workload balance, Pipeline concentration) that sit ABOVE the Dashboard's
-- date range selector, because none of them has a "when" to filter by.
--
-- WRITTEN, NOT RUN. Per this repo's "ask before you build" rule, this file
-- is not applied to the live database as part of writing it — that is
-- Milestone 3, gated on the product owner's explicit go-ahead, same as every
-- other migration in this folder.
--
-- ------------------------------------------------------------
-- WHAT THIS FILE DOES, and why each part exists:
--
--   STEP 1   idx_leads_current_stage index
--   STEP 2   leads_on_hold_detail()          — on-hold insights (metric #3)
--   STEP 3   leads_completeness_detail()     — data completeness (metric #4)
--   STEP 4   leads_followup_gap_detail()     — coverage gap (metric #5)
--   STEP 5   leads_workload_by_owner()       — workload balance (metric #6)
--   STEP 6   leads_open_deal_ranking()       — concentration (metric #7)
--   STEP 7   dashboard_snapshot_metrics()    — ONE combined headline RPC
--   STEP 8   GRANTs
--   STEP 9   verification queries (commented)
--
-- Metrics #1 (Active/On-hold pipeline split) and #2 (Stale leads) need NO
-- new SQL — see "WHAT IS DELIBERATELY NOT HERE" below.
--
-- ------------------------------------------------------------
-- THE SHAPE: one eager snapshot, five lazy detail functions — INDEPENDENT
-- of each other, not one calling the other.
--
-- ⚠️ REVISED 2026-09-08. This section originally said STEP 7 composed
-- STEPS 2-6 internally ("SELECTing FROM those same five functions"), for
-- the good reason that it avoids duplicating each predicate. That version
-- shipped, was tested only in isolation, and then measured live (Milestone
-- 5) to time out for a real sales_coordinator session under a real page
-- load — calling five functions that each independently `FROM leads` means
-- ONE call to the snapshot RPC scans the whole `leads` table six times
-- over, and `leads`' own RLS is measurably expensive for a coordinator or
-- manager (see STEP 7's own header for the full measured story). Six times
-- that cost, under the concurrency a real Dashboard mount creates, crossed
-- Supabase's 8-second statement_timeout.
--
-- STEP 7 now does its own single-pass scan of `leads` (see its `base` CTE)
-- and does NOT call STEPS 2-6 — it duplicates their predicates instead.
-- That is a real, accepted cost (documented at STEP 7 itself, with an
-- explicit "keep both in sync if either changes" note), traded for the
-- performance the eager, every-mount snapshot RPC actually needs. STEPS 2-6
-- are still exactly what a drill-down panel fetches directly, lazily, on
-- open (per PERFORMANCE.md Rule 1/Rule 3 and this repo's "eager build, lazy
-- row-level fetch" split already established by attention.js's
-- buildAgeingPanel/assembleBuckets) — nothing about THEIR role changed,
-- only how STEP 7 gets its own numbers.
--
-- Team workload (STEP 5) and Pipeline concentration (STEP 6) are naturally
-- multi-row (one row per employee / one row per open deal) — there is no
-- single "the" workload number the way there is for on-hold or completeness.
-- Their detail functions ARE the full per-employee / per-deal breakdown a
-- drill-down panel renders directly; the snapshot RPC (STEP 7) computes its
-- own small handful of scalars for the chip (busiest/lightest employee,
-- headline concentration %) from its own single-pass `flagged` CTE.
--
-- ------------------------------------------------------------
-- SECURITY — READ THIS BEFORE CHANGING ANYTHING BELOW.
--
-- Every function in this file is SECURITY INVOKER (Postgres's own default,
-- stated explicitly on each one so a future edit can't silently flip it),
-- NOT SECURITY DEFINER. This is the same load-bearing requirement
-- `leads_category_breakdown()`/`leads_needing_attention()` already document:
-- SECURITY INVOKER means every query inside runs under the CALLING user's
-- own RLS policies on `leads` (own_data_or_owner_role_select /
-- coordinator_team_select / manager_team_select) — a sales exec calling any
-- function here only ever sees their own leads, a coordinator only their
-- team's, a manager only their own + their team's, exactly as if they had
-- run the query directly, with ZERO hand-rolled scoping logic needed in any
-- function body. Milestone 1's design-confirmation pass verified this
-- against the live RLS policy file (migration_rls_performance_leads_
-- stage_history.sql) directly, not assumed from prose — see
-- TIME-INDEPENDENT-METRICS-LOG.md's Milestone 1 entry.
--
-- If any function below were ever changed to SECURITY DEFINER, it would run
-- with the function OWNER's privileges and bypass RLS entirely — every
-- sales exec calling it would see the whole company's leads. Do not change
-- this. (STEP 7 does NOT call STEPS 2-6, as an earlier version of this file
-- did — see STEP 7's own header for why that was reverted for performance —
-- but if any function here ever again calls another, the same rule applies:
-- nested SECURITY INVOKER calls preserve the original caller's role
-- throughout, so RLS is evaluated identically either way.)
--
-- `p_owner_ids` (optional, every function): same purpose as
-- `leads_category_breakdown()`'s own parameter of the same name — narrows
-- the result to just those owner_employee_id values, ON TOP OF whatever RLS
-- already allows. This is what lets Dashboard.jsx replicate the
-- sales_manager role's client-side "My / Team" scope toggle (managerScope/
-- inScope in Dashboard.jsx) for these functions' results, the same way it
-- already narrows allBreakdownLeads. NULL (the default) means "don't narrow
-- further" — correct for every other role, where RLS alone already gives
-- the right rows.
--
-- ------------------------------------------------------------
-- WHY THE DATE HANDLING BELOW LOOKS FUSSY — same reason, same fix, as
-- leads_needing_attention_rpc.sql. Read that file's own header before
-- touching any of the naive_to_instant() usage here.
--
-- `stage_history.changed_at` and `activities.created_at` are naive
-- TIMESTAMP columns (no time zone stored), and this app's JS parses a naive
-- timestamp string as LOCAL time (`new Date('2026-08-09T09:49:01')` reads as
-- IST here) — see CLAUDE.md's Day Review Timestamps note and
-- `src/lib/dbTime.js`'s `parseTimestamp`. To make a SQL day-count agree with
-- what `daysSince()` (src/lib/dateMath.js: `Math.floor((Date.now() -
-- new Date(dateLike).getTime()) / 86400000)`) would compute for the exact
-- same column, this file reproduces the same "subtract the browser's own
-- timezone offset, then read as UTC" trick `leads_needing_attention()`
-- already uses for `created_at`/`activities.created_at`. `p_now` and
-- `p_tz_offset_minutes` are PARAMETERS passed from the browser's own clock
-- (`Date.now()`/`new Date().getTimezoneOffset()`), never `now()` computed
-- server-side — the database runs in UTC, the reps are in IST, and a
-- server-side `now()` would silently misjudge every threshold by up to 5.5
-- hours around local midnight, exactly the class of bug already fixed once
-- in this codebase (Phase 9 finding F-P7-1, and again in
-- leads_needing_attention_rpc.sql's own header).
--
-- On-hold duration buckets (5, contiguous, no gaps — Milestone 1's confirmed
-- product-owner decision, see the log) are NOT computed in SQL. Per this
-- repo's own "SQL owns the predicates, JS owns the presentation" split
-- (leads_needing_attention_rpc.sql's header, and attention.js's
-- assembleBuckets()), `leads_on_hold_detail()` returns the raw
-- `days_on_hold` integer per lead; bucketing that into
-- `< 1 month / 1–3 months / 3–6 months / 6–12 months / 12+ months` is a
-- Milestone 6 JS concern (named constants, mirroring STALE_DAYS/
-- ATTENTION_DAYS's convention in attention.js — NOT reusing those constants,
-- since this is a different measurement, per the brief).
--
-- ------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
--
-- Metric #1, Active/On-hold pipeline split: NO new SQL. `src/lib/
-- pipelineValue.js`'s `sumOpenPipelineValue()`/`sumOnHoldValue()` already
-- compute exactly this from `breakdownLeads`, which Dashboard.jsx already
-- fetches on every mount for other cards (`fetchLeadsForBreakdown()`/
-- `leads_category_breakdown()`) — there is no new query needed for the
-- desktop chip. Milestone 1's log entry already flagged this: metric #1 is
-- a Milestone 6 relabeling/restructuring task (promoting the existing
-- "On hold · ₹X (N)" sub-line on the Open Pipeline tile into its own
-- explicitly-labeled "Active pipeline" / "On-hold pipeline" figures), not
-- new plumbing. `dashboard_snapshot_metrics()` below DOES return on-hold
-- count/value/avg-days (folded in from `leads_on_hold_detail()`, since that
-- function has to exist anyway for the On-hold insights panel) purely so
-- the mobile word-tile strip's on-hold chip has a real number the instant
-- its own panel opens without depending on `breakdownLeads` having already
-- loaded — it is not a second, competing definition of the on-hold figure
-- (see STEP 2/STEP 7's own comments: the CASE expression is copied
-- verbatim from `sumOnHoldValue`/`dealValueFor`'s documented rule, not
-- reinvented).
--
-- Metric #2, Stale leads: NO new SQL. Already fully built —
-- `leads_needing_attention()`'s `is_stale` bucket, unchanged. This file
-- does not touch that function or its migration.
--
-- ------------------------------------------------------------
-- A JUDGMENT CALL MADE HERE, FLAGGED FOR THE PRODUCT OWNER TO VETO —
-- "workload" deliberately does NOT exclude on-hold leads the way "Active
-- pipeline" does. `leads_workload_by_owner()` (STEP 5) counts every OPEN
-- lead (not won/lost) an employee owns, on-hold included, on the reasoning
-- that a paused deal is still sitting on that person's desk and is still
-- part of "how much is assigned to them" — a workload question, not a
-- currently-being-worked question. This is a real, considered choice, not
-- an oversight; it was not asked as a Milestone 1 AskUserQuestion because it
-- did not surface as an open assumption in the brief, but it is a genuine
-- either-way call. If the product owner wants workload to exclude on-hold
-- leads (matching Active pipeline's definition exactly), that's a one-line
-- change to STEP 5's WHERE clause plus its own doc comment update — flag it
-- in Milestone 2's review rather than silently building around a guess.
--
-- Similarly, "Pipeline concentration" (STEP 6) is scoped to the ACTIVE
-- pipeline only (open, excluding on-hold) — a paused deal isn't really "in
-- play" for a concentration-of-current-risk reading, and this keeps
-- Concentration's own total consistent with what the Active pipeline tile
-- itself shows. Also flagged for veto, same reasoning as above.
--
-- ------------------------------------------------------------
-- SAFE TO RE-RUN. Every statement is CREATE INDEX IF NOT EXISTS / CREATE OR
-- REPLACE FUNCTION. Independent of every other migration in this folder —
-- touches no existing table, column, or RLS policy; adds one index and six
-- new read-only functions.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: index on leads.current_stage
--
-- Every one of the five new functions below filters on
-- `COALESCE(current_stage, 'calling') NOT IN ('won','lost')` (isOpenLead) or
-- `current_stage = 'on_hold'` (isOnHoldLead) — confirmed by grepping every
-- file in Schema/ that no index anywhere covers this column today (unlike
-- owner_employee_id/created_at, which already have idx_leads_owner/
-- idx_leads_created_at). This is the one index this pass can state with
-- confidence is needed, not guessed — every new query here filters on it.
--
-- A composite index (e.g. leads(current_stage, owner_employee_id), or the
-- reverse order) is NOT added here, per the brief's own "profile it, don't
-- guess" instruction — deciding the more selective leading column needs a
-- real EXPLAIN ANALYZE against live data, which is Milestone 7's job (the
-- same Resource Timing / live-session verification this repo already
-- requires for every RLS-performance change, per
-- migration_rls_performance_leads_stage_history.sql's own VERIFY section).
-- If Milestone 7 finds this plain index insufficient once these functions
-- are wired into the real Dashboard, add a composite THEN, measured, rather
-- than guessing one now.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_current_stage ON leads(current_stage);


-- ------------------------------------------------------------
-- STEP 2: leads_on_hold_detail() — every on-hold lead, with days parked
--
-- Backs BOTH the On-hold pipeline insights drill-down panel (called
-- directly, full row set) AND dashboard_snapshot_metrics()'s on-hold
-- headline scalars (called internally, aggregated). "Days on hold" is
-- resolved from the lead's most recent stage_history row with
-- stage = 'on_hold' (per the brief) — a lead currently on hold always has
-- at least one such row, since reaching on_hold is itself a logged stage
-- change (LeadStageSection.jsx's On Hold flow always writes stage_history).
-- Falls back to the lead's created_at in the (should-not-happen) case of a
-- data anomaly, same "never return NULL where a real answer is knowable"
-- reasoning as fetchLastActivityPerLead()'s consumers.
-- ------------------------------------------------------------
-- days_on_hold needs p_now/p_tz_offset_minutes to be computed correctly
-- (see this file's header on why a naive TIMESTAMP column can't be diffed
-- against a server-side now()), so those are real, required-in-practice
-- parameters from the start — there is only ever this one signature.
CREATE OR REPLACE FUNCTION leads_on_hold_detail(
  p_owner_ids         integer[] DEFAULT NULL,
  p_now               timestamptz DEFAULT NULL,
  p_tz_offset_minutes integer     DEFAULT NULL
)
RETURNS TABLE (
  lead_id         integer,
  party           text,
  owner_id        integer,
  owner_name      text,
  value           numeric,
  on_hold_reason  text,
  on_hold_since   timestamp,
  days_on_hold    integer,
  resume_date     date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      l.id,
      l.owner_employee_id,
      l.quote_value,
      l.on_hold_reason,
      l.next_followup_date,
      l.created_at,
      COALESCE(p.name, s.nickname, s.locality, '(no party)') AS party_label,
      COALESCE(e.name, 'Unassigned')                          AS owner_label,
      (SELECT sh.changed_at FROM stage_history sh
        WHERE sh.lead_id = l.id AND sh.stage = 'on_hold'
        ORDER BY sh.changed_at DESC LIMIT 1)                   AS hold_started_at
    FROM leads l
    LEFT JOIN parties   p ON p.id = l.party_id
    LEFT JOIN sites     s ON s.id = l.site_id
    LEFT JOIN employees e ON e.id = l.owner_employee_id
    WHERE COALESCE(l.current_stage, 'calling') = 'on_hold'
      AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  ),
  timed AS (
    SELECT
      sc.*,
      COALESCE(sc.hold_started_at, sc.created_at) AS since_naive
    FROM scoped sc
  )
  SELECT
    t.id,
    t.party_label,
    t.owner_employee_id,
    t.owner_label,
    COALESCE(t.quote_value, 0),
    t.on_hold_reason,
    t.since_naive,
    CASE
      WHEN p_now IS NULL OR p_tz_offset_minutes IS NULL THEN NULL
      ELSE FLOOR(EXTRACT(EPOCH FROM (
        p_now - ((t.since_naive - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC')
      )) / 86400)::int
    END,
    t.next_followup_date
  FROM timed t
  ORDER BY t.id
$$;


-- ------------------------------------------------------------
-- STEP 3: leads_completeness_detail() — per-open-lead field completeness
--
-- Six fields, exactly as the brief specifies (architect fields deliberately
-- excluded — not every deal has one, so folding them into a blended score
-- would unfairly penalize leads that genuinely don't need one):
--
--   client_name / client_number  — leads.party_id when that party is a
--                                   'client'; else the site's role='owner'
--                                   site_contacts row; missing entirely if
--                                   neither resolves (the common scanning-
--                                   lead-with-no-known-client case).
--   address / pincode            — from the lead's own sites row
--                                   (house_no/locality for address, pincode
--                                   for pincode). Missing entirely if the
--                                   lead has no site_id.
--   site_stage                   — sites.site_stage.
--   product                      — leads.product_id.
--
-- Backs BOTH the completeness drill-down (full row set, one row per open
-- lead, with per-row missing-field tags for the field-filter chips) AND
-- dashboard_snapshot_metrics()'s blended + per-field percentage scalars
-- (aggregated from this same function's output — one definition of
-- "complete", not two).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads_completeness_detail(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  lead_id           integer,
  party             text,
  owner_id          integer,
  owner_name        text,
  has_client_name   boolean,
  has_client_number boolean,
  has_address       boolean,
  has_pincode       boolean,
  has_site_stage    boolean,
  has_product       boolean,
  missing_fields    text[],
  completeness_pct  numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      l.id,
      l.owner_employee_id,
      l.site_id,
      l.product_id,
      l.party_id,
      COALESCE(dp.name, s.nickname, s.locality, '(no party)') AS party_label,
      COALESCE(e.name, 'Unassigned')                          AS owner_label,
      -- The CLIENT specifically (party_type = 'client'), not just "whoever
      -- is linked" — this is Rule per the brief, distinct from party_label
      -- above, which is the generic display-name fallback chain used
      -- everywhere else in this app (leads_needing_attention() etc.).
      dp_client.name    AS client_name_direct,
      dp_client.mobile  AS client_mobile_direct,
      site_owner.name   AS client_name_via_site,
      site_owner.mobile AS client_mobile_via_site,
      s.house_no,
      s.locality,
      s.pincode,
      s.site_stage
    FROM leads l
    LEFT JOIN parties dp        ON dp.id = l.party_id
    LEFT JOIN parties dp_client ON dp_client.id = l.party_id AND dp_client.party_type = 'client'
    LEFT JOIN sites   s         ON s.id = l.site_id
    LEFT JOIN employees e       ON e.id = l.owner_employee_id
    LEFT JOIN LATERAL (
      SELECT p2.name, p2.mobile
      FROM site_contacts sc
      JOIN parties p2 ON p2.id = sc.party_id
      WHERE sc.site_id = l.site_id AND sc.role = 'owner'
      ORDER BY sc.discovered_at ASC NULLS LAST, sc.id ASC
      LIMIT 1
    ) site_owner ON dp_client.id IS NULL AND l.site_id IS NOT NULL
    WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
      AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  ),
  resolved AS (
    SELECT
      sc.*,
      COALESCE(sc.client_name_direct, sc.client_name_via_site)     AS client_name,
      COALESCE(sc.client_mobile_direct, sc.client_mobile_via_site) AS client_mobile
    FROM scoped sc
  ),
  flagged AS (
    SELECT
      r.*,
      (r.client_name IS NOT NULL AND r.client_name <> '')                                       AS f_client_name,
      (r.client_mobile IS NOT NULL AND r.client_mobile <> '')                                    AS f_client_number,
      (r.site_id IS NOT NULL AND (COALESCE(r.house_no, '') <> '' OR COALESCE(r.locality, '') <> '')) AS f_address,
      (r.site_id IS NOT NULL AND COALESCE(r.pincode, '') <> '')                                  AS f_pincode,
      (r.site_id IS NOT NULL AND COALESCE(r.site_stage, '') <> '')                               AS f_site_stage,
      (r.product_id IS NOT NULL)                                                                 AS f_product
    FROM resolved r
  )
  SELECT
    f.id,
    f.party_label,
    f.owner_employee_id,
    f.owner_label,
    f.f_client_name,
    f.f_client_number,
    f.f_address,
    f.f_pincode,
    f.f_site_stage,
    f.f_product,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN NOT f.f_client_name   THEN 'client_name'   END,
      CASE WHEN NOT f.f_client_number THEN 'client_number' END,
      CASE WHEN NOT f.f_address       THEN 'address'       END,
      CASE WHEN NOT f.f_pincode       THEN 'pincode'       END,
      CASE WHEN NOT f.f_site_stage    THEN 'site_stage'    END,
      CASE WHEN NOT f.f_product       THEN 'product'       END
    ], NULL),
    ROUND(
      (f.f_client_name::int + f.f_client_number::int + f.f_address::int
       + f.f_pincode::int + f.f_site_stage::int + f.f_product::int) / 6.0 * 100,
      1
    )
  FROM flagged f
  ORDER BY f.id
$$;


-- ------------------------------------------------------------
-- STEP 4: leads_followup_gap_detail() — open (excl. on_hold) leads with no
--         open follow-up at all
--
-- On-hold leads are excluded per the brief: they always carry a mandatory
-- hold-review reminder (FOLLOWUPS.md Rule 8.2 — "cannot be cancelled while
-- the lead is on hold"), so they can never genuinely be gapped and including
-- them would only ever dilute the percentage with leads that structurally
-- cannot appear here.
--
-- `next_followup_date` is read directly, not re-derived — Milestone 1's
-- live check confirmed migration_followups_rebuild.sql has run, so this
-- column is now trigger-maintained as the earliest due date among the
-- lead's own OPEN follow_ups (FOLLOWUPS.md Rule 1.2), which is exactly the
-- fact this metric wants: NULL now honestly means "no open follow-up
-- exists," not "nobody happened to write a date."
--
-- Deliberately NOT a `kind` in DrilldownPanel that pings anyone — this is a
-- passive dashboard count, not an attention queue. FOLLOWUPS.md Section 9
-- already rejected a "lead has no follow-up" attention flag for exactly the
-- reason a naive version of this metric would recreate: on real data this
-- would flag most leads and drown the genuine signals in Needs Attention.
-- Keep this metric read-only in spirit — a passive count on the dashboard,
-- not a red-flag surface (see Milestone 6 for the actual UI treatment).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads_followup_gap_detail(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  lead_id           integer,
  party             text,
  owner_id          integer,
  owner_name        text,
  stage             text,
  value             numeric,
  last_activity_at  timestamp
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH last_activity AS (
    SELECT a.lead_id, MAX(a.created_at) AS last_at
    FROM activities a
    WHERE a.lead_id IS NOT NULL
    GROUP BY a.lead_id
  )
  SELECT
    l.id,
    COALESCE(p.name, s.nickname, s.locality, '(no party)'),
    l.owner_employee_id,
    COALESCE(e.name, 'Unassigned'),
    COALESCE(l.current_stage, 'calling'),
    -- Mirrors dealValueFor()'s open-lead branch (won/lost are already
    -- excluded by the WHERE clause below).
    COALESCE(l.quote_value, 0),
    la.last_at
  FROM leads l
  LEFT JOIN parties   p  ON p.id = l.party_id
  LEFT JOIN sites     s  ON s.id = l.site_id
  LEFT JOIN employees e  ON e.id = l.owner_employee_id
  LEFT JOIN last_activity la ON la.lead_id = l.id
  WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost', 'on_hold')
    AND l.next_followup_date IS NULL
    AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  ORDER BY l.id
$$;


-- ------------------------------------------------------------
-- STEP 5: leads_workload_by_owner() — open lead count + value per employee
--
-- See this file's header for the flagged judgment call: "open" here means
-- isOpenLead (not won/lost), INCLUDING on-hold — a paused deal is still on
-- that person's desk. This differs deliberately from Active pipeline's
-- definition, which excludes on-hold. Flag for the product owner to veto in
-- Milestone 2's review if workload should instead match Active pipeline
-- exactly.
--
-- Returns one row per employee who owns at least one open lead VISIBLE
-- under the caller's own RLS/p_owner_ids scoping — an employee with zero
-- open leads simply doesn't appear. The caller (Milestone 6's JS) already
-- has its own employee roster (fetchActiveSalesExecs()/fetchMyTeamExecs())
-- to reconcile against and render a zero row for anyone missing here, the
-- same "employees I asked about vs. rows I got back" pattern this app
-- already uses for the Day Review table and the attainment heatmap.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads_workload_by_owner(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  owner_id          integer,
  owner_name        text,
  open_lead_count   bigint,
  open_pipeline_value numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    l.owner_employee_id                        AS owner_id,
    COALESCE(e.name, 'Unassigned')              AS owner_name,
    COUNT(*)                                    AS open_lead_count,
    -- Mirrors dealValueFor(): open leads (won/lost excluded by the WHERE
    -- below, on_hold intentionally included per the header note) value at
    -- their quote_value alone, coalesced to 0.
    SUM(COALESCE(l.quote_value, 0))             AS open_pipeline_value
  FROM leads l
  LEFT JOIN employees e ON e.id = l.owner_employee_id
  WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
    AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  GROUP BY l.owner_employee_id, e.name
  ORDER BY open_lead_count DESC, owner_id
$$;


-- ------------------------------------------------------------
-- STEP 6: leads_open_deal_ranking() — every ACTIVE-pipeline lead, ranked by
--         value desc, for the concentration panel
--
-- "Active" = open AND NOT on_hold, matching the same set Active pipeline's
-- own tile shows (sumOpenPipelineValue's definition) — see the header's
-- flagged judgment call for why on-hold is excluded here too. Row order
-- (value DESC, lead_id as a tiebreaker for determinism, same reasoning
-- leads_needing_attention_rpc.sql documents for its own ORDER BY id) is
-- exactly what both the drill-down's ranked list AND
-- dashboard_snapshot_metrics()'s concentration % calculation need — the
-- top-N cutoff is just `LIMIT` over this same ordering, computed twice (once
-- here conceptually, once in STEP 7's SQL) but against the identical rows in
-- the identical order, so the two cannot disagree on WHICH leads are "top".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads_open_deal_ranking(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  lead_id     integer,
  party       text,
  owner_id    integer,
  owner_name  text,
  value       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    l.id,
    COALESCE(p.name, s.nickname, s.locality, '(no party)'),
    l.owner_employee_id,
    COALESCE(e.name, 'Unassigned'),
    COALESCE(l.quote_value, 0)
  FROM leads l
  LEFT JOIN parties   p ON p.id = l.party_id
  LEFT JOIN sites     s ON s.id = l.site_id
  LEFT JOIN employees e ON e.id = l.owner_employee_id
  WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost', 'on_hold')
    AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  ORDER BY COALESCE(l.quote_value, 0) DESC, l.id
$$;


-- ------------------------------------------------------------
-- STEP 7: dashboard_snapshot_metrics() — the ONE combined headline RPC
--
-- Called once per Dashboard mount (and once per managerScope toggle, per
-- p_owner_ids). Returns exactly one row.
--
-- ⚠️ REVISED 2026-09-08, same day, after a real bug found live in Milestone
-- 5 (TIME-INDEPENDENT-METRICS-LOG.md has the full story). The FIRST version
-- of this function called STEPS 2-6's own functions internally — the
-- header used to say so, and to justify it as "one definition of each
-- predicate, reused by both the chip and its own panel". That reasoning was
-- correct about drift, and wrong about cost: calling five functions that
-- each independently `FROM leads` means this ONE request scans the whole
-- `leads` table SIX TIMES OVER (once per function, plus a sixth bare
-- `leads` query for the gap denominator) — and `leads`' own RLS is exactly
-- the case `migration_rls_performance_leads_stage_history.sql` already
-- measured as expensive for a coordinator or manager: an owner's row check
-- short-circuits cheaply on the first OR-branch, but a coordinator/manager
-- has to evaluate `is_my_team_member()`/`is_my_managed_member()` — a
-- SECURITY DEFINER function querying `employees` — for every row NOT on
-- their team before Postgres can conclude "false". Paying that six times
-- in one statement, under the real concurrent load a full Dashboard mount
-- creates (PERFORMANCE.md's own "the bottleneck is concurrency, not any
-- one query" lesson), pushed this well past Supabase's 8-second
-- `statement_timeout`. Measured live, calling this function for a real
-- `sales_coordinator` session on a real page load: `57014 canceling
-- statement due to statement timeout`, surfaced to the browser as an
-- unhandled 500 — the exact bug that lesson exists to prevent, now landed
-- by this migration's own first draft.
--
-- THE FIX: this function now scans `leads` EXACTLY ONCE (the `base` CTE
-- below carries every join every one of the six metrics needs — on-hold
-- duration's `stage_history` lookup, completeness's `parties`/`sites`/
-- `site_contacts` lookups, workload/concentration's owner+value), and every
-- aggregate below reads from that one materialized result, never from
-- `leads` again.
--
-- THE COST OF THE FIX: STEPS 2-6's own predicate logic (which fields count
-- as "on hold", which six fields count for completeness, which leads count
-- as "the gap") is now DUPLICATED here rather than reused, because
-- reusing those functions is exactly what made this slow. This is the same
-- trade this app already accepts between `leads_category_breakdown()` and
-- `leads_needing_attention()` — two fully independent, single-scan
-- aggregates rather than one calling the other — not a new kind of risk.
-- **If a predicate changes in any of STEPS 2-6 above, it must be changed
-- here too, or the eager chip and its own lazy drill-down will disagree.**
-- No test currently pins this — flagged for Milestone 7's verification
-- pass to at least spot-check the two paths agree on a live account.
--
-- p_top_fraction (default 0.10): the concentration cutoff — top
-- CEIL(count * p_top_fraction) leads by value, floored at 1 lead
-- (GREATEST(1, ...)) so this still means something at small scope sizes,
-- exactly as the brief specifies. Fixed at 10% for v1, no UI toggle (see
-- RECOMMENDATIONS.md — a Top-5/Top-10/Top-10% toggle is logged there as a
-- deferred idea, added at Milestone 6 when the concentration panel itself is
-- built, not built now).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_snapshot_metrics(
  p_owner_ids         integer[]   DEFAULT NULL,
  p_now               timestamptz DEFAULT NULL,
  p_tz_offset_minutes integer     DEFAULT NULL,
  p_top_fraction      numeric     DEFAULT 0.10
)
RETURNS TABLE (
  -- On-hold (metric #3 headline; also folds into metric #1's on-hold figure)
  on_hold_count               bigint,
  on_hold_value               numeric,
  on_hold_avg_days            numeric,

  -- Lead data completeness (metric #4)
  completeness_lead_count           bigint,
  completeness_pct                  numeric,
  completeness_client_name_pct      numeric,
  completeness_client_number_pct    numeric,
  completeness_address_pct          numeric,
  completeness_pincode_pct          numeric,
  completeness_site_stage_pct       numeric,
  completeness_product_pct          numeric,

  -- Follow-up coverage gap (metric #5)
  followup_gap_count         bigint,
  followup_gap_denominator   bigint,
  followup_gap_pct           numeric,

  -- Team workload balance (metric #6) — scalars only; full breakdown is
  -- leads_workload_by_owner(), fetched lazily by the drill-down.
  workload_employee_count    bigint,
  workload_busiest_owner_id  integer,
  workload_busiest_name      text,
  workload_busiest_count     bigint,
  workload_busiest_value     numeric,
  workload_lightest_owner_id integer,
  workload_lightest_name     text,
  workload_lightest_count    bigint,
  workload_lightest_value    numeric,

  -- Pipeline concentration (metric #7) — scalar only; full ranked list is
  -- leads_open_deal_ranking(), fetched lazily by the drill-down.
  concentration_pct               numeric,
  concentration_top_lead_count    integer,
  concentration_total_lead_count  bigint,
  concentration_total_value       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    -- ONE scan of leads, carrying every join every metric below needs.
    -- Filtering to NOT IN ('won','lost') here is a real optimization, not
    -- just tidiness — every one of the six metrics only ever cares about
    -- open leads, so this cuts the row count before the expensive per-row
    -- RLS evaluation has to run on the excluded rows too (the planner is
    -- free to evaluate cheap conditions before expensive ones, and a bare
    -- column comparison is far cheaper than the coordinator/manager RLS
    -- branches).
    SELECT
      l.id,
      l.owner_employee_id,
      l.site_id,
      l.product_id,
      l.next_followup_date,
      COALESCE(l.quote_value, 0)                                  AS value,
      COALESCE(l.current_stage, 'calling') = 'on_hold'            AS is_on_hold,
      COALESCE(e.name, 'Unassigned')                              AS owner_label,
      dp_client.name    AS client_name_direct,
      dp_client.mobile  AS client_mobile_direct,
      site_owner.name   AS client_name_via_site,
      site_owner.mobile AS client_mobile_via_site,
      s.house_no, s.locality, s.pincode, s.site_stage,
      -- Only ever evaluated for an on-hold row — CASE short-circuits the
      -- untaken branch, so the ~85% of open leads that are active never
      -- pay for this correlated stage_history lookup at all.
      CASE WHEN COALESCE(l.current_stage, 'calling') = 'on_hold' THEN (
        SELECT sh.changed_at FROM stage_history sh
         WHERE sh.lead_id = l.id AND sh.stage = 'on_hold'
         ORDER BY sh.changed_at DESC LIMIT 1
      ) END AS hold_started_at,
      l.created_at
    FROM leads l
    LEFT JOIN employees e       ON e.id = l.owner_employee_id
    LEFT JOIN sites     s       ON s.id = l.site_id
    LEFT JOIN parties   dp_client ON dp_client.id = l.party_id AND dp_client.party_type = 'client'
    LEFT JOIN LATERAL (
      SELECT p2.name, p2.mobile
      FROM site_contacts sc
      JOIN parties p2 ON p2.id = sc.party_id
      WHERE sc.site_id = l.site_id AND sc.role = 'owner'
      ORDER BY sc.discovered_at ASC NULLS LAST, sc.id ASC
      LIMIT 1
    ) site_owner ON dp_client.id IS NULL AND l.site_id IS NOT NULL
    WHERE COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
      AND (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
  ),
  flagged AS (
    SELECT
      b.*,
      NOT b.is_on_hold AS is_active,
      (COALESCE(b.client_name_direct, b.client_name_via_site) IS NOT NULL
        AND COALESCE(b.client_name_direct, b.client_name_via_site) <> '')   AS f_client_name,
      (COALESCE(b.client_mobile_direct, b.client_mobile_via_site) IS NOT NULL
        AND COALESCE(b.client_mobile_direct, b.client_mobile_via_site) <> '') AS f_client_number,
      (b.site_id IS NOT NULL AND (COALESCE(b.house_no, '') <> '' OR COALESCE(b.locality, '') <> '')) AS f_address,
      (b.site_id IS NOT NULL AND COALESCE(b.pincode, '') <> '')             AS f_pincode,
      (b.site_id IS NOT NULL AND COALESCE(b.site_stage, '') <> '')         AS f_site_stage,
      (b.product_id IS NOT NULL)                                           AS f_product,
      CASE
        WHEN NOT b.is_on_hold THEN NULL
        WHEN p_now IS NULL OR p_tz_offset_minutes IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (
          p_now - ((COALESCE(b.hold_started_at, b.created_at) - make_interval(mins => p_tz_offset_minutes)) AT TIME ZONE 'UTC')
        )) / 86400)::int
      END AS days_on_hold
    FROM base b
  ),
  hold AS (
    SELECT COUNT(*) AS cnt, COALESCE(SUM(value), 0) AS val, AVG(days_on_hold) AS avg_days
    FROM flagged WHERE is_on_hold
  ),
  -- Completeness scopes to every open lead (on-hold included), matching
  -- leads_completeness_detail()'s own scope exactly.
  completeness AS (
    SELECT
      COUNT(*) AS cnt,
      AVG((f_client_name::int + f_client_number::int + f_address::int + f_pincode::int + f_site_stage::int + f_product::int) / 6.0 * 100) AS blended_pct,
      AVG(f_client_name::int)   * 100 AS client_name_pct,
      AVG(f_client_number::int) * 100 AS client_number_pct,
      AVG(f_address::int)       * 100 AS address_pct,
      AVG(f_pincode::int)       * 100 AS pincode_pct,
      AVG(f_site_stage::int)    * 100 AS site_stage_pct,
      AVG(f_product::int)      * 100 AS product_pct
    FROM flagged
  ),
  -- Gap count AND its denominator both come off the same `is_active` rows
  -- in one pass (FILTER, not two separate queries) — this is what used to
  -- be a sixth, standalone `leads` scan (gap_denominator) and no longer is.
  gap AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active AND next_followup_date IS NULL) AS cnt,
      COUNT(*) FILTER (WHERE is_active)                                AS denom
    FROM flagged
  ),
  -- Workload includes on-hold leads (is_open, not is_active) — see this
  -- file's header note on that deliberate, flagged-for-veto choice.
  workload AS (
    SELECT owner_employee_id AS owner_id, owner_label AS owner_name,
           COUNT(*) AS open_lead_count, SUM(value) AS open_pipeline_value
    FROM flagged
    GROUP BY owner_employee_id, owner_label
  ),
  workload_busiest AS (
    SELECT * FROM workload ORDER BY open_lead_count DESC, owner_id ASC LIMIT 1
  ),
  workload_lightest AS (
    SELECT * FROM workload ORDER BY open_lead_count ASC, owner_id ASC LIMIT 1
  ),
  deals AS (
    SELECT id, value,
      ROW_NUMBER() OVER (ORDER BY value DESC, id) AS rn,
      COUNT(*) OVER ()                            AS total_n
    FROM flagged WHERE is_active
  ),
  deal_totals AS (
    SELECT
      COALESCE(MAX(total_n), 0)               AS total_n,
      COALESCE(SUM(value), 0)                 AS total_value,
      GREATEST(1, CEIL(COALESCE(MAX(total_n), 0) * p_top_fraction))::int AS top_n
    FROM deals
  ),
  concentration AS (
    SELECT
      dt.total_n,
      dt.total_value,
      dt.top_n,
      COALESCE((SELECT SUM(d.value) FROM deals d WHERE d.rn <= dt.top_n), 0) AS top_value
    FROM deal_totals dt
  )
  SELECT
    hold.cnt, hold.val, hold.avg_days,

    completeness.cnt, completeness.blended_pct, completeness.client_name_pct,
    completeness.client_number_pct, completeness.address_pct,
    completeness.pincode_pct, completeness.site_stage_pct, completeness.product_pct,

    gap.cnt, gap.denom,
    CASE WHEN gap.denom = 0 THEN 0::numeric
         ELSE ROUND(gap.cnt::numeric / gap.denom * 100, 1) END,

    (SELECT COUNT(*) FROM workload),
    (SELECT owner_id FROM workload_busiest), (SELECT owner_name FROM workload_busiest),
    (SELECT open_lead_count FROM workload_busiest), (SELECT open_pipeline_value FROM workload_busiest),
    (SELECT owner_id FROM workload_lightest), (SELECT owner_name FROM workload_lightest),
    (SELECT open_lead_count FROM workload_lightest), (SELECT open_pipeline_value FROM workload_lightest),

    CASE WHEN concentration.total_value = 0 THEN 0::numeric
         ELSE ROUND(concentration.top_value / concentration.total_value * 100, 1) END,
    concentration.top_n, concentration.total_n, concentration.total_value
  FROM hold, completeness, gap, concentration
$$;


-- ------------------------------------------------------------
-- STEP 8: GRANTs
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION leads_on_hold_detail(integer[], timestamptz, integer)      TO authenticated;
GRANT EXECUTE ON FUNCTION leads_completeness_detail(integer[])                       TO authenticated;
GRANT EXECUTE ON FUNCTION leads_followup_gap_detail(integer[])                       TO authenticated;
GRANT EXECUTE ON FUNCTION leads_workload_by_owner(integer[])                         TO authenticated;
GRANT EXECUTE ON FUNCTION leads_open_deal_ranking(integer[])                         TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_snapshot_metrics(integer[], timestamptz, integer, numeric) TO authenticated;


-- ============================================================
-- STEP 9: VERIFICATION — run each of these after Milestone 3's live run.
-- ============================================================

-- 1. Every function exists and is SECURITY INVOKER (prosecdef = false is the
--    security-critical check — if any of these six ever comes back true,
--    STOP and do not let the app call it):
--
-- SELECT proname, prosecdef FROM pg_proc
--  WHERE proname IN ('leads_on_hold_detail','leads_completeness_detail',
--                     'leads_followup_gap_detail','leads_workload_by_owner',
--                     'leads_open_deal_ranking','dashboard_snapshot_metrics');
--
--    Expect prosecdef = false for all six.

-- 2. The index landed:
--
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_leads_current_stage';

-- 3. Shape check only (SQL Editor runs as postgres/BYPASSRLS — this proves
--    the functions run and return a sensible shape, NOT that RLS scoping
--    works, see #4):
--
-- SELECT * FROM dashboard_snapshot_metrics(NULL, now(), 0, 0.10);
--
--    Expect one row, no error. completeness_pct/on_hold_avg_days etc. may
--    be NULL if there are currently zero on-hold leads / zero open leads —
--    that's a correct empty-state answer, not a bug (guard against dividing
--    by a NULL denominator in the Milestone 6 JS the same way the pct
--    CASE-guards inside this function already do for the gap%/
--    concentration% scalars).

-- 4. THE REAL TEST — from a real logged-in session of each role (never the
--    SQL Editor, which bypasses RLS as an admin role and would make every
--    scope look identical to "everything"), same requirement
--    migration_rls_performance_leads_stage_history.sql's own VERIFY section
--    already states for the identical reason:
--
--    a) As a real sales_executive: call
--       `supabase.rpc('dashboard_snapshot_metrics', {...})` from the
--       browser console and confirm every count/value is consistent with
--       that employee's own leads only (cross-check completeness_lead_count
--       and followup_gap_denominator against a manual count of their own
--       open leads).
--    b) As a real sales_coordinator and separately a real sales_manager:
--       same check, confirm the numbers reflect their team (+ own leads for
--       the manager), never a lead you know belongs to someone outside
--       their scope.
--    c) As the owner: company-wide totals, unchanged in kind from what
--       fetchLeadsForBreakdown()-based client-side computation would give
--       for the same underlying rule — cross-check on_hold_count/value
--       against sumOnHoldValue(breakdownLeads) already rendered elsewhere
--       on the same Dashboard load, they must agree exactly.
