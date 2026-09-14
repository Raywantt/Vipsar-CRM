-- ============================================================
-- MIGRATION: delete_lead_totally() — a real, permanent Delete Lead for the owner
-- Run this in the Supabase SQL Editor. Safe to re-run (CREATE OR REPLACE).
--
-- Until now there was no Delete-a-lead tool anywhere in this app (CLAUDE.md),
-- deliberately — stage_history/lead_owner_history/loss_reasons are
-- append-only forever, with NO DELETE grant for anyone, even the owner
-- (rls_policies.sql), and activities/follow_ups are plain RESTRICT-linked to
-- leads. A client-side `.from('leads').delete()` call, even as the owner,
-- fails outright the moment a lead has any real history — which is every
-- lead worth deleting.
--
-- This is a SECURITY DEFINER function, the same shape as
-- notify_lead_reassigned()/notify_lixil_lead_created(): it runs with the
-- privileges of whoever created it (the SQL Editor session, i.e. postgres),
-- so it bypasses both RLS and the missing DELETE grants on the append-only
-- tables — exactly like those triggers already do for notifications. The
-- owner-only check is enforced INSIDE the function body instead, since RLS
-- plays no part here.
--
-- DELETES, PERMANENTLY, WITH NO UNDO: the lead itself, every activity,
-- stage_history row, lead_owner_history row, loss_reasons row and
-- follow_ups row on it. notifications/lead_change_log/lead_remarks need no
-- explicit statement — all three are ON DELETE CASCADE from leads already.
-- The linked site (and its site_contacts) is removed too, but ONLY if no
-- other lead still points at it — a scanned site can in principle be shared,
-- and this must never take a colleague's lead down with it.
--
-- Deliberately NOT touched: parties (client/referrer/other). That's what
-- "Delete a party" (Profile, DeletePartySection.jsx) already exists for —
-- this tool doesn't widen into that job.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_lead_totally(target_lead_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $delete_lead_totally$
DECLARE
  v_site_id integer;
  v_other_leads_on_site integer;
BEGIN
  IF (select current_employee_role()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the owner can delete a lead.';
  END IF;

  SELECT site_id INTO v_site_id FROM leads WHERE id = target_lead_id;

  -- Dependency order matters here the same way it does in
  -- DESTRUCTIVE_reset_all_data.sql: every RESTRICT-linked child of `leads`
  -- has to go before the leads row itself, or the final DELETE fails with a
  -- foreign_key_violation.
  DELETE FROM activities WHERE lead_id = target_lead_id;
  DELETE FROM stage_history WHERE lead_id = target_lead_id;
  DELETE FROM lead_owner_history WHERE lead_id = target_lead_id;
  DELETE FROM loss_reasons WHERE lead_id = target_lead_id;
  DELETE FROM follow_ups WHERE lead_id = target_lead_id;
  -- notifications / lead_change_log / lead_remarks: ON DELETE CASCADE,
  -- cleaned up automatically by the DELETE FROM leads below.

  DELETE FROM leads WHERE id = target_lead_id;

  IF v_site_id IS NOT NULL THEN
    SELECT count(*) INTO v_other_leads_on_site FROM leads WHERE site_id = v_site_id;
    IF v_other_leads_on_site = 0 THEN
      DELETE FROM site_contacts WHERE site_id = v_site_id;
      DELETE FROM sites WHERE id = v_site_id;
    END IF;
  END IF;
END;
$delete_lead_totally$;

-- Safe to grant broadly: the function refuses anyone who isn't the owner
-- from its very first line, the same pattern every other SECURITY DEFINER
-- helper in this schema uses (current_employee_id(), is_my_team_member()).
GRANT EXECUTE ON FUNCTION delete_lead_totally(integer) TO authenticated;


-- ============================================================
-- VERIFY
--
-- 1. Only the owner may call it — as a NON-owner session (any role), this
--    must raise "Only the owner can delete a lead." rather than deleting
--    anything:
--
--   SELECT delete_lead_totally(999999); -- an id that doesn't exist is fine;
--                                        -- the role check fires first.
--
-- 2. Reversible, in a transaction, on a REAL disposable test lead — replace
--    123 with one you created for exactly this check:
--
--   BEGIN;
--     SELECT delete_lead_totally(123);
--     SELECT * FROM leads WHERE id = 123;            -- expect 0 rows
--     SELECT * FROM notifications WHERE lead_id = 123; -- expect 0 rows (cascade)
--   ROLLBACK;
--
-- NOTE the SQL Editor runs as postgres with BYPASSRLS and no auth.uid(), so
-- current_employee_role() is NULL there — check 1 will correctly refuse,
-- since NULL IS DISTINCT FROM 'owner' is true. Confirming the OWNER path
-- (a real successful delete) can only be done from a real logged-in owner
-- session in the app itself, not from this editor.
-- ============================================================
