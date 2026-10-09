-- ============================================================
-- MIGRATION: a Fresh RFQ the technical check sent back, re-raised, is Fresh
-- again (owner's ruling, 2026-10-09)
--
-- The app now classes the exec's corrected RFQ as FRESH, not Revised, when
-- every earlier RFQ on the lead was sent back by the Production Executive
-- (src/lib/rfqKind.js: hasStandingPriorRfq). The kind is written by the app
-- onto the activity, and this file's trigger copies it onto the desk row — so
-- the only thing left to fix in the database is the NUMBER.
--
--   rfq_from_activity() counted EVERY earlier RFQ Raised activity into
--   rfqs.revision, so a corrected fresh RFQ got revision 1 ("R1") and a real
--   revision raised after it would have been "R2" with no "R1" before it.
--   It now counts only the earlier RFQs that STOOD — not the ones the
--   technical check sent back. The corrected fresh RFQ is revision 0 and the
--   first real revision after it is R1.
--
-- Function body only: no table, column, policy or grant changes, so it can run
-- before OR after the deploy (the app's label reads the kind, so it never
-- shows "R1" on a fresh RFQ either way). Safe to re-run.
--
-- ⚠️ This is a full re-creation of migration_lead_products.sql's
-- rfq_from_activity() (product_ids and all). Re-running migration_rfq_desk.sql
-- or migration_lead_products.sql puts the old counting back — re-run THIS file
-- straight after either.
--
-- It does NOT touch RFQs already logged. To re-tag those, run
-- Schema/one_off_rfq_fresh_after_send_back.sql once (preview first).
--
-- RUN: paste into the Supabase SQL Editor and Run.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION rfq_from_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.activity_type <> 'rfq_raised' OR NEW.lead_id IS NULL OR NOT rfq_desk_is_live() THEN
    RETURN NULL;
  END IF;

  INSERT INTO rfqs (lead_id, activity_id, kind, revision,
                    raised_by_employee_id, logged_by_employee_id, is_test,
                    window_count, segments, product_ids)
  VALUES (
    NEW.lead_id,
    NEW.id,
    COALESCE(NEW.rfq_kind, 'fresh'),
    -- How many RFQ Raised activities this lead had before this one AND still
    -- stood: one the technical check sent back never passed, so it is not
    -- counted. (Estimation's send-backs and withdrawals do count — they are
    -- the app's own rule, rfqKind.js isSetAsideRfq.)
    (SELECT count(*) FROM activities a
      WHERE a.lead_id = NEW.lead_id AND a.activity_type = 'rfq_raised' AND a.id < NEW.id
        AND NOT EXISTS (SELECT 1 FROM rfqs s
                         WHERE s.activity_id = a.id
                           AND s.status = 'sent_back' AND s.sent_back_from = 'technical')),
    NEW.employee_id,
    COALESCE(NEW.logged_by_employee_id, NEW.employee_id),
    COALESCE((SELECT e.is_test_account FROM employees e WHERE e.id = NEW.employee_id), false),
    NEW.rfq_window_count,
    COALESCE(NEW.rfq_segments, '{}'),
    -- The new form sends products; the old one sent segment keys.
    COALESCE(NULLIF(NEW.rfq_product_ids, '{}'), rfq_segment_product_ids(NEW.rfq_segments))
  );

  RETURN NULL;
END;
$$;

COMMIT;


-- ============================================================
-- CHECKS (read-only)
-- ============================================================
-- The new counting is live (must be true):
--   SELECT pg_get_functiondef(oid) LIKE '%sent_back_from = ''technical''%' FROM pg_proc WHERE proname = 'rfq_from_activity';
-- The product columns survived (must be true — the old file's body would say false):
--   SELECT pg_get_functiondef(oid) LIKE '%product_ids%' FROM pg_proc WHERE proname = 'rfq_from_activity';
