-- ============================================================
-- MIGRATION: Business Development Manager — the database half (BDM.md Step 1)
-- Written 2026-09-15. Read BDM.md (repo root) first: every rule below
-- implements a decision recorded there (§3) or a gap found while planning (§4).
--
-- RUN: paste this whole file into the Supabase SQL Editor and press Run.
-- It is wrapped in BEGIN/COMMIT, so it either applies completely or not at
-- all. Safe to re-run (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).
-- Then run Schema/verify_bdm_role.sql (needs the BDM test login to exist).
--
-- BACKWARD-COMPATIBLE: adds columns the current app build never reads, so it
-- can run before any BDM app code is deployed. Existing roles are unaffected:
-- every new policy is a separate, BDM-guarded permissive policy, and every
-- replaced function is reproduced from its latest live copy with only the
-- BDM lines added.
--
--   STEP 0  prerequisite guard (architect/firm universal visibility is live)
--   STEP 1  employees.role accepts 'business_development_manager'
--   STEP 2  new columns, constraints, indexes
--   STEP 3  validate_employee_role_assignment(): block deactivating/demoting a
--           BDM who still holds architects
--   STEP 4  stamp_lead_creator(): created_by_employee_id can't be forged or
--           rewritten from the app
--   STEP 5  bdm_leads_before_write(): stamps/freezes the lead's BDM tag,
--           derives the joinery stage, refuses a BDM changing a lead's owner
--   STEP 6  bdm_parties_before_write(): stamps/freezes the architect's BDM tag
--   STEP 7  enforce_owner_only_stage_change(): knows the BDM role
--   STEP 8  bdm_leads_after_write(): capture history row, notifications,
--           client/site hand-over to the exec on assignment
--   STEP 9  RLS: BDM read/insert/update policies (all additive)
--   STEP 10 notifications.kind accepts the four BDM kinds
--
-- ⚠️ LAYERING: STEP 3 supersedes migration_coordinator_can_manage_manager.sql's
-- validate_employee_role_assignment(); STEP 4 supersedes
-- migration_lead_change_log.sql's stamp_lead_creator(); STEP 7 supersedes
-- migration_retire_measurements_design_discussion.sql's
-- enforce_owner_only_stage_change(); STEP 10 supersedes
-- migration_lead_remarks_and_lixil_notify.sql's notifications_kind_check.
-- Re-running ANY of those older files after this one silently strips the BDM
-- lines back out — re-run this file again afterwards.
--
-- STEP 7 also settles CLAUDE.md's outstanding question of whether the trigger
-- half of migration_retire_measurements_design_discussion.sql was ever
-- deployed: this file installs the 6-stage funnel array either way.
-- ============================================================

BEGIN;


-- ------------------------------------------------------------
-- STEP 0: prerequisite guard
--
-- A BDM's whole job is architects, and "architects are visible company-wide"
-- is migration_architects_universal_visibility.sql, which CLAUDE.md still
-- listed as outstanding. Stop here rather than build on a missing layer.
-- ------------------------------------------------------------
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'parties' AND policyname = 'architect_firm_universal_select'
  ) THEN
    RAISE EXCEPTION 'Run Schema/migration_architects_universal_visibility.sql first, then re-run this file. Nothing was changed.';
  END IF;
END
$guard$;


-- ------------------------------------------------------------
-- STEP 1: employees.role
-- Widening a CHECK never invalidates existing rows.
-- ------------------------------------------------------------
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','sales_executive','sales_coordinator','sales_manager',
                  'business_development_manager'));


-- ------------------------------------------------------------
-- STEP 2: columns, constraints, indexes
--
-- leads.bdm_employee_id  — WHICH BDM brought this lead in. The one field every
--   BDM rule reads (visibility, pool, credit, targets). Frozen at creation by
--   STEP 5 — a value derived from "creator's current role" would silently
--   change the day that person changes role or leaves.
-- leads.joinery_received — the BDM's yes/no at capture. NULL = never asked,
--   which is every lead not entered by a BDM.
-- parties.bdm_employee_id / bdm_since — this ARCHITECT is in that BDM's
--   portfolio, and since when. bdm_since is the floor for the 14-day
--   "architect not met" clock, so an imported portfolio doesn't flood the
--   queue on day one.
-- ------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS bdm_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS joinery_received BOOLEAN;

ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS bdm_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bdm_since       TIMESTAMP;

-- Only an individual architect sits in a BDM's portfolio — not a firm, not a
-- client. A firm is shared structure (many architects, possibly different
-- portfolios); a client belongs to the lead.
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_bdm_tag_architect_only;
ALTER TABLE parties ADD CONSTRAINT parties_bdm_tag_architect_only
  CHECK (bdm_employee_id IS NULL OR party_type = 'architect');

-- Partial: only BDM leads/architects carry a tag, so the index stays tiny and
-- serves every "my leads" / RLS EXISTS lookup keyed on it.
CREATE INDEX IF NOT EXISTS idx_leads_bdm_created
  ON leads (bdm_employee_id, created_at DESC)
  WHERE bdm_employee_id IS NOT NULL;

-- The owner's pool card: ownerless BDM leads, oldest first.
CREATE INDEX IF NOT EXISTS idx_leads_bdm_pool
  ON leads (created_at)
  WHERE owner_employee_id IS NULL AND bdm_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parties_bdm
  ON parties (bdm_employee_id)
  WHERE bdm_employee_id IS NOT NULL;


-- ------------------------------------------------------------
-- STEP 3: validate_employee_role_assignment()
--
-- Reproduced VERBATIM from migration_coordinator_can_manage_manager.sql (the
-- live copy) plus ONE new block at the end. A BDM needs no new reporting-line
-- rule: the existing checks already refuse a coordinator_id or manager_id on
-- any role but exec/manager, and already require the coordinator/manager a
-- row points at to hold that exact role — so a BDM can neither report to
-- anyone nor be reported to.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_employee_role_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  ---- coordinator line (widened: sales_executive OR sales_manager) ----
  IF NEW.coordinator_id IS NOT NULL THEN
    IF NEW.coordinator_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot be their own coordinator'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.role NOT IN ('sales_executive', 'sales_manager') THEN
      RAISE EXCEPTION 'Only a sales executive or sales manager can be assigned to a coordinator (this employee is %)', NEW.role
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
       WHERE id = NEW.coordinator_id AND role = 'sales_coordinator'
    ) THEN
      RAISE EXCEPTION 'coordinator_id must point at an employee whose role is sales_coordinator'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_coordinator'
     AND NEW.role IS DISTINCT FROM 'sales_coordinator'
     AND EXISTS (SELECT 1 FROM employees WHERE coordinator_id = OLD.id) THEN
    RAISE EXCEPTION 'This coordinator still has reports — reassign their team first'
      USING ERRCODE = 'check_violation';
  END IF;

  ---- manager line (unchanged from migration_sales_manager.sql) ----
  IF NEW.manager_id IS NOT NULL THEN
    IF NEW.manager_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot be their own manager'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.role <> 'sales_executive' THEN
      RAISE EXCEPTION 'Only a sales executive can be assigned to a manager (this employee is %)', NEW.role
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
       WHERE id = NEW.manager_id AND role = 'sales_manager'
    ) THEN
      RAISE EXCEPTION 'manager_id must point at an employee whose role is sales_manager'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_manager'
     AND NEW.role IS DISTINCT FROM 'sales_manager'
     AND EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id) THEN
    RAISE EXCEPTION 'This manager still has sales executives reporting to them — reassign their team first'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.role = 'sales_manager'
     AND OLD.is_active = true
     AND NEW.is_active = false
     AND EXISTS (SELECT 1 FROM employees WHERE manager_id = OLD.id) THEN
    RAISE EXCEPTION 'This manager still has sales executives reporting to them — reassign their team before deactivating them'
      USING ERRCODE = 'check_violation';
  END IF;

  ---- BDM line (NEW, migration_bdm_role.sql) ----
  -- Hard block, like a manager with reports: a BDM who leaves with architects
  -- still pointing at them strands those relationships with nobody.
  IF TG_OP = 'UPDATE'
     AND OLD.role = 'business_development_manager'
     AND (NEW.role IS DISTINCT FROM OLD.role
          OR (OLD.is_active = true AND NEW.is_active = false))
     AND EXISTS (SELECT 1 FROM parties WHERE bdm_employee_id = OLD.id) THEN
    RAISE EXCEPTION 'This business development manager still has architects — move their architects to someone else first'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_employee_role_assignment ON employees;
CREATE TRIGGER validate_employee_role_assignment
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_employee_role_assignment();


-- ------------------------------------------------------------
-- STEP 4: stamp_lead_creator() — lock created_by_employee_id
--
-- The old version (migration_lead_change_log.sql) kept a client-SUPPLIED
-- value via COALESCE, and nothing froze the column on UPDATE, so any session
-- could forge or rewrite "who created this lead". Harmless while only Day
-- Review's "New" count read it; agreed with the owner to close it now.
--
-- A real session (auth.uid() present) always stamps itself on INSERT and can
-- never change the value on UPDATE. Admin SQL (no auth.uid() — imports, data
-- fixes like fix_reassign_aanchal_leads.sql) keeps the old behaviour: an
-- explicit value is respected. Coordinator entry-on-behalf is unchanged: the
-- coordinator is the real actor and is what gets stamped, exactly as before.
-- No app code sends this column (checked: src/ never writes it).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_lead_creator()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by_employee_id := COALESCE(current_employee_id(), NEW.owner_employee_id);
    ELSE
      NEW.created_by_employee_id := COALESCE(NEW.created_by_employee_id, NEW.owner_employee_id);
    END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    NEW.created_by_employee_id := OLD.created_by_employee_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_lead_creator ON leads;
CREATE TRIGGER stamp_lead_creator
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION stamp_lead_creator();


-- ------------------------------------------------------------
-- STEP 5: bdm_leads_before_write()
--
-- Three jobs, one function (so their relative order can't drift):
--
-- (a) THE TAG. On INSERT a BDM session always stamps itself; the owner may
--     supply a value (owner's ruling: the owner may correct a tag); every
--     other real session gets NULL, so an exec can't credit a lead to a BDM.
--     On UPDATE only the owner (or admin SQL) may change it — anyone else's
--     change is silently reverted rather than raised, so an ordinary save
--     that happens to carry the column never fails.
--
-- (b) JOINERY → STAGE. A BDM lead captured with joinery_received = true
--     starts at joinery_follow_up (owner's ruling: at capture, not at
--     assignment). While still in the pool, toggling joinery moves the stage
--     calling ↔ joinery_follow_up and records it — but only when the save did
--     not ALSO set a stage itself (an explicit stage choice wins).
--
-- (c) A BDM NEVER CHANGES WHO OWNS A LEAD (owner's ruling: "only at capture").
--     This is load-bearing, not belt-and-braces: RLS OR's WITH CHECK clauses
--     across policies, so own_data_or_owner_role_update's
--     `owner_employee_id = me` would otherwise let a BDM quietly assign a pool
--     lead to themselves, bypassing the owner.
--
-- Trigger name sorts BEFORE enforce_*/owner_only_*/stamp_* (Postgres fires
-- same-timing triggers alphabetically), so the stage trigger sees the
-- derived joinery stage.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bdm_leads_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_session  boolean := auth.uid() IS NOT NULL;
  caller_role text    := current_employee_role();
  caller_id   integer := current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- (a)
    IF is_session THEN
      IF caller_role = 'business_development_manager' THEN
        NEW.bdm_employee_id := caller_id;
      ELSIF caller_role IS DISTINCT FROM 'owner' THEN
        NEW.bdm_employee_id := NULL;
      END IF;
    END IF;

    -- (b)
    IF NEW.bdm_employee_id IS NOT NULL
       AND NEW.joinery_received IS TRUE
       AND COALESCE(NEW.current_stage, 'calling') = 'calling' THEN
      NEW.current_stage := 'joinery_follow_up';
    END IF;

  ELSE
    -- (a)
    IF NEW.bdm_employee_id IS DISTINCT FROM OLD.bdm_employee_id
       AND is_session
       AND caller_role IS DISTINCT FROM 'owner' THEN
      NEW.bdm_employee_id := OLD.bdm_employee_id;
    END IF;

    -- (c)
    IF is_session
       AND caller_role = 'business_development_manager'
       AND NEW.owner_employee_id IS DISTINCT FROM OLD.owner_employee_id THEN
      RAISE EXCEPTION 'A business development manager cannot change who owns a lead — the owner assigns it'
        USING ERRCODE = 'check_violation';
    END IF;

    -- (b)
    IF OLD.owner_employee_id IS NULL
       AND NEW.owner_employee_id IS NULL
       AND NEW.bdm_employee_id IS NOT NULL
       AND NEW.joinery_received IS DISTINCT FROM OLD.joinery_received
       AND NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN
      IF NEW.joinery_received IS TRUE AND COALESCE(OLD.current_stage, 'calling') = 'calling' THEN
        NEW.current_stage := 'joinery_follow_up';
      ELSIF NEW.joinery_received IS NOT TRUE AND OLD.current_stage = 'joinery_follow_up' THEN
        NEW.current_stage := 'calling';
      END IF;

      -- The app didn't make this stage change, so the app won't record it.
      -- Written here (BEFORE UPDATE — the lead row already exists, so the FK
      -- holds; if a later trigger or RLS rejects the update, this rolls back
      -- with it).
      IF NEW.current_stage IS DISTINCT FROM OLD.current_stage THEN
        INSERT INTO stage_history (lead_id, stage, changed_by)
        VALUES (NEW.id, NEW.current_stage, caller_id);
      END IF;
    END IF;
  END IF;

  -- A tag must name a real BDM — checked only when the value is being SET,
  -- so a lead whose BDM later left can still be saved by its exec.
  IF NEW.bdm_employee_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.bdm_employee_id IS DISTINCT FROM OLD.bdm_employee_id)
     AND NOT EXISTS (
       SELECT 1 FROM employees
        WHERE id = NEW.bdm_employee_id AND role = 'business_development_manager'
     ) THEN
    RAISE EXCEPTION 'bdm_employee_id must point at an employee whose role is business_development_manager'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bdm_leads_before_write ON leads;
CREATE TRIGGER bdm_leads_before_write
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION bdm_leads_before_write();


-- ------------------------------------------------------------
-- STEP 6: bdm_parties_before_write() — the architect's portfolio tag
--
-- Same rules as the lead tag: a BDM creating an ARCHITECT stamps themselves;
-- the owner may set or move it; anyone else's value is forced NULL on INSERT
-- and reverted on UPDATE; admin SQL (the owner's legacy import) may set it.
-- bdm_since follows the tag: set to now() when a tag is first applied or
-- moved (an import may supply its own), cleared when the tag is cleared.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bdm_parties_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_session  boolean := auth.uid() IS NOT NULL;
  caller_role text    := current_employee_role();
  caller_id   integer := current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF is_session THEN
      IF caller_role = 'business_development_manager' THEN
        NEW.bdm_employee_id := CASE WHEN NEW.party_type = 'architect' THEN caller_id ELSE NULL END;
      ELSIF caller_role IS DISTINCT FROM 'owner' THEN
        NEW.bdm_employee_id := NULL;
      END IF;
    END IF;
  ELSIF is_session AND caller_role IS DISTINCT FROM 'owner' THEN
    NEW.bdm_employee_id := OLD.bdm_employee_id;
    NEW.bdm_since       := OLD.bdm_since;
  END IF;

  IF NEW.bdm_employee_id IS NULL THEN
    NEW.bdm_since := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.bdm_employee_id IS DISTINCT FROM OLD.bdm_employee_id THEN
    IF is_session OR NEW.bdm_since IS NULL THEN
      NEW.bdm_since := now();
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM employees
       WHERE id = NEW.bdm_employee_id AND role = 'business_development_manager'
    ) THEN
      RAISE EXCEPTION 'bdm_employee_id must point at an employee whose role is business_development_manager'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bdm_parties_before_write ON parties;
CREATE TRIGGER bdm_parties_before_write
  BEFORE INSERT OR UPDATE ON parties
  FOR EACH ROW
  EXECUTE FUNCTION bdm_parties_before_write();


-- ------------------------------------------------------------
-- STEP 7: enforce_owner_only_stage_change()
--
-- Reproduced VERBATIM from migration_retire_measurements_design_discussion.sql
-- (the latest copy) with the BDM added. Before this, the role allow-list
-- raised "You do not have permission to change a lead's stage" for a BDM on
-- every lead, including their own.
--
--   * A BDM on a POOL lead they brought in (still ownerless): any direction —
--     they may correct it until the owner assigns it.
--   * A BDM on a lead they OWN ("I'll work this myself"): forward only, the
--     same branch as sales_executive/sales_manager.
--   * Any other lead: RLS already refuses the UPDATE before this matters.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The 6 sequential funnel stages. Mirrors FUNNEL_SEQUENCE in
  -- src/lib/stageProgress.js — keep the two in step. (measurements and
  -- design_discussion retired 2026-09-08.)
  seq CONSTANT text[] := ARRAY[
    'calling','presentation','joinery_follow_up',
    'rfq','quote_submission','negotiation'
  ];
  caller_role text;
  from_stage  text;
  from_rank   int;
  to_rank     int;
BEGIN
  IF NEW.current_stage IS NOT DISTINCT FROM OLD.current_stage THEN
    RETURN NEW;
  END IF;

  -- Admin SQL run in the Supabase SQL Editor has no auth.uid(), so
  -- current_employee_role() is NULL there — without this, bulk stage fixes
  -- run by hand would abort. A deactivated employee has a real auth.uid()
  -- but a NULL role, so they are still caught by the role test below.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  caller_role := COALESCE(current_employee_role(), '');

  IF caller_role NOT IN ('owner','sales_coordinator','sales_executive','sales_manager',
                         'business_development_manager') THEN
    RAISE EXCEPTION 'You do not have permission to change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Owner and coordinator move a stage in any direction, including back.
  IF caller_role IN ('owner','sales_coordinator') THEN
    RETURN NEW;
  END IF;

  -- A BDM on their own still-unassigned pool lead: any direction.
  IF caller_role = 'business_development_manager'
     AND OLD.owner_employee_id IS NULL
     AND OLD.bdm_employee_id IS NOT DISTINCT FROM current_employee_id() THEN
    RETURN NEW;
  END IF;

  -- ---- sales_executive, sales_manager, and a BDM on a lead they own:
  -- ---- forward only, from here down

  -- Reopening a decided deal moves money back out of a reported figure.
  -- Treated as the largest reversal there is, whatever it reopens into.
  IF OLD.current_stage IN ('won','lost') THEN
    RAISE EXCEPTION
      'This deal is already marked %. Ask a coordinator or the owner to reopen it.',
      OLD.current_stage
      USING ERRCODE = 'check_violation';
  END IF;

  -- An on-hold lead is ranked at the stage it actually paused at, so a
  -- detour through On hold cannot launder a backward move (negotiation ->
  -- on_hold -> calling). Same derivation LeadDetail's stepper uses: the
  -- most recent non-on-hold history row, falling back to 'calling' for a
  -- lead never explicitly moved (its 'calling' is a column DEFAULT, not a
  -- logged change, so no stage_history row exists for it).
  IF OLD.current_stage = 'on_hold' THEN
    SELECT sh.stage INTO from_stage
      FROM stage_history sh
     WHERE sh.lead_id = OLD.id
       AND sh.stage <> 'on_hold'
     ORDER BY sh.changed_at DESC
     LIMIT 1;
    from_stage := COALESCE(from_stage, 'calling');
  ELSE
    from_stage := OLD.current_stage;
  END IF;

  from_rank := array_position(seq, from_stage);
  to_rank   := array_position(seq, NEW.current_stage);

  -- An off-funnel destination (on_hold / won / lost) has no rank and is
  -- never "backward" — pausing or closing a deal is always allowed. An
  -- unrecognised legacy current_stage has no rank either — left alone
  -- rather than guessed at.
  IF from_rank IS NOT NULL AND to_rank IS NOT NULL AND to_rank < from_rank THEN
    RAISE EXCEPTION
      'You can only move a lead forward. Ask a coordinator or the owner to move it back.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS owner_only_stage_change ON leads;
CREATE TRIGGER owner_only_stage_change
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_only_stage_change();


-- ------------------------------------------------------------
-- STEP 8: bdm_leads_after_write()
--
-- AFTER, because each job needs the lead row to exist (FKs) or must only
-- happen once the write has definitely passed every check.
--
-- (1) CAPTURE HISTORY ROW. A BDM lead created at joinery_follow_up gets one
--     stage_history row, so the stepper and funnel have a dated entry. Real
--     sessions only — an import supplies its own history.
--
-- (2) HAND-OVER ON ASSIGNMENT (ownerless → an exec). A pool lead's client and
--     site were created by the BDM, and parties/sites UPDATE is "creator or
--     owner" — so without this the exec could not edit their own client's
--     number or site stage. Coordinator entry-on-behalf solves the same
--     problem by writing the exec's id at capture; a pool lead has no exec
--     yet, so it is done at assignment instead. Architects and firms stay
--     with the BDM (portfolio). A client shared with ANOTHER of this BDM's
--     still-waiting pool leads is left alone.
--
-- (3) NOTIFICATIONS (respect app.skip_assignment_notifications, like the
--     existing notification triggers):
--       bdm_pool_lead     — a new pool lead → every active owner
--       bdm_lead_assigned — pool lead assigned → the BDM (the exec's own
--                           'lead_assigned' already fires from
--                           migration_lead_assignment_notifications.sql)
--       bdm_lead_won/lost — their lead closed → the BDM, unless the BDM made
--                           the change or owns the lead themselves
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bdm_leads_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  skip_notify boolean := coalesce(current_setting('app.skip_assignment_notifications', true), 'off') = 'on';
  actor_id    integer := current_employee_id();
BEGIN
  IF NEW.bdm_employee_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- (1)
    IF auth.uid() IS NOT NULL AND NEW.current_stage = 'joinery_follow_up' THEN
      INSERT INTO stage_history (lead_id, stage, changed_by)
      VALUES (NEW.id, 'joinery_follow_up', COALESCE(actor_id, NEW.bdm_employee_id));
    END IF;

    -- (3)
    IF NOT skip_notify AND NEW.owner_employee_id IS NULL THEN
      INSERT INTO notifications (employee_id, kind, lead_id, actor_employee_id)
      SELECT e.id, 'bdm_pool_lead', NEW.id, actor_id
        FROM employees e
       WHERE e.role = 'owner'
         AND e.is_active = true
         AND e.id IS DISTINCT FROM actor_id;
    END IF;

    RETURN NULL;
  END IF;

  -- UPDATE
  IF OLD.owner_employee_id IS NULL AND NEW.owner_employee_id IS NOT NULL THEN
    -- (2)
    UPDATE sites
       SET discovered_by = NEW.owner_employee_id
     WHERE id = NEW.site_id
       AND discovered_by = NEW.bdm_employee_id;

    UPDATE parties p
       SET created_by = NEW.owner_employee_id
     WHERE p.id IN (NEW.party_id, NEW.other_party_id)
       AND p.created_by = NEW.bdm_employee_id
       AND p.party_type NOT IN ('architect', 'firm')
       AND NOT EXISTS (
         SELECT 1 FROM leads l2
          WHERE l2.id <> NEW.id
            AND l2.owner_employee_id IS NULL
            AND l2.bdm_employee_id = NEW.bdm_employee_id
            AND (l2.party_id = p.id OR l2.other_party_id = p.id)
       );

    -- (3)
    IF NOT skip_notify AND NEW.owner_employee_id IS DISTINCT FROM NEW.bdm_employee_id THEN
      INSERT INTO notifications (employee_id, kind, lead_id, actor_employee_id)
      VALUES (NEW.bdm_employee_id, 'bdm_lead_assigned', NEW.id, actor_id);
    END IF;
  END IF;

  -- (3)
  IF NOT skip_notify
     AND NEW.current_stage IN ('won', 'lost')
     AND NEW.current_stage IS DISTINCT FROM OLD.current_stage
     AND actor_id IS DISTINCT FROM NEW.bdm_employee_id
     AND NEW.owner_employee_id IS DISTINCT FROM NEW.bdm_employee_id THEN
    INSERT INTO notifications (employee_id, kind, lead_id, actor_employee_id)
    VALUES (NEW.bdm_employee_id,
            CASE NEW.current_stage WHEN 'won' THEN 'bdm_lead_won' ELSE 'bdm_lead_lost' END,
            NEW.id, actor_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS bdm_leads_after_write ON leads;
CREATE TRIGGER bdm_leads_after_write
  AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION bdm_leads_after_write();


-- ------------------------------------------------------------
-- STEP 9: RLS — every policy is additive, named bdm_*, and guarded on the
-- role first so it folds to a constant false for every other role (the
-- CLAUDE.md RLS-performance pattern). Nothing existing is edited.
--
-- "Tagged lead" below always means leads.bdm_employee_id = the caller.
-- EXISTS subqueries on `leads` run under the caller's own leads RLS, so they
-- can only ever match a lead the BDM is already allowed to see.
-- ------------------------------------------------------------

-- leads: read every lead they brought in, whoever owns it now.
DROP POLICY IF EXISTS "bdm_sourced_select" ON leads;
CREATE POLICY "bdm_sourced_select" ON leads
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND bdm_employee_id = (SELECT current_employee_id())
  );

-- leads: insert an ownerless pool lead, or one they will work themselves.
-- Never a lead owned by anyone else — a BDM does not assign.
DROP POLICY IF EXISTS "bdm_insert" ON leads;
CREATE POLICY "bdm_insert" ON leads
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND bdm_employee_id = (SELECT current_employee_id())
    AND (owner_employee_id IS NULL OR owner_employee_id = (SELECT current_employee_id()))
  );

-- leads: edit a pool lead until the owner assigns it. The owner column can't
-- move either way (STEP 5 (c) raises; this WITH CHECK is the second layer).
-- After assignment neither USING branch matches, so a BDM update touches 0
-- rows — view only.
DROP POLICY IF EXISTS "bdm_pool_update" ON leads;
CREATE POLICY "bdm_pool_update" ON leads
  FOR UPDATE USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND bdm_employee_id = (SELECT current_employee_id())
    AND owner_employee_id IS NULL
  ) WITH CHECK (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND bdm_employee_id = (SELECT current_employee_id())
    AND owner_employee_id IS NULL
  );

-- stage_history: read the progress of their leads.
DROP POLICY IF EXISTS "bdm_sourced_select" ON stage_history;
CREATE POLICY "bdm_sourced_select" ON stage_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = stage_history.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
    )
  );

-- stage_history: record a stage change the BDM makes on a pool lead (the app
-- writes history itself, as for every role). A lead they own is already
-- covered by own_lead_insert. changed_by must be the BDM.
DROP POLICY IF EXISTS "bdm_pool_insert" ON stage_history;
CREATE POLICY "bdm_pool_insert" ON stage_history
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND changed_by = (SELECT current_employee_id())
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = stage_history.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
         AND l.owner_employee_id IS NULL
    )
  );

-- activities: read the exec's work on their leads (Lead Detail's timeline).
DROP POLICY IF EXISTS "bdm_sourced_select" ON activities;
CREATE POLICY "bdm_sourced_select" ON activities
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND lead_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = activities.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
    )
  );

-- lead_owner_history: who the lead was handed to, and when.
DROP POLICY IF EXISTS "bdm_sourced_select" ON lead_owner_history;
CREATE POLICY "bdm_sourced_select" ON lead_owner_history
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_owner_history.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
    )
  );

-- loss_reasons: why their lead was lost (owner's ruling). Still no access to
-- any other lead's reasons — "Why we lose" stays owner-only company-wide.
DROP POLICY IF EXISTS "bdm_sourced_select" ON loss_reasons;
CREATE POLICY "bdm_sourced_select" ON loss_reasons
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = loss_reasons.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
    )
  );

-- parties: the client / referrer / other party on their leads, and contacts
-- at those leads' sites — otherwise a handed-off lead reads "Lead #1234".
-- (Architects/firms are already visible to everyone via
-- architect_firm_universal_select; the BDM's own-created parties via
-- team_scoped_select's created_by branch.)
DROP POLICY IF EXISTS "bdm_sourced_select" ON parties;
CREATE POLICY "bdm_sourced_select" ON parties
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND (
      EXISTS (
        SELECT 1 FROM leads l
         WHERE l.bdm_employee_id = (SELECT current_employee_id())
           AND (l.party_id = parties.id
                OR l.referred_by_party_id = parties.id
                OR l.other_party_id = parties.id)
      )
      OR EXISTS (
        SELECT 1 FROM site_contacts sc
          JOIN leads l2 ON l2.site_id = sc.site_id
         WHERE sc.party_id = parties.id
           AND l2.bdm_employee_id = (SELECT current_employee_id())
      )
    )
  );

-- sites: the site of each of their leads.
DROP POLICY IF EXISTS "bdm_sourced_select" ON sites;
CREATE POLICY "bdm_sourced_select" ON sites
  FOR SELECT USING (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.site_id = sites.id
         AND l.bdm_employee_id = (SELECT current_employee_id())
    )
  );

-- lead_remarks: the capture-time remark (owner's ruling: remarks at capture
-- only). Allowed while the lead is still in the pool; once assigned, the BDM
-- can read remarks (readable_if_lead_visible already inherits lead
-- visibility) but not add them. A lead the BDM owns is already covered by
-- insert_if_can_edit_lead.
DROP POLICY IF EXISTS "bdm_pool_insert" ON lead_remarks;
CREATE POLICY "bdm_pool_insert" ON lead_remarks
  FOR INSERT WITH CHECK (
    (SELECT current_employee_role()) = 'business_development_manager'
    AND employee_id = (SELECT current_employee_id())
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_remarks.lead_id
         AND l.bdm_employee_id = (SELECT current_employee_id())
         AND l.owner_employee_id IS NULL
    )
  );


-- ------------------------------------------------------------
-- STEP 10: notifications.kind
--
-- Nothing renders or pushes the four new kinds until BDM.md Step 3 teaches
-- AssignedLeadsCard/notificationQueries.js and the Edge Function about them
-- (both filter on an explicit kind list, so unknown kinds are simply
-- ignored until then — never mis-rendered).
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('lead_assigned', 'lixil_lead_created',
                  'bdm_pool_lead', 'bdm_lead_assigned', 'bdm_lead_won', 'bdm_lead_lost'));


-- PostgREST caches the schema; new columns are invisible to the API until it
-- reloads. Delivered when the transaction commits.
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================
-- VERIFY (read-only introspection — the behavioural checks live in
-- Schema/verify_bdm_role.sql)
--
-- 1. Columns exist:
--   SELECT table_name, column_name, data_type FROM information_schema.columns
--    WHERE (table_name = 'leads'   AND column_name IN ('bdm_employee_id','joinery_received'))
--       OR (table_name = 'parties' AND column_name IN ('bdm_employee_id','bdm_since'));
--   Expect 4 rows.
--
-- 2. Triggers exist:
--   SELECT tgrelid::regclass, tgname FROM pg_trigger
--    WHERE NOT tgisinternal
--      AND tgname IN ('bdm_leads_before_write','bdm_leads_after_write',
--                     'bdm_parties_before_write','stamp_lead_creator',
--                     'owner_only_stage_change','validate_employee_role_assignment');
--   Expect 6 rows.
--
-- 3. Policies exist:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE policyname LIKE 'bdm_%' ORDER BY tablename, policyname;
--   Expect 11 rows: activities, lead_owner_history, lead_remarks (insert),
--   leads (select, insert, update), loss_reasons, parties, sites,
--   stage_history (select, insert).
-- ============================================================
