-- ------------------------------------------------------------
-- Fix reassign_open_follow_ups() so it only moves the PREVIOUS
-- owner's own reminders, not every open reminder on the lead.
--
-- Follow-ups audit finding (CLAUDE.md, 2026-09-16/18): a BDM pool lead's
-- owner_employee_id goes NULL -> rep on first assignment, which this
-- trigger treats as an ordinary reassignment. Its old WHERE clause moved
-- every open follow-up on the lead to the new owner regardless of who it
-- was assigned to — including a reminder the BDM set for THEMSELVES to
-- keep tracking the architect relationship (BDM.md's "Set follow-up" on a
-- pool lead). That silently handed the BDM's own reminder to the rep,
-- contradicting the documented rule that a BDM's pool reminder should stay
-- theirs after handoff.
--
-- The fix: only move a reminder that was actually assigned to the OLD
-- owner. For a normal reassignment (A -> B) that is every reminder A held
-- on this lead, same as before. For a pool lead's first assignment
-- (NULL -> B), OLD.owner_employee_id is NULL, and `assigned_to = NULL` is
-- never true in SQL — so nothing on the lead moves, and a BDM's own
-- reminder (assigned_to = the BDM, not NULL) is correctly left alone.
--
-- Safe to re-run whole.
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
       AND assigned_to = OLD.owner_employee_id;
  END IF;
  RETURN NULL;
END;
$$;
