-- ============================================================
-- MIGRATION: RFQ desk — a revision's approval moves the lead too
-- (RFQ-DESK.md Step 3, 2026-10-06)
--
-- WHAT: rfqs_after_write() moved a lead to 'rfq' on approval only when the
-- approved RFQ was FRESH. A lead whose fresh RFQ was sent back has its
-- corrected revision approved instead — and stayed at 'calling' with an
-- approved RFQ on file, in no stage anyone would look for it. Now the lead's
-- first approved RFQ moves it, whatever its kind (a price revision never
-- does: it re-quotes a lead that is already quoted). The stage test
-- (calling / presentation / joinery follow-up only) is what stops a second
-- move, exactly as before — verify_rfq_desk.sql's T26 still holds, and its
-- new T16b proves this case.
--
-- The only change from migration_rfq_desk.sql's copy is the v_advance line;
-- that file now carries the same line, so re-running it keeps this fix.
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run. Then run
-- Schema/verify_rfq_desk.sql and read its report (expect T16b PASS).
-- ============================================================

CREATE OR REPLACE FUNCTION rfqs_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor       integer := current_employee_id();
  skip_notify boolean := coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on';
  v_action    text;
  v_from      text;
  v_stage     text;
  v_advance   boolean;
  v_raised_on date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := CASE WHEN NEW.kind = 'price_revision' THEN 'price_revision_started' ELSE 'raised' END;
    v_from   := NULL;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_from   := OLD.status;
    v_action := CASE
      WHEN OLD.status = 'with_technical'  AND NEW.status = 'with_estimation' THEN 'approved'
      WHEN NEW.status = 'sent_back'                                         THEN 'sent_back'
      WHEN OLD.status = 'with_estimation' AND NEW.status = 'with_lixil'      THEN 'raised_with_lixil'
      WHEN OLD.status = 'with_lixil'      AND NEW.status = 'quoted'          THEN 'quoted'
      WHEN NEW.status = 'withdrawn'                                         THEN 'withdrawn'
      ELSE 'status_changed'
    END;
  ELSE
    RETURN NULL;   -- no status change, nothing to record
  END IF;

  INSERT INTO rfq_events (rfq_id, lead_id, is_test, action, from_status, to_status, actor_employee_id, note)
  VALUES (NEW.id, NEW.lead_id, NEW.is_test, v_action, v_from, NEW.status,
          COALESCE(actor, CASE WHEN TG_OP = 'INSERT' THEN NEW.logged_by_employee_id END),
          CASE WHEN v_action = 'sent_back' THEN NEW.send_back_note END);

  -- ---- lead side effects ----
  IF v_action = 'approved' THEN
    SELECT current_stage INTO v_stage FROM leads WHERE id = NEW.lead_id;
    -- The lead's FIRST approved RFQ moves it, whatever its kind: a revision
    -- whose fresh RFQ was sent back is the RFQ that actually passed
    -- (migration_rfq_desk_advance_fix.sql, 2026-10-06 — it used to be
    -- fresh-only, which left such a lead at 'calling'). The stage test is what
    -- stops a second move; a price revision never applies (it re-quotes).
    v_advance := NEW.kind <> 'price_revision'
                 AND COALESCE(v_stage, 'calling') IN ('calling','presentation','joinery_follow_up');
    v_raised_on := (NEW.raised_at AT TIME ZONE 'Asia/Kolkata')::date;

    PERFORM set_config('app.rfq_desk_stage_change', 'on', true);
    UPDATE leads
       SET rfq_raised    = true,
           rfq_raised_at = GREATEST(COALESCE(rfq_raised_at, v_raised_on), v_raised_on),
           current_stage = CASE WHEN v_advance THEN 'rfq' ELSE current_stage END
     WHERE id = NEW.lead_id;
    PERFORM set_config('app.rfq_desk_stage_change', 'off', true);

    IF v_advance THEN
      INSERT INTO stage_history (lead_id, stage, changed_by) VALUES (NEW.lead_id, 'rfq', actor);
    END IF;
  END IF;

  IF v_action = 'quoted' THEN
    UPDATE leads SET quote_value = NEW.quote_value WHERE id = NEW.lead_id;
  END IF;

  -- ---- notifications ----
  IF skip_notify THEN
    RETURN NULL;
  END IF;

  IF v_action = 'raised' THEN
    INSERT INTO notifications (employee_id, kind, lead_id, rfq_id, actor_employee_id)
    SELECT e.id, 'rfq_new', NEW.lead_id, NEW.id, actor
      FROM employees e
     WHERE e.role = 'production_executive' AND e.is_active
       AND e.is_test_account = NEW.is_test
       AND e.id IS DISTINCT FROM actor;

  ELSIF v_action = 'approved' THEN
    INSERT INTO notifications (employee_id, kind, lead_id, rfq_id, actor_employee_id)
    SELECT e.id, 'rfq_approved', NEW.lead_id, NEW.id, actor
      FROM employees e
     WHERE e.role = 'estimation_executive' AND e.is_active
       AND e.is_test_account = NEW.is_test
       AND e.id IS DISTINCT FROM actor;

  ELSIF v_action IN ('sent_back', 'quoted') THEN
    INSERT INTO notifications (employee_id, kind, lead_id, rfq_id, actor_employee_id)
    SELECT DISTINCT x.id,
           CASE WHEN v_action = 'sent_back' THEN 'rfq_sent_back' ELSE 'rfq_quote_ready' END,
           NEW.lead_id, NEW.id, actor
      FROM (VALUES (NEW.raised_by_employee_id), (NEW.logged_by_employee_id)) AS x(id)
      JOIN employees e ON e.id = x.id AND e.is_active
     WHERE x.id IS DISTINCT FROM actor;

    IF v_action = 'sent_back' AND v_from = 'with_estimation'
       AND NEW.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM actor THEN
      INSERT INTO notifications (employee_id, kind, lead_id, rfq_id, actor_employee_id)
      SELECT e.id, 'rfq_bounced', NEW.lead_id, NEW.id, actor
        FROM employees e
       WHERE e.id = NEW.approved_by AND e.is_active;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;
