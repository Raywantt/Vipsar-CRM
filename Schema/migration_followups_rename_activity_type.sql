-- ------------------------------------------------------------
-- Rename follow_ups.activity_type -> follow_ups.planned_activity_type.
--
-- Follow-ups audit finding, owner's ruling 2026-09-18: activity_type meant
-- two different things depending on which table you were looking at.
-- activities.activity_type is what someone actually DID (unchanged by this
-- file). follow_ups.activity_type was what a reminder is FOR — the kind of
-- activity it anticipates, set when the reminder is created and read again
-- to decide which "Log activity & close" screen to send someone to. Same
-- column name, same shared value list, genuinely different meaning — this
-- rename makes the schema itself say so instead of relying on which table
-- you remembered you were reading.
--
-- ⚠️ DEPLOY ORDER — this migration MUST run before the matching code change
-- goes live (App.jsx code is untouched; only src/lib/followUpQueries.js's
-- FOLLOW_UP_SELECT, createFollowUp and updateFollowUp reference the raw
-- column name). Run this FIRST. The app code keeps reading and writing
-- `f.activity_type` in JS everywhere else — FOLLOW_UP_SELECT aliases the
-- renamed column back to that same key
-- (`activity_type:planned_activity_type`), so nothing outside
-- followUpQueries.js needs to change. But until this migration has run,
-- the aliased select would ask PostgREST for a column that doesn't exist
-- yet and every follow-ups query in the app — Home, Dashboard, Lead
-- Detail, Profile, all five roles — would fail at once. Safe once this has
-- run; not safe before.
--
-- Safe to re-run whole.
-- ------------------------------------------------------------

-- 1) The rename itself. Postgres updates the existing CHECK constraint's
--    internal reference automatically — no separate ALTER needed for that —
--    but the constraint's own NAME is renamed too, purely for readability
--    when someone next reads \d follow_ups.
ALTER TABLE follow_ups RENAME COLUMN activity_type TO planned_activity_type;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'follow_ups_activity_type_check'
  ) THEN
    ALTER TABLE follow_ups
      RENAME CONSTRAINT follow_ups_activity_type_check TO follow_ups_planned_activity_type_check;
  END IF;
END $$;

-- 2) follow_up_change_log.field's CHECK gains the new label so the audit
--    trigger below can log changes under it going forward. The OLD label
--    ('activity_type') stays legal too — historical rows already used it,
--    and rewriting years of audit history for a rename is not worth doing.
ALTER TABLE follow_up_change_log DROP CONSTRAINT IF EXISTS follow_up_change_log_field_check;
ALTER TABLE follow_up_change_log ADD CONSTRAINT follow_up_change_log_field_check
  CHECK (field IN
    ('created','status','due_date','due_time','title','notes',
     'activity_type','planned_activity_type','assigned_to'));

-- 3) The audit trigger (Schema/migration_followups_rebuild.sql) — same
--    function, same trigger wiring, just reading/writing the renamed
--    column and logging under the new field label from here on.
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
  IF NEW.planned_activity_type IS DISTINCT FROM OLD.planned_activity_type THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'planned_activity_type', OLD.planned_activity_type, NEW.planned_activity_type);
  END IF;
  IF NEW.assigned_to  IS DISTINCT FROM OLD.assigned_to  THEN
    INSERT INTO follow_up_change_log (follow_up_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'assigned_to', OLD.assigned_to::TEXT, NEW.assigned_to::TEXT);
  END IF;

  RETURN NULL;
END;
$$;

-- 4) The hold-review identifier (Schema/migration_followups_cancel_rules.sql)
--    — same function, same trigger wiring, just the renamed column. The
--    ONE-TIME cleanup UPDATE in that file already ran and needs no re-run;
--    only the function definition (which fires on every future off-hold
--    transition) needs the fix.
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
       AND planned_activity_type = 'other'
       AND title LIKE 'On hold%';
    PERFORM set_config('app.system_follow_up_cancel', 'off', true);
  END IF;
  RETURN NULL;
END;
$$;

-- 5) PostgREST caches the schema; a renamed column needs the same nudge a
--    new relationship does (see CLAUDE.md's "DDL alone isn't enough").
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Verify (read-only)
-- ------------------------------------------------------------
-- Expect the new column, not the old one:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'follow_ups' AND column_name LIKE '%activity_type%';
