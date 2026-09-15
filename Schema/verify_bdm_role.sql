-- ============================================================
-- VERIFY: migration_bdm_role.sql, as REAL sessions (BDM.md Step 1)
--
-- WHAT THIS IS: a behavioural test of every Step 1 rule, run as three real
-- employees — the BDM test login, a sales executive and the owner. It
-- impersonates each one the way Supabase's own RLS tests do (switch to the
-- `authenticated` role and set the JWT's `sub` to that employee's Auth user
-- id), so auth.uid(), current_employee_id() and every policy evaluate exactly
-- as they would for that person in the app. This is NOT the "SQL Editor as
-- postgres" trap CLAUDE.md warns about — that runs with BYPASSRLS and no
-- auth.uid(); this deliberately drops both.
--
-- NOTHING IS SAVED. The whole test runs inside one DO block that ends by
-- raising an error on purpose, which rolls back every row it created. So:
--
--   ► THE RED ERROR BOX IS THE REPORT. Read the PASS/FAIL lines in it. ◄
--
-- NEEDS: migration_bdm_role.sql already run; an ACTIVE employee with
-- role = 'business_development_manager' AND a Supabase Auth login linked
-- (auth_user_id set); an active owner and an active sales executive, both
-- with logins.
--
-- RUN: paste into the Supabase SQL Editor, press Run, copy the whole error
-- message back.
-- ============================================================

DO $verify$
DECLARE
  v_bdm_id    integer;  v_bdm_uid    uuid;
  v_owner_id  integer;  v_owner_uid  uuid;
  v_exec_id   integer;  v_exec_uid   uuid;
  v_exec_lead integer;
  v_other_arch integer;
  v_owner_count integer;

  v_client  integer;
  v_arch    integer;
  v_site    integer;
  v_lead    integer;
  v_forged  integer;
  v_int     integer;
  v_text    text;
  v_rec     record;
  v_ok      boolean;

  lines text[] := ARRAY[]::text[];
  n_fail integer;
BEGIN
  -- ---------------- setup (as postgres) ----------------
  SELECT id, auth_user_id INTO v_bdm_id, v_bdm_uid FROM employees
   WHERE role = 'business_development_manager' AND is_active AND auth_user_id IS NOT NULL
   ORDER BY id LIMIT 1;
  IF v_bdm_id IS NULL THEN
    RAISE EXCEPTION 'SETUP: no active business_development_manager with a login. Create the BDM test login first (see BDM.md Step 1).';
  END IF;

  SELECT id, auth_user_id INTO v_owner_id, v_owner_uid FROM employees
   WHERE role = 'owner' AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT e.id, e.auth_user_id INTO v_exec_id, v_exec_uid FROM employees e
   WHERE e.role = 'sales_executive' AND e.is_active AND e.auth_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM leads l WHERE l.owner_employee_id = e.id)
   ORDER BY e.id LIMIT 1;
  IF v_owner_id IS NULL OR v_exec_id IS NULL THEN
    RAISE EXCEPTION 'SETUP: need an active owner and an active sales_executive (who owns a lead), both with logins.';
  END IF;

  SELECT id INTO v_exec_lead FROM leads
   WHERE owner_employee_id = v_exec_id AND bdm_employee_id IS NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_other_arch FROM parties
   WHERE party_type = 'architect' AND created_by IS DISTINCT FROM v_bdm_id ORDER BY id LIMIT 1;
  SELECT count(*) INTO v_owner_count FROM employees WHERE role = 'owner' AND is_active;

  -- =====================================================
  -- AS THE BDM
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_bdm_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bdm_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- T01 client party
  INSERT INTO parties (party_type, name, created_by)
  VALUES ('client', 'ZZ BDM VERIFY CLIENT', v_bdm_id) RETURNING id INTO v_client;
  lines := array_append(lines, (CASE WHEN v_client IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || '  T01 BDM creates a client party and can read it back'));

  -- T02 architect party → tagged to the BDM
  INSERT INTO parties (party_type, name, mobile, created_by)
  VALUES ('architect', 'ZZ BDM VERIFY ARCHITECT', '9000000001', v_bdm_id) RETURNING id INTO v_arch;
  SELECT (bdm_employee_id = v_bdm_id AND bdm_since IS NOT NULL) INTO v_ok FROM parties WHERE id = v_arch;
  lines := array_append(lines, (CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END || '  T02 BDM-created architect is tagged to the BDM with bdm_since'));

  -- T03 site
  INSERT INTO sites (discovered_via, discovered_by)
  VALUES ('referral_architect', v_bdm_id) RETURNING id INTO v_site;
  lines := array_append(lines, (CASE WHEN v_site IS NOT NULL THEN 'PASS' ELSE 'FAIL' END || '  T03 BDM creates a site and can read it back'));

  -- T04 pool lead with joinery received
  INSERT INTO leads (site_id, party_id, owner_employee_id, source_type, referred_by_party_id, joinery_received)
  VALUES (v_site, v_client, NULL, 'referral_architect', v_arch, true)
  RETURNING id INTO v_lead;
  SELECT * INTO v_rec FROM leads WHERE id = v_lead;
  lines := array_append(lines, (CASE WHEN v_rec.bdm_employee_id = v_bdm_id THEN 'PASS' ELSE 'FAIL' END || '  T04a pool lead is tagged to the BDM'));
  lines := array_append(lines, (CASE WHEN v_rec.current_stage = 'joinery_follow_up' THEN 'PASS' ELSE 'FAIL' END || '  T04b joinery received → starts at joinery_follow_up (got ' || coalesce(v_rec.current_stage, 'NULL') || ')'));
  lines := array_append(lines, (CASE WHEN v_rec.created_by_employee_id = v_bdm_id THEN 'PASS' ELSE 'FAIL' END || '  T04c created_by_employee_id stamped as the BDM'));
  lines := array_append(lines, (CASE WHEN v_rec.owner_employee_id IS NULL THEN 'PASS' ELSE 'FAIL' END || '  T04d lead is ownerless (in the pool)'));

  -- T05 capture history row
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T05 one stage_history row written at capture (got ' || v_int || ')'));

  -- T06 capture remark
  BEGIN
    INSERT INTO lead_remarks (lead_id, employee_id, body) VALUES (v_lead, v_bdm_id, 'ZZ verify remark');
    lines := array_append(lines, 'PASS  T06 BDM adds a remark to their pool lead');
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, ('FAIL  T06 BDM adds a remark to their pool lead: ' || SQLERRM));
  END;

  -- T07 pool edit: joinery off → stage back to calling, history recorded
  UPDATE leads SET joinery_received = false WHERE id = v_lead;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  SELECT current_stage INTO v_text FROM leads WHERE id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 AND v_text = 'calling' THEN 'PASS' ELSE 'FAIL' END || '  T07a BDM edits pool lead; joinery off → calling (rows ' || v_int || ', stage ' || coalesce(v_text, 'NULL') || ')'));
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 2 THEN 'PASS' ELSE 'FAIL' END || '  T07b the derived stage change is recorded (history rows ' || v_int || ')'));

  -- T08 BDM cannot assign the pool lead to an exec
  BEGIN
    UPDATE leads SET owner_employee_id = v_exec_id WHERE id = v_lead;
    GET DIAGNOSTICS v_int = ROW_COUNT;
    lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T08 BDM assigning a pool lead to an exec is refused (rows ' || v_int || ')'));
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T08 BDM assigning a pool lead to an exec is refused');
  END;

  -- T09 BDM cannot take the pool lead themselves
  BEGIN
    UPDATE leads SET owner_employee_id = v_bdm_id WHERE id = v_lead;
    GET DIAGNOSTICS v_int = ROW_COUNT;
    lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T09 BDM taking a pool lead for themselves is refused (rows ' || v_int || ')'));
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T09 BDM taking a pool lead for themselves is refused');
  END;

  -- T10 BDM cannot insert a lead owned by an exec
  BEGIN
    INSERT INTO leads (party_id, owner_employee_id, source_type) VALUES (v_client, v_exec_id, 'referral_architect');
    lines := array_append(lines, 'FAIL  T10 BDM inserting a lead owned by an exec was ALLOWED');
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T10 BDM inserting a lead owned by an exec is refused');
  END;

  -- T11 / T12 BDM cannot see an exec's own lead or its activities
  IF v_exec_lead IS NOT NULL THEN
    SELECT count(*) INTO v_int FROM leads WHERE id = v_exec_lead;
    lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T11 BDM cannot see an exec''s own lead'));
    SELECT count(*) INTO v_int FROM activities WHERE lead_id = v_exec_lead;
    lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T12 BDM cannot see activities on an exec''s own lead'));
  ELSE
    lines := array_append(lines, 'SKIP  T11/T12 no untagged exec lead found');
  END IF;

  -- T13 architects are visible company-wide
  IF v_other_arch IS NOT NULL THEN
    SELECT count(*) INTO v_int FROM parties WHERE id = v_other_arch;
    lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T13 BDM can see an architect someone else created'));
  ELSE
    lines := array_append(lines, 'SKIP  T13 no other architect exists');
  END IF;

  PERFORM set_config('role', 'none', true);

  -- T14 owners notified of the pool lead (as postgres)
  SELECT count(*) INTO v_int FROM notifications WHERE lead_id = v_lead AND kind = 'bdm_pool_lead';
  lines := array_append(lines, (CASE WHEN v_int = v_owner_count THEN 'PASS' ELSE 'FAIL' END || '  T14 every active owner notified of the pool lead (' || v_int || ' of ' || v_owner_count || ')'));

  -- =====================================================
  -- AS THE EXEC
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- T15 exec cannot see the pool lead
  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T15 exec cannot see an unassigned pool lead'));

  -- T16 exec cannot forge a BDM tag or a creator on insert
  INSERT INTO leads (party_id, owner_employee_id, source_type, bdm_employee_id, created_by_employee_id)
  VALUES (v_client, v_exec_id, 'referral_architect', v_bdm_id, v_owner_id)
  RETURNING id INTO v_forged;
  SELECT * INTO v_rec FROM leads WHERE id = v_forged;
  lines := array_append(lines, (CASE WHEN v_rec.bdm_employee_id IS NULL THEN 'PASS' ELSE 'FAIL' END || '  T16a exec-supplied bdm_employee_id is discarded'));
  lines := array_append(lines, (CASE WHEN v_rec.created_by_employee_id = v_exec_id THEN 'PASS' ELSE 'FAIL' END || '  T16b exec-supplied created_by_employee_id is discarded'));

  -- T17 exec cannot rewrite them on update
  UPDATE leads SET bdm_employee_id = v_bdm_id, created_by_employee_id = v_owner_id WHERE id = v_forged;
  SELECT * INTO v_rec FROM leads WHERE id = v_forged;
  lines := array_append(lines, (CASE WHEN v_rec.bdm_employee_id IS NULL AND v_rec.created_by_employee_id = v_exec_id THEN 'PASS' ELSE 'FAIL' END || '  T17 exec cannot rewrite the tag or creator on update'));

  -- =====================================================
  -- AS THE OWNER: assign the pool lead to the exec
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_owner_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  UPDATE leads SET owner_employee_id = v_exec_id WHERE id = v_lead;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T18 owner assigns the pool lead to the exec'));

  PERFORM set_config('role', 'none', true);

  -- T19 hand-over + notifications (as postgres)
  SELECT discovered_by INTO v_int FROM sites WHERE id = v_site;
  lines := array_append(lines, (CASE WHEN v_int = v_exec_id THEN 'PASS' ELSE 'FAIL' END || '  T19a site handed to the exec on assignment'));
  SELECT created_by INTO v_int FROM parties WHERE id = v_client;
  lines := array_append(lines, (CASE WHEN v_int = v_exec_id THEN 'PASS' ELSE 'FAIL' END || '  T19b client handed to the exec on assignment'));
  SELECT created_by INTO v_int FROM parties WHERE id = v_arch;
  lines := array_append(lines, (CASE WHEN v_int = v_bdm_id THEN 'PASS' ELSE 'FAIL' END || '  T19c architect stays with the BDM'));
  SELECT count(*) INTO v_int FROM notifications WHERE lead_id = v_lead AND kind = 'bdm_lead_assigned' AND employee_id = v_bdm_id;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T19d BDM notified of the assignment'));
  SELECT count(*) INTO v_int FROM notifications WHERE lead_id = v_lead AND kind = 'lead_assigned' AND employee_id = v_exec_id;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T19e exec notified of the assignment (existing trigger)'));

  -- =====================================================
  -- AS THE EXEC: work the lead
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  UPDATE sites SET locality = 'ZZ verify locality' WHERE id = v_site;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T20 exec can edit the site of the assigned lead'));

  INSERT INTO activities (employee_id, lead_id, activity_type, notes)
  VALUES (v_exec_id, v_lead, 'call', 'ZZ verify call');

  -- Exactly what LeadStageSection does for Lost: stage, history row, reason.
  UPDATE leads SET current_stage = 'lost' WHERE id = v_lead;
  INSERT INTO stage_history (lead_id, stage, changed_by) VALUES (v_lead, 'lost', v_exec_id);
  INSERT INTO loss_reasons (lead_id, reason) VALUES (v_lead, 'price');

  PERFORM set_config('role', 'none', true);

  SELECT count(*) INTO v_int FROM notifications WHERE lead_id = v_lead AND kind = 'bdm_lead_lost' AND employee_id = v_bdm_id;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T21 BDM notified when the exec marks the lead lost'));

  -- =====================================================
  -- AS THE BDM again: view only after handoff
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_bdm_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bdm_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    UPDATE leads SET joinery_received = true WHERE id = v_lead;
    GET DIAGNOSTICS v_int = ROW_COUNT;
    lines := array_append(lines, (CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END || '  T22 BDM can no longer edit the lead after assignment (rows ' || v_int || ')'));
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T22 BDM can no longer edit the lead after assignment');
  END;

  BEGIN
    INSERT INTO lead_remarks (lead_id, employee_id, body) VALUES (v_lead, v_bdm_id, 'ZZ late remark');
    lines := array_append(lines, 'FAIL  T23 BDM added a remark AFTER assignment (should be capture only)');
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T23 BDM cannot add a remark after assignment');
  END;

  SELECT count(*) INTO v_int FROM leads WHERE id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24a BDM still sees the lead after handoff'));
  SELECT count(*) INTO v_int FROM parties WHERE id = v_client;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24b BDM still sees the client (no "Lead #id")'));
  SELECT count(*) INTO v_int FROM sites WHERE id = v_site;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24c BDM still sees the site'));
  SELECT count(*) INTO v_int FROM stage_history WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int >= 3 THEN 'PASS' ELSE 'FAIL' END || '  T24d BDM sees stage history (rows ' || v_int || ')'));
  SELECT count(*) INTO v_int FROM activities WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24e BDM sees the exec''s activity'));
  SELECT count(*) INTO v_int FROM loss_reasons WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24f BDM sees the loss reason'));
  SELECT count(*) INTO v_int FROM lead_remarks WHERE lead_id = v_lead;
  lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T24g BDM reads the capture remark'));
  SELECT count(*) INTO v_int FROM lead_owner_history WHERE lead_id = v_lead;
  lines := array_append(lines, ('INFO  T24h BDM sees ' || v_int || ' ownership-history rows (0 expected here: this test assigns by UPDATE only, the app also writes history)'));

  PERFORM set_config('role', 'none', true);

  -- =====================================================
  -- EXISTING ROLES UNCHANGED + deactivation block
  -- =====================================================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF v_exec_lead IS NOT NULL THEN
    SELECT count(*) INTO v_int FROM leads WHERE id = v_exec_lead;
    lines := array_append(lines, (CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END || '  T25 exec still sees their own lead'));
  END IF;
  PERFORM set_config('role', 'none', true);

  BEGIN
    UPDATE employees SET is_active = false WHERE id = v_bdm_id;
    lines := array_append(lines, 'FAIL  T26 a BDM holding architects was DEACTIVATED');
  EXCEPTION WHEN OTHERS THEN
    lines := array_append(lines, 'PASS  T26 deactivating a BDM who holds architects is blocked');
  END;

  -- ---------------- report ----------------
  SELECT count(*) INTO n_fail FROM unnest(lines) x WHERE x LIKE 'FAIL%';
  RAISE EXCEPTION E'BDM VERIFY — % failed. Nothing was saved (this error rolls everything back).\n%',
    n_fail, array_to_string(lines, E'\n');
END
$verify$;
