-- ============================================================
-- MIGRATION: lead_remarks + "new Lixil lead" notification
-- Run this in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS throughout).
--
-- TWO independent pieces:
--
--   1. `lead_remarks` — a permanent, append-only log of free-text remarks
--      against a lead: who wrote it, when. Separate from `activities`
--      (records something that happened on a date) and `lead_change_log`
--      (a value-edit audit trail, trigger-written) — a remark is neither of
--      those, and there was nowhere on `leads` to put it (deliberately, per
--      CLAUDE.md: "there is no notes column on leads at all"). This is a
--      GENERAL feature, not Lixil-specific — any editing role can add one,
--      on any lead, at any time, visible to anyone who can already see the
--      lead.
--
--   2. A SECOND `notifications.kind`, 'lixil_lead_created' — fired by a new
--      trigger on `leads` INSERT, scoped tightly to
--      source_type = 'lixil' AND the row's owner being someone other than
--      whoever is inserting it (today that is only a sales_coordinator's
--      "Who is this for?" picker at capture). This is DELIBERATELY separate
--      from 'lead_assigned' (migration_lead_assignment_notifications.sql),
--      which fires only on REASSIGNMENT and was built that way on purpose —
--      see that file's own comments and CLAUDE.md's "creating a lead for
--      somebody... deliberately does not fire this". Nothing about that
--      rule changes here; this is a new, narrower event living alongside it.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: lead_remarks table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_remarks (
  id           SERIAL PRIMARY KEY,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_remarks_lead ON lead_remarks(lead_id, created_at);

ALTER TABLE lead_remarks ENABLE ROW LEVEL SECURITY;

-- SELECT deliberately does not restate leads' own visibility rules (own /
-- team / managed-team / owner-sees-all) — it reads them, LIVE, off `leads`
-- itself via EXISTS. Postgres evaluates that subquery under the same
-- session, so it is already filtered by leads' own SELECT policies: if this
-- employee's leads query would return the row, the EXISTS matches; if not,
-- it doesn't. This can never drift from leads' own rules because it never
-- copies them — the "two places compute the same permission separately" bug
-- shape CLAUDE.md calls out repeatedly (BottomNav's nav flags, Dashboard's
-- isOwner branches) is structurally impossible here.
DROP POLICY IF EXISTS "readable_if_lead_visible" ON lead_remarks;
CREATE POLICY "readable_if_lead_visible" ON lead_remarks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_remarks.lead_id)
  );

-- INSERT is the same three roles LeadDetail's own `canEdit` computes: owner,
-- that lead's sales coordinator, or the lead's own exec. A sales_manager on
-- a team lead can READ (via the policy above, since they can already see
-- the lead) but not ADD one — they get canQuickAct, not canEdit, everywhere
-- else on a team lead too. Widen this deliberately if that should change;
-- don't let it drift in quietly.
DROP POLICY IF EXISTS "insert_if_can_edit_lead" ON lead_remarks;
CREATE POLICY "insert_if_can_edit_lead" ON lead_remarks
  FOR INSERT WITH CHECK (
    employee_id = (select current_employee_id())
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_remarks.lead_id
         AND (
           l.owner_employee_id = (select current_employee_id())
           OR (select current_employee_role()) = 'owner'
           OR (
             (select current_employee_role()) = 'sales_coordinator'
             AND (select is_my_team_member(l.owner_employee_id))
           )
         )
    )
  );

-- No UPDATE, no DELETE, for anyone — a remark is a permanent record of what
-- was said, same append-only shape as loss_reasons/lead_change_log/
-- stage_history/lead_owner_history. Correcting one means adding a new
-- remark, never editing history.

REVOKE ALL ON lead_remarks FROM authenticated;
GRANT SELECT, INSERT ON lead_remarks TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE lead_remarks_id_seq TO authenticated;


-- ------------------------------------------------------------
-- STEP 2: widen notifications.kind
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('lead_assigned', 'lixil_lead_created'));


-- ------------------------------------------------------------
-- STEP 3: the "new Lixil lead" trigger
--
-- Fires on INSERT, not UPDATE — this is intentionally the one case where
-- lead CREATION notifies someone, which
-- migration_lead_assignment_notifications.sql's trigger explicitly does NOT
-- do for every other lead (see its own STEP 3 comment). Scoped tightly so
-- it cannot fire anywhere that original rule was meant to hold:
--
--   * source_type = 'lixil' only — every other source stays silent at
--     creation, exactly as before.
--   * owner_employee_id IS NOT NULL — a lead can be created unowned.
--   * owner_employee_id IS DISTINCT FROM the inserting actor — so an exec
--     who somehow creates their own Lixil lead never gets a pointless
--     "you made a lead for yourself" ping. Today only a sales_coordinator's
--     "Who is this for?" picker produces owner != actor at creation at all,
--     so in practice this fires exactly for coordinator entry-on-behalf.
--
-- Same suppression flag as the reassignment trigger, and for the same
-- reason: a bulk SQL insert of Lixil leads (an import, a data fix) must
-- wrap itself in SET LOCAL app.skip_assignment_notifications = 'on' or it
-- fires one notification per row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_lixil_lead_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_lixil_lead_created$
BEGIN
  IF coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type = 'lixil'
     AND NEW.owner_employee_id IS NOT NULL
     AND NEW.owner_employee_id IS DISTINCT FROM current_employee_id() THEN
    INSERT INTO notifications (employee_id, kind, lead_id, actor_employee_id)
    VALUES (NEW.owner_employee_id, 'lixil_lead_created', NEW.id, current_employee_id());
  END IF;

  RETURN NEW;
END;
$notify_lixil_lead_created$;

DROP TRIGGER IF EXISTS lixil_lead_created_notification ON leads;
CREATE TRIGGER lixil_lead_created_notification
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION notify_lixil_lead_created();


-- PostgREST caches the schema; lead_remarks is invisible to the API until it
-- reloads.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFY
--
-- 1. lead_remarks shape — expect exactly two policies, no UPDATE/DELETE:
--
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'lead_remarks';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'lead_remarks' ORDER BY grantee, privilege_type;
--
-- 2. notifications accepts the new kind:
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'notifications'::regclass AND contype = 'c';
--
-- 3. The trigger fires — reversible, in a transaction. Replace 7 with a real
--    employee id and 'ludhiana' with a real office_territory value:
--
--   BEGIN;
--     INSERT INTO leads (source_type, owner_employee_id, office_territory)
--     VALUES ('lixil', 7, 'ludhiana')
--     RETURNING id;
--     -- note the returned id, then:
--     SELECT employee_id, kind, lead_id, actor_employee_id FROM notifications
--      WHERE kind = 'lixil_lead_created' ORDER BY id DESC LIMIT 1;
--   ROLLBACK;
--
-- NOTE the SQL Editor runs as postgres with BYPASSRLS and no auth.uid(), so
-- current_employee_id() is NULL there — NEW.owner_employee_id (7) IS
-- DISTINCT FROM NULL is true, so the trigger fires for this test even though
-- no real session did anything. That is expected for this check; it is also
-- exactly why a real bulk insert of Lixil leads from this editor needs the
-- SET LOCAL suppression flag, or every row pings its new owner.
-- ============================================================
