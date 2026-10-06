-- ============================================================
-- VERIFY: migration_lead_products.sql, as REAL sessions
--
-- Several products per lead, the RFQ's own copy, quotes per product and the
-- by-product report — run as the test logins (exec, production-exec,
-- estimation-exec) the way Schema/verify_rfq_desk.sql impersonates them.
--
-- NOTHING IS SAVED: one DO block that ends by raising an error on purpose,
-- which rolls back every row it made. ► THE RED ERROR BOX IS THE REPORT. ◄
--
-- NEEDS: migration_products_portfolio.sql, migration_products_order.sql and
-- migration_lead_products.sql already run; the three test logins.
-- ============================================================

DO $verify$
DECLARE
  v_exec_id integer;  v_exec_uid uuid;
  v_pe_uid  uuid;
  v_ee_uid  uuid;
  v_tostem  integer := (SELECT id FROM products WHERE name = 'Tostem');
  v_in16    integer := (SELECT id FROM products WHERE name = 'IN16');
  v_site    integer;
  v_lead    integer;
  v_rfq     rfqs;
  v_lead_row leads;
  v_ok      boolean;
  v_text    text;
  v_before  numeric;
  v_after   numeric;
  lines  text[] := ARRAY[]::text[];
  n_fail integer;
BEGIN
  SELECT id, auth_user_id INTO v_exec_id, v_exec_uid FROM employees
   WHERE role = 'sales_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id INTO v_pe_uid FROM employees
   WHERE role = 'production_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT auth_user_id INTO v_ee_uid FROM employees
   WHERE role = 'estimation_executive' AND is_test_account AND is_active AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_exec_id IS NULL OR v_pe_uid IS NULL OR v_ee_uid IS NULL OR v_tostem IS NULL OR v_in16 IS NULL THEN
    RAISE EXCEPTION 'SETUP: need the three test logins and the products Tostem and IN16.';
  END IF;
  UPDATE rfq_desk_settings SET live_from = COALESCE(live_from, now());

  -- The exec's by-product figure for IN16 before, to measure the change.
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT COALESCE(sum(deal_value), 0) INTO v_before FROM leads_category_breakdown(ARRAY[v_exec_id])
   WHERE category_group = 'product' AND category = 'IN16';

  -- ---- the exec: a lead with two products ----
  INSERT INTO sites (locality, discovered_by) VALUES ('Products verify site', v_exec_id) RETURNING id INTO v_site;
  INSERT INTO leads (site_id, owner_employee_id, created_by_employee_id, source_type, office_territory, current_stage, product_ids)
  VALUES (v_site, v_exec_id, v_exec_id, 'scanning', 'ludhiana', 'calling', ARRAY[v_tostem, v_in16])
  RETURNING id INTO v_lead;
  SELECT * INTO v_lead_row FROM leads WHERE id = v_lead;
  lines := lines || format('%s L1 a lead takes two products, and product_id mirrors the first (%s, %s)',
    CASE WHEN v_lead_row.product_ids = ARRAY[v_tostem, v_in16] AND v_lead_row.product_id = v_tostem THEN 'PASS' ELSE 'FAIL' END,
    v_lead_row.product_ids, v_lead_row.product_id);

  -- The build from before writes product_id only: the list follows.
  UPDATE leads SET product_id = v_in16 WHERE id = v_lead;
  SELECT * INTO v_lead_row FROM leads WHERE id = v_lead;
  lines := lines || format('%s L2 an old-style product_id write becomes the list (%s)',
    CASE WHEN v_lead_row.product_ids = ARRAY[v_in16] THEN 'PASS' ELSE 'FAIL' END, v_lead_row.product_ids);
  UPDATE leads SET product_ids = ARRAY[v_tostem, v_in16] WHERE id = v_lead;

  v_ok := false;
  BEGIN
    UPDATE leads SET product_ids = ARRAY[v_tostem, v_tostem] WHERE id = v_lead;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  lines := lines || format('%s L3 a product listed twice is refused', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);

  -- ---- RFQ Raised with products → the RFQ keeps its own copy ----
  INSERT INTO activities (employee_id, lead_id, activity_type, rfq_kind, rfq_window_count, rfq_product_ids, notes)
  VALUES (v_exec_id, v_lead, 'rfq_raised', 'fresh', 8, ARRAY[v_tostem, v_in16], 'products verify');
  SELECT * INTO v_rfq FROM rfqs WHERE lead_id = v_lead;
  lines := lines || format('%s R1 the RFQ keeps its own copy of the products (%s)',
    CASE WHEN v_rfq.product_ids = ARRAY[v_tostem, v_in16] THEN 'PASS' ELSE 'FAIL' END, v_rfq.product_ids);
  PERFORM set_config('role', 'none', true);

  -- ---- through the desk ----
  PERFORM set_config('request.jwt.claim.sub', v_pe_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pe_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM rfq_approve(v_rfq.id);
  PERFORM set_config('role', 'none', true);

  PERFORM set_config('request.jwt.claim.sub', v_ee_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ee_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM rfq_raise_with_lixil(v_rfq.id);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote_lines(v_rfq.id, 'VERIFY-1', jsonb_build_array(jsonb_build_object('product_id', v_tostem, 'value', 600000)), NULL);
  EXCEPTION WHEN check_violation THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s Q1 a quote missing a product is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_ok := false; v_text := NULL;
  BEGIN
    PERFORM rfq_record_quote_lines(v_rfq.id, 'VERIFY-1', jsonb_build_array(
      jsonb_build_object('product_id', v_tostem, 'value', 600000),
      jsonb_build_object('product_id', v_in16, 'value', 0)), NULL);
  EXCEPTION WHEN check_violation THEN v_ok := true; v_text := SQLERRM;
  END;
  lines := lines || format('%s Q2 a zero value is refused (%s)', CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END, v_text);

  v_rfq := rfq_record_quote_lines(v_rfq.id, 'VERIFY-1', jsonb_build_array(
    jsonb_build_object('product_id', v_tostem, 'value', 600000),
    jsonb_build_object('product_id', v_in16, 'value', 400000)), NULL);
  PERFORM set_config('role', 'none', true);
  SELECT * INTO v_lead_row FROM leads WHERE id = v_lead;
  lines := lines || format('%s Q3 a quote per product: RFQ %s (%s), the lead''s quote value is the sum (%s) and carries the split (%s lines)',
    CASE WHEN v_rfq.status = 'quoted' AND v_rfq.quote_value = 1000000 AND v_lead_row.quote_value = 1000000
              AND jsonb_array_length(v_lead_row.quote_lines) = 2 THEN 'PASS' ELSE 'FAIL' END,
    v_rfq.status, v_rfq.quote_value, v_lead_row.quote_value, jsonb_array_length(v_lead_row.quote_lines));

  -- ---- Leads by product, as the exec ----
  PERFORM set_config('request.jwt.claim.sub', v_exec_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_exec_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT COALESCE(sum(deal_value), 0) INTO v_after FROM leads_category_breakdown(ARRAY[v_exec_id])
   WHERE category_group = 'product' AND category = 'IN16';
  lines := lines || format('%s B1 Leads by product puts the lead under IN16 at its quoted share (+%s)',
    CASE WHEN v_after - v_before = 400000 THEN 'PASS' ELSE 'FAIL' END, v_after - v_before);
  PERFORM set_config('role', 'none', true);

  -- ---- the change log ----
  SELECT new_value INTO v_text FROM lead_change_log
   WHERE lead_id = v_lead AND field = 'product' ORDER BY id DESC LIMIT 1;
  lines := lines || format('%s C1 the change log names the products (%s)',
    CASE WHEN v_text = 'Tostem + IN16' THEN 'PASS' ELSE 'FAIL' END, v_text);

  SELECT count(*) INTO n_fail FROM unnest(lines) l WHERE l LIKE 'FAIL%';
  RAISE EXCEPTION E'LEAD PRODUCTS VERIFY — % failed. Nothing was saved (this error rolls everything back).\n%',
    n_fail, array_to_string(lines, E'\n');
END
$verify$;
