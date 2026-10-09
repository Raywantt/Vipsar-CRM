-- ============================================================
-- ONE-OFF DATA FIX (2026-10-09) — RFQs that were logged as "Revised" but are
-- really the exec's corrected version of a Fresh RFQ the Production Executive
-- sent back. They become Fresh.
--
-- Owner's ruling: a Fresh RFQ sent back from the TECHNICAL check never
-- passed, so the corrected one is the lead's Fresh RFQ. Going forward the app
-- tags it fresh itself; this re-tags the ones already logged.
--
-- WHICH RFQs: a desk RFQ tagged 'revised' where EVERY earlier RFQ Raised
-- activity on the lead had been sent back from the technical check by the time
-- this one was raised (and there is at least one earlier). An earlier RFQ with
-- no desk row, still waiting, approved, quoted, withdrawn, or sent back by
-- ESTIMATION keeps the RFQ Revised, as before. A lead that is now Won or Lost
-- is left alone (the app always calls an RFQ on a decided deal a revision, and
-- the stage it had when this was raised isn't recorded here) — the preview
-- lists those so you can see them.
--
-- WHAT IT CHANGES, and nothing else:
--   * activities.rfq_kind        'revised' -> 'fresh'   (the corrected RFQ)
--   * rfqs.kind / rfqs.revision  'revised' -> 'fresh', revision 0
--   * rfqs.revision of the lead's OTHER revised RFQs, renumbered so the first
--     real revision after the fresh one reads R1 (the old numbering counted
--     the sent-back one)
-- It does NOT touch status, counts_toward_target, the lead's stage, or any
-- notification: no status is in any SET list, so neither the approval trigger
-- nor the history trigger fires. counts_toward_target was already right — the
-- database credited the corrected RFQ's approval to the target as "the fresh
-- one it corrects" — and it stays as it was.
--
-- It refuses (changes nothing) if an affected lead also has a price revision,
-- whose number copies the quote it re-quotes; look at that lead by hand.
--
-- NOT a migration — never part of a run-everything list. Run in the Supabase
-- SQL Editor (postgres, so RLS and the no-write grants on rfqs don't apply).
--
-- STEP 1: run the PREVIEW (read-only) on its own and read it.
-- STEP 2: run the FIX. Safe to re-run: once re-tagged, a row no longer matches.
-- (Also run Schema/migration_rfq_fresh_after_send_back.sql so RFQs raised from
-- now on are numbered the same way.)
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 — PREVIEW (read-only). One row per RFQ that would be re-tagged, and
-- per one left alone because its lead is Won/Lost (will_fix = false).
-- ------------------------------------------------------------
SELECT
  r.id                 AS desk_rfq_id,
  r.lead_id,
  p.name               AS client,
  l.current_stage      AS lead_stage_now,
  r.is_test,
  r.raised_at,
  r.status             AS this_rfq_status,
  r.kind               AS kind_now,
  r.revision           AS revision_now,
  (SELECT string_agg('#' || a.id || ' ' || COALESCE(s.status, 'no desk row')
                       || COALESCE(' (' || s.sent_back_from || ')', ''),
                     ', ' ORDER BY a.id)
     FROM activities a
     LEFT JOIN rfqs s ON s.activity_id = a.id
    WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id
  )                    AS earlier_rfqs,
  (l.current_stage NOT IN ('won', 'lost')) AS will_fix
FROM rfqs r
JOIN leads l        ON l.id = r.lead_id
LEFT JOIN parties p ON p.id = l.party_id
WHERE r.kind = 'revised'
  AND r.activity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM activities a
               WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id)
  AND NOT EXISTS (SELECT 1 FROM activities a
                   WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id
                     AND NOT EXISTS (SELECT 1 FROM rfqs s
                                      WHERE s.activity_id = a.id
                                        AND s.status = 'sent_back' AND s.sent_back_from = 'technical'
                                        AND s.sent_back_at <= r.raised_at))
ORDER BY r.lead_id, r.id;


-- ------------------------------------------------------------
-- STEP 2 — THE FIX. Run once the preview looks right.
-- ------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_rfqs  integer[];
  v_acts  integer[];
  v_leads integer[];
  v_n     integer;
BEGIN
  SELECT array_agg(r.id), array_agg(r.activity_id), array_agg(DISTINCT r.lead_id)
    INTO v_rfqs, v_acts, v_leads
    FROM rfqs r
    JOIN leads l ON l.id = r.lead_id
   WHERE r.kind = 'revised'
     AND r.activity_id IS NOT NULL
     AND l.current_stage NOT IN ('won', 'lost')
     AND EXISTS (SELECT 1 FROM activities a
                  WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id)
     AND NOT EXISTS (SELECT 1 FROM activities a
                      WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id
                        AND NOT EXISTS (SELECT 1 FROM rfqs s
                                         WHERE s.activity_id = a.id
                                           AND s.status = 'sent_back' AND s.sent_back_from = 'technical'
                                           AND s.sent_back_at <= r.raised_at));

  IF v_rfqs IS NULL THEN
    RAISE NOTICE 'Nothing to fix: no revised RFQ is the corrected version of a technical send-back.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM rfqs WHERE kind = 'price_revision' AND lead_id = ANY (v_leads);
  IF v_n > 0 THEN
    RAISE EXCEPTION '% price revision(s) sit on the affected lead(s) %. Nothing changed — look at them by hand.', v_n, v_leads;
  END IF;

  UPDATE activities SET rfq_kind = 'fresh' WHERE id = ANY (v_acts);

  UPDATE rfqs SET kind = 'fresh', revision = 0, updated_at = now() WHERE id = ANY (v_rfqs);

  -- The same counting rfq_from_activity() now uses, applied to the affected
  -- leads' remaining revised RFQs: earlier RFQs that stood when this one was
  -- raised.
  UPDATE rfqs r
     SET revision = (SELECT count(*) FROM activities a
                      WHERE a.lead_id = r.lead_id AND a.activity_type = 'rfq_raised' AND a.id < r.activity_id
                        AND NOT EXISTS (SELECT 1 FROM rfqs s
                                         WHERE s.activity_id = a.id
                                           AND s.status = 'sent_back' AND s.sent_back_from = 'technical'
                                           AND s.sent_back_at <= r.raised_at)),
         updated_at = now()
   WHERE r.lead_id = ANY (v_leads) AND r.kind = 'revised' AND r.activity_id IS NOT NULL;

  RAISE NOTICE 'Re-tagged % RFQ(s) on lead(s) %.', cardinality(v_rfqs), v_leads;
END
$$;

COMMIT;


-- ------------------------------------------------------------
-- AFTER — read-only. The RFQs on the affected leads: the corrected one now
-- reads kind 'fresh', revision 0; any later revision starts again at 1.
-- ------------------------------------------------------------
SELECT
  r.lead_id, r.id AS desk_rfq_id, a.id AS activity_id,
  a.rfq_kind AS activity_kind, r.kind AS desk_kind, r.revision, r.status,
  r.sent_back_from, r.counts_toward_target
FROM rfqs r
LEFT JOIN activities a ON a.id = r.activity_id
WHERE r.lead_id IN (SELECT lead_id FROM rfqs WHERE sent_back_from = 'technical')
ORDER BY r.lead_id, r.id;
