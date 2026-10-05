-- Correct 51 existing won leads against the owner's "Order Value without GST"
-- sheet.  Run in the Supabase SQL Editor.
--
-- What it changes (only these, per lead):
--   * order_value      -> the sheet's value WITHOUT GST
--   * office_territory -> the sheet's office (Vikas Kansal #394 = patiala, the owner's call)
--   * won date         -> moves the lead's MOST RECENT 'won' stage_history row to
--                         the sheet's date at 12:00, so the order lands in the right
--                         month's booked figure. (stage_history is append-only for
--                         the app; the SQL Editor runs as postgres, so this works.)
--   * #1205 Krishnam Wahi's party: architect -> client
--   * Gundeep Singh has two orders in the CRM. The sheet's one order (no. 131,
--     5 Jul) goes on the later lead, #1127.
--
-- What it does NOT touch: owners (#1500 stays with Raghav Dhingra), stages,
-- #1103 (Sukhwinder Singh), PRAVAL (left out for now) and #691 (Gundeep's
-- other order, kept exactly as it is).
--
-- Guards: every lead must exist, be 'won', and its client name must contain the
-- expected word. Any miss raises and NOTHING is written (single transaction).
-- Safe to re-run. Undo: Schema/undo_fix_won_orders_from_sheet_2026_10.sql

DO $$
DECLARE
  r        record;
  v_stage  text;
  v_name   text;
  v_n     integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- lead, name guard,   order value, won date,           office
      (1500, 'KAUSHAL',      5884784, DATE '2026-06-22', NULL::text),
      (398,  'BALA',         326271,  DATE '2026-06-01', 'ludhiana'),
      (410,  'LAKSHEY',      836654,  DATE '2026-06-22', 'ludhiana'),
      (394,  'KANSAL',       1128420, DATE '2026-06-29', 'patiala'),
      (540,  'SHUBHAM',      691555,  NULL,              'ludhiana'),
      (594,  'PREM',         350049,  DATE '2026-04-04', NULL),
      (615,  'JASWANT',      225710,  DATE '2026-04-11', NULL),
      (542,  'ANMOL',        539605,  DATE '2026-05-25', NULL),
      (534,  'GOLDY',        706336,  DATE '2026-05-28', NULL),
      (539,  'GAGAN',        972260,  DATE '2026-05-29', NULL),
      (511,  'CHAWLA',       1008989, DATE '2026-05-29', NULL),
      (517,  'LOVEPREET',    457384,  DATE '2026-06-22', NULL),
      (535,  'SHIVAM',       1089255, DATE '2026-06-30', NULL),
      (605,  'GAGAN',        2319920, DATE '2026-06-30', NULL),
      (499,  'PARAMJIT',     1151675, DATE '2026-06-30', NULL),
      (500,  'KAPOOR',       1181345, DATE '2026-07-18', NULL),
      (598,  'VARINDER',     923172,  DATE '2026-08-06', NULL),
      (492,  'VIJAY',        1292708, DATE '2026-08-12', 'ludhiana'),
      (490,  'GURMEET',      894275,  DATE '2026-08-27', NULL),
      (337,  'LOVEADITYA',   1275886, DATE '2026-04-03', 'ludhiana'),
      (354,  'AGGARWAL',     855800,  DATE '2026-04-16', 'ludhiana'),
      (249,  'ASHISH',       530034,  DATE '2026-06-30', 'ludhiana'),
      (244,  'MAHAJAN',      543958,  DATE '2026-06-30', 'ludhiana'),
      (236,  'MALHOTRA',     900309,  DATE '2026-07-15', 'ludhiana'),
      (228,  'WATS',         922764,  DATE '2026-08-11', 'ludhiana'),
      (304,  'CHARANJ',      804833,  DATE '2026-04-17', 'ludhiana'),
      (445,  'MANPREET',     769125,  DATE '2026-04-17', NULL),
      (1204, 'ANURAG',       852000,  DATE '2026-04-01', 'amritsar'),
      (1203, 'ARVINDER',     1122700, DATE '2026-06-01', NULL),
      (1206, 'RATNA',        480750,  DATE '2026-06-30', NULL),
      (1205, 'WAHI',         2770600, DATE '2026-07-06', NULL),
      (846,  'GHUMAN',       838773,  DATE '2026-06-30', NULL),
      (845,  'NIRMAL',       1334755, DATE '2026-06-30', NULL),
      (844,  'INDERJEET',    1581229, DATE '2026-06-30', NULL),
      (1167, 'KABIR',        4299986, DATE '2026-06-16', NULL),
      (1114, 'AGAGRWAL',     3711822, DATE '2026-06-30', NULL),
      (1164, 'KHULLAR',      1892949, DATE '2026-08-11', 'jalandhar'),
      (779,  'CHETAN',       1463502, DATE '2026-08-19', NULL),
      (655,  'BUNTY',        2317045, DATE '2026-07-01', NULL),
      (1127, 'GUNDEEP',      2064107, DATE '2026-07-05', NULL),
      (737,  'DHIMAN',       1961745, DATE '2026-05-29', NULL),
      (724,  'SUSHIL',       596844,  DATE '2026-05-30', NULL),
      (756,  'BHAVYANSH',    1155271, DATE '2026-06-01', NULL),
      (712,  'MANJIT',       NULL,    DATE '2026-06-16', NULL),
      (703,  'AMANDEEP',     402180,  DATE '2026-06-17', NULL),
      (658,  'VICKY',        716314,  DATE '2026-08-03', NULL),
      (905,  'SODHI',        398380,  DATE '2026-07-05', NULL),
      (837,  'PANKAJ',       510981,  DATE '2026-08-03', NULL),
      (810,  'SHIVIN',       92179,   DATE '2026-08-19', NULL),
      (850,  'SHAM',         734694,  DATE '2026-08-27', NULL)
    ) AS t(lead_id, guard, value, won_on, office)
  LOOP
    SELECT l.current_stage, p.name INTO v_stage, v_name
    FROM leads l LEFT JOIN parties p ON p.id = l.party_id
    WHERE l.id = r.lead_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lead #% not found. Nothing written.', r.lead_id;
    END IF;
    IF v_stage IS DISTINCT FROM 'won' THEN
      RAISE EXCEPTION 'Lead #% is "%" not won. Nothing written.', r.lead_id, v_stage;
    END IF;
    IF v_name IS NULL OR v_name NOT ILIKE '%' || r.guard || '%' THEN
      RAISE EXCEPTION 'Lead #% client is "%", expected a name containing "%". Nothing written.', r.lead_id, v_name, r.guard;
    END IF;

    UPDATE leads
       SET order_value      = COALESCE(r.value::numeric, order_value),
           office_territory = COALESCE(r.office, office_territory)
     WHERE id = r.lead_id;

    IF r.won_on IS NOT NULL THEN
      UPDATE stage_history
         SET changed_at = (r.won_on + TIME '12:00')::timestamp
       WHERE id = (SELECT id FROM stage_history
                    WHERE lead_id = r.lead_id AND stage = 'won'
                    ORDER BY changed_at DESC, id DESC LIMIT 1);
      IF NOT FOUND THEN
        INSERT INTO stage_history (lead_id, stage, changed_at)
        VALUES (r.lead_id, 'won', (r.won_on + TIME '12:00')::timestamp);
      END IF;
    END IF;

    v_n := v_n + 1;
  END LOOP;

  -- Krishnam Wahi (#1205): the party was typed architect, the order is a client's
  UPDATE parties SET party_type = 'client'
   WHERE id = (SELECT party_id FROM leads WHERE id = 1205) AND party_type = 'architect';

  RAISE NOTICE 'Updated % existing leads.', v_n;
END $$;

-- Check: every row should now read as the sheet says
SELECT l.id, p.name AS client, p.party_type, e.name AS owner, l.office_territory,
       l.order_value,
       (SELECT max(changed_at)::date FROM stage_history s WHERE s.lead_id = l.id AND s.stage = 'won') AS won_on
FROM leads l
JOIN parties p ON p.id = l.party_id
LEFT JOIN employees e ON e.id = l.owner_employee_id
WHERE l.id IN (1500,398,410,394,540,594,615,542,534,539,511,517,535,605,499,500,598,492,490,337,354,249,244,236,228,304,445,
               1204,1203,1206,1205,846,845,844,1167,1114,1164,779,655,1127,737,724,756,712,703,658,905,837,810,850)
ORDER BY l.id;
