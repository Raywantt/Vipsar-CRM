-- ============================================================
-- Coordinator entry-on-behalf-of-exec (2026-08-11) — the FAB's "New Lead"
-- and "Log Activity" are now open to sales_coordinator too, with a
-- mandatory "Who is this for?" exec picker in both forms. Run this in the
-- Supabase Dashboard's SQL Editor — the anon key this app runs on can't
-- execute DDL. The three sections below are independent; if one errors you
-- can still safely run the others.
--
-- leads already had everything needed for "who really created this vs. who
-- it's credited to" — created_by_employee_id (migration_lead_change_log.sql,
-- live since 2026-08-10) is stamped to the actual actor regardless of who
-- owner_employee_id ends up being. activities had no equivalent: employee_id
-- was, until now, always the same person as the one submitting the form, so
-- nothing distinguished "the exec logged it" from "the coordinator logged it
-- for them". Section 1 adds that column, mirroring leads' own pattern
-- exactly (BEFORE INSERT trigger stamps the real actor, app code never sets
-- it). Section 2 closes a real RLS gap this flow hits in practice — confirmed
-- live, not just reasoned through: an SC logging a Site Visit against a team
-- member's *existing* site needs to update sites.site_stage, and no
-- coordinator-team UPDATE policy exists on sites today (only sites SELECT
-- and site_contacts UPDATE were widened by migration_sales_coordinator.sql).
-- Without it, that field doesn't error — it SILENTLY NO-OPS. ActivityLog.jsx's
-- update call has no .select()/.single() on it, and Postgres RLS filters an
-- UPDATE's target rows the same way it would a SELECT: a row the policy
-- rejects just isn't matched, so 0 rows change and Supabase returns
-- {data: null, error: null} — no exception, nothing for the existing
-- warnings.push(...) error handling to catch. Reproduced live: a coordinator
-- picked "foundation" as the Site stage on a Site Visit, got "Activity
-- logged." with no warning at all, and the site's stage was still
-- "— Not specified —" afterward.
-- ============================================================


-- ------------------------------------------------------------
-- 1) activities.logged_by_employee_id — the real actor, always
--
-- Same shape as leads.created_by_employee_id: nullable FK, backfilled for
-- existing rows (every activity ever logged before this feature was
-- self-logged, so employee_id is the correct backfill value), stamped going
-- forward by a BEFORE INSERT trigger so no app code has to remember to set
-- it. Unlike leads.entered_by_role, this is a plain audit field with no lock
-- semantics attached — it never changes after insert, activities are never
-- edited once logged.
-- ------------------------------------------------------------
ALTER TABLE activities ADD COLUMN IF NOT EXISTS logged_by_employee_id INTEGER REFERENCES employees(id);

UPDATE activities
   SET logged_by_employee_id = employee_id
 WHERE logged_by_employee_id IS NULL
   AND employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION stamp_activity_logger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.logged_by_employee_id :=
    COALESCE(NEW.logged_by_employee_id, current_employee_id(), NEW.employee_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_activity_logger ON activities;
CREATE TRIGGER stamp_activity_logger
  BEFORE INSERT ON activities
  FOR EACH ROW
  EXECUTE FUNCTION stamp_activity_logger();


-- ------------------------------------------------------------
-- 2) sites — add the missing coordinator-team UPDATE policy
--
-- migration_sales_coordinator.sql's STEP 6 widened sites SELECT for an SC
-- but never added a matching UPDATE policy (only site_contacts got one).
-- Scoped the same way that site_contacts policy is: any site carrying at
-- least one lead owned by a member of this coordinator's team.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_update" ON sites;
CREATE POLICY "coordinator_team_update" ON sites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = sites.id
         AND is_my_team_member(leads.owner_employee_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = sites.id
         AND is_my_team_member(leads.owner_employee_id)
    )
  );


-- ------------------------------------------------------------
-- 3) parties — add the missing coordinator-team UPDATE policy
--
-- Same gap as sites, for the same reason: an SC creating a lead on behalf of
-- an exec passes created_by = that exec (see LeadQuickCapture.jsx /
-- PartySearchOrCreate.jsx's new createdByEmployeeId prop — done deliberately
-- so the exec keeps normal edit rights on their own client record
-- afterward), which also means the SC itself has no standing "own data"
-- claim on that party if they ever need to fix a typo in the same session.
-- Scoped via the same three link types team_scoped_select already checks
-- (party_id / referred_by_party_id / other_party_id) on a team member's lead.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_update" ON parties;
CREATE POLICY "coordinator_team_update" ON parties
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM leads l
       WHERE is_my_team_member(l.owner_employee_id)
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads l
       WHERE is_my_team_member(l.owner_employee_id)
         AND (l.party_id = parties.id OR l.referred_by_party_id = parties.id OR l.other_party_id = parties.id)
    )
  );


-- ============================================================
-- VERIFICATION
-- ============================================================

-- 1. Column + trigger exist:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'activities' AND column_name = 'logged_by_employee_id';
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'activities'::regclass AND tgname = 'stamp_activity_logger';

-- 2. Backfill worked:
-- SELECT count(*) FILTER (WHERE logged_by_employee_id IS NULL) AS unattributed, count(*) AS total FROM activities;
-- Expect unattributed = 0 (or exactly the count of rows whose employee_id was already NULL, if any).

-- 3. New policies exist:
-- SELECT tablename, policyname FROM pg_policies
--  WHERE policyname = 'coordinator_team_update' AND tablename IN ('sites','parties');

-- 4. Live end-to-end check, logged in as a sales_coordinator with at least
--    one active exec on their team: log an activity via the FAB's "Log
--    Activity" against that exec, then:
-- SELECT id, employee_id, logged_by_employee_id, activity_type, created_at
--   FROM activities ORDER BY created_at DESC LIMIT 5;
--    Expect employee_id = the exec, logged_by_employee_id = your own
--    coordinator id, and the two to differ.

-- 5. The sites fix specifically (this is the one that silently no-ops
--    pre-migration, see section 2's comment above): as that same
--    coordinator, log a Site Visit against a lead with a linked site, set
--    Site stage to anything, submit, then reload the lead as any role and
--    confirm Site details actually shows the new stage — not
--    "— Not specified —" with no error anywhere.
