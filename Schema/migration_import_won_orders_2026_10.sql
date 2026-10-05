-- Import 12 booked orders from the owner's "Order Value without GST" sheet
-- (the ones with no CRM lead) as new WON leads.  Run in the Supabase SQL Editor.
--
-- What each order becomes:
--   party   : client, name + city from the sheet, no mobile
--   site    : an empty sites row (every lead has one — see LeadQuickCapture)
--   lead    : current_stage 'won', order_value = value WITHOUT GST,
--             source 'showroom_walkin' (neutral; the column is required),
--             no product, office from the sheet,
--             created_at / lead_generated_at = booked-on date,
--             external_reference_id = 'won-import-<order no>'  <- the tag
--   stage_history : one 'won' row at booked-on 12:00, so the order lands in
--             the right month's booked figure.
--
-- Safe to re-run: an order already imported (same marker) is skipped.
-- All-or-nothing: any problem (e.g. an employee name that matches 0 or 2
-- people) raises and nothing is written.
-- Owners are resolved by name; check the NOTICE lines before trusting it.

DO $$
DECLARE
  r        record;
  o        record;
  v_owner  integer;
  v_party  integer;
  v_site   integer;
  v_lead   integer;
  v_made   integer := 0;
  v_skip   integer := 0;
  v_names  text[] := ARRAY['Raywant', 'Vipin Beniwal', 'Pawan Kumar', 'Manohar Mishra'];
  n        text;
  c        integer;
BEGIN
  -- 1. every owner name must resolve to exactly one active employee
  FOREACH n IN ARRAY v_names LOOP
    SELECT count(*) INTO c FROM employees WHERE is_active AND name ILIKE n || '%';
    IF c <> 1 THEN
      RAISE EXCEPTION 'Owner "%" matches % active employees (need exactly 1). Nothing written.', n, c;
    END IF;
    RAISE NOTICE 'Owner "%" -> %', n, (SELECT name || ' (id ' || id || ', ' || role || ')' FROM employees WHERE is_active AND name ILIKE n || '%');
  END LOOP;

  -- 2. the orders
  FOR r IN
    SELECT * FROM (VALUES
      (58,  DATE '2026-04-20', 'PARAMPREET SINGH',      'LUDHIANA',  'Raywant',        181560,   'ludhiana'),
      (103, DATE '2026-06-03', 'SHIVAM KAURA',          'LUDHIANA',  'Raywant',        246075,   'ludhiana'),
      (107, DATE '2026-06-16', 'MANISH BANSAL',         'LUDHIANA',  'Raywant',        1682475,  'ludhiana'),
      (135, DATE '2026-07-10', 'DAMAN DHILLON',         'LUDHIANA',  'Raywant',        2750000,  'ludhiana'),
      (81,  DATE '2026-05-01', 'Radha Vallabh Trader',  'LUDHIANA',  'Raywant',        67486,    'ludhiana'),
      (84,  DATE '2026-05-22', 'PRAVEEN KUMAR',         'LUDHIANA',  'Raywant',        535130,   'ludhiana'),
      (85,  DATE '2026-05-21', 'SHANKAR SINGLA',        'LUDHIANA',  'Raywant',        88934,    'ludhiana'),
      (104, DATE '2026-06-03', 'AKASH MITTAL',          'LUDHIANA',  'Raywant',        224000,   'ludhiana'),
      (121, DATE '2026-06-30', 'RAJBIR HISAR',          'AMRITSAR',  'Vipin Beniwal',  1203517,  'ludhiana'),
      (128, DATE '2026-06-30', 'VISHAL MOHAN GUPTA 2',  'AMRITSAR',  'Pawan Kumar',    70700,    'amritsar'),
      (144, DATE '2026-08-12', 'RINKU/ RANJU',          'AMRITSAR',  'Pawan Kumar',    290448,   'amritsar'),
      (145, DATE '2026-08-19', 'RAJINDER SINGH',        'JALANDHAR', 'Manohar Mishra', 1061448,  'jalandhar')
    ) AS t(order_no, booked_on, customer, city, owner_name, value, office)
    ORDER BY order_no
  LOOP
    IF EXISTS (SELECT 1 FROM leads WHERE external_reference_id = 'won-import-' || r.order_no) THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_owner FROM employees WHERE is_active AND name ILIKE r.owner_name || '%';

    INSERT INTO parties (party_type, name, city, created_by)
    VALUES ('client', r.customer, initcap(r.city), v_owner)
    RETURNING id INTO v_party;

    INSERT INTO sites (discovered_via, discovered_by)
    VALUES ('showroom_walkin', v_owner)
    RETURNING id INTO v_site;

    INSERT INTO leads (
      site_id, party_id, owner_employee_id, source_type, external_reference_id,
      office_territory, lead_generated_at, current_stage, order_value, created_at
    ) VALUES (
      v_site, v_party, v_owner, 'showroom_walkin', 'won-import-' || r.order_no,
      r.office, r.booked_on, 'won', r.value, (r.booked_on + TIME '12:00')::timestamp
    ) RETURNING id INTO v_lead;

    INSERT INTO stage_history (lead_id, stage, changed_by, changed_at)
    VALUES (v_lead, 'won', v_owner, (r.booked_on + TIME '12:00')::timestamp);

    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'Created % won leads, skipped % already imported.', v_made, v_skip;
END $$;

-- Check: expect 12 rows, total 8,401,773
SELECT l.id, l.external_reference_id, p.name AS customer, e.name AS owner,
       l.order_value, l.office_territory, l.current_stage,
       (SELECT max(changed_at) FROM stage_history s WHERE s.lead_id = l.id AND s.stage = 'won') AS won_at
FROM leads l
JOIN parties p ON p.id = l.party_id
JOIN employees e ON e.id = l.owner_employee_id
WHERE l.external_reference_id LIKE 'won-import-%'
ORDER BY l.external_reference_id;

SELECT count(*) AS leads, sum(order_value) AS total
FROM leads WHERE external_reference_id LIKE 'won-import-%';

-- UNDO (only if needed; run as a separate statement):
-- DELETE FROM stage_history WHERE lead_id IN (SELECT id FROM leads WHERE external_reference_id LIKE 'won-import-%');
-- WITH l AS (DELETE FROM leads WHERE external_reference_id LIKE 'won-import-%' RETURNING site_id, party_id),
--      s AS (DELETE FROM sites WHERE id IN (SELECT site_id FROM l)  RETURNING 1)
-- DELETE FROM parties WHERE id IN (SELECT party_id FROM l);
