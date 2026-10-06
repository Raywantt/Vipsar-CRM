-- ============================================================
-- MIGRATION: VIPSAR's product portfolio, PART A (owner's ruling, 2026-10-06)
--
-- Run this BEFORE the app deploy; run migration_products_portfolio_part_b.sql
-- AFTER it (the RFQ segment list is two-sided — see 3).
--
-- 1. Erase the test RFQ on lead #482 (MR. Vineet, Samana — Vipul Sharma's
--    real client). The owner's ruling: the RFQ was a test, the client is real.
--    Removed: RFQ #62 (its events and alerts cascade with it), the
--    "RFQ Raised" activity #4446 that created it, and the open follow-up #1529
--    that activity scheduled ("Follow up with MR. Vineet after RFQ Raised").
--    The lead's rfq_raised / rfq_raised_at are cleared — only today's approval
--    had set them. Everything else on the lead (calls, meetings, quote value,
--    earlier follow-ups) is untouched. Each row is checked before it goes, and
--    the whole file stops if anything doesn't match what was inspected.
--
-- 2. The product list becomes exactly the owner's ten:
--      Tostem, Noki, IN16, Giesta, Sky Light, Wrapping bars, PremiAL, VOX,
--      StoneLam, Others
--    The six that already existed are RENAMED in place (same id), so the
--    1,281 leads that point at them keep their product: TOSTEM→Tostem,
--    NOKI SERIES→Noki, SKYLIGHT→Sky Light, VOX→VOX, Stonelam→StoneLam,
--    Other→Others (its "Other" category cleared, which drew "Other (Other)").
--    IN16, Giesta, Wrapping bars and PremiAL are added. The two Veneto
--    products are moved off (owner's pick): Veneto/In 16 → IN16, Veneto →
--    Others — then deleted. Every screen reads the products table, so the
--    picker, Lead Detail, Leads by product, Orders booked and the Excel export
--    all follow with no code change.
--
-- 3. The RFQ Raised form's "Product segment" list becomes the same ten
--    (owner's ruling). PART A lets the CHECK accept the OLD values AND the new
--    ones, so the live app (still offering Windows / Facade) keeps saving
--    until the new code is deployed. PART B then removes the old values.
--    New keys: tostem, noki, in16, giesta, skylight, wrapping_bars, premial,
--    vox, stonelam, others (in16 / giesta / skylight / wrapping_bars kept).
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run (each step
-- checks whether it is already done).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. The test RFQ on lead #482
-- ------------------------------------------------------------
DO $erase$
DECLARE
  v_rfq rfqs;
BEGIN
  SELECT * INTO v_rfq FROM rfqs WHERE id = 62;
  IF v_rfq.id IS NULL THEN
    RAISE NOTICE 'RFQ #62 is already gone — skipping the clean-up.';
    RETURN;
  END IF;
  IF v_rfq.lead_id <> 482 OR v_rfq.activity_id IS DISTINCT FROM 4446 THEN
    RAISE EXCEPTION 'RFQ #62 is not the one inspected (lead %, activity %) — nothing changed.', v_rfq.lead_id, v_rfq.activity_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM activities WHERE id = 4446 AND lead_id = 482 AND activity_type = 'rfq_raised') THEN
    RAISE EXCEPTION 'Activity #4446 is not lead #482''s RFQ Raised — nothing changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM rfqs WHERE lead_id = 482 AND id <> 62) THEN
    RAISE EXCEPTION 'Lead #482 has another desk RFQ besides #62 — nothing changed; ask before erasing.';
  END IF;

  DELETE FROM rfqs WHERE id = 62;                      -- rfq_events + notifications cascade
  DELETE FROM follow_ups
   WHERE id = 1529 AND lead_id = 482 AND status = 'open' AND title LIKE '%after RFQ Raised%';
  DELETE FROM activities WHERE id = 4446;
  UPDATE leads SET rfq_raised = false, rfq_raised_at = NULL WHERE id = 482;
  -- The lead's next follow-up date is derived from its open reminders.
  UPDATE leads
     SET next_followup_date = (SELECT min(f.due_date) FROM follow_ups f WHERE f.lead_id = 482 AND f.status = 'open')
   WHERE id = 482;
  RAISE NOTICE 'Erased the test RFQ on lead #482.';
END
$erase$;

-- ------------------------------------------------------------
-- 2. Products
-- ------------------------------------------------------------
UPDATE products SET name = 'Tostem'    WHERE id = 12;
UPDATE products SET name = 'Noki'      WHERE id = 10;
UPDATE products SET name = 'Sky Light' WHERE id = 11;
UPDATE products SET name = 'VOX'       WHERE id = 13;
UPDATE products SET name = 'StoneLam'  WHERE id = 18;
UPDATE products SET name = 'Others', category = NULL WHERE id = 15;

INSERT INTO products (name)
SELECT v.name FROM (VALUES ('IN16'), ('Giesta'), ('Wrapping bars'), ('PremiAL')) AS v(name)
 WHERE NOT EXISTS (SELECT 1 FROM products p WHERE lower(p.name) = lower(v.name));

-- Veneto/In 16 → IN16, Veneto → Others, then the two go.
UPDATE leads SET product_id = (SELECT id FROM products WHERE name = 'IN16' ORDER BY id LIMIT 1)
 WHERE product_id = 19;
UPDATE leads SET product_id = 15 WHERE product_id = 21;
DELETE FROM products WHERE id IN (19, 21);

-- Exactly the ten, or stop.
DO $check$
DECLARE
  v_names text[];
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_names FROM products;
  IF v_names IS DISTINCT FROM ARRAY['Giesta','IN16','Noki','Others','PremiAL','Sky Light','StoneLam','Tostem','VOX','Wrapping bars'] THEN
    RAISE EXCEPTION 'The products table is not exactly the ten after the change: % — nothing changed.', v_names;
  END IF;
END
$check$;

-- ------------------------------------------------------------
-- 3. RFQ segments — old AND new accepted until PART B
-- ------------------------------------------------------------
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_rfq_details_check;
ALTER TABLE activities ADD CONSTRAINT activities_rfq_details_check CHECK (
  (rfq_window_count IS NULL OR (activity_type = 'rfq_raised' AND rfq_window_count > 0))
  AND
  (rfq_segments IS NULL OR (
     activity_type = 'rfq_raised'
     AND cardinality(rfq_segments) > 0
     AND rfq_segments <@ ARRAY['windows','facade','tostem','noki','in16','giesta','skylight','wrapping_bars','premial','vox','stonelam','others']::text[]
  ))
);

-- rfqs' segment CHECK was declared inline in migration_rfq_desk.sql, so its
-- name is Postgres's choice: drop every CHECK on rfqs that tests `segments`,
-- whatever it is called, then add the named one.
DO $drop$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.rfqs'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%segments%'
  LOOP
    EXECUTE format('ALTER TABLE rfqs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$drop$;
ALTER TABLE rfqs ADD CONSTRAINT rfqs_segments_check
  CHECK (segments <@ ARRAY['windows','facade','tostem','noki','in16','giesta','skylight','wrapping_bars','premial','vox','stonelam','others']::text[]);

COMMIT;
