-- ============================================================
-- MIGRATION: follow-ups rebuild  (2026-08-21)
--
-- The data-layer half of the follow-up rebuild. Read FOLLOWUPS.md (repo root)
-- first — it holds the agreed rules this file implements, and the audit
-- findings that motivated each one. Rule numbers below refer to that file.
--
-- WHAT THIS DOES, and why each part exists:
--
--   STEP 1  status/cancel/completed-by columns      Rules 2.1, 2.2, 4.2
--   STEP 2  keep is_done in step with status        (back-compat, see below)
--   STEP 3  leads.on_hold_reason                    Rule 8.4
--   STEP 4  leads.next_followup_date becomes DERIVED Rule 1.2  ← the big one
--   STEP 5  open follow-ups move with a lead's owner Rule 5.6
--   STEP 6  follow_up_change_log audit trail        Rule 10.2
--   STEP 7  promote the 21 orphaned lead dates      Rule 10.1
--   STEP 8  indexes (+ resolve a name collision)    audit §6.6
--   STEP 9  RLS + grants for the new table
--   STEP 10 verification queries (commented out)
--
-- ORDERING IS LOAD-BEARING. STEP 4 installs the trigger that owns
-- leads.next_followup_date; STEP 7 then promotes the orphans (firing that
-- trigger, which recomputes the same value it already held) and finishes with
-- a full one-time recompute that NULLs the date on every lead whose
-- follow-ups are all closed. Running 7 before 4 would leave those stale dates
-- behind. Do not reorder.
--
-- SAFE TO RE-RUN. Every statement is IF NOT EXISTS / OR REPLACE / DROP-then-
-- CREATE, and STEP 7's promotion is guarded by a NOT EXISTS so a second run
-- promotes nothing.
--
-- INDEPENDENT of every other migration in this folder EXCEPT that it assumes
-- current_employee_id() / current_employee_role() (rls_policies.sql) and
-- is_my_team_member() (migration_sales_coordinator.sql) already exist. Both
-- are long live.
--
-- ⚠️ AFTER RUNNING THIS, THE EDGE FUNCTION MUST BE REDEPLOYED.
-- supabase/functions/send-followup-reminders/index.ts is updated in the same
-- change to filter on status='open' rather than is_done=false. Until it is
-- redeployed, a CANCELLED follow-up would still be picked up and notified.
-- Nothing can actually be cancelled until the UI ships, so there is no live
-- window where this bites — but redeploy before using the cancel action.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: the three states, and the link to the completing activity
--
-- status replaces is_done as the source of truth. is_done is NOT dropped —
-- see STEP 2 for why.
--
-- completed_by_activity_id is what makes "did they actually do it?"
-- answerable. Today is_done is unverifiable self-report: a rep can tick a
-- follow-up done having logged nothing, and no query can detect it.
-- ON DELETE SET NULL rather than CASCADE — deleting an activity must never
-- delete the follow-up that recorded it; the follow-up stays done, it just
-- loses its proof.
-- ------------------------------------------------------------
ALTER TABLE follow_ups
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS completed_by_activity_id INTEGER
    REFERENCES activities(id) ON DELETE SET NULL;

-- Backfill BEFORE the CHECK goes on, so an existing row can't fail it.
UPDATE follow_ups
   SET status = CASE WHEN is_done THEN 'done' ELSE 'open' END
 WHERE status IS DISTINCT FROM (CASE WHEN is_done THEN 'done' ELSE 'open' END);

ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_status_check;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_status_check
  CHECK (status IN ('open', 'done', 'cancelled'));

-- Rule 2.1: a cancellation must say why. Enforced at the DB layer, not just
-- in the form — the same "no skip-for-now escape hatch" treatment
-- DECISIONS.md already requires for marking a lead lost.
ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_cancel_reason_required;
ALTER TABLE follow_ups ADD CONSTRAINT follow_ups_cancel_reason_required
  CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> ''));


-- ------------------------------------------------------------
-- STEP 2: is_done stays, and is maintained FROM status
--
-- Deliberately not dropped and not converted to a GENERATED column:
--   * dropping it would drop the two partial indexes whose WHERE clause
--     references it, and would break the deployed Edge Function the instant
--     this migration ran rather than when the function is redeployed;
--   * ALTER ... SET GENERATED does not exist for an existing column, so
--     converting means drop + re-add, i.e. the same problem.
--
-- Instead a BEFORE trigger derives it, so the two can never disagree. App
-- code should read `status`; is_done remains only so nothing breaks mid-
-- deploy. NOTE it is TRUE only for 'done' — a CANCELLED follow-up has
-- is_done = false, because Rule 2.2 says cancelled never counts as done.
-- That is exactly why the Edge Function must move to status='open': a
-- cancelled row would otherwise still look notifiable to it.
--
-- The trigger also owns done_at / cancelled_at, so a caller cannot mark
-- something done without stamping when, or stamp a time that disagrees with
-- the state.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_follow_up_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_done := (NEW.status = 'done');

  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.done_at := COALESCE(NEW.done_at, now());
  ELSIF NEW.status <> 'done' THEN
    NEW.done_at := NULL;
    NEW.completed_by_activity_id := NULL;   -- reopening drops the stale proof
  END IF;

  IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  ELSIF NEW.status <> 'cancelled' THEN
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;

  -- Rule 8.5 + the audit's headline push bug: moving a due date must put the
  -- reminder back in the notification queue. The Edge Function skips anything
  -- already notified, so without this a rescheduled reminder is silently
  -- removed from push forever. Clearing it here rather than in the app means
  -- every reschedule path is covered, including ones not written yet.
  IF TG_OP = 'UPDATE' AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.notified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follow_up_status_sync ON follow_ups;
CREATE TRIGGER follow_up_status_sync
  BEFORE INSERT OR UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION sync_follow_up_status();

-- Bring every existing row through the trigger once so is_done/done_at agree
-- with status from here on.
UPDATE follow_ups SET status = status;


-- ------------------------------------------------------------
-- STEP 3: the hold reason belongs to the lead, not to a reminder
--
-- Rule 8.4. Today the reason lives only in the on-hold reminder's notes, and
-- LeadDetail reads it via a not-done filter — so completing that reminder
-- erases the record of why the lead was ever paused.
-- ------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS on_hold_reason TEXT;

-- Recover what we can from the existing on-hold reminders, so leads paused
-- before this migration don't lose their reason. Matches the title the On
-- Hold flow generates. Only fills a lead that is actually on hold and has no
-- reason yet, so re-running is a no-op.
UPDATE leads l
   SET on_hold_reason = f.notes
  FROM (
    SELECT DISTINCT ON (lead_id) lead_id, notes
      FROM follow_ups
     WHERE lead_id IS NOT NULL
       AND notes IS NOT NULL
       AND title LIKE 'On hold%'
     ORDER BY lead_id, created_at DESC
  ) f
 WHERE f.lead_id = l.id
   AND l.current_stage = 'on_hold'
   AND l.on_hold_reason IS NULL;


-- ------------------------------------------------------------
-- STEP 4: leads.next_followup_date becomes DERIVED  ← Rule 1.2
--
-- THE headline fix. Measured live before this migration: 27 leads carried a
-- next_followup_date and only 6 had a real follow_ups row behind them — a 78%
-- orphan rate, i.e. leads that display a scheduled follow-up for which no
-- notification will ever fire.
--
-- The column now means exactly one thing: the earliest due date among that
-- lead's OPEN follow-ups, or NULL if it has none. It is maintained here and
-- nowhere else. No application code may write it — every such write is being
-- removed in the same change.
--
-- A trigger rather than a helper function called from the app, for the same
-- reason lead_change_log is trigger-written: this app has no single lead-
-- update service (leads is written from four LeadDetail sections,
-- LeadStageSection, LeadQuickActions and three side-effect paths in
-- ActivityLog), so a JS helper would have to be called from all of them and
-- the first missed call site silently recreates the orphan problem.
--
-- SECURITY DEFINER because the writer may not own the lead: an owner or
-- coordinator completing a reminder on someone else's lead must still be able
-- to update that lead's derived date. Without it the recompute would be
-- silently filtered to zero rows by RLS — the documented silent-no-op shape.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_lead_next_followup(p_lead_id INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_lead_id IS NULL THEN RETURN; END IF;

  UPDATE leads
     SET next_followup_date = (
           SELECT MIN(due_date) FROM follow_ups
            WHERE lead_id = p_lead_id AND status = 'open'
         )
   WHERE id = p_lead_id
     AND next_followup_date IS DISTINCT FROM (
           SELECT MIN(due_date) FROM follow_ups
            WHERE lead_id = p_lead_id AND status = 'open'
         );
END;
$$;

CREATE OR REPLACE FUNCTION trg_sync_lead_next_followup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Both sides, because a follow-up can be moved between leads: the old
  -- lead's date must be recomputed too, not just the new one's.
  IF TG_OP <> 'INSERT' AND OLD.lead_id IS NOT NULL THEN
    PERFORM sync_lead_next_followup(OLD.lead_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.lead_id IS NOT NULL THEN
    PERFORM sync_lead_next_followup(NEW.lead_id);
  END IF;
  RETURN NULL;   -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS follow_up_syncs_lead_date ON follow_ups;
CREATE TRIGGER follow_up_syncs_lead_date
  AFTER INSERT OR UPDATE OR DELETE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION trg_sync_lead_next_followup();


-- ------------------------------------------------------------
-- STEP 5: open follow-ups move with the lead  ← Rule 5.6
--
-- Reminders follow the lead. Done and cancelled ones stay with whoever held
-- them — those are historical fact, and rewriting them would retroactively
-- re-credit work to someone who didn't do it (the same reasoning that made
-- leads.created_by_employee_id a separate column from owner_employee_id).
--
-- A trigger, not app code, because reassignment happens in LeadQuickActions
-- today and could happen elsewhere tomorrow.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reassign_open_follow_ups()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id
     AND NEW.owner_employee_id IS NOT NULL THEN
    UPDATE follow_ups
       SET assigned_to = NEW.owner_employee_id
     WHERE lead_id = NEW.id
       AND status = 'open'
       AND assigned_to IS DISTINCT FROM NEW.owner_employee_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lead_reassign_moves_follow_ups ON leads;
CREATE TRIGGER lead_reassign_moves_follow_ups
  AFTER UPDATE OF owner_employee_id ON leads
  FOR EACH ROW EXECUTE FUNCTION reassign_open_follow_ups();


-- ------------------------------------------------------------
-- STEP 6: the audit trail  ← Rule 10.2
--
-- Follow-ups are about to become editable (Rule 5.3) and "missed" is about to
-- become consequential (Rule 2.3, per-exec counts the owner judges the team
-- on). Without a trail, a due date can be moved backwards to make a missed
-- follow-up look on-time and nothing records it.
--
-- Same shape and same reasoning as lead_change_log: trigger-written only,
-- append-only, SECURITY DEFINER so it cannot be bypassed by whoever holds
-- the UPDATE right. Note lead_change_log.field's CHECK deliberately excludes
-- next_followup_date; now that the column is derived (STEP 4) that is
-- correct — the real event is recorded here instead.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_up_change_log (
  id            SERIAL      PRIMARY KEY,
  follow_up_id  INTEGER     NOT NULL REFERENCES follow_ups(id) ON DELETE CASCADE,
  changed_by    INTEGER     REFERENCES employees(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  field         TEXT        NOT NULL CHECK (field IN
                              ('created','status','due_date','due_time',
                               'title','notes','activity_type','assigned_to')),
  old_value     TEXT,   -- NULL for 'created'
  new_value     TEXT
);

CREATE INDEX IF NOT EXISTS idx_fu_change_log_fu_at ON follow_up_change_log (follow_up_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fu_change_log_by_at ON follow_up_change_log (changed_by, changed_at DESC);

CREATE OR REPLACE FUNCTION log_follow_up_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor INTEGER := current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, new_value)
    VALUES (NEW.id, COALESCE(actor, NEW.created_by), 'created', NEW.status);
    RETURN NULL;
  END IF;

  IF NEW.status       IS DISTINCT FROM OLD.status       THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.due_date     IS DISTINCT FROM OLD.due_date     THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'due_date', OLD.due_date::TEXT, NEW.due_date::TEXT);
  END IF;
  IF NEW.due_time     IS DISTINCT FROM OLD.due_time     THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'due_time', OLD.due_time::TEXT, NEW.due_time::TEXT);
  END IF;
  IF NEW.title        IS DISTINCT FROM OLD.title        THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'title', OLD.title, NEW.title);
  END IF;
  IF NEW.notes        IS DISTINCT FROM OLD.notes        THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'notes', OLD.notes, NEW.notes);
  END IF;
  IF NEW.activity_type IS DISTINCT FROM OLD.activity_type THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'activity_type', OLD.activity_type, NEW.activity_type);
  END IF;
  IF NEW.assigned_to  IS DISTINCT FROM OLD.assigned_to  THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'assigned_to', OLD.assigned_to::TEXT, NEW.assigned_to::TEXT);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS follow_up_change_log_ins ON follow_ups;
CREATE TRIGGER follow_up_change_log_ins
  AFTER INSERT ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION log_follow_up_changes();

DROP TRIGGER IF EXISTS follow_up_change_log_upd ON follow_ups;
CREATE TRIGGER follow_up_change_log_upd
  AFTER UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION log_follow_up_changes();


-- ------------------------------------------------------------
-- STEP 7: promote the orphaned lead dates  ← Rule 10.1
--
-- Leads carrying a next_followup_date with NO follow_ups row at all. 21 of
-- them when this was written. They are real intentions somebody recorded, so
-- they are promoted rather than cleared — but nobody knows who set them or
-- why, so the generated title and the inferred assignee are MARKED as such in
-- notes. This app's standing rule is that a guessed value must never be
-- indistinguishable from a real one.
--
-- Deliberately NOT promoting leads that already have a follow-up which is
-- merely done: there, the stale date exists precisely BECAUSE the reminder
-- was completed (markFollowUpDone never cleared the column). Promoting those
-- would resurrect finished work as new open reminders. The recompute at the
-- end of this step is what clears them instead.
--
-- Skips leads with no owner — assigned_to/created_by are NOT NULL and there
-- is nobody honest to attribute them to. Any such lead simply has its date
-- cleared by the recompute below.
-- ------------------------------------------------------------
INSERT INTO follow_ups (assigned_to, created_by, lead_id, party_id, title, notes, due_date, status)
SELECT l.owner_employee_id,
       l.owner_employee_id,
       l.id,
       l.party_id,
       'Follow up',
       'Migrated from the lead''s follow-up date on 2026-08-21. The original '
       || 'author and intent were not recorded — this reminder was created by '
       || 'the migration, not by a person.',
       l.next_followup_date,
       'open'
  FROM leads l
 WHERE l.next_followup_date IS NOT NULL
   AND l.owner_employee_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.lead_id = l.id);

-- One-time full recompute. After the promotion above, every lead that should
-- carry a date has an open follow-up backing it; this NULLs the date on every
-- lead whose follow-ups are all closed (or which had no owner to promote to),
-- bringing the whole table in line with Rule 1.2.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM leads WHERE next_followup_date IS NOT NULL LOOP
    PERFORM sync_lead_next_followup(r.id);
  END LOOP;
END $$;


-- ------------------------------------------------------------
-- STEP 8: indexes
--
-- lead_id was never indexed, though fetchLatestFollowUpForLead filters on it
-- on every single Lead Detail page load. Every other FK in this schema is
-- indexed; this one was missed.
--
-- The name collision: idx_follow_ups_assigned_due is declared twice with
-- DIFFERENT definitions — tostem_crm_schema.sql:394 with a
-- `WHERE is_done = false` partial clause, migration_lead_change_log.sql:121
-- without it. Both use IF NOT EXISTS, so whichever ran first won silently and
-- which one is live cannot be determined without pg_indexes. Dropped and
-- recreated here, unambiguously and WITHOUT the partial clause, because
-- fetchFollowUpsForEmployee reads done rows too and a partial index cannot
-- serve it.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead ON follow_ups (lead_id);

DROP INDEX IF EXISTS idx_follow_ups_assigned_due;
CREATE INDEX idx_follow_ups_assigned_due ON follow_ups (assigned_to, due_date);

-- Replaces idx_follow_ups_due_notify, whose WHERE clause references is_done.
-- status is the real filter now, and the Edge Function's new query is
-- (status='open' AND notified_at IS NULL ORDER BY due_date).
DROP INDEX IF EXISTS idx_follow_ups_due_notify;
CREATE INDEX idx_follow_ups_due_notify ON follow_ups (due_date, due_time)
  WHERE status = 'open' AND notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_status_due ON follow_ups (status, due_date);


-- ------------------------------------------------------------
-- STEP 9: RLS + grants for follow_up_change_log
--
-- Visibility mirrors follow_ups exactly — you can read the history of a
-- reminder you can read. The three predicates are the same three that guard
-- follow_ups itself (own / owner role / team member), reached through a join
-- since the log carries no assigned_to of its own.
--
-- Append-only, and enforced at BOTH layers: no INSERT/UPDATE/DELETE policy
-- and no grant for those verbs. The SECURITY DEFINER trigger is the only
-- writer. The explicit REVOKE matters — rls_policies.sql STEP A sets ALTER
-- DEFAULT PRIVILEGES granting all four verbs on new tables to authenticated,
-- so a table created after it arrives broadly writable unless told otherwise.
-- migration_lead_change_log.sql learned this the same way and still missed
-- TRUNCATE; this one does not.
-- ------------------------------------------------------------
ALTER TABLE follow_up_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visible_with_its_follow_up" ON follow_up_change_log;
CREATE POLICY "visible_with_its_follow_up" ON follow_up_change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM follow_ups f
       WHERE f.id = follow_up_change_log.follow_up_id
         AND (
           f.assigned_to = current_employee_id()
           OR current_employee_role() = 'owner'
           OR is_my_team_member(f.assigned_to)
         )
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON follow_up_change_log FROM authenticated;
GRANT SELECT ON follow_up_change_log TO authenticated;

-- service_role is NOT auto-granted on this project (supabase/config.toml's
-- auto_expose_new_tables). The Edge Function does not read this table today,
-- but grant SELECT so a future admin/reporting job doesn't hit the same
-- "the RLS-bypass role can't read its own table" failure this repo already
-- documents.
GRANT SELECT ON follow_up_change_log TO service_role;

-- PostgREST caches the schema; without this the new table and columns may not
-- be visible to the Data API until the next natural refresh.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- STEP 10: VERIFICATION — run these after, they should all pass.
-- ============================================================
--
-- 1. New columns exist:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'follow_ups'
--    AND column_name IN ('status','cancel_reason','cancelled_at','completed_by_activity_id')
--  ORDER BY column_name;
--
-- 2. status and is_done agree on every row (must return 0):
-- SELECT count(*) FROM follow_ups WHERE is_done <> (status = 'done');
--
-- 3. Rule 1.2 holds — every lead's date equals its earliest open follow-up
--    (must return 0 rows):
-- SELECT l.id, l.next_followup_date,
--        (SELECT MIN(due_date) FROM follow_ups f WHERE f.lead_id = l.id AND f.status='open') AS should_be
--   FROM leads l
--  WHERE l.next_followup_date IS DISTINCT FROM
--        (SELECT MIN(due_date) FROM follow_ups f WHERE f.lead_id = l.id AND f.status='open');
--
-- 4. No orphans left (must return 0):
-- SELECT count(*) FROM leads l
--  WHERE l.next_followup_date IS NOT NULL
--    AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.lead_id = l.id AND f.status='open');
--
-- 5. The promoted rows, clearly marked:
-- SELECT id, lead_id, assigned_to, due_date, title FROM follow_ups
--  WHERE notes LIKE 'Migrated from the lead%' ORDER BY id;
--
-- 6. Triggers installed (expect 5 on follow_ups, 1 on leads):
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
--  WHERE NOT tgisinternal AND tgrelid IN ('follow_ups'::regclass, 'leads'::regclass)
--  ORDER BY tgrelid::regclass::text, tgname;
--
-- 7. Audit trail is append-only for authenticated (expect SELECT only):
-- SELECT privilege_type FROM information_schema.role_table_grants
--  WHERE table_name = 'follow_up_change_log' AND grantee = 'authenticated';
--
-- 8. Reschedule clears notified_at — pick a notified row and move it:
-- UPDATE follow_ups SET due_date = due_date + 1 WHERE id = <a notified id>
--   RETURNING id, due_date, notified_at;   -- notified_at must come back NULL
