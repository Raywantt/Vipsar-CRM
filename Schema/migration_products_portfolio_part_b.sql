-- ============================================================
-- MIGRATION: VIPSAR's product portfolio, PART B — run AFTER the app deploy
--
-- PART A (migration_products_portfolio.sql) let the RFQ segment CHECKs accept
-- the old values (Windows, Facade) beside the owner's ten, so the app that was
-- live at the time could keep saving. Once the new app is deployed nothing
-- offers the old values any more, so this:
--   1. moves any RFQ / RFQ Raised activity still carrying an old value onto
--      the new list — Windows → Tostem (the window system nearly every lead
--      is for), Facade → Others — and says how many it moved;
--   2. tightens both CHECKs to exactly the ten.
-- The ten must match RFQ_SEGMENT_OPTIONS in src/lib/rfqDesk.js
-- (rfqDesk.test.js pins the two together).
--
-- RUN: paste into the Supabase SQL Editor and Run, after the deploy. Safe to
-- re-run.
-- ============================================================

BEGIN;

DO $move$
DECLARE
  n_rfqs integer;
  n_acts integer;
BEGIN
  UPDATE rfqs
     SET segments = ARRAY(
           SELECT DISTINCT CASE s WHEN 'windows' THEN 'tostem' WHEN 'facade' THEN 'others' ELSE s END
             FROM unnest(segments) AS s)
   WHERE segments && ARRAY['windows','facade']::text[];
  GET DIAGNOSTICS n_rfqs = ROW_COUNT;

  UPDATE activities
     SET rfq_segments = ARRAY(
           SELECT DISTINCT CASE s WHEN 'windows' THEN 'tostem' WHEN 'facade' THEN 'others' ELSE s END
             FROM unnest(rfq_segments) AS s)
   WHERE rfq_segments && ARRAY['windows','facade']::text[];
  GET DIAGNOSTICS n_acts = ROW_COUNT;

  RAISE NOTICE 'Moved % RFQ(s) and % RFQ Raised activit(y/ies) off Windows / Facade.', n_rfqs, n_acts;
END
$move$;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_rfq_details_check;
ALTER TABLE activities ADD CONSTRAINT activities_rfq_details_check CHECK (
  (rfq_window_count IS NULL OR (activity_type = 'rfq_raised' AND rfq_window_count > 0))
  AND
  (rfq_segments IS NULL OR (
     activity_type = 'rfq_raised'
     AND cardinality(rfq_segments) > 0
     AND rfq_segments <@ ARRAY['tostem','noki','in16','giesta','skylight','wrapping_bars','premial','vox','stonelam','others']::text[]
  ))
);

ALTER TABLE rfqs DROP CONSTRAINT IF EXISTS rfqs_segments_check;
ALTER TABLE rfqs ADD CONSTRAINT rfqs_segments_check
  CHECK (segments <@ ARRAY['tostem','noki','in16','giesta','skylight','wrapping_bars','premial','vox','stonelam','others']::text[]);

COMMIT;
