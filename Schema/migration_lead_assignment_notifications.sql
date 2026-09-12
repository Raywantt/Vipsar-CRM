-- ============================================================
-- MIGRATION: notifications — "a lead has been assigned to you"
-- Run this in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS throughout).
--
-- WHAT THIS IS FOR: when a lead changes hands, the person RECEIVING it is
-- told, clearly, on their phone. Until now a reassignment was completely
-- silent to the new owner — lead_owner_history recorded it, the Deal owner
-- rail showed it to anyone who happened to open that lead, and that was the
-- whole of it. A rep could be carrying a lead for a week without knowing.
--
-- WHY A SEPARATE TABLE AND NOT follow_ups: a reassignment is not a reminder.
-- Putting it there would make a fake row appear in "Your reminders", and it
-- would be counted by every follow-up metric in the app — the Day Review's
-- done/missed cell, the Today screens' open-follow-up counts, the
-- followups_overdue attention bucket. Those numbers mean something; a
-- notification riding inside them corrupts all of them at once.
--
-- WHY A TRIGGER, NOT APP CODE: the same reasoning as lead_change_log, and it
-- is not hypothetical here. owner_employee_id is written from
-- LeadQuickActions today, but Schema/fix_reassign_aanchal_leads.sql shows
-- reassignment also happens as hand-written SQL, and the Supabase table
-- editor is always a path. A JS helper would have to be called from every
-- one of those, and the first one anyone forgets is a rep who is never told
-- they own a lead. See STEP 3's SUPPRESSING THIS note for how a deliberate
-- bulk reassignment opts out.
--
-- NO PRE-BAKED title/body COLUMNS: same call lead_change_log made. The push
-- text is built at send time by the Edge Function and the in-app card builds
-- its own from the joined lead, so a stored copy could only ever drift from
-- the lead's real current name.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: the table
--
-- `kind` is a CHECK rather than a bare TEXT because this table is meant to
-- hold more than one sort of notification eventually, and an unrecognised
-- kind would be a row nothing renders and nothing pushes — invisible dead
-- weight. Adding a kind later means widening this constraint AND teaching
-- both renderers about it, deliberately.
--
-- notified_at = a push was actually sent to at least one device.
-- seen_at     = the recipient has acknowledged it inside the app.
-- They are independent: a rep with notifications denied never gets a
-- notified_at, and must still be able to see and dismiss the in-app card.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('lead_assigned')),
  lead_id            INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  actor_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at         TIMESTAMP DEFAULT now(),
  notified_at        TIMESTAMP,
  seen_at            TIMESTAMP
);


-- ------------------------------------------------------------
-- STEP 2: indexes
--
-- The first serves the in-app card ("what has this employee not seen yet"),
-- which runs on every Today screen load for every role. The second is
-- partial so it stays tiny: the cron only ever asks for the handful of rows
-- that still need pushing, and a partial index on that predicate means the
-- ever-growing tail of already-sent rows costs nothing to skip.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_employee_unseen
  ON notifications(employee_id, created_at DESC)
  WHERE seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_unsent
  ON notifications(created_at)
  WHERE notified_at IS NULL;


-- ------------------------------------------------------------
-- STEP 3: the trigger
--
-- Fires only when owner_employee_id genuinely changes to a non-null value.
-- IS DISTINCT FROM (not <>) so a NULL-to-someone assignment counts, which
-- <> would silently swallow.
--
-- SELF-ASSIGNMENT IS NOT SKIPPED, on purpose. It would be tempting to add
-- "AND NEW.owner_employee_id <> current_employee_id()" on the grounds that
-- nobody needs telling about something they just did. That would break the
-- one thing this feature cannot otherwise be tested with — an owner
-- reassigning a lead to themselves to see the notification arrive on their
-- own phone (see src/lib/selfAssignTest.js). It is also harmless in real
-- use: nobody but the owner can currently be both actor and recipient.
--
-- SUPPRESSING THIS for a deliberate bulk reassignment (a data fix like
-- Schema/fix_reassign_aanchal_leads.sql, an import, a backfill) — otherwise
-- one UPDATE touching 200 leads sends that rep 200 push notifications:
--
--     BEGIN;
--     SET LOCAL app.skip_assignment_notifications = 'on';
--     UPDATE leads SET owner_employee_id = ... WHERE ...;
--     COMMIT;
--
-- SET LOCAL, so it expires with the transaction and cannot leak into the
-- next statement. current_setting(..., true) returns NULL rather than
-- erroring when the setting was never set, which is the normal case.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_lead_reassigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_lead_reassigned$
BEGIN
  IF coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_employee_id IS NOT NULL
     AND NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id THEN
    INSERT INTO notifications (employee_id, kind, lead_id, actor_employee_id)
    VALUES (NEW.owner_employee_id, 'lead_assigned', NEW.id, current_employee_id());
  END IF;

  RETURN NEW;
END;
$notify_lead_reassigned$;

DROP TRIGGER IF EXISTS lead_assignment_notification ON leads;
CREATE TRIGGER lead_assignment_notification
  AFTER UPDATE OF owner_employee_id ON leads
  FOR EACH ROW
  EXECUTE FUNCTION notify_lead_reassigned();


-- ------------------------------------------------------------
-- STEP 4: RLS
--
-- Own row only, with NO owner-role exception even on read — the same shape
-- push_subscriptions uses, and for the same reason. A notification is
-- personal; an owner reading the whole company's would be noise at best.
--
-- There is deliberately no INSERT policy for anyone. This table has exactly
-- one writer, the SECURITY DEFINER trigger above, which does not go through
-- RLS at all. A client that could insert here could fabricate a "you have
-- been assigned a lead" alert for a colleague.
--
-- UPDATE is own-row and exists for one purpose: marking a notification seen.
--
-- The (select ...) wrapping is the form the two 2026-09-07 performance
-- migrations established — it lets Postgres evaluate the helper once per
-- statement instead of once per row.
-- ------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_data_select" ON notifications;
CREATE POLICY "own_data_select" ON notifications
  FOR SELECT USING (
    employee_id = (select current_employee_id())
  );

DROP POLICY IF EXISTS "own_data_update" ON notifications;
CREATE POLICY "own_data_update" ON notifications
  FOR UPDATE USING (
    employee_id = (select current_employee_id())
  ) WITH CHECK (
    employee_id = (select current_employee_id())
  );

DROP POLICY IF EXISTS "own_data_delete" ON notifications;
CREATE POLICY "own_data_delete" ON notifications
  FOR DELETE USING (
    employee_id = (select current_employee_id())
  );


-- ------------------------------------------------------------
-- STEP 5: grants
--
-- TWO things here are easy to get wrong and both have bitten this project
-- before (CLAUDE.md, Conventions):
--
--   1. service_role does NOT automatically reach a new table on this
--      instance — see supabase/config.toml's auto_expose_new_tables note.
--      The Edge Function runs as service_role and would fail with a plain
--      "permission denied for table notifications" without this.
--   2. Every new table arrives BROADLY writable via STEP A of
--      rls_policies.sql (ALTER DEFAULT PRIVILEGES) plus Supabase's own
--      baseline. The REVOKE below is what actually keeps INSERT off the
--      table for clients; the missing INSERT policy alone is one layer, and
--      one careless permissive policy later would make the grant live.
-- ------------------------------------------------------------
REVOKE ALL ON notifications FROM authenticated;
GRANT SELECT, UPDATE, DELETE ON notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO service_role;


-- PostgREST caches the schema; a brand-new table is invisible to the API
-- until it reloads.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- VERIFY
--
-- 1. Shape, trigger and policies exist:
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal;
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notifications';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'notifications' ORDER BY grantee, privilege_type;
--
--   Expect lead_assignment_notification among the triggers; exactly three
--   policies (select/update/delete, NO insert); and authenticated holding
--   SELECT/UPDATE/DELETE but NOT INSERT.
--
-- 2. The trigger actually fires — the check that matters, since creating a
--    trigger proves it exists, not that it does anything. Reversible, in a
--    transaction, on a real lead. Replace 999 with a real lead id and 7 with
--    a real employee id that is NOT its current owner:
--
--   BEGIN;
--     UPDATE leads SET owner_employee_id = 7 WHERE id = 999;
--     SELECT employee_id, kind, lead_id, actor_employee_id
--       FROM notifications WHERE lead_id = 999;   -- expect one row for 7
--   ROLLBACK;
--
-- 3. And that suppression works — same shape, expecting NO new row:
--
--   BEGIN;
--     SET LOCAL app.skip_assignment_notifications = 'on';
--     UPDATE leads SET owner_employee_id = 7 WHERE id = 999;
--     SELECT count(*) FROM notifications WHERE lead_id = 999;  -- expect 0
--   ROLLBACK;
--
-- NOTE the SQL Editor runs as postgres with BYPASSRLS and no auth.uid(), so
-- current_employee_id() is NULL there and actor_employee_id will come back
-- null in check 2. That is correct and expected — it proves the trigger
-- fires, not that attribution works. Attribution can only be confirmed from
-- a real logged-in session.
-- ============================================================
