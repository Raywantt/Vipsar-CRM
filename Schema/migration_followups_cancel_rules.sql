-- ============================================================
-- Follow-up cancel rules (owner's rulings, 2026-09-16)
--
-- 1. A reminder someone else assigned can't be cancelled by the person it
--    was assigned to. They can still complete or reschedule it. The app
--    hides the Cancel button; this is the real boundary, since RLS is
--    row-level and the assignee holds UPDATE on their own rows.
--
-- 2. Marking a lead won or lost cancels its open reminders, with the reason
--    "Lead marked won" / "Lead marked lost". Reopening the lead later does
--    NOT reopen them. Taking a lead off hold cancels its open hold review.
--
-- 3. One-time: cancel the reminders already open on won/lost leads.
--
-- Triggers only — no column the app selects is added — so this can run
-- before or after the deploy. Safe to re-run.
--
-- Runs AFTER migration_followups_rebuild.sql (it relies on its status
-- column, cancel_reason CHECK and sync_follow_up_status trigger).
-- ============================================================


-- ------------------------------------------------------------
-- 1. Assignee can't cancel an assigned reminder
--
-- current_employee_id() is NULL for admin SQL (no auth.uid()), so the SQL
-- Editor is unaffected. The won/lost trigger below sets
-- app.system_follow_up_cancel for its own statement, because the person
-- marking the lead won is usually that same assignee.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_assigned_follow_up_cancel()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND OLD.created_by IS NOT NULL
     AND OLD.created_by <> OLD.assigned_to
     AND current_setting('app.system_follow_up_cancel', true) IS DISTINCT FROM 'on'
     AND current_employee_id() IS NOT NULL
     AND current_employee_id() = OLD.assigned_to
  THEN
    RAISE EXCEPTION 'This reminder was assigned to you by someone else, so only they can cancel it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follow_up_enforce_assigned_cancel ON follow_ups;
CREATE TRIGGER follow_up_enforce_assigned_cancel
  BEFORE UPDATE OF status ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION enforce_assigned_follow_up_cancel();


-- ------------------------------------------------------------
-- 2. Won / lost cancels the lead's open reminders
--
-- SECURITY DEFINER for the same reason sync_lead_next_followup is: the
-- person closing the lead may not be able to UPDATE every reminder on it
-- (an owner-assigned one, a coordinator's). follow_up_change_log still
-- records the real actor, since current_employee_id() reads the session.
-- ------------------------------------------------------------
--
-- 2b (added 2026-09-16, same function): taking a lead OFF hold for any open
-- stage cancels its open hold review, reason "Lead taken off hold". Without
-- it the "On hold — …" reminder stayed open, pushed on its date and then
-- counted as missed. Identified the way Lead Detail identifies it: created
-- by the On Hold flow, i.e. activity_type 'other' AND title 'On hold%'. Other
-- reminders on the lead are left alone. on_hold -> won/lost is covered by
-- the branch above, which cancels everything.
CREATE OR REPLACE FUNCTION cancel_follow_ups_on_lead_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN
    RETURN NULL;
  END IF;

  IF NEW.current_stage IN ('won', 'lost') THEN
    PERFORM set_config('app.system_follow_up_cancel', 'on', true);
    UPDATE follow_ups
       SET status = 'cancelled',
           cancel_reason = 'Lead marked ' || NEW.current_stage
     WHERE lead_id = NEW.id
       AND status = 'open';
    PERFORM set_config('app.system_follow_up_cancel', 'off', true);
  ELSIF OLD.current_stage = 'on_hold' THEN
    PERFORM set_config('app.system_follow_up_cancel', 'on', true);
    UPDATE follow_ups
       SET status = 'cancelled',
           cancel_reason = 'Lead taken off hold'
     WHERE lead_id = NEW.id
       AND status = 'open'
       AND activity_type = 'other'
       AND title LIKE 'On hold%';
    PERFORM set_config('app.system_follow_up_cancel', 'off', true);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS lead_close_cancels_follow_ups ON leads;
CREATE TRIGGER lead_close_cancels_follow_ups
  AFTER UPDATE OF current_stage ON leads
  FOR EACH ROW EXECUTE FUNCTION cancel_follow_ups_on_lead_close();


-- ------------------------------------------------------------
-- 3. One-time cleanup: reminders already open on won/lost leads
--    (7 of them on 2026-09-16).
-- ------------------------------------------------------------
UPDATE follow_ups f
   SET status = 'cancelled',
       cancel_reason = 'Lead marked ' || l.current_stage
  FROM leads l
 WHERE f.lead_id = l.id
   AND f.status = 'open'
   AND l.current_stage IN ('won', 'lost');

-- Hold reviews left open on leads no longer on hold (none on 2026-09-16).
UPDATE follow_ups f
   SET status = 'cancelled',
       cancel_reason = 'Lead taken off hold'
  FROM leads l
 WHERE f.lead_id = l.id
   AND f.status = 'open'
   AND f.activity_type = 'other'
   AND f.title LIKE 'On hold%'
   AND l.current_stage IS DISTINCT FROM 'on_hold';


-- ------------------------------------------------------------
-- Verify (read-only)
-- ------------------------------------------------------------
-- Expect 0:
-- SELECT count(*) FROM follow_ups f JOIN leads l ON l.id = f.lead_id
--  WHERE f.status = 'open' AND l.current_stage IN ('won', 'lost');
--
-- Expect both triggers listed:
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
--  WHERE tgname IN ('follow_up_enforce_assigned_cancel', 'lead_close_cancels_follow_ups');
--
-- Rule 1 must be checked as a real logged-in sales exec, not from the SQL
-- Editor (which has no auth.uid(), so the trigger lets everything through).
