-- ============================================================
-- VERIFY: migration_rfq_desk_in_process.sql, as REAL sessions
--
-- Checks that each desk role reads ONLY the leads in their own process,
-- impersonating the test logins the same way Schema/verify_rfq_desk.sql does
-- (the `authenticated` role + the JWT's `sub`), so current_employee_id() and
-- every policy evaluate exactly as in the app.
--
-- NOTHING IS SAVED. It all runs in one DO block that ends by raising an error
-- on purpose, which rolls back every row it made (and the switch, if it had
-- to turn it on). ► THE RED ERROR BOX IS THE REPORT. ◄
--
-- NEEDS: migration_rfq_desk.sql (+ its advance fix) and
-- migration_rfq_desk_in_process.sql already run; active TEST logins for a
-- sales_executive, a production_executive and an estimation_executive.
--
-- RUN: paste into the Supabase SQL Editor, press Run, copy the whole error
-- message back.
-- ============================================================

DO $verify$
DECLARE
  v_exec_id integer;  v_exec_uid uuid;
  v_pe_id   integer;  v_pe_uid   uuid;
  v_ee_id   integer;  v_ee_uid   uuid;
  v_client  integer;
  v_site    integer;
  v_lead_a  integer;   -- walks the whole loop to a quote, then is won
  v_lead_b  integer;   -- sent back by the technical check
  v_rfq_a   integer;
  v_rfq_b   integer;
  v_int     integer;
  v_int2    integer;
  lines  text[] := ARRAY[]::text[];
  n_fail integer;
BEGIN
  -- ================= setup (as postgres) =================
  SELECT id, auth_user_id INTO v_exec_id, v_exec_uid FROM employees
   WHERE role = 'sales_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_pe_id, v_pe_uid FROM employees
   WHERE role = 'production_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_ee_id, v_ee_uid FROM employees
   WHERE role = 'estimation_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_exec_id IS NULL OR v_pe_id IS NULL OR v_ee_id IS NULL THEN
    RAISE EXCEPTION 'SETUP: need active TEST logins for a sales_executive, a production_executive and an estimation_executive.';
  END IF;

  INSERT INTO parties (party_type, name, created_by) VALUES ('client', 'In-process verify client', v_exec_id) RETURNING id INTO v_client;
  INSERT INTO sites (locality, discovered_by) VALUES ('In-process verify site', v_exec_id) RETURNING id INTO v_site;
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type, office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling') RETURNING id INTO v_lead_a;
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type, office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling') RETURNING id INTO v_lead_b;

  -- The desk must be on for an RFQ Raised to become a desk RFQ (rolled back).
  UPDATE rfq_desk_settings SET live_from = COALESCE(live_from, now());

  -- ================= the exec raises two RFQs =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead_a, 'rfq_raised', 'fresh', 6, ARRAY['windows'], 'in-process verify A');
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_segments, notes)
  VALUES (v_exec_id, v_lead_b, 'rfq_raised', 'fresh', 4, ARRAY['windows'], 'in-process verify B');
  PERFORM set_config('role', 'none', true);
  SELECT id INTO v_rfq_a FROM rfqs WHERE lead_id = v_lead_a;
  SELECT id INTO v_rfq_b FROM rfqs WHERE lead_id = v_lead_b;

  -- ================= waiting at the technical check =================
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT (SELECT count(*) FROM leads WHERE id = v_lead_a) + (SELECT count(*) FROM parties WHERE id = v_client)
       + (SELECT count(*) FROM sites WHERE id = v_site) INTO v_int;
  lines := lines || format('%s P1 production-exec reads a lead waiting for them, its client and its site (%s of 3)',
    CASE WHEN v_int = 3 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM leads WHERE id IN (v_lead_a, v_lead_b);
  lines := lines || format('%s E1 estimation-exec can''t read leads still at the technical check (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= production decides: A approved, B sent back =================
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM rfq_approve(v_rfq_a);
  PERFORM rfq_send_back(v_rfq_b, 'in-process verify');
  SELECT count(*) INTO v_int FROM leads WHERE id IN (v_lead_a, v_lead_b);
  SELECT count(*) INTO v_int2 FROM stage_history WHERE lead_id = v_lead_a;
  lines := lines || format('%s P2 once decided, production-exec reads neither lead (%s rows) nor its stage history (%s rows)',
    CASE WHEN v_int = 0 AND v_int2 = 0 THEN 'PASS' ELSE 'FAIL' END, v_int, v_int2);
  SELECT count(*) INTO v_int FROM rfqs WHERE id IN (v_rfq_a, v_rfq_b);
  lines := lines || format('%s P3 …but still reads the two RFQs they decided, for their Today strip (%s of 2)',
    CASE WHEN v_int = 2 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= estimation =================
  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT (SELECT count(*) FROM leads WHERE id = v_lead_a) + (SELECT count(*) FROM parties WHERE id = v_client)
       + (SELECT count(*) FROM sites WHERE id = v_site) INTO v_int;
  SELECT count(*) INTO v_int2 FROM leads WHERE id = v_lead_b;
  lines := lines || format('%s E2 estimation-exec reads the approved lead, client and site (%s of 3), not the sent-back one (%s rows)',
    CASE WHEN v_int = 3 AND v_int2 = 0 THEN 'PASS' ELSE 'FAIL' END, v_int, v_int2);

  PERFORM rfq_raise_with_lixil(v_rfq_a);
  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead_a;
  lines := lines || format('%s E3 still reads it while it is with Lixil (%s)', CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);

  PERFORM rfq_record_quote(v_rfq_a, 'IN-PROCESS-VERIFY', 250000, NULL);
  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead_a;
  lines := lines || format('%s E4 still reads it once quoted — its latest quote may need a price revision (%s)',
    CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- The deal is won (as admin: no session, so no stage rule applies).
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE leads SET current_stage = 'won', order_value = 250000 WHERE id = v_lead_a;

  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead_a;
  lines := lines || format('%s E5 once the lead is won, estimation-exec no longer reads it (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- And production never got it back.
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead_a;
  lines := lines || format('%s P4 production-exec still can''t read the quoted / won lead (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- The exec who owns them is untouched.
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM leads WHERE id IN (v_lead_a, v_lead_b);
  lines := lines || format('%s X1 the exec still reads both of their own leads (%s of 2)',
    CASE WHEN v_int = 2 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= report (and roll everything back) =================
  SELECT count(*) INTO n_fail FROM unnest(lines) l WHERE l LIKE 'FAIL%';
  RAISE EXCEPTION E'RFQ DESK IN-PROCESS VERIFY — % failed. Nothing was saved (this error rolls everything back).\n%',
    n_fail, array_to_string(lines, E'\n');
END
$verify$;
