-- ============================================================
-- MIGRATION: RFQ desk — only the leads in each person's process
-- (owner's ruling, 2026-10-06)
--
-- Until now both desk roles could read EVERY lead that had ever had a desk
-- RFQ (plus its client, site, contacts and stage history), and find them in
-- Search. The owner narrowed it to the leads in each person's own process:
--
--   Production Executive — leads with an RFQ waiting at the technical check
--     (status with_technical). Once they approve or send it back, the lead
--     is gone for them.
--   Estimation Executive — leads with an RFQ waiting for estimation or with
--     Lixil (with_estimation / with_lixil), PLUS leads whose newest desk RFQ
--     (not withdrawn) is a quote and which are still open (not won / lost):
--     a price revision is started from that lead's page, so the lead whose
--     latest quote Lixil may re-price has to stay reachable.
--
-- desk_lead_ids() is the ONE place that decides it: the desk_select policies
-- on leads, sites, parties, site_contacts and stage_history all read it (via
-- desk_site_ids() / desk_party_ids()), so replacing its body narrows every
-- one of them at once. Nothing else changes — the rfqs table itself stays
-- readable to the desk (their Today strips count their own decisions from
-- it), the desk's action functions are SECURITY DEFINER and don't need the
-- lead, and architects / firms stay visible to every role as before.
--
-- "Newest" is the same pick as rfqDesk.js's latestDeskRfqByLead and the
-- leads_needing_attention() RPC: latest raised_at, then highest id.
--
-- The app side (same commit): Search is removed for both roles, a lead that
-- leaves their process shows "This lead isn't in your queue" instead of "Lead
-- not found", and a decision made on Lead Detail that takes the lead out of
-- their process says so and offers the way back to Today.
--
-- ⚠️ ORDER: run AFTER migration_rfq_desk.sql. Re-running migration_rfq_desk.sql
-- puts the old "every lead with a desk RFQ" body back — re-run THIS file
-- straight after it.
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run. Then run
-- Schema/verify_rfq_desk_in_process.sql and read its report.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION desk_lead_ids()
RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT current_employee_role() AS role, my_is_test_account() AS is_test),
  -- Each lead's newest desk RFQ that wasn't withdrawn (Estimation Executive
  -- only — nobody else needs it).
  latest AS (
    SELECT DISTINCT ON (r.lead_id) r.lead_id, r.status
      FROM rfqs r, me
     WHERE me.role = 'estimation_executive'
       AND r.is_test = me.is_test
       AND r.status <> 'withdrawn'
     ORDER BY r.lead_id, r.raised_at DESC, r.id DESC
  )
  SELECT COALESCE(array_agg(DISTINCT x.lead_id), '{}')
    FROM (
      -- Production Executive: waiting at the technical check.
      SELECT r.lead_id FROM rfqs r, me
       WHERE me.role = 'production_executive'
         AND r.is_test = me.is_test
         AND r.status = 'with_technical'
      UNION ALL
      -- Estimation Executive: waiting for estimation, or with Lixil.
      SELECT r.lead_id FROM rfqs r, me
       WHERE me.role = 'estimation_executive'
         AND r.is_test = me.is_test
         AND r.status IN ('with_estimation', 'with_lixil')
      UNION ALL
      -- Estimation Executive: the lead's latest word is a quote, and the deal
      -- is still open — where a price revision starts.
      SELECT lt.lead_id FROM latest lt
        JOIN leads l ON l.id = lt.lead_id
       WHERE lt.status = 'quoted'
         AND COALESCE(l.current_stage, 'calling') NOT IN ('won', 'lost')
    ) x;
$$;

COMMIT;
