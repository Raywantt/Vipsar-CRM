-- ============================================================
-- MEASUREMENT (read-only — changes nothing), 2026-09-21.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this WHOLE file → Run.
-- It returns ONE table (section, who, item, ms, detail). Download it as CSV.
-- Takes about 20–40 seconds.
--
-- WHAT IT MEASURES. The app's heaviest queries, timed INSIDE the database
-- (no network), once as a real account of each role — the way the app runs
-- them, permission rules (RLS) included — and once as `postgres`, which
-- skips the permission rules. The gap between the two is what the rules cost.
-- Also lists every permission rule and index, so the fix can be targeted.
--
-- "Acting as" a role uses Supabase's documented way to test RLS from the SQL
-- Editor: SET LOCAL ROLE authenticated + the account's id in
-- request.jwt.claims, inside this one transaction. Nothing is written except
-- a temporary table that disappears when the editor session ends.
-- ============================================================

CREATE TEMP TABLE IF NOT EXISTS _perf (
  n int, section text, who text, item text, ms numeric, detail text
);
TRUNCATE _perf;

DO $$
DECLARE
  p     record;
  q     record;
  plan  json;
  top   text;
  i     int := 0;
BEGIN
  FOR p IN
    SELECT * FROM (
      -- One real account per role: the active, non-test employee of that
      -- role who owns the most leads (so the numbers reflect real data).
      SELECT DISTINCT ON (e.role) e.role::text AS role, e.name::text AS name, e.auth_user_id::text AS uid
        FROM employees e
       WHERE e.is_active AND NOT e.is_test_account AND e.auth_user_id IS NOT NULL
       ORDER BY e.role, (SELECT count(*) FROM leads l WHERE l.owner_employee_id = e.id) DESC, e.id
    ) personas
    UNION ALL
    SELECT 'zz no permission rules', 'postgres', NULL
  LOOP
    FOR q IN SELECT * FROM (VALUES
      ('01 leads: full download for dashboards', $q$
        SELECT l.id, l.external_reference_id, l.current_stage, l.order_value, l.site_id, l.owner_employee_id,
               l.bdm_employee_id, l.source_type, l.office_territory, l.quote_sent, l.quote_sent_at, l.rfq_raised,
               l.rfq_raised_at, l.quote_value, l.closure_probability, l.estimated_close_date, l.next_followup_date, l.created_at,
               (SELECT row_to_json(x) FROM (SELECT p.name FROM parties p WHERE p.id = l.party_id) x) AS parties,
               (SELECT row_to_json(x) FROM (SELECT s.nickname, s.locality, s.house_no, s.site_stage, s.area_id,
                   (SELECT row_to_json(y) FROM (SELECT a.area_name FROM areas a WHERE a.id = s.area_id) y) AS areas
                  FROM sites s WHERE s.id = l.site_id) x) AS sites,
               (SELECT row_to_json(x) FROM (SELECT e.name FROM employees e WHERE e.id = l.owner_employee_id) x) AS employees,
               (SELECT row_to_json(x) FROM (SELECT pr.name, pr.category FROM products pr WHERE pr.id = l.product_id) x) AS products
          FROM leads l
         WHERE l.owner_employee_id IS NOT NULL OR l.bdm_employee_id IS NULL $q$),
      ('02 activities: last-touched download', $q$
        SELECT a.lead_id, a.created_at FROM activities a WHERE a.lead_id IS NOT NULL $q$),
      ('03 stage history: funnel download', $q$
        SELECT sh.lead_id, sh.stage, sh.changed_at,
               (SELECT row_to_json(x) FROM (SELECT l.owner_employee_id, l.bdm_employee_id FROM leads l WHERE l.id = sh.lead_id) x) AS leads
          FROM stage_history sh ORDER BY sh.changed_at $q$),
      ('04 activities: this month (activity counts)', $q$
        SELECT a.activity_type, a.employee_id, a.rfq_kind, a.created_at, a.lead_id,
               (SELECT row_to_json(x) FROM (SELECT e.name FROM employees e WHERE e.id = a.employee_id) x) AS employees
          FROM activities a WHERE a.created_at >= date_trunc('month', now()) $q$),
      ('05 function: leads_needing_attention', $q$
        SELECT * FROM leads_needing_attention(now(), current_date, 330) $q$),
      ('06 function: leads_category_breakdown', $q$
        SELECT * FROM leads_category_breakdown(NULL) $q$),
      ('07 function: dashboard_snapshot_metrics', $q$
        SELECT * FROM dashboard_snapshot_metrics(NULL, now(), 330, 0.1) $q$),
      ('08 contacts: name search', $q$
        SELECT p.id, p.name, p.mobile, p.party_type FROM parties p
         WHERE p.name ILIKE '%singh%' OR p.mobile ILIKE '%singh%' ORDER BY p.name LIMIT 100 $q$),
      ('09 areas: full list', $q$
        SELECT a.id, a.area_name, a.city FROM areas a ORDER BY a.area_name, a.id $q$),
      ('10 follow-ups: open, due by today', $q$
        SELECT f.id, f.title, f.due_date,
               (SELECT row_to_json(x) FROM (SELECT l.id, l.current_stage,
                   (SELECT row_to_json(y) FROM (SELECT pp.name FROM parties pp WHERE pp.id = l.party_id) y) AS parties
                  FROM leads l WHERE l.id = f.lead_id) x) AS leads,
               (SELECT row_to_json(x) FROM (SELECT e.name FROM employees e WHERE e.id = f.assigned_to) x) AS assigned_to_employee
          FROM follow_ups f WHERE f.status = 'open' AND f.due_date <= current_date $q$),
      ('11 sites: search by locality', $q$
        SELECT s.id FROM sites s WHERE s.nickname ILIKE '%road%' OR s.locality ILIKE '%road%' LIMIT 100 $q$)
    ) v(name, sql)
    LOOP
      i := i + 1;
      BEGIN
        IF p.uid IS NOT NULL THEN
          PERFORM set_config('request.jwt.claims',
                             json_build_object('sub', p.uid, 'role', 'authenticated')::text, true);
          EXECUTE 'SET LOCAL ROLE authenticated';
        END IF;
        EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON) ' || q.sql INTO plan;
        EXECUTE 'RESET ROLE';

        -- The busiest inner steps: anything run once per row (loops > 1) or a
        -- full-table scan, heaviest first — this is where RLS cost shows up.
        WITH RECURSIVE nodes(node) AS (
          SELECT plan->0->'Plan'
          UNION ALL
          SELECT c FROM nodes, json_array_elements(nodes.node->'Plans') c
        )
        SELECT string_agg(label, ' ; ') INTO top FROM (
          SELECT format('%s%s ×%s = %s ms',
                        node->>'Node Type',
                        COALESCE(' on ' || (node->>'Relation Name'), ''),
                        node->>'Actual Loops',
                        round((node->>'Actual Total Time')::numeric * (node->>'Actual Loops')::numeric, 1)) AS label
            FROM nodes
           WHERE (node->>'Actual Loops')::numeric > 1 OR node->>'Node Type' = 'Seq Scan'
           ORDER BY (node->>'Actual Total Time')::numeric * (node->>'Actual Loops')::numeric DESC
           LIMIT 5
        ) t;

        INSERT INTO _perf VALUES (i, 'timing', p.role || ' — ' || p.name, q.name,
          round((plan->0->>'Execution Time')::numeric + (plan->0->>'Planning Time')::numeric, 1),
          'rows ' || COALESCE(plan->0->'Plan'->>'Actual Rows', '?') || ' | ' || COALESCE(top, ''));
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO _perf VALUES (i, 'timing', p.role || ' — ' || p.name, q.name, NULL, 'ERROR: ' || SQLERRM);
      END;
    END LOOP;
  END LOOP;
END $$;

SELECT section, who, item, ms, detail FROM (
  SELECT 1 AS s, n AS k, section, who, item, ms, detail FROM _perf
  UNION ALL
  SELECT 2, 0, 'policy', tablename::text,
         policyname || ' [' || cmd || CASE WHEN permissive = 'RESTRICTIVE' THEN ', restrictive' ELSE '' END || ']',
         NULL,
         'USING: ' || COALESCE(qual, '-') || COALESCE(' | CHECK: ' || with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 3, 0, 'index', tablename::text, indexname::text, NULL, indexdef
    FROM pg_indexes WHERE schemaname = 'public'
) r
ORDER BY s, k, who, item;
