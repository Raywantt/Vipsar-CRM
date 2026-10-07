-- ============================================================
-- VERIFY: migration_manager_team_activity.sql, as REAL sessions
--
-- Impersonates the test logins the same way Schema/verify_rfq_desk.sql does
-- (the `authenticated` role + the JWT's `sub`), so current_employee_id() and
-- every policy evaluate exactly as in the app.
--
-- What it proves, on a throwaway lead owned by the test exec:
--   1. the manager can log an activity on a lead that isn't theirs (no new
--      policy needed), and reads it back;
--   2. `activities` RLS is UNTOUCHED — the exec and the coordinator still read
--      0 activity rows on that lead, so the manager's row can never leak into
--      a count either of them runs;
--   3. manager_activity_on_team_leads() hands the row to the exec and to the
--      exec's coordinator, and to nobody else (not the manager — RLS gives them
--      their own — and not the exec once they stop reporting to that manager);
--   4. it counts as a touch: last_activity_per_lead() sees it, and a lead that
--      was stale (30 days untouched) stops being stale in
--      leads_needing_attention().
--
-- NOTHING IS SAVED. It all runs in one DO block that ends by raising an error
-- on purpose, which rolls back every row it made and the reporting lines it
-- changed. ► THE RED ERROR BOX IS THE REPORT. ◄
--
-- NEEDS: migration_manager_team_activity.sql already run; active TEST logins
-- (is_test_account, with a Supabase Auth user) for a sales_manager, a
-- sales_executive and a sales_coordinator.
--
-- RUN: paste into the Supabase SQL Editor, press Run, copy the whole error
-- message back.
-- ============================================================

DO $verify$
DECLARE
  v_mgr_id   integer;  v_mgr_uid   uuid;
  v_exec_id  integer;  v_exec_uid  uuid;
  v_coord_id integer;  v_coord_uid uuid;
  v_client   integer;
  v_site     integer;
  v_lead     integer;
  v_act      integer;
  v_int      integer;
  v_int2     integer;
  lines  text[] := ARRAY[]::text[];
  n_fail integer;
BEGIN
  -- ================= setup (as postgres) =================
  SELECT id, auth_user_id INTO v_mgr_id, v_mgr_uid FROM employees
   WHERE role = 'sales_manager' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_exec_id, v_exec_uid FROM employees
   WHERE role = 'sales_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id, auth_user_id INTO v_coord_id, v_coord_uid FROM employees
   WHERE role = 'sales_coordinator' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_mgr_id IS NULL OR v_exec_id IS NULL OR v_coord_id IS NULL THEN
    RAISE EXCEPTION 'SETUP: need active TEST logins for a sales_manager, a sales_executive and a sales_coordinator.';
  END IF;

  -- The exec reports to both (rolled back with everything else).
  UPDATE employees SET manager_id = v_mgr_id, coordinator_id = v_coord_id WHERE id = v_exec_id;

  INSERT INTO parties (party_type, name, created_by) VALUES ('client', 'Manager-activity verify client', v_exec_id) RETURNING id INTO v_client;
  INSERT INTO sites (locality, discovered_by) VALUES ('Manager-activity verify site', v_exec_id) RETURNING id INTO v_site;
  INSERT INTO leads (site_id, party_id, owner_employee_id, created_by_employee_id, source_type, office_territory, current_stage)
  VALUES (v_site, v_client, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling') RETURNING id INTO v_lead;
  -- 30 days untouched, not an import: stale under every threshold.
  UPDATE leads SET created_at = now() - interval '30 days' WHERE id = v_lead;

  -- ================= before: the exec's lead reads stale =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM leads_needing_attention(now(), current_date, 0) n
   WHERE n.lead_id = v_lead AND n.is_stale;
  lines := lines || format('%s T1 before the visit the exec''s lead is stale (%s row)',
    CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= the manager logs on the exec's lead =================
  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  INSERT INTO activities (employee_id, lead_id, activity_type, notes)
  VALUES (v_mgr_id, v_lead, 'call', 'manager-activity verify') RETURNING id INTO v_act;
  SELECT count(*) INTO v_int FROM activities WHERE id = v_act;
  lines := lines || format('%s T2 the manager logs an activity on a team member''s lead, and reads it back (%s row)',
    CASE WHEN v_act IS NOT NULL AND v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);
  SELECT count(*) INTO v_int FROM last_activity_per_lead() p WHERE p.lead_id = v_lead;
  SELECT count(*) INTO v_int2 FROM manager_activity_on_team_leads(v_lead);
  lines := lines || format('%s T3 the manager sees the lead in last_activity_per_lead() through RLS (%s) and gets nothing from the exec-side function (%s)',
    CASE WHEN v_int = 1 AND v_int2 = 0 THEN 'PASS' ELSE 'FAIL' END, v_int, v_int2);
  PERFORM set_config('role', 'none', true);

  -- ================= the exec =================
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM activities WHERE lead_id = v_lead;
  lines := lines || format('%s T4 RLS is untouched: the exec still reads 0 activity rows on their lead, so it can''t reach any count (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  SELECT count(*) INTO v_int FROM manager_activity_on_team_leads(v_lead) m WHERE m.employee_id = v_mgr_id AND m.id = v_act;
  lines := lines || format('%s T5 the exec reads their manager''s activity through manager_activity_on_team_leads() (%s row)',
    CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);
  SELECT count(*) INTO v_int FROM last_activity_per_lead() p WHERE p.lead_id = v_lead;
  lines := lines || format('%s T6 it counts as a touch in last_activity_per_lead() (%s row)',
    CASE WHEN v_int = 1 THEN 'PASS' ELSE 'FAIL' END, v_int);
  SELECT count(*) INTO v_int FROM leads_needing_attention(now(), current_date, 0) n
   WHERE n.lead_id = v_lead AND (n.is_stale OR n.is_stale_7d);
  lines := lines || format('%s T7 …so the lead is no longer stale in leads_needing_attention() (%s stale row)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= the exec's coordinator =================
  PERFORM set_config('request.jwt.claim.sub', v_coord_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM activities WHERE lead_id = v_lead AND employee_id = v_mgr_id;
  SELECT count(*) INTO v_int2 FROM manager_activity_on_team_leads(v_lead);
  lines := lines || format('%s T8 the coordinator reads it through the function (%s row) while RLS still shows them 0 (%s rows)',
    CASE WHEN v_int2 = 1 AND v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int2, v_int);
  SELECT count(*) INTO v_int FROM leads_needing_attention(now(), current_date, 0) n
   WHERE n.lead_id = v_lead AND (n.is_stale OR n.is_stale_7d);
  lines := lines || format('%s T9 …and the lead is not stale on their screen either (%s stale row)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= it follows the reporting line =================
  -- Once the exec no longer reports to that manager, the manager is not "their
  -- manager" and the row is not handed to them.
  UPDATE employees SET manager_id = NULL WHERE id = v_exec_id;
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_int FROM manager_activity_on_team_leads(v_lead);
  lines := lines || format('%s T10 an exec who no longer reports to that manager is handed nothing (%s rows)',
    CASE WHEN v_int = 0 THEN 'PASS' ELSE 'FAIL' END, v_int);
  PERFORM set_config('role', 'none', true);

  -- ================= report (rolls everything back) =================
  SELECT count(*) INTO n_fail FROM unnest(lines) l WHERE l LIKE 'FAIL%';
  RAISE EXCEPTION E'\n=== verify_manager_team_activity: % FAIL ===\n%\n(nothing was saved — this error is the report)',
    n_fail, array_to_string(lines, E'\n');
END
$verify$;
