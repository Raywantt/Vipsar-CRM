-- ============================================================
-- MIGRATION: RLS performance — leads / stage_history read cost for a
--            sales_executive (and, less severely today, a coordinator or
--            manager with a large team)
--
-- Run this in the Supabase SQL Editor, whole file, top to bottom. Safe to
-- re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
--
-- >>> RUN THIS LAST, AFTER EVERY OTHER PENDING MIGRATION <<<
-- Specifically: after rls_policies.sql, migration_backlog_2026_08_10.sql,
-- migration_owner_only_stage.sql, migration_scope_stage_history.sql,
-- migration_sales_coordinator.sql, migration_lead_edit_rights.sql, and
-- migration_sales_manager.sql. This file rewrites the FINAL state those
-- seven files build up incrementally — it does not add a new capability,
-- so there is no forward dependency, only a backward one: if ANY of those
-- seven is ever re-run after this file (to pick up an unrelated fix), it
-- will silently reinstall the slower, unwrapped form of whichever policy
-- it defines, and this file must be re-run again afterward to restore the
-- fix. That is a performance regression if forgotten, not a security one —
-- every policy that migration would reinstall is the same one already live
-- today, just without the optimization below. Same hazard
-- migration_lead_edit_rights.sql and migration_sales_manager.sql already
-- document for each other; this file is now a fourth link in that chain.
--
-- ============================================================
-- THE PROBLEM, MEASURED LIVE (2026-09-07)
--
-- fetchStageHistoryForFunnel() (src/lib/dashboardQueries.js) — the query
-- behind the sales funnel's "avg days in stage" column — measured 5.5s
-- idle and timed out (57014, Supabase's 8s statement_timeout) under a real
-- Dashboard load, as a sales_executive with 88 rows of stage_history
-- actually visible to them. The funnel still shows its stage COUNTS (those
-- are seeded from leads, a separate fetch), so the card looks populated;
-- only the avg-days figures silently go missing, which is why this hid
-- behind the bigger 416/speculativePages bug fixed the same day (see this
-- file's sibling note in CLAUDE.md's Conventions section).
--
-- THE CAUSE READS BACKWARDS: an exec's queries are slow in proportion to
-- the rows they CANNOT see, not the rows they can.
--
-- leads SELECT is three permissive policies (own_data_or_owner_role_select,
-- coordinator_team_select, manager_team_select), which Postgres ORs
-- together into effectively four boolean branches. For a rep's own row the
-- first branch (`owner_employee_id = current_employee_id()`) matches and
-- short-circuits the rest — cheap. For each of the ~1,100 OTHER rows in the
-- table, every branch has to be evaluated before Postgres can conclude
-- "false", including is_my_team_member(...) and is_my_managed_member(...) —
-- two SECURITY DEFINER functions that each run a real subquery against
-- `employees` on every call. SECURITY DEFINER also means Postgres can never
-- inline these functions into the calling query (inlining a definer
-- function would silently run it with the CALLER's privileges instead of
-- the owner's — exactly the privilege escalation SECURITY DEFINER exists to
-- prevent), so every one of those ~1,100 calls is a genuine opaque function
-- invocation, not folded away by the planner. That is why the OWNER
-- (1,209 visible rows, so almost every row hits the CHEAP first branch) is
-- fast, and an exec (86-88 visible rows, so almost every row falls through
-- to the EXPENSIVE later branches) is slow — backwards from the usual
-- intuition that more visible rows means more work.
--
-- stage_history pays this bill TWICE: its own SELECT policy runs
-- `EXISTS (SELECT 1 FROM leads WHERE ...)` per stage_history row (which
-- itself re-evaluates leads' access predicates in miniature), and
-- fetchStageHistoryForFunnel's `leads(owner_employee_id)` embed evaluates
-- leads' full SELECT policy set a SECOND time for the same lead.
--
-- Also relevant, separately from function cost: `current_employee_id()`
-- and `current_employee_role()` are STABLE and take no arguments, but a
-- BARE call to either inside a USING/WITH CHECK clause is not guaranteed to
-- be evaluated only once per query — see the Supabase RLS performance
-- guidance (loaded via the supabase-postgres-best-practices skill before
-- writing this file): wrapping such a call as `(select fn())` gives the
-- planner a scalar subquery it can turn into a one-time InitPlan instead of
-- a per-row FuncExpr. That guidance applies to EVERY policy in this schema,
-- not just the two tables below — see "DELIBERATELY NOT CHANGED" at the
-- bottom for why this pass stays narrow.
--
-- ============================================================
-- THE FIX — two changes, both PROVABLY value-preserving (not just "should
-- be fine"). Every rewrite below is one of exactly two shapes, and the
-- comment at each site states which:
--
--   (a) SUBSTITUTION: a bare `current_employee_id()` / `current_employee_role()`
--       call becomes `(select current_employee_id())` / `(select current_employee_role())`.
--       Both functions are STABLE with zero arguments and no reference to
--       any outer column, so within one statement they are, by definition,
--       the same value everywhere they appear. Wrapping in `(select ...)`
--       cannot change that value — it only changes how Postgres is allowed
--       to cache it. This shape needs no further proof.
--
--   (b) SHORT-CIRCUIT GUARD: a bare `is_my_team_member(x)` /
--       `is_my_managed_member(x)` call becomes
--       `(select current_employee_role()) = 'sales_coordinator' AND (select is_my_team_member(x))`
--       (or the manager equivalent). This is safe ONLY because both helper
--       functions ALREADY require the matching role internally as one of
--       their own ANDed conditions (see their bodies, reproduced below) —
--       so `is_my_team_member(x)` is false for every caller whose role
--       isn't 'sales_coordinator', with no dependency on x at all. Adding
--       `role = 'sales_coordinator' AND` in front is therefore
--       `A AND B` where B already implies A internally — which is
--       `A AND B ≡ B` by construction, i.e. a no-op on the truth table and
--       a pure win on execution: for every role that can never match
--       (owner, exec, manager, or a coordinator checking the MANAGER
--       predicate), Postgres now short-circuits on the first — cheap,
--       InitPlan-cached — operand and never calls the expensive function at
--       all, instead of calling it and having IT discover internally that
--       the role doesn't match. This is the dominant fix: it turns
--       ~1,100 per-row calls into an EXISTS-against-employees for an exec
--       into ZERO such calls.
--
-- Every policy/function below is reproduced with its CURRENT live body
-- (confirmed by reading rls_policies.sql, migration_sales_coordinator.sql,
-- migration_lead_edit_rights.sql and migration_sales_manager.sql directly,
-- not from a summary) and only (a)/(b) applied — no predicate is added,
-- removed, reordered relative to its OR-siblings, or changed in meaning.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: the two team-membership helpers — wrap their own internal calls
--
-- Minor on its own (each call's inner `employees e WHERE e.id = ...` scan
-- is bounded to at most one row by the primary key, so there's little
-- per-row cost inside a single invocation to save) but included for two
-- real reasons: it is the same substitution as everywhere else in this
-- file, and it is what benefits a COORDINATOR or MANAGER whose own team is
-- large — for them, is_my_team_member()/is_my_managed_member() genuinely IS
-- called once per row of their team's leads (the id argument varies
-- per-row, so STEP 2's outer guard cannot skip the call the way it does for
-- an exec), and postgres 14+'s Memoize/Result-Cache node can reuse a cached
-- result across rows that share the same argument value once the function
-- call is expressed as a scalar subquery here and at each call site (STEP
-- 2/3) — plausible and consistent with Supabase's own documented pattern,
-- not independently benchmarked in this pass.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_my_team_member(target_employee_id integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE e.id = target_employee_id
       AND e.coordinator_id = (SELECT current_employee_id())
       AND (SELECT current_employee_role()) = 'sales_coordinator'
  );
$$;

CREATE OR REPLACE FUNCTION is_my_managed_member(target_employee_id integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE e.id = target_employee_id
       AND e.manager_id = (SELECT current_employee_id())
       AND (SELECT current_employee_role()) = 'sales_manager'
  );
$$;

-- GRANTs are unaffected by CREATE OR REPLACE FUNCTION (the function's OID
-- and ACL are preserved when the signature doesn't change), but restated
-- here so this file stands alone if ever run against a database that
-- somehow lost them.
GRANT EXECUTE ON FUNCTION is_my_team_member(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION is_my_managed_member(integer) TO authenticated;


-- ------------------------------------------------------------
-- STEP 2: leads policies
-- ------------------------------------------------------------

-- own_data_or_owner_role_select — SUBSTITUTION only (shape a).
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON leads;
CREATE POLICY "own_data_or_owner_role_select" ON leads
  FOR SELECT USING (
    owner_employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- own_data_or_owner_role_insert — SUBSTITUTION only. Perf gain here is
-- negligible (one row per INSERT), included only for consistency with its
-- SELECT/UPDATE siblings so nobody copies the unwrapped shape from here
-- into a new policy later.
DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON leads;
CREATE POLICY "own_data_or_owner_role_insert" ON leads
  FOR INSERT WITH CHECK (
    owner_employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- own_data_or_owner_role_update — SUBSTITUTION only, both clauses.
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON leads;
CREATE POLICY "own_data_or_owner_role_update" ON leads
  FOR UPDATE USING (
    owner_employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  ) WITH CHECK (
    owner_employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- owner_only_delete — SUBSTITUTION only.
DROP POLICY IF EXISTS "owner_only_delete" ON leads;
CREATE POLICY "owner_only_delete" ON leads
  FOR DELETE USING (
    (SELECT current_employee_role()) = 'owner'
  );

-- coordinator_team_select — GUARD (shape b). Original body, for reference:
--   FOR SELECT USING (is_my_team_member(owner_employee_id));
DROP POLICY IF EXISTS "coordinator_team_select" ON leads;
CREATE POLICY "coordinator_team_select" ON leads
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(owner_employee_id))
  );

-- coordinator_team_insert — GUARD, same shape as SELECT above.
DROP POLICY IF EXISTS "coordinator_team_insert" ON leads;
CREATE POLICY "coordinator_team_insert" ON leads
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(owner_employee_id))
  );

-- coordinator_team_update — GUARD on both clauses. Original had no OR
-- fallback on either clause (a coordinator has no coordinator_id of their
-- own, so is_my_team_member() is false for their own id by construction —
-- see migration_sales_coordinator.sql STEP 5's own note on this); the
-- rewrite preserves that — no fallback branch is added here.
DROP POLICY IF EXISTS "coordinator_team_update" ON leads;
CREATE POLICY "coordinator_team_update" ON leads
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(owner_employee_id))
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(owner_employee_id))
  );

-- manager_team_select — GUARD, same shape.
DROP POLICY IF EXISTS "manager_team_select" ON leads;
CREATE POLICY "manager_team_select" ON leads
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND (SELECT is_my_managed_member(owner_employee_id))
  );

-- manager_team_update — GUARD on the USING clause; the WITH CHECK keeps its
-- original `OR owner_employee_id = current_employee_id()` fallback (that
-- branch is what lets a manager reassign a team lead to THEMSELVES —
-- is_my_managed_member() is false for a manager's own id, same reasoning as
-- the coordinator above — and it is unaffected by the guard since it has no
-- dependency on is_my_managed_member() at all).
DROP POLICY IF EXISTS "manager_team_update" ON leads;
CREATE POLICY "manager_team_update" ON leads
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND (SELECT is_my_managed_member(owner_employee_id))
  ) WITH CHECK (
    (
      (SELECT current_employee_role()) = 'sales_manager'
      AND (SELECT is_my_managed_member(owner_employee_id))
    )
    OR owner_employee_id = (SELECT current_employee_id())
  );


-- ------------------------------------------------------------
-- STEP 3: stage_history policies
--
-- Every SELECT policy here also re-checks `leads` via EXISTS, so this is
-- where the fix matters twice over — once for stage_history's own ~1,591
-- rows, and once for the leads.owner_employee_id lookup nested inside each
-- EXISTS. Note the fix does NOT restructure the EXISTS shape (looking a
-- lead up by id to read its owner_employee_id is inherent — stage_history
-- has no owner_employee_id column of its own — and that lookup already
-- uses leads' primary key via idx equivalent, so it's not the slow part);
-- it only removes the redundant function re-evaluation inside each lookup.
-- ------------------------------------------------------------

-- own_data_or_owner_role_select — SUBSTITUTION only.
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON stage_history;
CREATE POLICY "own_data_or_owner_role_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'owner'
    OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = stage_history.lead_id
        AND leads.owner_employee_id = (SELECT current_employee_id())
    )
  );

-- owner_only_insert — SUBSTITUTION only.
DROP POLICY IF EXISTS "owner_only_insert" ON stage_history;
CREATE POLICY "owner_only_insert" ON stage_history
  FOR INSERT WITH CHECK ((SELECT current_employee_role()) = 'owner');

-- own_lead_insert — SUBSTITUTION only.
DROP POLICY IF EXISTS "own_lead_insert" ON stage_history;
CREATE POLICY "own_lead_insert" ON stage_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND leads.owner_employee_id = (SELECT current_employee_id())
    )
  );

-- coordinator_team_select — GUARD in front of the EXISTS. Safe by the same
-- A-AND-B≡B reasoning as STEP 2: is_my_team_member() inside the EXISTS is
-- false for every row when the caller isn't a coordinator, so the EXISTS
-- itself is already false for every non-coordinator today — the guard just
-- stops Postgres from opening the EXISTS (and the leads lookup, and the
-- function call inside it) at all in that case.
DROP POLICY IF EXISTS "coordinator_team_select" ON stage_history;
CREATE POLICY "coordinator_team_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND (SELECT is_my_team_member(leads.owner_employee_id))
    )
  );

-- coordinator_team_insert — same shape as SELECT above, WITH CHECK.
DROP POLICY IF EXISTS "coordinator_team_insert" ON stage_history;
CREATE POLICY "coordinator_team_insert" ON stage_history
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND (SELECT is_my_team_member(leads.owner_employee_id))
    )
  );

-- manager_team_select — same shape, manager side.
DROP POLICY IF EXISTS "manager_team_select" ON stage_history;
CREATE POLICY "manager_team_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND (SELECT is_my_managed_member(leads.owner_employee_id))
    )
  );

-- manager_team_insert — same shape, WITH CHECK.
DROP POLICY IF EXISTS "manager_team_insert" ON stage_history;
CREATE POLICY "manager_team_insert" ON stage_history
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND (SELECT is_my_managed_member(leads.owner_employee_id))
    )
  );


-- ============================================================
-- DELIBERATELY NOT CHANGED — so this reads as a scoping decision, not a
-- partial fix left unfinished.
--
--   Every other table's policies (activities, parties, sites, follow_ups,
--   targets, loss_reasons, lead_change_log, lead_owner_history,
--   site_contacts, employees, ...) have the EXACT SAME two defects: bare
--   current_employee_id()/current_employee_role() calls, and — on parties/
--   sites/follow_ups/targets/loss_reasons/lead_change_log/
--   lead_owner_history — an ungated is_my_team_member()/
--   is_my_managed_member() call in their own coordinator_team_*/
--   manager_team_* policies. They would benefit from the identical
--   (select ...) + role-guard treatment. NOT done in this pass, on
--   purpose: the measured problem is specifically leads/stage_history for
--   a sales_executive (PERFORMANCE.md Rule 4 exists for exactly this class
--   of issue generally, but this file fixes the one instance that was
--   actually timed and reported). Widening this to every table multiplies
--   the reviewable surface of a migration whose downside, if a rewrite is
--   ever wrong, is a data leak rather than a blank card — better to land
--   this narrow fix, confirm it against a real exec session, and repeat the
--   exact same recipe on another table only once THAT table is measured as
--   a real bottleneck (a coordinator or manager with a large team is the
--   most likely next candidate — is_my_team_member()/is_my_managed_member()
--   are unguarded on parties/sites/follow_ups/targets/loss_reasons/
--   lead_change_log/lead_owner_history today, same as leads/stage_history
--   were before this file).
--
--   current_employee_id() / current_employee_role() themselves — their
--   bodies are untouched. The defect was never in what they compute, only
--   in how bare call sites let Postgres re-invoke them per row.
--
--   No new index. idx_leads_owner (leads.owner_employee_id) and
--   idx_stage_history_lead (stage_history.lead_id) already exist
--   (tostem_crm_schema.sql) and already cover every lookup this file's
--   EXISTS clauses perform — confirmed by reading the schema file, not
--   assumed. The cost being fixed here is per-row function-call overhead,
--   not a missing index.
-- ============================================================


-- ============================================================
-- VERIFY — run each of these after the migration. Expected results are
-- stated; anything else means a step did not land as intended.
-- ============================================================

-- 1. Every policy this file touches now wraps its helper calls in `select`.
--    Expect 16 rows (9 on leads, 7 on stage_history), and — this is the
--    important check — the `qual`/`with_check` text of EVERY row should
--    contain the substring 'SELECT current_employee' at least once, proving
--    the bare-call form is gone, not just that the policy still exists.
SELECT tablename, policyname, cmd,
       qual       ILIKE '%SELECT current_employee%' AS using_wrapped,
       with_check ILIKE '%SELECT current_employee%' AS check_wrapped
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('leads', 'stage_history')
   AND policyname IN (
     'own_data_or_owner_role_select','own_data_or_owner_role_insert',
     'own_data_or_owner_role_update','owner_only_delete','owner_only_insert',
     'own_lead_insert','coordinator_team_select','coordinator_team_insert',
     'coordinator_team_update','manager_team_select','manager_team_update',
     'manager_team_insert'
   )
 ORDER BY tablename, cmd, policyname;

-- 2. The two helpers are still SECURITY DEFINER + STABLE (CREATE OR REPLACE
--    preserves this only if the new body keeps the same declarations, which
--    it does — this just confirms nothing was dropped by accident).
--    Expect prosecdef = true, provolatile = 's' for both rows.
SELECT proname, prosecdef, provolatile
  FROM pg_proc
 WHERE proname IN ('is_my_team_member', 'is_my_managed_member');

-- 3. THE REAL TEST IS BEHAVIOURAL, RUN AS EACH ROLE — NOT IN THE SQL
--    EDITOR. The SQL Editor runs as `postgres` with BYPASSRLS and no
--    auth.uid(), so current_employee_id()/current_employee_role() resolve
--    NULL there and every policy in this file evaluates to false — you
--    would see zero rows for everything and wrongly read that as a leak
--    fixed rather than as "not logged in as anyone". Confirm from real
--    logged-in sessions on the three-port setup instead:
--
--    a) As the SAME sales executive this bug was measured against
--       (Raghav Gupta or similar, ~86-88 rows): row counts and totals on
--       Dashboard/Home/the Sales Exec Profile/the sales funnel must be
--       IDENTICAL to what they were before this migration — this is a
--       pure performance change, so if a single number moves, something
--       here is wrong. Specifically re-check:
--         SELECT count(*) FROM leads;          -- same number as before
--         SELECT count(*) FROM stage_history;  -- same number as before
--       and that the funnel's "avg days in stage" column, previously
--       blank, now actually renders a number for at least one stage.
--
--    b) As a real sales_coordinator with a real team, and separately as a
--       real sales_manager with a real team: same check — row counts and
--       totals unchanged, and (this is the part that would catch a data
--       leak) confirm you STILL cannot see a lead/stage_history row that
--       belongs to someone outside your own team. Pick one specific lead
--       you know is NOT on your team and confirm:
--         SELECT * FROM leads WHERE id = <a lead you know isn't yours>;
--       returns zero rows, exactly as it did before this migration.
--
--    c) As the owner: unchanged — expect the same full-company counts as
--       always.

-- 4. RE-MEASURE THE ACTUAL FIX, as the sales executive from 3a, using the
--    same Resource Timing recipe PERFORMANCE.md's Rule 6 uses (run this in
--    the browser console on a real Dashboard load, production build):
--      const { supabase } = await import('/src/lib/supabaseClient.js')
--      performance.getEntriesByType('resource')
--        .filter(e => e.name.includes('stage_history'))
--        .map(e => ({ q: e.name.split('/rest/v1/')[1]?.slice(0,80), ms: Math.round(e.duration) }))
--    Expect the stage_history request to land well under the 8s
--    statement_timeout — a few hundred ms, not 5.5s idle / timing out under
--    load. Compare against a fresh incognito/logged-out-then-back-in
--    session so the query cache (queryCache.js, 90s) isn't just serving a
--    stale fast answer from before you made this change.
-- ============================================================
