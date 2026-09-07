-- ============================================================
-- MIGRATION: RLS performance — parties / sites / activities
--            (search-or-create, and Log Activity's lead picker)
--
-- Run this in the Supabase SQL Editor, whole file, top to bottom. Safe to
-- re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout).
--
-- SIBLING of Schema/migration_rls_performance_leads_stage_history.sql (that
-- one is already live). Same two rewrite shapes, same proof style. No hard
-- ordering dependency on that file — is_my_team_member()/is_my_managed_member()
-- work correctly whether or not their own bodies are wrapped — but it should
-- stay applied for this file's full benefit, since several policies below
-- call those two functions.
--
-- >>> CORRECTED after the first run, same day <<< — STEP 4 (sites/parties
-- coordinator_team_update) was ADDED after the user ran the original version
-- of this file and its own VERIFY query #1 came back showing those exact two
-- policies still unwrapped (using_wrapped/check_wrapped both false). Cause:
-- these two policies are defined in Schema/migration_coordinator_entry.sql
-- (2026-08-11), a file that was not part of the grep sweep this migration was
-- originally drafted from — an incomplete search, not a logic error in
-- anything that WAS found. If you already ran the pre-correction version,
-- re-run this whole file — every earlier statement is a no-op the second
-- time (DROP POLICY IF EXISTS / CREATE OR REPLACE throughout), so re-running
-- is safe and only STEP 4 actually changes anything.
--
-- >>> RUN THIS LAST, AFTER rls_policies.sql, migration_sales_coordinator.sql,
--     and migration_sales_manager.sql <<< — same reversion hazard as the
-- sibling file: those three define the policies this file rewrites, so
-- re-running any of them afterward silently reinstalls the slower form,
-- and this file must be re-run to restore the fix.
--
-- ============================================================
-- WHY `activities` IS IN THIS FILE, NOT JUST `parties`/`sites`
--
-- This isn't a guess-and-widen — it's a traced dependency. `parties`'
-- `team_scoped_select` policy (below) decides "can you see this contact" partly
-- via `EXISTS (SELECT 1 FROM activities a WHERE a.party_id = parties.id AND
-- a.employee_id = current_employee_id())`. That subquery is plain SQL inside a
-- policy body, NOT inside a SECURITY DEFINER function — so it runs under the
-- calling role's own privileges, which means it is ITSELF subject to
-- `activities`' own RLS policies, every time. `activities.coordinator_team_select`
-- /`coordinator_team_insert`/`coordinator_team_update`/`manager_team_select` have
-- the exact unwrapped, ungated `is_my_team_member()`/`is_my_managed_member()`
-- shape this file's sibling already fixed on `leads`. So every party search
-- was quietly re-running that same expensive, skippable check a second time,
-- once per candidate row, via this join — fixing `parties` alone would have
-- left this half of the cost in place. (The same subquery also touches
-- `leads` and `site_contacts` — `leads`' policies are already fixed by the
-- sibling migration; `site_contacts`' own policy is a single cheap bare call,
-- not worth a whole extra section, wrapped inline in STEP 3 below for
-- completeness.)
--
-- ============================================================
-- WHAT THIS FILE CANNOT DO, READ BEFORE EXPECTING SIBLING-LEVEL GAINS
--
-- The sibling file's dominant win was SKIPPING an expensive check entirely
-- for roles that could never match — coordinator/manager team membership is
-- irrelevant to a plain sales_executive, so the whole branch could fold to
-- `false` before ever touching `employees`.
--
-- `parties`/`sites`' OWN-visibility branches (an exec's "is this contact
-- linked to one of MY leads/activities/site-contacts") have NO such
-- shortcut. That question is genuinely role-dependent-but-not-skippable for
-- an exec or a manager checking their OWN rows — the honest answer really is
-- sometimes yes and sometimes no, so Postgres has to actually look. STEP 1/2
-- below therefore apply ONLY shape (a) — wrap the bare function calls so
-- each individual check is cheaper — to those branches; there is no
-- shape (b) guard to add because there is no internally-redundant role check
-- to hoist outside of. The manager_team_select policies on parties/sites DO
-- get a real (small) version of the sibling's win, since they're already
-- gated by role and only need their calls wrapped, not restructured.
--
-- Every EXISTS branch this file rewrites is already backed by an index —
-- confirmed by reading tostem_crm_schema.sql directly: idx_leads_owner,
-- idx_leads_party, idx_leads_referred_by, idx_leads_other_party, idx_leads_site,
-- idx_activities_employee, idx_activities_party, idx_site_contacts_site,
-- idx_site_contacts_party, idx_parties_created_by, idx_sites_discovered_by all
-- exist. So the ceiling here is genuinely "each check is cheap but real,"
-- not "a missing index is making this scan the whole table" — no new index
-- is added by this file for that reason.
-- ============================================================
-- THE FIX — same two shapes as the sibling file, same proof requirement:
--
--   (a) SUBSTITUTION: bare `current_employee_id()`/`current_employee_role()`
--       becomes `(select ...)`. Value-preserving by definition (STABLE,
--       zero-arg, no outer reference) — needs no further proof, applied
--       throughout every policy below.
--
--   (b) SHORT-CIRCUIT GUARD (only where the sibling's pattern actually
--       applies — `activities.coordinator_team_*` and the four
--       `manager_team_select`/insert/update rows across all three tables):
--       `is_my_team_member(x)` / `is_my_managed_member(x)` becomes
--       `(select current_employee_role()) = 'sales_coordinator' AND
--        (select is_my_team_member(x))` (or the manager equivalent) — safe
--       because both helpers already require the matching role internally,
--       so `A AND B ≡ B` when B already implies A. Identical proof to the
--       sibling file; not re-derived per policy here.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: parties policies
-- ------------------------------------------------------------

-- authenticated_insert — SUBSTITUTION only.
DROP POLICY IF EXISTS "authenticated_insert" ON parties;
CREATE POLICY "authenticated_insert" ON parties
  FOR INSERT WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

-- own_data_or_owner_role_update — SUBSTITUTION only, both clauses.
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON parties;
CREATE POLICY "own_data_or_owner_role_update" ON parties
  FOR UPDATE USING (
    created_by = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  ) WITH CHECK (
    created_by = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- owner_only_delete — SUBSTITUTION only.
DROP POLICY IF EXISTS "owner_only_delete" ON parties;
CREATE POLICY "owner_only_delete" ON parties
  FOR DELETE USING (
    (SELECT current_employee_role()) = 'owner'
  );

-- team_scoped_select — SUBSTITUTION only (shape a), no restructuring. Every
-- branch here decides real per-caller visibility (own-created, own-lead,
-- own-activity, own-site-contact) — none of them are redundant with a role
-- check the way is_my_team_member()'s internal check was, so there is
-- nothing to short-circuit away. Original body, for reference, is
-- reproduced from migration_sales_coordinator.sql STEP 6 with only
-- `(select ...)` added around each bare current_employee_id()/
-- current_employee_role() call.
DROP POLICY IF EXISTS "team_scoped_select" ON parties;
CREATE POLICY "team_scoped_select" ON parties
  FOR SELECT USING (
    (SELECT current_employee_role()) IN ('owner','sales_coordinator')
    OR created_by = (SELECT current_employee_id())
    OR EXISTS (
         SELECT 1 FROM leads l
          WHERE l.owner_employee_id = (SELECT current_employee_id())
            AND (l.party_id = parties.id
                 OR l.referred_by_party_id = parties.id
                 OR l.other_party_id = parties.id)
       )
    OR EXISTS (
         SELECT 1 FROM activities a
          WHERE a.party_id = parties.id
            AND a.employee_id = (SELECT current_employee_id())
       )
    OR EXISTS (
         SELECT 1 FROM site_contacts sc
          JOIN leads l2 ON l2.site_id = sc.site_id
          WHERE sc.party_id = parties.id
            AND l2.owner_employee_id = (SELECT current_employee_id())
       )
  );

-- manager_team_select — SUBSTITUTION only. Already correctly gated by role
-- at the top level (this IS the sibling's shape b, already applied when
-- this policy was first written) — only the bare calls inside need wrapping.
DROP POLICY IF EXISTS "manager_team_select" ON parties;
CREATE POLICY "manager_team_select" ON parties
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND (
      EXISTS (
        SELECT 1 FROM leads l
         WHERE (SELECT is_my_managed_member(l.owner_employee_id))
           AND (l.party_id = parties.id
                OR l.referred_by_party_id = parties.id
                OR l.other_party_id = parties.id)
      )
      OR EXISTS (
        SELECT 1 FROM site_contacts sc
          JOIN leads l2 ON l2.site_id = sc.site_id
         WHERE sc.party_id = parties.id
           AND (SELECT is_my_managed_member(l2.owner_employee_id))
      )
    )
  );


-- ------------------------------------------------------------
-- STEP 2: sites policies — same shapes, same reasoning as parties above.
-- ------------------------------------------------------------

-- authenticated_insert — SUBSTITUTION only.
DROP POLICY IF EXISTS "authenticated_insert" ON sites;
CREATE POLICY "authenticated_insert" ON sites
  FOR INSERT WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

-- own_data_or_owner_role_update — SUBSTITUTION only, both clauses.
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON sites;
CREATE POLICY "own_data_or_owner_role_update" ON sites
  FOR UPDATE USING (
    discovered_by = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  ) WITH CHECK (
    discovered_by = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- owner_only_delete — SUBSTITUTION only.
DROP POLICY IF EXISTS "owner_only_delete" ON sites;
CREATE POLICY "owner_only_delete" ON sites
  FOR DELETE USING (
    (SELECT current_employee_role()) = 'owner'
  );

-- team_scoped_select — SUBSTITUTION only, no restructuring (same reasoning
-- as parties' version: the own-discovered / own-lead branches are genuine
-- per-caller checks, nothing to short-circuit).
DROP POLICY IF EXISTS "team_scoped_select" ON sites;
CREATE POLICY "team_scoped_select" ON sites
  FOR SELECT USING (
    (SELECT current_employee_role()) IN ('owner','sales_coordinator')
    OR discovered_by = (SELECT current_employee_id())
    OR EXISTS (
         SELECT 1 FROM leads l
          WHERE l.site_id = sites.id
            AND l.owner_employee_id = (SELECT current_employee_id())
       )
  );

-- manager_team_select — SUBSTITUTION only, already role-gated.
DROP POLICY IF EXISTS "manager_team_select" ON sites;
CREATE POLICY "manager_team_select" ON sites
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.site_id = sites.id
         AND (SELECT is_my_managed_member(l.owner_employee_id))
    )
  );


-- ------------------------------------------------------------
-- STEP 3: activities policies — the transitively-hit table (see the header
-- comment above for why this is here, not a scope-widening guess).
-- ------------------------------------------------------------

-- own_data_or_owner_role_select — SUBSTITUTION only.
DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON activities;
CREATE POLICY "own_data_or_owner_role_select" ON activities
  FOR SELECT USING (
    employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- own_data_or_owner_role_insert — SUBSTITUTION only.
DROP POLICY IF EXISTS "own_data_or_owner_role_insert" ON activities;
CREATE POLICY "own_data_or_owner_role_insert" ON activities
  FOR INSERT WITH CHECK (
    employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- own_data_or_owner_role_update — SUBSTITUTION only, both clauses.
DROP POLICY IF EXISTS "own_data_or_owner_role_update" ON activities;
CREATE POLICY "own_data_or_owner_role_update" ON activities
  FOR UPDATE USING (
    employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  ) WITH CHECK (
    employee_id = (SELECT current_employee_id())
    OR (SELECT current_employee_role()) = 'owner'
  );

-- owner_only_delete — SUBSTITUTION only.
DROP POLICY IF EXISTS "owner_only_delete" ON activities;
CREATE POLICY "owner_only_delete" ON activities
  FOR DELETE USING (
    (SELECT current_employee_role()) = 'owner'
  );

-- coordinator_team_select — GUARD (shape b). Original:
--   FOR SELECT USING (is_my_team_member(employee_id));
DROP POLICY IF EXISTS "coordinator_team_select" ON activities;
CREATE POLICY "coordinator_team_select" ON activities
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(employee_id))
  );

-- coordinator_team_insert — GUARD, same shape.
DROP POLICY IF EXISTS "coordinator_team_insert" ON activities;
CREATE POLICY "coordinator_team_insert" ON activities
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(employee_id))
  );

-- coordinator_team_update — GUARD added alongside the existing
-- entered_by_role lock clause (an activity an exec has already saved stays
-- off-limits to their coordinator). AND is order-independent for the final
-- truth value, so adding the guard changes nothing about what this policy
-- permits — only how cheaply it decides.
DROP POLICY IF EXISTS "coordinator_team_update" ON activities;
CREATE POLICY "coordinator_team_update" ON activities
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(employee_id))
    AND entered_by_role IS DISTINCT FROM 'sales_executive'
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND (SELECT is_my_team_member(employee_id))
    AND entered_by_role IS DISTINCT FROM 'sales_executive'
  );

-- manager_team_select — GUARD, manager side. Original:
--   FOR SELECT USING (is_my_managed_member(employee_id));
-- (No manager INSERT/UPDATE on activities — unchanged, per the owner's
-- ruling that a manager never edits an exec's logged activity.)
DROP POLICY IF EXISTS "manager_team_select" ON activities;
CREATE POLICY "manager_team_select" ON activities
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'sales_manager'
    AND (SELECT is_my_managed_member(employee_id))
  );


-- ------------------------------------------------------------
-- STEP 4 (added in the correction — see the header note): the two
-- coordinator_team_update policies from Schema/migration_coordinator_entry.sql
--
-- Both are GUARD rewrites (shape b) — same proof as everywhere else in this
-- file: is_my_team_member() already requires role = 'sales_coordinator'
-- internally, so adding that same check outside it changes nothing about
-- what these policies allow, only how cheaply they decide. Original bodies
-- reproduced from migration_coordinator_entry.sql sections 2 and 3, with
-- (select ...) wrapping and the role guard added and nothing else touched.
-- ------------------------------------------------------------

-- sites.coordinator_team_update — lets a coordinator update a team member's
-- existing site (e.g. Site Visit's site-stage update) without needing an
-- "own data" claim on it.
DROP POLICY IF EXISTS "coordinator_team_update" ON sites;
CREATE POLICY "coordinator_team_update" ON sites
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = sites.id
         AND (SELECT is_my_team_member(leads.owner_employee_id))
    )
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = sites.id
         AND (SELECT is_my_team_member(leads.owner_employee_id))
    )
  );

-- parties.coordinator_team_update — same reasoning: a coordinator who
-- created a party on behalf of an exec (created_by = the exec, per
-- LeadQuickCapture's createdByEmployeeId) has no "own data" claim on it
-- either, so this is their fallback edit path.
DROP POLICY IF EXISTS "coordinator_team_update" ON parties;
CREATE POLICY "coordinator_team_update" ON parties
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE (SELECT is_my_team_member(l.owner_employee_id))
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE (SELECT is_my_team_member(l.owner_employee_id))
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  );


-- ============================================================
-- DELIBERATELY NOT CHANGED
--
--   site_contacts — its own SELECT/INSERT policy
--   (`current_employee_role() IS NOT NULL`) is a single bare call with
--   nothing to short-circuit and no per-row EXISTS; not worth its own
--   migration step. NOT wrapped here either, to keep this file's diff
--   focused on the tables actually measured/traced as costly — a one-line
--   fix if it's ever worth doing, same recipe as everywhere else in this
--   file.
--
--   employees, follow_ups, targets, loss_reasons, lead_change_log,
--   lead_owner_history — same bare-call pattern as everywhere else in this
--   schema, still not touched. Same reasoning as the sibling file: fix what
--   was traced as actually costly, not everything that shares the pattern.
--
--   No new index, anywhere. Every EXISTS branch this file rewrites already
--   has one — see the header comment's index list, confirmed by reading
--   tostem_crm_schema.sql directly.
--
--   No restructuring of `parties`/`sites`' team_scoped_select logic itself
--   (the ORDER of OR branches, or what each branch checks). Only the bare
--   function calls inside are wrapped — see "WHAT THIS FILE CANNOT DO"
--   above for why a bigger structural change (a precomputed visibility
--   table) is a separate, bigger decision and not part of this pass.
-- ============================================================


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- 1. Every touched policy now wraps its helper calls. Expect 20 rows (was
--    18 before the STEP 4 correction — coordinator_team_update exists on
--    THREE tables, not just activities, and this query's own policyname
--    list already covered all three, which is exactly how the gap was
--    caught: re-running this same query after the first version of this
--    file showed parties/sites' copies still false/false). qual/with_check
--    should never show `false` for using_wrapped/check_wrapped (NULL is
--    expected and fine wherever that clause doesn't apply to the policy's
--    command — see the sibling file's own note on this).
SELECT tablename, policyname, cmd,
       qual       ILIKE '%SELECT current_employee%' AS using_wrapped,
       with_check ILIKE '%SELECT current_employee%' AS check_wrapped
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('parties', 'sites', 'activities')
   AND policyname IN (
     'authenticated_insert','own_data_or_owner_role_update','owner_only_delete',
     'team_scoped_select','manager_team_select','own_data_or_owner_role_select',
     'own_data_or_owner_role_insert','coordinator_team_select',
     'coordinator_team_insert','coordinator_team_update'
   )
 ORDER BY tablename, cmd, policyname;

-- 2. THE REAL TEST IS BEHAVIOURAL, RUN AS EACH ROLE — NOT IN THE SQL EDITOR
--    (same reason as the sibling file: the editor runs as postgres with
--    BYPASSRLS and no auth.uid(), so everything here would evaluate false).
--
--    a) As a sales executive: party/site search results — which contacts
--       show up, whether "+ Add new" appears for a genuinely new name —
--       must be IDENTICAL to before this migration. This is a pure
--       performance change; any difference in WHICH contacts appear means
--       something here is wrong.
--    b) As a coordinator and separately a manager: same check, plus try
--       searching for a name you know belongs to a party outside your
--       reach (created by, and only ever touched by, someone on a
--       different team) — it must still not appear.
--    c) As the owner: unchanged, full company visibility as always.

-- 3. RE-MEASURE, as a sales executive, using the same Resource Timing
--    recipe as the sibling file and PERFORMANCE.md Rule 6:
--      performance.getEntriesByType('resource')
--        .filter(e => e.name.includes('/parties') || e.name.includes('/sites'))
--        .map(e => ({ q: e.name.split('/rest/v1/')[1]?.slice(0,80), ms: Math.round(e.duration) }))
--    Type a common name into a search-or-create box (New Lead's Client name
--    is the easiest place) and compare the `parties` request's duration
--    before/after. Expect a real but modest improvement, not a dramatic
--    one — see this file's own "WHAT THIS FILE CANNOT DO" section for why.
-- ============================================================
