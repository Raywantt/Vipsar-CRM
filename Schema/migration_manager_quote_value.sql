-- ============================================================
-- MIGRATION: a sales manager may set a lead's quote value (2026-10-09).
--
-- The owner's ruling: owners and sales managers can type a quote value on a
-- lead — a manager on their own leads AND their team's. An OWNER may also
-- replace the figure of a Lixil quote the RFQ desk recorded; a manager may not.
--
-- WHAT THIS CHANGES — one function body, no table, column or policy:
--
--   enforce_manager_lock() is re-created from migration_manager_reassign_fix.sql
--   (its latest definition: the reachability check, the four allowed columns)
--   with two additions:
--
--   1. quote_value and quote_lines join the allowed columns on a TEAM lead.
--      quote_lines is the per-product split of a desk quote; the app clears it
--      whenever a typed total replaces the figure it described, so a manager's
--      save can touch both.
--
--   2. NEW GUARD, before the own-lead early return so it holds on a manager's
--      own leads as well: a manager cannot change quote_value or quote_lines on
--      a lead whose newest desk RFQ is a recorded Lixil quote (rfqs.status =
--      'quoted'). Only an owner can replace that figure. The check mirrors
--      latestDeskQuote() in src/lib/rfqDesk.js — the app's Sales progress /
--      QuoteValueCard lock is the convenience, this is the boundary.
--
--   An owner, a coordinator and an exec are unaffected: the function returns
--   immediately for any role but sales_manager. The RFQ desk's own writes to
--   leads.quote_value (rfqs_after_write, rfq_record_quote_lines) run in an
--   estimation executive's or owner's session, so they never meet this guard.
--
-- ORDERING: must run after migration_sales_manager.sql and
-- migration_manager_reassign_fix.sql (it supersedes their enforce_manager_lock()).
-- If either is re-run afterwards, it puts the old four-column body back —
-- re-run THIS file straight after. Safe to re-run itself (CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER).
--
-- SAFE BEFORE OR AFTER THE DEPLOY: the new build only ever writes quote_value
-- from Sales progress (owner; a manager on their own lead) and from the
-- manager's card on a team lead. Until this runs, that last write is refused
-- with the lock's own message ("…but not its other details"); nothing else
-- changes.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_manager_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed CONSTANT text[] := ARRAY[
    'current_stage','next_followup_date','order_value','owner_employee_id',
    'quote_value','quote_lines'
  ];
BEGIN
  IF current_employee_role() IS DISTINCT FROM 'sales_manager' THEN
    RETURN NEW;   -- owner, coordinator and the exec themselves are unaffected
  END IF;

  -- A figure the RFQ desk recorded from Lixil's quote is an owner's to replace,
  -- on a manager's own lead as much as a team lead.
  IF (NEW.quote_value IS DISTINCT FROM OLD.quote_value
      OR NEW.quote_lines IS DISTINCT FROM OLD.quote_lines)
     AND EXISTS (
       SELECT 1 FROM rfqs r
        WHERE r.lead_id = OLD.id
          AND r.status = 'quoted'
          AND r.quote_received_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'The RFQ desk has recorded Lixil''s quote on this lead — only an owner can change its quote value'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.owner_employee_id IS NOT DISTINCT FROM current_employee_id() THEN
    RETURN NEW;   -- a manager's OWN lead: they are a rep here, no further limits
  END IF;

  -- The lead must already be reachable by this manager — their own (handled
  -- above) or their team's. See migration_manager_reassign_fix.sql for why this
  -- lives in the trigger and not in the UPDATE policy's USING.
  IF NOT is_my_managed_member(OLD.owner_employee_id) THEN
    RAISE EXCEPTION
      'You can only change a lead that is your own or belongs to one of your sales executives'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'This lead belongs to one of your sales executives — a manager can change its stage, follow-up date, order value, quote value and owner, but not its other details'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_manager_lock ON leads;
CREATE TRIGGER enforce_manager_lock
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_manager_lock();


-- ============================================================
-- VERIFY — run each of these after the migration.
-- ============================================================

-- Q1. The new body is the live one.
-- SELECT prosrc LIKE '%''quote_value'',''quote_lines''%'  AS allows_quote_columns,
--        prosrc LIKE '%r.status = ''quoted''%'            AS has_desk_quote_guard,
--        prosrc LIKE '%is_my_managed_member(OLD.owner_employee_id)%' AS keeps_reachability_check
--   FROM pg_proc WHERE proname = 'enforce_manager_lock';
--    Expect true, true, true.

-- Q2. THE BEHAVIOURAL CHECK — as REAL logged-in sessions, never the SQL Editor
--     (postgres, BYPASSRLS, no auth.uid(): current_employee_role() is NULL, so
--     the whole function returns at its first line whether or not this worked).
--     As a sales_manager (the test login `sm` works, with a test exec's lead):
--       1. Set a quote value on a TEAM lead that has no Lixil quote. Expect success.
--       2. Set one on your OWN lead with no Lixil quote. Expect success.
--       3. On a lead whose newest RFQ is a recorded Lixil quote (own or team),
--          try to change quote_value. Expect the "only an owner can change its
--          quote value" error — and the same for quote_lines.
--       4. Change some OTHER column (e.g. closure_probability) on a team lead.
--          Expect the original "…but not its other details" error, now naming
--          quote value among the permitted ones.
--     As the owner: change quote_value on a lead that HAS a Lixil quote. Expect
--     success (the owner is never limited). As an exec, coordinator and the
--     estimation executive: nothing changed for them.
--     Each change lands in lead_change_log ('quote_value') — read it back.
-- ============================================================
