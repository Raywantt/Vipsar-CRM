-- ============================================================
-- MIGRATION: make architect and firm parties universally visible to every
-- active employee, regardless of team/lead ownership (written 2026-09-10,
-- at the owner's direct request: "make architects universally visible and
-- accessible for all the employees")
--
-- WHY: parties/sites SELECT has been "own leads/activities, or your own
-- team's" since migration_sales_coordinator.sql reversed the earlier
-- company-wide open read (see CLAUDE.md's Sales Coordinator section,
-- "A sales exec's parties/sites read is now scoped to their own leads").
-- That narrowing was correct for clients/builders/PMCs/etc. — those really
-- are one rep's or one team's contacts — but an architect (and the firm
-- they work under) is shared infrastructure: the same architect routinely
-- appears across leads owned by different reps and different teams, and
-- with team-scoped visibility a rep who can't see an existing architect
-- just creates a duplicate instead of finding the real one. That's exactly
-- the "cross-team duplicates are accepted" tradeoff CLAUDE.md already flags
-- as a known cost of the coordinator narrowing — this migration removes
-- that cost for architects/firms specifically, without reopening it for
-- every other party type.
--
-- SCOPE, confirmed directly with the owner before writing this:
--   1. Covers BOTH party_type = 'architect' (the individual) AND
--      party_type = 'firm' (the practice they belong to, via
--      parties.firm_party_id) — narrowing to architects alone would leave
--      the Firm picker on Architect Meeting/New Lead/Lead Detail's Contacts
--      still unable to find a firm another team created, defeating the
--      point.
--   2. VISIBILITY (SELECT) is what widens, for every active employee, every
--      role, with no team/lead condition at all.
--   3. EDIT rights do NOT widen to match. The owner's explicit ruling:
--      "they can edit their own ones, but universally only owner can edit"
--      — i.e. the existing own_data_or_owner_role_update rule (creator, or
--      owner) is UNCHANGED and untouched by this file; what changes is that
--      sales_coordinator's separate coordinator_team_update fallback (added
--      by migration_coordinator_entry.sql, for editing a team member's party
--      they didn't personally create) must stop covering architect/firm
--      rows, since letting a coordinator edit an architect they didn't
--      create would grant more than "owner-only" for the not-mine case.
--      sales_manager was considered and explicitly ruled out for any special
--      edit right here (the owner's correction after first floating
--      "owner and sales_manager") — a manager already has no team-scoped
--      UPDATE policy on parties at all (checked: only manager_team_select
--      exists, see migration_sales_manager.sql), so there is nothing to
--      narrow there.
--
-- WHAT THIS DOES NOT TOUCH:
--   - own_data_or_owner_role_update on parties (creator-or-owner edit rule)
--     — unchanged, and it's what implements "they can edit their own ones".
--   - authenticated_insert on parties — already open to any active
--     employee (needed for search-before-create), unaffected.
--   - owner_only_delete on parties — unaffected.
--   - sites, or any table besides parties — architects/firms are `parties`
--     rows; nothing here touches site visibility.
--   - manager_team_select / team_scoped_select's own bodies — left exactly
--     as migration_rls_performance_parties_sites_activities.sql produced
--     them. This migration adds a SEPARATE, additive SELECT policy rather
--     than editing either of those (same "separate policy, not a rewrite"
--     precedent migration_sales_manager.sql set for parties/sites), so a
--     mistake here can't silently change what those two already grant.
--
-- App-layer note: no client code changes are needed. Every party
-- search/picker (PartySearchOrCreate, EmployeeSearchSelect's sibling
-- flows, Search.jsx's party directory, Architect Meeting's picker, Lead
-- Detail's Contacts) queries `parties` directly with no client-side
-- team/role filtering — visibility is entirely RLS-driven, so widening the
-- policy is sufficient for every one of those surfaces to start showing
-- every architect/firm company-wide with no code change.
--
-- Safe to re-run: DROP POLICY IF EXISTS before every CREATE POLICY.
--
-- ORDERING: must run after migration_rls_performance_parties_sites_activities.sql
-- (already live) — STEP 2 below replaces the exact coordinator_team_update
-- policy that file produced. ⚠️ If migration_coordinator_entry.sql or
-- migration_rls_performance_parties_sites_activities.sql is ever re-run
-- AFTER this file, it will silently revert coordinator_team_update back to
-- covering architect/firm rows too — same reversion hazard this repo's
-- other layered RLS migrations already document for themselves. Re-run
-- this file again afterward to restore the narrowing.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: universal SELECT for architect/firm parties.
--
-- Additive permissive policy — OR's in on top of team_scoped_select and
-- manager_team_select, so it can only ever widen what a role already sees,
-- never narrow it. Gated on current_employee_role() IS NOT NULL (i.e. an
-- active employee), the same guard every other "any employee" policy in
-- this schema uses, so a deactivated employee's session still can't see
-- these rows either.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "architect_firm_universal_select" ON parties;
CREATE POLICY "architect_firm_universal_select" ON parties
  FOR SELECT USING (
    party_type IN ('architect', 'firm')
    AND (SELECT current_employee_role()) IS NOT NULL
  );


-- ------------------------------------------------------------
-- STEP 2: narrow coordinator_team_update so it no longer covers
-- architect/firm rows — a coordinator's team-fallback edit path (for a
-- party they didn't personally create, but that's linked to their team's
-- lead) now excludes architects/firms, so the only ways left to edit one
-- are: you created it, or you're the owner. Reproduced from
-- migration_rls_performance_parties_sites_activities.sql STEP 4's live
-- form with exactly one condition added (party_type NOT IN (...)) to both
-- USING and WITH CHECK — nothing else touched. WITH CHECK carries the same
-- condition so a coordinator can't launder an architect/firm row through
-- this policy by relabelling party_type mid-update either direction.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_update" ON parties;
CREATE POLICY "coordinator_team_update" ON parties
  FOR UPDATE USING (
    party_type NOT IN ('architect', 'firm')
    AND (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE (SELECT is_my_team_member(l.owner_employee_id))
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  ) WITH CHECK (
    party_type NOT IN ('architect', 'firm')
    AND (SELECT current_employee_role()) = 'sales_coordinator'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE (SELECT is_my_team_member(l.owner_employee_id))
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  );


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- Q1. Both policies exist with the expected shape:
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--  WHERE tablename = 'parties'
--    AND policyname IN ('architect_firm_universal_select', 'coordinator_team_update');

-- Q2. Row-count sanity check (run as postgres in the SQL Editor — this only
--     proves the POLICY EXISTS and matches the right rows in principle; it
--     does NOT prove RLS-scoped behaviour per role, see Q3):
-- SELECT count(*) FROM parties WHERE party_type IN ('architect', 'firm');
--   Expect > 0 (the live architect_firm_link backfill already created real
--   firm parties) — this is the count that should become visible to
--   EVERY employee after this migration, regardless of role.

-- Q3. THE BEHAVIOURAL CHECK — MUST be run as a real logged-in employee,
--     never trusted from the SQL Editor alone (postgres/BYPASSRLS has no
--     auth.uid(), so every branch here would evaluate true/false
--     independent of whether the policy actually works for a real session).
--
--   1. As a sales_executive who owns none of the leads an architect is
--      linked to (pick one created by a colleague on a different team,
--      confirmed via the owner's own session first): search for that
--      architect by name in New Lead's "Referral from" (architect
--      referral) or Log Activity's Architect Meeting picker. Expect the
--      real row to appear — before this migration it would not have,
--      unless linked to this exec's own lead/activity.
--   2. Same exec: try to EDIT that architect's mobile number or set/change
--      their firm link (if you didn't create it and aren't the owner).
--      Expect it to fail exactly like today ("added by someone else, so
--      you can't edit that record" — see setPartyFirm's own warning path)
--      — visibility widened, edit rights did not.
--   3. As a sales_coordinator: find an architect linked to a lead OUTSIDE
--      their own team (confirm via the owner's session which architect
--      qualifies). Expect it to be visible in search.
--   4. Same coordinator: try to edit that same outside-team-linked
--      architect's own fields. Expect it to be REFUSED now, even though
--      coordinator_team_update used to allow this for a party linked to
--      ANY of their team's leads. If this succeeds, STEP 2 above did not
--      take effect — check for a re-run of migration_coordinator_entry.sql
--      or migration_rls_performance_parties_sites_activities.sql after
--      this file (see the ORDERING note).
--   5. As the owner: confirm editing any architect/firm, created by anyone,
--      still works exactly as before (own_data_or_owner_role_update's
--      owner branch is untouched).
--   6. As the architect/firm's own creator (any role): confirm editing it
--      still works exactly as before (own_data_or_owner_role_update's
--      created_by branch is untouched).
-- ============================================================
