-- ============================================================
-- MIGRATION: the RFQ desk — tables, rules, visibility, notifications
-- (RFQ-DESK.md Step 1, 2026-10-06)
--
-- WHAT THIS ADDS
--   * activities.rfq_window_count / rfq_segments — what the exec's RFQ Raised
--     form will ask (Step 3). Optional here: an RFQ logged without them (the
--     current form, an import) still reaches the desk.
--   * rfq_desk_settings — the desk's on/off switch (STEP 1b). While it is off,
--     nothing enters the desk. Once on, EVERY RFQ Raised activity on a lead,
--     whoever logs it (exec, coordinator, manager, BDM), becomes a desk RFQ
--     and alerts the Production Executive (trigger, STEP 5).
--   * rfqs        — one row per RFQ submission (each revision its own row),
--                   moving with_technical → with_estimation → with_lixil →
--                   quoted, or out to sent_back / withdrawn.
--   * rfq_events  — append-only history of every move, trigger-written.
--   * Six functions the app calls for every desk action (STEP 8): approve,
--     send back, raise with Lixil, record quote, withdraw, start price
--     revision. They are the ONLY way to change an RFQ — nobody holds an
--     INSERT/UPDATE/DELETE grant on either table.
--   * Read access for the Production / Estimation Executive to every lead
--     that has an RFQ: the lead, its client and other parties, site, site
--     contacts and stage history (STEP 9). Nothing else, and no edits.
--   * notifications: an rfq_id column and five new kinds (STEP 4).
--
-- WHAT IT CHANGES THAT ALREADY EXISTS — read before re-running anything:
--   * enforce_owner_only_stage_change() is re-installed with ONE new early
--     exit: the desk's own approval step sets a transaction-local flag
--     (app.rfq_desk_stage_change) and may move a lead to 'rfq'. Without it
--     the Production Executive's approval would be refused ("You do not have
--     permission to change a lead's stage"). Everything else in that function
--     is the migration_bdm_role.sql copy, verbatim.
--       ⚠ Re-running migration_bdm_role.sql, migration_retire_measurements_
--       design_discussion.sql or any older file that defines that function
--       removes the exit, and approvals then fail loudly. Re-run THIS file
--       straight after.
--   * notifications_kind_check is widened. ⚠ Re-running
--     migration_bdm_handoff.sql / migration_bdm_role.sql /
--     migration_lead_remarks_and_lixil_notify.sql re-creates it without the
--     rfq_* kinds and FAILS once any rfq_* notification exists. Re-run THIS
--     file straight after.
--
-- WHEN THE DESK STARTS RECEIVING RFQs: when the owner turns it on, on launch
-- day (owner's ruling, 2026-10-06 — a clean start: no backlog of RFQs that
-- are also being tracked in Excel, and no RFQ counted toward a target under
-- both the old and the new rule). Running this file leaves it OFF, so it
-- changes nothing anyone sees today. To turn it on (launch day only):
--     UPDATE rfq_desk_settings SET live_from = now();
-- and off again (RFQs already in the desk stay there):
--     UPDATE rfq_desk_settings SET live_from = NULL;
--
-- TEST ACCOUNTS: an RFQ raised by a test login is a test RFQ (rfqs.is_test,
-- frozen at creation). A test desk login sees and works ONLY test RFQs, and
-- a real one only real RFQs, so the production-exec / estimation-exec test
-- logins can never approve or quote a real exec's RFQ. Owners see test RFQs
-- only with Profile → Test accounts switched on, as everywhere else.
--
-- ORDER: after migration_rfq_desk_roles.sql (the role values must exist —
-- STEP 0 checks). Independent of migration_rls_per_row_fixes.sql: every
-- policy here is new and additive.
--
-- VERIFY: Schema/verify_rfq_desk.sql, as real sessions (test logins).
-- Safe to re-run whole.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- STEP 0: guard — the two role values must already be legal
-- ------------------------------------------------------------
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'employees_role_check'
       AND pg_get_constraintdef(oid) LIKE '%estimation_executive%'
  ) THEN
    RAISE EXCEPTION 'Run Schema/migration_rfq_desk_roles.sql first, then re-run this file. Nothing was changed.';
  END IF;
END
$guard$;


-- ------------------------------------------------------------
-- STEP 1: what an RFQ Raised activity carries
--
-- Both columns are only legal on an rfq_raised activity. Segments are a
-- closed list (two-sided: the Step 3 JS list must match this one).
-- ------------------------------------------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS rfq_window_count INTEGER,
  ADD COLUMN IF NOT EXISTS rfq_segments     TEXT[];

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_rfq_details_check;
ALTER TABLE activities ADD CONSTRAINT activities_rfq_details_check CHECK (
  (rfq_window_count IS NULL OR (activity_type = 'rfq_raised' AND rfq_window_count > 0))
  AND
  (rfq_segments IS NULL OR (
     activity_type = 'rfq_raised'
     AND cardinality(rfq_segments) > 0
     AND rfq_segments <@ ARRAY['windows','giesta','in16','skylight','facade','wrapping_bars']::text[]
  ))
);


-- ------------------------------------------------------------
-- STEP 1b: the on/off switch
--
-- One row. live_from NULL = off; a time = on since then. Every employee can
-- read it — Step 3's Log Activity reads it to know whether an RFQ still
-- advances the lead at logging (desk off, today's behaviour) or waits for
-- the Production Executive's approval (desk on). Nobody can write it from
-- the app: the owner flips it in the SQL Editor.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfq_desk_settings (
  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  live_from  TIMESTAMPTZ
);
INSERT INTO rfq_desk_settings (id, live_from) VALUES (true, NULL)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON rfq_desk_settings FROM anon, authenticated;
GRANT SELECT ON rfq_desk_settings TO authenticated, service_role;
ALTER TABLE rfq_desk_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rfq_desk_settings_select" ON rfq_desk_settings;
CREATE POLICY "rfq_desk_settings_select" ON rfq_desk_settings FOR SELECT TO authenticated
  USING ((SELECT current_employee_id()) IS NOT NULL);

CREATE OR REPLACE FUNCTION rfq_desk_is_live()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT live_from IS NOT NULL AND live_from <= now() FROM rfq_desk_settings), false);
$$;


-- ------------------------------------------------------------
-- STEP 2: rfqs
--
-- status
--   with_technical  — waiting for the Production Executive
--   with_estimation — approved; waiting for the Estimation Executive
--   with_lixil      — raised with Lixil; waiting for the quote
--   quoted          — quote received (terminal)
--   sent_back       — bounced to the exec, by either desk step (terminal for
--                     this revision; the fix comes back as a new revision)
--   withdrawn       — taken back by the exec / whoever logged it (terminal)
--
-- kind: fresh / revised come from the activity's own rfq_kind (classified at
-- logging, rfqKind.js); price_revision is started by the Estimation
-- Executive when Lixil changes its prices and skips the technical check.
--
-- revision: how many RFQ Raised activities this lead had before this one
-- (0 = the first). Counts activities, not desk rows, so an RFQ logged before
-- the desk existed still counts. A price revision repeats the latest number.
--
-- window_count / segments: whatever the activity carried — blank for an RFQ
-- logged without them (the current form, an import). Step 3's form asks.
--
-- raised_by_employee_id = the exec the RFQ is credited to (the activity's
-- employee_id; for a price revision, the lead's owner). logged_by = who
-- pressed Save (a coordinator logging for an exec; the Estimation Executive
-- for a price revision). Both get the sent-back / quote-ready notifications.
--
-- Timestamps are TIMESTAMPTZ (PostgREST sends an offset; parseTimestamp
-- passes it through), unlike the older naive-UTC TIMESTAMP columns.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfqs (
  id                     SERIAL PRIMARY KEY,
  lead_id                INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_id            INTEGER REFERENCES activities(id) ON DELETE SET NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('fresh','revised','price_revision')),
  revision               INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  raised_by_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  logged_by_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_test                BOOLEAN NOT NULL DEFAULT false,
  window_count           INTEGER CHECK (window_count IS NULL OR window_count > 0),
  segments               TEXT[] NOT NULL DEFAULT '{}'
                           CHECK (segments <@ ARRAY['windows','giesta','in16','skylight','facade','wrapping_bars']::text[]),
  status                 TEXT NOT NULL DEFAULT 'with_technical'
                           CHECK (status IN ('with_technical','with_estimation','with_lixil',
                                             'quoted','sent_back','withdrawn')),
  raised_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at            TIMESTAMPTZ,
  approved_by            INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  sent_back_at           TIMESTAMPTZ,
  sent_back_by           INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  sent_back_from         TEXT CHECK (sent_back_from IS NULL OR sent_back_from IN ('technical','estimation')),
  send_back_note         TEXT CHECK (send_back_note IS NULL OR char_length(send_back_note) <= 1000),
  lixil_raised_at        TIMESTAMPTZ,
  lixil_raised_by        INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  quote_received_at      TIMESTAMPTZ,
  quote_received_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  quote_date             DATE,
  quote_ref              TEXT,
  quote_value            NUMERIC(14,2) CHECK (quote_value IS NULL OR quote_value > 0),
  withdrawn_at           TIMESTAMPTZ,
  withdrawn_by           INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A quoted RFQ always carries the quote.
  CONSTRAINT rfqs_quote_complete CHECK (
    status <> 'quoted' OR (quote_value IS NOT NULL AND quote_ref IS NOT NULL AND quote_date IS NOT NULL)
  ),
  -- A price revision never goes through the technical check.
  CONSTRAINT rfqs_price_revision_skips_technical CHECK (kind <> 'price_revision' OR status <> 'with_technical')
);

-- One desk RFQ per activity, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rfqs_activity ON rfqs (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfqs_lead ON rfqs (lead_id);
-- The queues: small, because quoted / sent back / withdrawn rows drop out.
CREATE INDEX IF NOT EXISTS idx_rfqs_open ON rfqs (status, raised_at)
  WHERE status IN ('with_technical','with_estimation','with_lixil');


-- ------------------------------------------------------------
-- STEP 3: rfq_events — append-only, written only by rfqs_after_write()
--
-- lead_id and is_test are copied from the RFQ so the history can be read and
-- hidden without a join. action:
--   raised / price_revision_started   — the row was created
--   approved                          — with_technical → with_estimation
--   sent_back                         — note = the optional send-back note
--   raised_with_lixil, quoted, withdrawn
--   status_changed                    — any other move (admin SQL only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfq_events (
  id                 SERIAL PRIMARY KEY,
  rfq_id             INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  lead_id            INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  is_test            BOOLEAN NOT NULL DEFAULT false,
  action             TEXT NOT NULL CHECK (action IN ('raised','price_revision_started','approved',
                                                     'sent_back','raised_with_lixil','quoted',
                                                     'withdrawn','status_changed')),
  from_status        TEXT,
  to_status          TEXT NOT NULL,
  actor_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_events_rfq ON rfq_events (rfq_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rfq_events_lead ON rfq_events (lead_id);


-- ------------------------------------------------------------
-- STEP 4: notifications — rfq_id + five kinds
--
--   rfq_new          — new RFQ → every active Production Executive
--   rfq_approved     — approved → every active Estimation Executive
--   rfq_sent_back    — sent back (either step) → the exec + whoever logged it
--   rfq_bounced      — sent back at estimation → the Production Executive
--                      who approved it
--   rfq_quote_ready  — quote recorded → the exec + whoever logged it
--
-- Nothing renders or pushes these until Step 3 teaches the app and the Edge
-- Function about them (both filter on explicit kind lists, so unknown kinds
-- are ignored, never mis-rendered). The list below is
-- migration_bdm_handoff.sql's current one plus the five.
-- ------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS rfq_id INTEGER REFERENCES rfqs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_rfq ON notifications (rfq_id) WHERE rfq_id IS NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('lead_assigned', 'lixil_lead_created',
                  'bdm_pool_lead', 'bdm_pool_nudge',
                  'bdm_lead_assigned', 'bdm_lead_won', 'bdm_lead_lost',
                  'rfq_new', 'rfq_approved', 'rfq_sent_back', 'rfq_bounced', 'rfq_quote_ready'));


-- ------------------------------------------------------------
-- STEP 5: every RFQ Raised activity → a desk RFQ (while the desk is on)
--
-- Owner's ruling (2026-10-06): whenever ANYONE logs an RFQ Raised on a lead,
-- it goes to the Production Executive's desk and alerts them — with or
-- without the window count / segments. A trigger, not app code: ActivityLog
-- is the only writer today, but the first forgotten call site would be an
-- RFQ that silently never reaches Harjot. AFTER INSERT, so the activity row
-- (and the logged_by stamp from stamp_activity_logger, a BEFORE trigger)
-- already exists. The rfq_new alert is written by rfqs_after_write().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION rfq_from_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.activity_type <> 'rfq_raised' OR NEW.lead_id IS NULL OR NOT rfq_desk_is_live() THEN
    RETURN NULL;
  END IF;

  INSERT INTO rfqs (lead_id, activity_id, kind, revision,
                    raised_by_employee_id, logged_by_employee_id, is_test,
                    window_count, segments)
  VALUES (
    NEW.lead_id,
    NEW.id,
    COALESCE(NEW.rfq_kind, 'fresh'),
    (SELECT count(*) FROM activities a
      WHERE a.lead_id = NEW.lead_id AND a.activity_type = 'rfq_raised' AND a.id < NEW.id),
    NEW.employee_id,
    COALESCE(NEW.logged_by_employee_id, NEW.employee_id),
    COALESCE((SELECT e.is_test_account FROM employees e WHERE e.id = NEW.employee_id), false),
    NEW.rfq_window_count,
    COALESCE(NEW.rfq_segments, '{}')
  );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rfq_from_activity ON activities;
CREATE TRIGGER rfq_from_activity
  AFTER INSERT ON activities
  FOR EACH ROW
  EXECUTE FUNCTION rfq_from_activity();


-- ------------------------------------------------------------
-- STEP 6: enforce_owner_only_stage_change() — the desk's one exit
--
-- VERBATIM the migration_bdm_role.sql copy, plus the block marked RFQ DESK.
-- The flag is set (transaction-local) only inside rfqs_after_write() around
-- its own UPDATE of the lead, and reset straight after. No client can set it:
-- PostgREST exposes no way to set an arbitrary setting, and no function here
-- sets it from an argument. Same trust model as
-- app.skip_assignment_notifications.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The 6 sequential funnel stages. Mirrors FUNNEL_SEQUENCE in
  -- src/lib/stageProgress.js — keep the two in step. (measurements and
  -- design_discussion retired 2026-09-08.)
  seq CONSTANT text[] := ARRAY[
    'calling','presentation','joinery_follow_up',
    'rfq','quote_submission','negotiation'
  ];
  caller_role text;
  from_stage  text;
  from_rank   int;
  to_rank     int;
BEGIN
  IF NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN
    RETURN NEW;
  END IF;

  -- RFQ DESK (migration_rfq_desk.sql): an approved RFQ moving its lead to
  -- 'rfq'. rfqs_after_write() has already decided the move is forward.
  IF COALESCE(current_setting('app.rfq_desk_stage_change', true), 'off') = 'on'
     AND NEW.current_stage = 'rfq' THEN
    RETURN NEW;
  END IF;

  -- Admin SQL run in the Supabase SQL Editor has no auth.uid(), so
  -- current_employee_role() is NULL there — without this, bulk stage fixes
  -- run by hand would abort. A deactivated employee has a real auth.uid()
  -- but a NULL role, so they are still caught by the role test below.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := COALESCE(current_employee_role(), '');

  IF caller_role NOT IN ('owner','sales_coordinator','sales_executive','sales_manager',
                         'business_development_manager') THEN
    RAISE EXCEPTION 'You do not have permission to change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Owner and coordinator move a stage in any direction, including back.
  IF caller_role IN ('owner','sales_coordinator') THEN
    RETURN NEW;
  END IF;

  -- A BDM on their own still-unassigned pool lead: any direction.
  IF caller_role = 'business_development_manager'
     AND OLD.owner_employee_id IS NULL
     AND OLD.bdm_employee_id IS NOT DISTINCT FROM current_employee_id() THEN
    RETURN NEW;
  END IF;

  -- ---- sales_executive, sales_manager, and a BDM on a lead they own:
  -- ---- forward only, from here down

  -- Reopening a decided deal moves money back out of a reported figure.
  -- Treated as the largest reversal there is, whatever it reopens into.
  IF OLD.current_stage IN ('won','lost') THEN
    RAISE EXCEPTION
      'This deal is already marked %. Ask a coordinator or the owner to reopen it.',
      OLD.current_stage
      USING ERRCODE = 'check_violation';
  END IF;

  -- An on-hold lead is ranked at the stage it actually paused at, so a
  -- detour through On hold cannot launder a backward move (negotiation ->
  -- on_hold -> calling). Same derivation LeadDetail's stepper uses: the
  -- most recent non-on-hold history row, falling back to 'calling' for a
  -- lead never explicitly moved (its 'calling' is a column DEFAULT, not a
  -- logged change, so no stage_history row exists for it).
  IF OLD.current_stage = 'on_hold' THEN
    SELECT sh.stage INTO from_stage
      FROM stage_history sh
     WHERE sh.lead_id = OLD.id
       AND sh.stage <> 'on_hold'
     ORDER BY sh.changed_at DESC
     LIMIT 1;
    from_stage := COALESCE(from_stage, 'calling');
  ELSE
    from_stage := OLD.current_stage;
  END IF;

  from_rank := array_position(seq, from_stage);
  to_rank   := array_position(seq, NEW.current_stage);

  -- An off-funnel destination (on_hold / won / lost) has no rank and is
  -- never "backward" — pausing or closing a deal is always allowed. An
  -- unrecognised legacy current_stage has no rank either — left alone
  -- rather than guessed at.
  IF from_rank IS NOT NULL AND to_rank IS NOT NULL AND to_rank < from_rank THEN
    RAISE EXCEPTION
      'You can only move a lead forward. Ask a coordinator or the owner to move it back.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_only_stage_change ON leads;
CREATE TRIGGER owner_only_stage_change
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_only_stage_change();


-- ------------------------------------------------------------
-- STEP 7: rfqs_after_write() — history, lead side effects, notifications
--
-- Fires on every insert and on every status change, whoever made it (the
-- action functions in STEP 8, or admin SQL). One place, so no path can
-- change an RFQ without leaving history or skipping a notification.
--
-- LEAD SIDE EFFECTS
--   approved — lead.rfq_raised = true, rfq_raised_at = the later of its own
--              date and this RFQ's raised date; and a FRESH RFQ moves a lead
--              still before RFQ in the funnel to 'rfq' with a stage_history
--              row, credited to whoever approved. Exactly shouldAdvanceToRfq
--              (rfqKind.js): never on_hold / won / lost, never a lead already
--              at or past RFQ, never an unrecognised legacy stage.
--   quoted   — lead.quote_value = this quote (owner's ruling: the
--              Estimation Executive's figure IS the lead's quote value).
--              quote_sent / quote_sent_at stay the exec's: received from
--              Lixil is not the same as submitted to the client.
--
-- Notifications respect app.skip_assignment_notifications, like every other
-- notification trigger. A desk notification only goes to desk staff whose
-- test flag matches the RFQ's.
-- ------------------------------------------------------------
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
    v_advance := NEW.kind = 'fresh'
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

DROP TRIGGER IF EXISTS rfqs_after_write ON rfqs;
CREATE TRIGGER rfqs_after_write
  AFTER INSERT OR UPDATE ON rfqs
  FOR EACH ROW
  EXECUTE FUNCTION rfqs_after_write();


-- ------------------------------------------------------------
-- STEP 8: the six desk actions
--
-- SECURITY DEFINER, so they write past RLS — which is why each one checks,
-- itself and first: who the caller is, that they may see this RFQ (test
-- scope), and that the RFQ is in the status the action starts from. The row
-- is locked (FOR UPDATE), so two people pressing at once can't both win:
-- the second gets "no longer waiting…". Each returns the updated rfqs row.
--
-- Who may do what (the owner can cover any step, RFQ-DESK.md §3):
--   rfq_approve              Production Executive / owner, from with_technical
--   rfq_send_back            Production Executive / owner from with_technical;
--                            Estimation Executive / owner from with_estimation
--                            (not a price revision — withdraw that instead)
--   rfq_raise_with_lixil     Estimation Executive / owner, from with_estimation
--   rfq_record_quote         Estimation Executive / owner, from with_lixil
--   rfq_withdraw             the credited exec, whoever logged it, or the
--                            owner — while with_technical or with_estimation
--                            ("until it reaches Lixil")
--   rfq_start_price_revision Estimation Executive / owner, on a lead with a
--                            quoted RFQ and no price revision already open
-- ------------------------------------------------------------

-- Is the logged-in employee a test account?
CREATE OR REPLACE FUNCTION my_is_test_account()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT e.is_test_account FROM employees e
     WHERE e.auth_user_id = auth.uid() AND e.is_active = true
  ), false);
$$;

-- May the caller see an RFQ with this test flag? Desk staff: only their own
-- kind (test ↔ test, real ↔ real). Anyone else: the usual rule — test data
-- only for a test account or an owner with the switch on.
CREATE OR REPLACE FUNCTION rfq_test_scope_ok(p_is_test boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN current_employee_role() IN ('production_executive','estimation_executive')
      THEN p_is_test = my_is_test_account()
    ELSE (NOT p_is_test) OR viewer_sees_test_data()
  END;
$$;

-- Shared opening of every action on an existing RFQ: lock it, check scope.
CREATE OR REPLACE FUNCTION rfq_lock_for_action(p_rfq_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r rfqs;
BEGIN
  IF current_employee_id() IS NULL THEN
    RAISE EXCEPTION 'Your account is not active in the CRM.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM rfqs WHERE id = p_rfq_id FOR UPDATE;
  IF NOT FOUND OR NOT rfq_test_scope_ok(r.is_test) THEN
    RAISE EXCEPTION 'That RFQ could not be found.' USING ERRCODE = 'P0002';
  END IF;
  RETURN r;
END;
$$;

-- Human wording for a status, for error messages.
CREATE OR REPLACE FUNCTION rfq_status_words(p_status text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'with_technical'  THEN 'waiting for the technical check'
    WHEN 'with_estimation' THEN 'waiting for estimation'
    WHEN 'with_lixil'      THEN 'with Lixil'
    WHEN 'quoted'          THEN 'already quoted'
    WHEN 'sent_back'       THEN 'already sent back'
    WHEN 'withdrawn'       THEN 'withdrawn'
    ELSE p_status
  END;
$$;

CREATE OR REPLACE FUNCTION rfq_approve(p_rfq_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r rfqs;
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('production_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Production Executive or the owner can approve an RFQ.' USING ERRCODE = '42501';
  END IF;
  r := rfq_lock_for_action(p_rfq_id);
  IF r.status <> 'with_technical' THEN
    RAISE EXCEPTION 'This RFQ is no longer waiting for the technical check — it is %.', rfq_status_words(r.status)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rfqs
     SET status = 'with_estimation', approved_at = now(), approved_by = current_employee_id(), updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_send_back(p_rfq_id integer, p_note text DEFAULT NULL)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      rfqs;
  v_role text := COALESCE(current_employee_role(), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_from text;
BEGIN
  IF v_role NOT IN ('production_executive', 'estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Production Executive, the Estimation Executive or the owner can send an RFQ back.'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'The note is too long — keep it under 1,000 characters.' USING ERRCODE = 'check_violation';
  END IF;
  r := rfq_lock_for_action(p_rfq_id);

  IF r.status = 'with_technical' AND v_role IN ('production_executive', 'owner') THEN
    v_from := 'technical';
  ELSIF r.status = 'with_estimation' AND v_role IN ('estimation_executive', 'owner') THEN
    IF r.kind = 'price_revision' THEN
      RAISE EXCEPTION 'A price revision can''t be sent back to the exec — withdraw it instead.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_from := 'estimation';
  ELSE
    RAISE EXCEPTION 'You can''t send this RFQ back — it is %.', rfq_status_words(r.status)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rfqs
     SET status = 'sent_back', sent_back_at = now(), sent_back_by = current_employee_id(),
         sent_back_from = v_from, send_back_note = v_note, updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_raise_with_lixil(p_rfq_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r rfqs;
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Estimation Executive or the owner can raise an RFQ with Lixil.' USING ERRCODE = '42501';
  END IF;
  r := rfq_lock_for_action(p_rfq_id);
  IF r.status <> 'with_estimation' THEN
    RAISE EXCEPTION 'This RFQ is not waiting for estimation — it is %.', rfq_status_words(r.status)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rfqs
     SET status = 'with_lixil', lixil_raised_at = now(), lixil_raised_by = current_employee_id(), updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_record_quote(
  p_rfq_id      integer,
  p_quote_ref   text,
  p_quote_value numeric,
  p_quote_date  date DEFAULT NULL
)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       rfqs;
  v_ref   text := NULLIF(btrim(COALESCE(p_quote_ref, '')), '');
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date  date := COALESCE(p_quote_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Estimation Executive or the owner can record a quote.' USING ERRCODE = '42501';
  END IF;
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Enter Lixil''s quote reference.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_quote_value IS NULL OR p_quote_value <= 0 OR p_quote_value >= 1e12 THEN
    RAISE EXCEPTION 'Enter the quote value (without GST).' USING ERRCODE = 'check_violation';
  END IF;
  IF v_date > v_today THEN
    RAISE EXCEPTION 'The quote date can''t be in the future.' USING ERRCODE = 'check_violation';
  END IF;
  r := rfq_lock_for_action(p_rfq_id);
  IF r.status <> 'with_lixil' THEN
    RAISE EXCEPTION 'This RFQ is not waiting for Lixil''s quote — it is %.', rfq_status_words(r.status)
      USING ERRCODE = 'check_violation';
  END IF;
  -- Harpreet's sheet had 14 quotes dated before their RFQ: typing slips.
  IF v_date < (r.raised_at AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'The quote date can''t be before the RFQ was raised (%).',
      to_char((r.raised_at AT TIME ZONE 'Asia/Kolkata')::date, 'DD Mon YYYY')
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rfqs
     SET status = 'quoted', quote_received_at = now(), quote_received_by = current_employee_id(),
         quote_ref = v_ref, quote_value = round(p_quote_value, 2), quote_date = v_date, updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_withdraw(p_rfq_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r    rfqs;
  v_me integer := current_employee_id();
BEGIN
  r := rfq_lock_for_action(p_rfq_id);
  -- COALESCE the whole test: with a NULL raised_by/logged_by the OR chain is
  -- NULL, and `IF NOT NULL` would let anyone through.
  IF NOT COALESCE(current_employee_role() = 'owner'
                  OR v_me = r.raised_by_employee_id
                  OR v_me = r.logged_by_employee_id, false) THEN
    RAISE EXCEPTION 'Only the exec who raised this RFQ, whoever logged it, or the owner can withdraw it.'
      USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('with_technical', 'with_estimation') THEN
    RAISE EXCEPTION 'This RFQ can''t be withdrawn — it is %.', rfq_status_words(r.status)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE rfqs
     SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = v_me, updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_start_price_revision(p_lead_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last  rfqs;
  v_owner integer;
  r       rfqs;
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Estimation Executive or the owner can start a price revision.' USING ERRCODE = '42501';
  END IF;

  -- Serialise price revisions on one lead (the "already open" test below).
  SELECT owner_employee_id INTO v_owner FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lead could not be found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_last FROM rfqs
   WHERE lead_id = p_lead_id AND status = 'quoted'
   ORDER BY quote_received_at DESC, id DESC
   LIMIT 1;
  IF NOT FOUND OR NOT rfq_test_scope_ok(v_last.is_test) THEN
    RAISE EXCEPTION 'This lead has no quoted RFQ to revise.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM rfqs
              WHERE lead_id = p_lead_id AND kind = 'price_revision'
                AND status IN ('with_estimation', 'with_lixil')) THEN
    RAISE EXCEPTION 'A price revision is already open on this lead.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO rfqs (lead_id, kind, revision, raised_by_employee_id, logged_by_employee_id, is_test,
                    window_count, segments, status)
  VALUES (p_lead_id, 'price_revision', v_last.revision, v_owner, current_employee_id(), v_last.is_test,
          v_last.window_count, v_last.segments, 'with_estimation')
  RETURNING * INTO r;
  RETURN r;
END;
$$;


-- ------------------------------------------------------------
-- STEP 9: what the desk can read
--
-- The Production / Estimation Executive read every lead that has a desk RFQ
-- (of their own test kind) — the lead, its parties, site, site contacts and
-- stage history. Read only: no UPDATE/INSERT policy is added anywhere.
--
-- The helpers are SECURITY DEFINER for the reason test_lead_ids() is: a
-- `leads` policy that queried rfqs, whose own policy queries leads, would be
-- infinite recursion. Each returns an empty array for every other role, and
-- each is called in the hoisted `(SELECT fn())` form — once per statement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION desk_lead_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT current_employee_role() AS role, my_is_test_account() AS is_test)
  SELECT COALESCE(array_agg(DISTINCT r.lead_id), '{}')
    FROM rfqs r, me
   WHERE me.role IN ('production_executive', 'estimation_executive')
     AND r.is_test = me.is_test;
$$;

CREATE OR REPLACE FUNCTION desk_site_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dl AS (SELECT desk_lead_ids() AS ids)
  SELECT COALESCE(array_agg(DISTINCT l.site_id), '{}')
    FROM leads l, dl
   WHERE l.id = ANY(dl.ids) AND l.site_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION desk_party_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dl AS (SELECT desk_lead_ids() AS ids),
       ds AS (SELECT desk_site_ids() AS ids),
       p AS (
         SELECT unnest(ARRAY[l.party_id, l.other_party_id, l.referred_by_party_id]) AS id
           FROM leads l, dl WHERE l.id = ANY(dl.ids)
         UNION
         SELECT sc.party_id FROM site_contacts sc, ds WHERE sc.site_id = ANY(ds.ids)
         UNION
         SELECT s.primary_contact_party_id FROM sites s, ds WHERE s.id = ANY(ds.ids)
       )
  SELECT COALESCE(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}') FROM p;
$$;

DROP POLICY IF EXISTS "desk_select" ON leads;
CREATE POLICY "desk_select" ON leads FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND id = ANY((SELECT desk_lead_ids())::integer[])
);

DROP POLICY IF EXISTS "desk_select" ON sites;
CREATE POLICY "desk_select" ON sites FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND id = ANY((SELECT desk_site_ids())::integer[])
);

DROP POLICY IF EXISTS "desk_select" ON parties;
CREATE POLICY "desk_select" ON parties FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND id = ANY((SELECT desk_party_ids())::integer[])
);

DROP POLICY IF EXISTS "desk_select" ON site_contacts;
CREATE POLICY "desk_select" ON site_contacts FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND site_id = ANY((SELECT desk_site_ids())::integer[])
);

DROP POLICY IF EXISTS "desk_select" ON stage_history;
CREATE POLICY "desk_select" ON stage_history FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND lead_id = ANY((SELECT desk_lead_ids())::integer[])
);


-- ------------------------------------------------------------
-- STEP 10: who reads rfqs / rfq_events, and nobody writes them directly
--
-- Desk staff: every RFQ of their own test kind. Everyone else: the RFQs on
-- leads they can already see (the subquery runs under their own leads RLS,
-- so a rep sees their own, a coordinator their team's, the owner all).
-- Plus the usual restrictive hide_test_accounts on both tables.
--
-- REVOKE ALL first: rls_policies.sql's ALTER DEFAULT PRIVILEGES and
-- Supabase's baseline would otherwise leave these broadly writable. Every
-- write goes through STEP 8's functions or the triggers, which run as the
-- table owner.
-- ------------------------------------------------------------
REVOKE ALL ON rfqs, rfq_events FROM anon, authenticated;
GRANT SELECT ON rfqs, rfq_events TO authenticated;
-- The Edge Function (Step 3) reads them for push wording.
GRANT SELECT ON rfqs, rfq_events TO service_role;

ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rfqs_desk_select" ON rfqs;
CREATE POLICY "rfqs_desk_select" ON rfqs FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) IN ('production_executive', 'estimation_executive')
  AND is_test = (SELECT my_is_test_account())
);

DROP POLICY IF EXISTS "rfqs_lead_select" ON rfqs;
CREATE POLICY "rfqs_lead_select" ON rfqs FOR SELECT TO authenticated USING (
  (SELECT current_employee_role()) NOT IN ('production_executive', 'estimation_executive')
  AND lead_id IN (SELECT l.id FROM leads l)
);

DROP POLICY IF EXISTS hide_test_accounts ON rfqs;
CREATE POLICY hide_test_accounts ON rfqs AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR NOT is_test);

DROP POLICY IF EXISTS "rfq_events_select" ON rfq_events;
CREATE POLICY "rfq_events_select" ON rfq_events FOR SELECT TO authenticated USING (
  rfq_id IN (SELECT r.id FROM rfqs r)
);

DROP POLICY IF EXISTS hide_test_accounts ON rfq_events;
CREATE POLICY hide_test_accounts ON rfq_events AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT viewer_sees_test_data()) OR NOT is_test);


-- ------------------------------------------------------------
-- STEP 11: function grants
--
-- Functions are executable by PUBLIC by default; the actions are for signed-
-- in employees only. Trigger functions need no grant.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  rfq_approve(integer), rfq_send_back(integer, text), rfq_raise_with_lixil(integer),
  rfq_record_quote(integer, text, numeric, date), rfq_withdraw(integer),
  rfq_start_price_revision(integer),
  rfq_lock_for_action(integer), rfq_test_scope_ok(boolean), my_is_test_account(),
  desk_lead_ids(), desk_site_ids(), desk_party_ids(), rfq_desk_is_live()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  rfq_approve(integer), rfq_send_back(integer, text), rfq_raise_with_lixil(integer),
  rfq_record_quote(integer, text, numeric, date), rfq_withdraw(integer),
  rfq_start_price_revision(integer),
  rfq_test_scope_ok(boolean), my_is_test_account(),
  desk_lead_ids(), desk_site_ids(), desk_party_ids(), rfq_desk_is_live()
TO authenticated;

-- rfq_lock_for_action is an internal step of the actions above; nobody calls
-- it directly (it would lock a row and return it past RLS).
REVOKE EXECUTE ON FUNCTION rfq_lock_for_action(integer) FROM authenticated;

COMMIT;

-- PostgREST caches the schema: new tables, columns and functions are
-- invisible to the API until it reloads.
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CHECKS (read-only) — run any of these afterwards
-- ============================================================
-- Tables and the new activity columns:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE (table_name = 'activities' AND column_name LIKE 'rfq_%')
--       OR table_name IN ('rfqs','rfq_events') ORDER BY 1, 2;
-- The five new notification kinds:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'notifications_kind_check';
-- The switch (expect live_from NULL until launch day):
--   SELECT * FROM rfq_desk_settings;
-- The desk exit in the stage rule:
--   SELECT prosrc LIKE '%rfq_desk_stage_change%' FROM pg_proc WHERE proname = 'enforce_owner_only_stage_change';
-- Then the behavioural test: Schema/verify_rfq_desk.sql.
