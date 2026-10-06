-- ============================================================
-- VERIFY: migration_rfq_desk.sql, as REAL sessions (RFQ-DESK.md Step 1)
--
-- WHAT THIS IS: a behavioural test of every Step 1 rule, run as the test
-- logins — the sales exec ('exec'), the Production Executive
-- ('production-exec') and the Estimation Executive ('estimation-exec') —
-- plus, where they exist, the test coordinator, a real exec, the real
-- Production Executive and the owner. It impersonates each one the way
-- Supabase's own RLS tests do (switch to the `authenticated` role and set
-- the JWT's `sub` to that person's Auth user id), so auth.uid(),
-- current_employee_id() and every policy evaluate exactly as in the app.
-- That is NOT the "SQL Editor as postgres" trap CLAUDE.md warns about.
--
-- NOTHING IS SAVED. Everything runs inside one DO block that ends by
-- raising an error on purpose, which rolls back every row it created
-- (leads, RFQs, notifications, all of it) — including turning the desk's
-- switch on for the test, so the real switch is left exactly as it was. So:
--
--   ► THE RED ERROR BOX IS THE REPORT. Read the PASS/FAIL lines in it. ◄
--
-- NEEDS: migration_rfq_desk.sql (+ migration_rfq_desk_advance_fix.sql) and
-- migration_rfq_desk_reporting.sql already run — T40–T50 test the last one
-- (Step 6: target counting, "RFQs back with the exec", the raiser's read);
-- the three test logins above, active, marked is_test_account, with Auth
-- logins linked.
--
-- RUN: paste into the Supabase SQL Editor, press Run, copy the whole error
-- message back.
-- ============================================================

DO $verify$
DECLARE
  v_exec_id integer;  v_exec_uid uuid;
  v_pe_id   integer;  v_pe_uid   uuid;
  v_ee_id   integer;  v_ee_uid   uuid;
  v_sc_id   integer;  v_sc_uid   uuid;   -- test coordinator of the test exec, if any
  v_rexec_id integer; v_rexec_uid uuid;  -- a real sales exec with a login
  v_rpe_id  integer;  v_rpe_uid  uuid;   -- the real Production Executive
  v_own_id  integer;  v_own_uid  uuid;   -- an owner
  v_own_sees_test boolean;

  v_client  integer;
  v_site    integer;
  v_lead    integer;
  v_lead2   integer;
  v_real_lead integer;
  v_act     integer;
  v_rfq1    integer;
  v_rfq2    integer;
  v_rfq3    integer;
  v_rfq4    integer;
  v_rfq5    integer;
  v_lead3   integer;   -- Step 6: sent back, then corrected
  v_lead4   integer;   -- Step 6: quote in, then sent to the client
  v_lead5   integer;   -- Step 6: an RFQ handled in Excel (no desk RFQ)
  v_rfq6    integer;
  v_rfq7    integer;
  v_rfq8    integer;
  v_bool    boolean;
  v_r       rfqs;
  v_int     integer;
  v_num     numeric;
  v_text    text;
  v_ok      boolean;

  lines  text[] := ARRAY[]::text[];
  n_fail integer;
BEGIN
  -- ================= setup (as postgres) =================
  SELECT id, auth_user_id INTO v_exec_id, v_exec_uid FROM employees
   WHERE role = 'sales_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_pe_id, v_pe_uid FROM employees
   WHERE role = 'production_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_ee_id, v_ee_uid FROM employees
   WHERE role = 'estimation_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;
  IF v_exec_id IS NULL OR v_pe_id IS NULL OR v_ee_id IS NULL THEN
    RAISE EXCEPTION 'SETUP: need active TEST logins for a sales_executive, a production_executive and an estimation_executive (is_test_account = true, Auth login linked).';
  END IF;

  SELECT e.id, e.auth_user_id INTO v_sc_id, v_sc_uid FROM employees e
   WHERE e.role = 'sales_coordinator' AND e.is_test_account AND e.is_active AND e.auth_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM employees x WHERE x.id = v_exec_id AND x.coordinator_id = e.id)
   LIMIT 1;
  SELECT e.id, e.auth_user_id INTO v_rexec_id, v_rexec_uid FROM employees e
   WHERE e.role = 'sales_executive' AND NOT e.is_test_account AND e.is_active AND e.auth_user_id IS NOT NULL
   ORDER BY e.id LIMIT 1;
  SELECT id, auth_user_id INTO v_rpe_id, v_rpe_uid FROM employees
   WHERE role = 'production_executive' AND NOT is_test_account AND is_active AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_own_id, v_own_uid FROM employees
   WHERE role = 'owner' AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;

  -- A real lead with no RFQ — the desk test logins must not see it.
  SELECT l.id INTO v_real_lead FROM leads l
   WHERE l.owner_employee_id IS NOT NULL
     AND l.owner_employee_id <> ALL(test_employee_ids())
     AND NOT EXISTS (SELECT 1 FROM rfqs r WHERE r.lead_id = l.id)
   ORDER BY l.id LIMIT 1;

  -- A fresh test lead for the test exec, at 'calling'.
  INSERT INTO parties (party_type, name, created_by)
  VALUES ('client', 'RFQ desk verify client', v_exec_id) RETURNING id INTO v_client;
  INSERT INTO sites (locality, discovered_by) VALUES ('RFQ desk verify site', v_exec_id) RETURNING id INTO v_site;
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type,
                     office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling')
  RETURNING id INTO v_lead;
  -- A second one, for the switch tests (keeps v_lead's revision count clean).
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type,
                     office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling')
  RETURNING id INTO v_lead2;
  -- Step 6's three (see their section at the end).
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type,
                     office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling')
  RETURNING id INTO v_lead3;
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type,
                     office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling')
  RETURNING id INTO v_lead4;
  -- An RFQ raised five days ago and worked in Excel: the lead carries
  -- rfq_raised, no desk RFQ, no quote sent.
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type,
                     office_territory, current_stage, rfq_raised, rfq_raised_at)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'rfq',
          true, (now() AT TIME ZONE 'Asia/Kolkata')::date - 5)
  RETURNING id INTO v_lead5;

  -- The switch OFF for T00a (whatever it really is — rolled back at the end).
  UPDATE rfq_desk_settings SET live_from = NULL;

  -- ================= the switch =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, notes)
  VALUES (v_exec_id, v_lead2, 'rfq_raised', 'fresh', 'verify RFQ while the desk is off');
  PERFORM set_config('role', 'none', true);
  SELECT count(*) INTO v_int FROM rfqs WHERE lead_id = v_lead2;
  lines := lines || format('%s T00a desk OFF: an RFQ Raised does not enter the desk (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);

  UPDATE rfq_desk_settings SET live_from = now();

  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, notes)
  VALUES (v_exec_id, v_lead2, 'rfq_raised', 'revised', 'verify RFQ with no window count')
  RETURNING id INTO v_act;
  PERFORM set_config('role', 'none', true);
  SELECT * INTO v_r FROM rfqs WHERE activity_id = v_act;
  lines := lines || format('%s T00b desk ON: an RFQ Raised with no window count still enters the desk (status %s, windows %s, R%s) and alerts the production-exec (%s)',
    CASE WHEN v_r.id IS NOT NULL AND v_r.status = 'with_technical' AND v_r.window_count IS NULL AND v_r.revision = 1
              AND EXISTS (SELECT 1 FROM notifications WHERE rfq_id = v_r.id AND kind = 'rfq_new' AND employee_id = v_pe_id)
         THEN 'PASS' ELSE 'FAIL' END,
    v_r.status, COALESCE(v_r.window_count::text, 'blank'), v_r.revision,
    EXISTS (SELECT 1 FROM notifications WHERE rfq_id = v_r.id AND kind = 'rfq_new' AND employee_id = v_pe_id));

  -- ================= AS THE TEST EXEC =================
  PERFORM set_config('role', 'authenticated', true);   -- still the exec's JWT

  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead, 'rfq_raised', 'fresh', 12, ARRAY['windows','in16'], 'verify RFQ 1')
  RETURNING id INTO v_act;
  SELECT * INTO v_r FROM rfqs WHERE activity_id = v_act;
  v_rfq1 := v_r.id;
  lines := lines || format('%s T01 exec''s RFQ Raised (12 windows) becomes a desk RFQ: status=%s kind=%s rev=%s raised_by=%s logged_by=%s test=%s',
    CASE WHEN v_r.id IS NOT NULL AND v_r.status = 'with_technical' AND v_r.kind = 'fresh' AND v_r.revision = 0
              AND v_r.raised_by_employee_id = v_exec_id AND v_r.logged_by_employee_id = v_exec_id
              AND v_r.is_test AND v_r.window_count = 12 AND v_r.segments = ARRAY['windows','in16']
         THEN 'PASS' ELSE 'FAIL' END,
    v_r.status, v_r.kind, v_r.revision, v_r.raised_by_employee_id, v_r.logged_by_employee_id, v_r.is_test);

  SELECT count(*) INTO v_int FROM rfq_events WHERE rfq_id = v_rfq1 AND action = 'raised';
  lines := lines || format('%s T02 exec sees the ''raised'' event (%s)', CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);

  v_ok := false;
  BEGIN
    UPDATE rfqs SET status = 'quoted' WHERE id = v_rfq1;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  lines := lines || format('%s T03 exec cannot write rfqs directly', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);

  v_ok := false;
  BEGIN
    PERFORM rfq_approve(v_rfq1);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T04 exec cannot approve (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_ok := false;
  BEGIN
    INSERT INTO activities (employee_id, lead_id, activity_type, rfq_window_count) VALUES (v_exec_id, v_lead, 'call', 5);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  lines := lines || format('%s T05 a window count on a Call is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);

  v_ok := false;
  BEGIN
    INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments)
    VALUES (v_exec_id, v_lead, 'rfq_raised', 'revised', 3, ARRAY['doors']);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  lines := lines || format('%s T06 an unknown segment is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);

  PERFORM set_config('role', 'none', true);

  SELECT count(*) INTO v_int FROM notifications WHERE rfq_id = v_rfq1 AND kind = 'rfq_new' AND employee_id = v_pe_id;
  SELECT count(*) INTO v_num FROM notifications n JOIN employees e ON e.id = n.employee_id
   WHERE n.rfq_id = v_rfq1 AND n.kind = 'rfq_new' AND NOT e.is_test_account;
  lines := lines || format('%s T07 rfq_new → test production-exec only (test %s, real %s)',
    CASE WHEN v_int = 1 AND v_num = 0 THEN 'PASS' ELSE 'FAIL' END, v_int, v_num);

  -- ================= AS THE TEST PRODUCTION EXECUTIVE =================
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO v_int FROM rfqs WHERE id = v_rfq1;
  lines := lines || format('%s T08 production-exec sees the RFQ (%s)', CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);

  SELECT (SELECT count(*) FROM leads WHERE id = v_lead)
       + (SELECT count(*) FROM parties WHERE id = v_client)
       + (SELECT count(*) FROM sites WHERE id = v_site) INTO v_int;
  lines := lines || format('%s T09 production-exec reads the lead, its client and its site (%s of 3)',
    CASE WHEN v_int = 3 THEN 'PASS' ELSE 'FAIL' END, v_int);

  SELECT count(*) INTO v_int FROM leads WHERE id = v_real_lead;
  lines := lines || format('%s T10 production-exec cannot see a lead with no RFQ (#%s: %s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_real_lead, v_int);

  SELECT count(*) INTO v_int FROM rfqs WHERE NOT is_test;
  lines := lines || format('%s T11 test production-exec sees no real RFQs (%s)', CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);

  UPDATE leads SET current_stage = 'negotiation' WHERE id = v_lead;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  lines := lines || format('%s T12 production-exec cannot edit the lead directly (%s rows)', CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote(v_rfq1, 'X', 100, NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T13 production-exec cannot record a quote (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_r := rfq_approve(v_rfq1);
  lines := lines || format('%s T14 approve → %s, approved_by=%s',
    CASE WHEN v_r.status = 'with_estimation' AND v_r.approved_by = v_pe_id THEN 'PASS' ELSE 'FAIL' END, v_r.status, v_r.approved_by);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_approve(v_rfq1);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T15 approving twice is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  PERFORM set_config('role', 'none', true);

  SELECT current_stage INTO v_text FROM leads WHERE id = v_lead;
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead AND stage = 'rfq' AND changed_by = v_pe_id;
  lines := lines || format('%s T16 approval moved the fresh-RFQ lead calling → %s, history rows %s, rfq_raised %s',
    CASE WHEN v_text = 'rfq' AND v_int = 1 AND (SELECT rfq_raised AND rfq_raised_at IS NOT NULL FROM leads WHERE id = v_lead)
         THEN 'PASS' ELSE 'FAIL' END,
    v_text, v_int, (SELECT rfq_raised FROM leads WHERE id = v_lead));

  SELECT count(*) INTO v_int FROM notifications WHERE rfq_id = v_rfq1 AND kind = 'rfq_approved' AND employee_id = v_ee_id;
  lines := lines || format('%s T17 rfq_approved → estimation-exec (%s)', CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);

  -- T16b (migration_rfq_desk_advance_fix.sql): a lead whose FIRST approved RFQ
  -- is a revision — its fresh one was sent back, or (here) it was logged as a
  -- revision — still moves to RFQ Raised on that approval. v_lead2 is at
  -- 'calling' with the revised RFQ from T00b waiting at the technical check.
  SELECT id INTO v_rfq5 FROM rfqs WHERE lead_id = v_lead2 AND status = 'with_technical' ORDER BY id LIMIT 1;
  PERFORM set_config('role', 'authenticated', true);   -- still the production-exec's JWT
  PERFORM rfq_approve(v_rfq5);
  PERFORM set_config('role', 'none', true);
  SELECT current_stage INTO v_text FROM leads WHERE id = v_lead2;
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead2 AND stage = 'rfq' AND changed_by = v_pe_id;
  lines := lines || format('%s T16b approving a REVISED RFQ on a lead still before RFQ moves it too: calling → %s, history rows %s',
    CASE WHEN v_text = 'rfq' AND v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_text, v_int);
  v_rfq5 := NULL;

  -- ================= AS THE TEST ESTIMATION EXECUTIVE =================
  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_r := rfq_send_back(v_rfq1, '  Sizes missing on W4  ');
  lines := lines || format('%s T18 estimation sends back → %s from %s, note "%s"',
    CASE WHEN v_r.status = 'sent_back' AND v_r.sent_back_from = 'estimation' AND v_r.send_back_note = 'Sizes missing on W4'
         THEN 'PASS' ELSE 'FAIL' END, v_r.status, v_r.sent_back_from, v_r.send_back_note);

  PERFORM set_config('role', 'none', true);

  SELECT count(*) INTO v_int FROM notifications WHERE rfq_id = v_rfq1 AND kind = 'rfq_sent_back' AND employee_id = v_exec_id;
  SELECT count(*) INTO v_num FROM notifications WHERE rfq_id = v_rfq1 AND kind = 'rfq_bounced' AND employee_id = v_pe_id;
  lines := lines || format('%s T19 rfq_sent_back → exec (%s) and rfq_bounced → production-exec (%s)',
    CASE WHEN v_int = 1 AND v_num = 1 THEN 'PASS' ELSE 'FAIL' END, v_int, v_num);

  -- Every move carries its own time and who made it (the owner's ask).
  SELECT string_agg(action || ' by #' || COALESCE(actor_employee_id::text, '?')
                    || CASE WHEN created_at IS NULL THEN ' (NO TIME)' ELSE '' END, ' → ' ORDER BY id)
    INTO v_text FROM rfq_events WHERE rfq_id = v_rfq1;
  lines := lines || format('%s T19b each move is timed and attributed: %s',
    CASE WHEN v_text = format('raised by #%s → approved by #%s → sent_back by #%s', v_exec_id, v_pe_id, v_ee_id)
              AND (SELECT approved_at IS NOT NULL AND sent_back_at IS NOT NULL FROM rfqs WHERE id = v_rfq1)
         THEN 'PASS' ELSE 'FAIL' END, v_text);

  -- ================= the revision, all the way to a quote =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead, 'rfq_raised', 'revised', 12, ARRAY['windows'], 'verify RFQ 2')
  RETURNING id INTO v_act;
  SELECT * INTO v_r FROM rfqs WHERE activity_id = v_act;
  v_rfq2 := v_r.id;
  lines := lines || format('%s T20 the revision is R%s, kind %s', CASE WHEN v_r.revision = 1 AND v_r.kind = 'revised' THEN 'PASS' ELSE 'FAIL' END, v_r.revision, v_r.kind);

  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM rfq_approve(v_rfq2);

  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote(v_rfq2, 'R26-TEST', 1000, NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T21 a quote before "raised with Lixil" is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_r := rfq_raise_with_lixil(v_rfq2);
  lines := lines || format('%s T22 raise with Lixil → %s', CASE WHEN v_r.status = 'with_lixil' AND v_r.lixil_raised_by = v_ee_id THEN 'PASS' ELSE 'FAIL' END, v_r.status);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote(v_rfq2, 'R26-TEST', 1000, ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1));
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T23 a future quote date is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote(v_rfq2, 'R26-TEST', 1000, ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1));
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T24 a quote dated before the RFQ is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_r := rfq_record_quote(v_rfq2, ' R26-TEST-1 ', 1234567.891, NULL);
  lines := lines || format('%s T25 record quote → %s, ref "%s", value %s',
    CASE WHEN v_r.status = 'quoted' AND v_r.quote_ref = 'R26-TEST-1' AND v_r.quote_value = 1234567.89 THEN 'PASS' ELSE 'FAIL' END,
    v_r.status, v_r.quote_ref, v_r.quote_value);

  PERFORM set_config('role', 'none', true);

  SELECT quote_value INTO v_num FROM leads WHERE id = v_lead;
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead AND stage = 'rfq';
  lines := lines || format('%s T26 lead quote value = %s; the revision''s approval added no second stage move (%s rfq rows)',
    CASE WHEN v_num = 1234567.89 AND v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_num, v_int);

  SELECT count(*) INTO v_int FROM notifications WHERE rfq_id = v_rfq2 AND kind = 'rfq_quote_ready' AND employee_id = v_exec_id;
  lines := lines || format('%s T27 rfq_quote_ready → exec (%s)', CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);

  -- ================= price revision =================
  PERFORM set_config('role', 'authenticated', true);   -- still the estimation-exec's JWT

  v_r := rfq_start_price_revision(v_lead);
  v_rfq3 := v_r.id;
  lines := lines || format('%s T28 price revision opens: kind %s, %s, R%s, raised_by %s, logged_by %s',
    CASE WHEN v_r.kind = 'price_revision' AND v_r.status = 'with_estimation' AND v_r.revision = 1
              AND v_r.raised_by_employee_id = v_exec_id AND v_r.logged_by_employee_id = v_ee_id
         THEN 'PASS' ELSE 'FAIL' END,
    v_r.kind, v_r.status, v_r.revision, v_r.raised_by_employee_id, v_r.logged_by_employee_id);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_start_price_revision(v_lead);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T29 a second open price revision is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_send_back(v_rfq3, NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T30 a price revision can''t be sent back (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  PERFORM rfq_raise_with_lixil(v_rfq3);
  PERFORM rfq_record_quote(v_rfq3, 'R26-TEST-2', 1500000, NULL);
  PERFORM set_config('role', 'none', true);

  SELECT quote_value INTO v_num FROM leads WHERE id = v_lead;
  SELECT count(*) INTO v_int FROM notifications WHERE rfq_id = v_rfq3 AND kind = 'rfq_quote_ready';
  lines := lines || format('%s T31 price revision replaces the lead''s quote value (%s) and tells only the exec (%s rows, to exec: %s)',
    CASE WHEN v_num = 1500000 AND v_int = 1
              AND EXISTS (SELECT 1 FROM notifications WHERE rfq_id = v_rfq3 AND kind = 'rfq_quote_ready' AND employee_id = v_exec_id)
         THEN 'PASS' ELSE 'FAIL' END,
    v_num, v_int, EXISTS (SELECT 1 FROM notifications WHERE rfq_id = v_rfq3 AND kind = 'rfq_quote_ready' AND employee_id = v_exec_id));

  -- ================= withdraw =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead, 'rfq_raised', 'revised', 4, ARRAY['skylight'], 'verify RFQ 4')
  RETURNING id INTO v_act;
  SELECT id INTO v_rfq4 FROM rfqs WHERE activity_id = v_act;

  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_withdraw(v_rfq4);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T32 production-exec can''t withdraw an exec''s RFQ (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  v_r := rfq_withdraw(v_rfq4);
  lines := lines || format('%s T33 exec withdraws their own RFQ → %s', CASE WHEN v_r.status = 'withdrawn' AND v_r.withdrawn_by = v_exec_id THEN 'PASS' ELSE 'FAIL' END, v_r.status);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_withdraw(v_rfq2);
  EXCEPTION WHEN OTHERS THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s T34 a quoted RFQ can''t be withdrawn (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);
  PERFORM set_config('role', 'none', true);

  -- ================= coordinator logging for the exec =================
  IF v_sc_id IS NULL THEN
    lines := lines || 'SKIP T35-T36 no test coordinator supervises the test exec';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_sc_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sc_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
    VALUES (v_exec_id, v_lead, 'rfq_raised', 'revised', 6, ARRAY['windows'], 'verify RFQ 5 (coordinator)')
    RETURNING id INTO v_act;
    SELECT * INTO v_r FROM rfqs WHERE activity_id = v_act;
    v_rfq5 := v_r.id;
    lines := lines || format('%s T35 coordinator-logged RFQ: raised_by exec (%s), logged_by coordinator (%s)',
      CASE WHEN v_r.raised_by_employee_id = v_exec_id AND v_r.logged_by_employee_id = v_sc_id THEN 'PASS' ELSE 'FAIL' END,
      v_r.raised_by_employee_id, v_r.logged_by_employee_id);

    PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
    PERFORM rfq_send_back(v_rfq5, NULL);
    PERFORM set_config('role', 'none', true);

    SELECT count(*) INTO v_int FROM notifications
     WHERE rfq_id = v_rfq5 AND kind = 'rfq_sent_back' AND employee_id IN (v_exec_id, v_sc_id);
    lines := lines || format('%s T36 a technical send-back (no note) tells the exec and the coordinator (%s of 2), no rfq_bounced (%s)',
      CASE WHEN v_int = 2 AND NOT EXISTS (SELECT 1 FROM notifications WHERE rfq_id = v_rfq5 AND kind = 'rfq_bounced')
           THEN 'PASS' ELSE 'FAIL' END,
      v_int, (SELECT count(*) FROM notifications WHERE rfq_id = v_rfq5 AND kind = 'rfq_bounced'));
  END IF;

  -- ================= isolation from real people =================
  IF v_rexec_id IS NULL THEN
    lines := lines || 'SKIP T37 no real sales exec with a login';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_rexec_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rexec_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_int FROM rfqs WHERE lead_id = v_lead;
    lines := lines || format('%s T37 a real exec sees none of the test RFQs (%s)', CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
    PERFORM set_config('role', 'none', true);
  END IF;

  IF v_rpe_id IS NULL THEN
    lines := lines || 'SKIP T38 no real Production Executive with a login';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_rpe_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rpe_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_int FROM rfqs WHERE is_test;
    v_ok := false; v_text := NULL;
    BEGIN
      PERFORM rfq_send_back(v_rfq4, NULL);   -- withdrawn anyway; must fail as "not found" first
    EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM LIKE '%could not be found%'; v_text := SQLERRM;
    END;
    lines := lines || format('%s T38 the real Production Executive sees no test RFQs (%s) and can''t act on one (%s)',
      CASE WHEN v_int = 0 AND v_ok THEN 'PASS' ELSE 'FAIL' END, v_int, v_text);
    PERFORM set_config('role', 'none', true);
  END IF;

  IF v_own_id IS NULL THEN
    lines := lines || 'SKIP T39 no owner with a login';
  ELSE
    SELECT COALESCE(p.show_test_accounts, false) INTO v_own_sees_test
      FROM employees e LEFT JOIN employee_preferences p ON p.employee_id = e.id WHERE e.id = v_own_id;
    PERFORM set_config('request.jwt.claim.sub', v_own_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_own_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_int FROM rfqs WHERE lead_id = v_lead;
    lines := lines || format('%s T39 owner (Test accounts switch %s) sees %s of the lead''s test RFQs',
      CASE WHEN (v_own_sees_test AND v_int >= 4) OR (NOT COALESCE(v_own_sees_test, false) AND v_int = 0) THEN 'PASS' ELSE 'FAIL' END,
      CASE WHEN v_own_sees_test THEN 'ON' ELSE 'OFF' END, v_int);
    PERFORM set_config('role', 'none', true);
  END IF;

  -- ================= Step 6: the target count (migration_rfq_desk_reporting.sql) =================
  -- Everything in this block shares one transaction, so now() — and with it
  -- live_from, every raised_at and every approved_at — is the same instant.
  PERFORM set_config('role', 'none', true);

  SELECT counts_toward_target INTO v_ok FROM rfqs WHERE id = v_rfq1;
  lines := lines || format('%s T40 a fresh RFQ counts toward the target once approved, and still counts after estimation sent it back (%s)',
    CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_ok);

  SELECT counts_toward_target INTO v_ok FROM rfqs WHERE id = v_rfq2;
  SELECT count(*) INTO v_int FROM rfqs WHERE lead_id = v_lead AND counts_toward_target;
  lines := lines || format('%s T41 its revision, approved later, does not count again (%s) — one count per lead (%s)',
    CASE WHEN NOT v_ok AND v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_ok, v_int);

  SELECT COALESCE(bool_or(counts_toward_target), false) INTO v_ok FROM rfqs WHERE lead_id = v_lead2;
  lines := lines || format('%s T42 a lead whose fresh RFQ was logged before the desk went live gets no count from its approved revision (%s) — it counted by its logging day',
    CASE WHEN NOT v_ok THEN 'PASS' ELSE 'FAIL' END, v_ok);

  -- v_lead3: a fresh RFQ sent back at the technical check, then corrected.
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead3, 'rfq_raised', 'fresh', 8, ARRAY['windows'], 'verify Step 6 fresh')
  RETURNING id INTO v_act;
  SELECT id INTO v_rfq6 FROM rfqs WHERE activity_id = v_act;

  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM rfq_send_back(v_rfq6, NULL);

  -- Needs Attention as the exec, read 3 days and 1 day from now (p_now).
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  SELECT a.is_pending_rfq, a.rfq_back_kind INTO v_ok, v_text
    FROM leads_needing_attention(now() + interval '3 days', ((now() + interval '3 days') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
   WHERE a.lead_id = v_lead3;
  SELECT COALESCE((SELECT a.is_pending_rfq
                     FROM leads_needing_attention(now() + interval '1 day', ((now() + interval '1 day') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
                    WHERE a.lead_id = v_lead3), false) INTO v_bool;
  lines := lines || format('%s T43 sent back and not re-logged: "RFQs back with the exec" after 2 days (%s, %s), not after 1 (%s)',
    CASE WHEN v_ok AND v_text = 'sent_back' AND NOT v_bool THEN 'PASS' ELSE 'FAIL' END, v_ok, v_text, v_bool);

  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead3, 'rfq_raised', 'revised', 8, ARRAY['windows'], 'verify Step 6 corrected')
  RETURNING id INTO v_act;
  SELECT id INTO v_rfq7 FROM rfqs WHERE activity_id = v_act;
  SELECT COALESCE((SELECT a.is_pending_rfq
                     FROM leads_needing_attention(now() + interval '3 days', ((now() + interval '3 days') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
                    WHERE a.lead_id = v_lead3), false) INTO v_ok;
  lines := lines || format('%s T44 once the corrected RFQ is logged the lead leaves it — back with the desk (%s)',
    CASE WHEN NOT v_ok THEN 'PASS' ELSE 'FAIL' END, v_ok);

  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  v_r := rfq_approve(v_rfq7);
  PERFORM set_config('role', 'none', true);
  lines := lines || format('%s T45 a sent-back fresh RFQ counts when its correction passes: fresh %s, revision %s (returned to the app: %s)',
    CASE WHEN NOT (SELECT counts_toward_target FROM rfqs WHERE id = v_rfq6) AND v_r.counts_toward_target
         THEN 'PASS' ELSE 'FAIL' END,
    (SELECT counts_toward_target FROM rfqs WHERE id = v_rfq6), (SELECT counts_toward_target FROM rfqs WHERE id = v_rfq7),
    v_r.counts_toward_target);

  -- v_lead4: approved, quoted, then sent to the client.
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead4, 'rfq_raised', 'fresh', 5, ARRAY['giesta'], 'verify Step 6 quote')
  RETURNING id INTO v_act;
  SELECT id INTO v_rfq8 FROM rfqs WHERE activity_id = v_act;
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM rfq_approve(v_rfq8);
  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM rfq_raise_with_lixil(v_rfq8);
  PERFORM rfq_record_quote(v_rfq8, 'R26-TEST-6', 500000, NULL);

  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  SELECT a.is_pending_rfq, a.rfq_back_kind INTO v_ok, v_text
    FROM leads_needing_attention(now() + interval '3 days', ((now() + interval '3 days') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
   WHERE a.lead_id = v_lead4;
  lines := lines || format('%s T46 quote in and not sent to the client: "RFQs back with the exec" after 2 days (%s, %s)',
    CASE WHEN v_ok AND v_text = 'quote_in' THEN 'PASS' ELSE 'FAIL' END, v_ok, v_text);

  -- Sent to the client the day BEFORE this quote came in — an earlier quote.
  UPDATE leads SET quote_sent = true, quote_sent_at = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 WHERE id = v_lead4;
  SELECT COALESCE((SELECT a.is_pending_rfq
                     FROM leads_needing_attention(now() + interval '3 days', ((now() + interval '3 days') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
                    WHERE a.lead_id = v_lead4), false) INTO v_ok;
  UPDATE leads SET quote_sent_at = (now() AT TIME ZONE 'Asia/Kolkata')::date WHERE id = v_lead4;
  SELECT COALESCE((SELECT a.is_pending_rfq
                     FROM leads_needing_attention(now() + interval '3 days', ((now() + interval '3 days') AT TIME ZONE 'Asia/Kolkata')::date, 330) a
                    WHERE a.lead_id = v_lead4), false) INTO v_bool;
  lines := lines || format('%s T47 an earlier quote''s "sent" date doesn''t clear it (%s); marking it sent the day it came in does (%s)',
    CASE WHEN v_ok AND NOT v_bool THEN 'PASS' ELSE 'FAIL' END, v_ok, v_bool);

  -- v_lead5: no desk RFQ — the rule from before the desk.
  SELECT a.is_pending_rfq, a.rfq_back_kind INTO v_ok, v_text
    FROM leads_needing_attention(now(), (now() AT TIME ZONE 'Asia/Kolkata')::date, 330) a
   WHERE a.lead_id = v_lead5;
  lines := lines || format('%s T48 a lead with no desk RFQ keeps the old rule — raised 5 days ago, no quote sent: %s (kind %s)',
    CASE WHEN v_ok AND v_text IS NULL THEN 'PASS' ELSE 'FAIL' END, v_ok, COALESCE(v_text, 'none'));

  -- The exec's own count is read through rfqs — so it must survive the lead
  -- being handed to someone else (rfqs_raised_by_select).
  IF v_own_id IS NULL THEN
    lines := lines || 'SKIP T49 no owner to hand the lead to';
  ELSE
    PERFORM set_config('role', 'none', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('app.skip_assignment_notifications', 'on', true);
    UPDATE leads SET owner_employee_id = v_own_id WHERE id = v_lead4;

    PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_int FROM leads WHERE id = v_lead4;
    SELECT count(*) INTO v_num FROM rfqs WHERE lead_id = v_lead4 AND counts_toward_target;
    lines := lines || format('%s T49 after the lead is handed to the owner, the exec still reads the counted RFQ they raised (%s) — the lead itself: %s rows',
      CASE WHEN v_num = 1 THEN 'PASS' ELSE 'FAIL' END, v_num, v_int);
  END IF;

  IF v_rexec_id IS NULL THEN
    lines := lines || 'SKIP T50 no real sales exec with a login';
  ELSE
    PERFORM set_config('request.jwt.claim.sub', v_rexec_uid::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rexec_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_int FROM rfqs WHERE lead_id IN (v_lead3, v_lead4);
    lines := lines || format('%s T50 someone who did not raise them still can''t read them (%s)',
      CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  END IF;
  PERFORM set_config('role', 'none', true);

  -- ================= report (and roll everything back) =================
  SELECT count(*) INTO n_fail FROM unnest(lines) l WHERE l LIKE 'FAIL%';
  RAISE EXCEPTION E'RFQ DESK VERIFY — % failed. Nothing was saved (this error rolls everything back).\n%',
    n_fail, array_to_string(lines, E'\n');
END
$verify$;
