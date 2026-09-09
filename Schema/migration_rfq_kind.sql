-- ============================================================
-- MIGRATION: fresh vs. revised RFQs
--
-- Owner's ruling, 2026-09-09. A sales exec re-requests a quotation whenever
-- the client asks for changes, so a lead often accumulates several RFQs
-- before the quote is finalized. The first "RFQ Raised" activity logged
-- against a lead is a FRESH RFQ; every one after that is a REVISED RFQ.
--
-- Classification is decided in the app (src/lib/rfqKind.js), from the
-- lead's stage at the moment the activity is logged, then frozen onto the
-- activity row — this migration only adds the column to hold it. No DB
-- trigger, no CHECK-constraint-driven logic: every other side-effect of
-- logging an activity in this app (rfq_raised, order_value, site_stage)
-- already lives in ActivityLog.jsx's own submit handler, not a trigger.
--
-- NO BACKFILL. Every activities row logged before this shipped keeps
-- rfq_kind = NULL — per the owner's explicit direction, this only applies
-- to data that comes in after the change, not a reclassification of
-- history. Every reader of this column already treats NULL as "not
-- classified" (counts toward the RFQ-raised target the same as a real
-- 'fresh' row would, shows no Fresh/Revised tag on the timeline) rather
-- than erroring or guessing.
-- ============================================================

ALTER TABLE activities ADD COLUMN IF NOT EXISTS rfq_kind text;

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_rfq_kind_check;
ALTER TABLE activities ADD CONSTRAINT activities_rfq_kind_check
  CHECK (rfq_kind IS NULL OR rfq_kind IN ('fresh', 'revised'));


-- ============================================================
-- VERIFY — run these after the migration
-- ============================================================

-- 1. Column + constraint exist. Expect one row.
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'activities' AND column_name = 'rfq_kind';

-- 2. Every existing row is untouched (NULL). Expect this to equal the
--    table's total row count.
-- SELECT count(*) FROM activities WHERE rfq_kind IS NULL;

-- 3. The CHECK actually rejects a bad value. Expect a 23514 error.
-- UPDATE activities SET rfq_kind = 'nonsense' WHERE id = (SELECT id FROM activities LIMIT 1);
