-- ============================================================
-- MIGRATION: Sales Manager role (Phase 10) — schema + RLS
--
-- RUN THIS IN THE SUPABASE SQL EDITOR, whole file, top to bottom.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR
-- REPLACE throughout). Verification queries at the bottom.
--
-- ORDER: run AFTER migration_lead_edit_rights.sql, which is itself after
-- migration_sales_coordinator.sql and migration_backlog_2026_08_10.sql.
-- STEP 8 below REPLACES enforce_owner_only_stage_change(); every one of
-- those three files installs an earlier version of that same function, so
-- running any of them afterwards silently reverts a manager's stage
-- rights. Same hazard migration_lead_edit_rights.sql documents for itself.
--
-- ------------------------------------------------------------
-- WHAT THIS ADDS: a fourth role, 'sales_manager' (SM).
--
-- An SM is a WORKING SALES EXECUTIVE WHO ALSO SUPERVISES. That sentence is
-- the whole design, and the two halves are deliberately separate:
--
--   * As a rep — they own leads, log their own activities, carry personal
--     targets, and are ranked against sales executives. This half needs NO
--     new policy at all: every own_data_or_owner_role_* policy already
--     keys on `= current_employee_id()`, not on a role name, so a manager
--     is covered by the existing exec plumbing the moment the role value
--     is legal. Verify that claim rather than trusting it (VERIFY Q9).
--
--   * As a supervisor — they read everything about their own team's
--     leads, and may change only a narrow set of fields on them. This
--     half is what the rest of this file builds.
--
-- HOW IT DIFFERS FROM sales_coordinator, decided with the owner
-- 2026-09-03. Do not "align" these later without asking; each divergence
-- was chosen explicitly:
--
--   coordinator                        manager
--   -----------------------------------------------------------------
--   owns no leads                      owns leads, carries targets
--   edits team lead details freely     stage / follow-up / order value /
--     (lock dropped 2026-08-13)          owner ONLY (STEP 7)
--   moves stage any direction          FORWARD ONLY, same as an exec
--   enters leads + activities on       never — logs only their own work
--     behalf of an exec                  (no INSERT policy anywhere here)
--   may edit an exec's activities      never (SELECT only on activities)
--   cannot see loss reasons            can, for their team (STEP 6)
--   reassigns within their team        same, plus to themselves
--
-- A sales exec now reports to TWO independent authorities. coordinator_id
-- and manager_id are separate columns, both optional, neither implying the
-- other, and neither role can see into the other's supervision. An exec may
-- have a coordinator, a manager, both, or neither.
--
-- ------------------------------------------------------------
-- WHY A SECOND HELPER, NOT A WIDENED is_my_team_member()
--
-- is_my_team_member() is routed through by ~13 live, verified coordinator
-- policies. Teaching it a second reporting line would change every one of
-- them at once, and a mistake there is a silent cross-team data leak on a
-- role that is already in production. is_my_managed_member() is a parallel
-- function with an identical shape, so the coordinator's behaviour is
-- byte-for-byte untouched by this file — the same reasoning that made the
-- coordinator's own policies separate rather than edits to the exec ones.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: employees.role — allow 'sales_manager'
--
-- MUST run before STEP 2's trigger can ever match, and before any row can
-- be given the new role. Widening a CHECK never invalidates existing rows.
-- ------------------------------------------------------------
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','sales_executive','sales_coordinator','sales_manager'));


-- ------------------------------------------------------------
-- STEP 2: employees.manager_id
--
-- INTEGER, not UUID — employees.id is SERIAL here (the same correction
-- migration_sales_coordinator.sql records for coordinator_id).
--
-- NULL means "no manager": the normal state for an owner, a coordinator, a
-- manager themselves, and for any exec whose manager line has not been set.
-- Nothing is backfilled and nothing is required — an exec with no manager
-- simply appears on no manager's team, which is the correct reading for
-- all 431 imported leads and every employee that exists today.
--
-- ON DELETE is deliberately absent (RESTRICT): employees are deactivated,
-- never deleted, in this app. STEP 3 blocks the realistic version of this
-- hazard — deactivating or demoting a manager who still has reports.
-- ------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'employees'::regclass AND conname = 'fk_employee_manager'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT fk_employee_manager FOREIGN KEY (manager_id)
      REFERENCES employees(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);


-- ------------------------------------------------------------
-- STEP 3: extend validate_employee_role_assignment()
--
-- Reproduces the existing coordinator half VERBATIM and adds the manager
-- half beside it. Read the coordinator clauses as untouched: this is a
-- CREATE OR REPLACE of one function that owns both rules, not a new rule.
--
-- THREE things are enforced for the manager line:
--
--   1. manager_id may only sit on a sales_executive, and may only point at
--      a sales_manager. Mirrors the coordinator rule exactly.
--
--      CONSEQUENCE FOR THE ADMIN UI: promoting an exec to sales_manager
--      must clear BOTH coordinator_id AND manager_id in the SAME
--      statement, or this trigger rejects the promotion with a confusing
--      message about a line the owner did not touch. updateEmployeeRole()
--      in src/lib/employeeQueries.js already clears coordinator_id for a
--      non-exec role; manager_id is added to it in the screens pass.
--
--   2. Demoting a manager who still has reports is BLOCKED (owner's
--      ruling). An orphaned manager_id would leave a whole team's leads
--      readable by someone who is no longer their supervisor.
--
--   3. DEACTIVATING a manager who still has reports is ALSO blocked —
--      this is the one place the manager rule is STRICTER than the
--      coordinator's, which blocks only the role change. Called out here
--      rather than quietly widened to both roles: extending it to
--      coordinators would change the behaviour of a role that is already
--      live, which is a separate decision. Say so and it is a two-line
--      change.
--
-- A deactivated manager still resolves to NULL through
-- current_employee_role() (rls_policies.sql STEP A2), so their own access
-- is already revoked the instant is_active flips — this rule is about not
-- stranding their TEAM, not about the manager's own access.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_employee_role_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  ---- coordinator line (unchanged from migration_sales_coordinator.sql) ----
  IF NEW.coordinator_id IS NOT NULL THEN
    IF NEW.coordinator_id = NEW.id THEN
      RAISE EXCEPTION 'An employee cannot be their own coordinator'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.role <> 'sales_executive' THEN
      RAISE EXCEPTION 'Only a sales executive can be assigned to a coordinator (this employee is %)', NEW.role
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
    RAISE EXCEPTION 'This coordinator still has sales executives reporting to them — reassign their team first'
      USING ERRCODE = 'check_violation';
  END IF;

  ---- manager line (new) ----
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_employee_role_assignment ON employees;
CREATE TRIGGER validate_employee_role_assignment
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_employee_role_assignment();


-- ------------------------------------------------------------
-- STEP 4: helper — "is this employee on the calling SM's team?"
--
-- MUST come after STEP 2. LANGUAGE sql validates its body at CREATE time,
-- so defining it before manager_id exists fails the whole file on this
-- statement with 42703 — exactly how is_my_team_member() failed on its
-- first live run. Do not move it up, and do not switch it to plpgsql to
-- make the ordering not matter: late binding would turn a loud creation
-- error into a quiet runtime one.
--
-- Returns false (not null) for a NULL argument, so an unassigned lead is
-- invisible to every manager rather than visible to all of them.
--
-- The role test inside is belt-and-braces exactly as it is in
-- is_my_team_member(): STEP 3 already guarantees manager_id only ever
-- points at a sales_manager.
--
-- IMPORTANT: this is false for the caller's OWN id — a manager has no
-- manager. That is load-bearing in two places. It means "a manager's own
-- leads are not part of their own team scope" (the owner's ruling: team
-- means execs only), and it is what makes the WITH CHECK in STEP 5 need an
-- explicit `= current_employee_id()` branch to permit reassigning a lead
-- to oneself.
--
-- SECURITY DEFINER + fixed search_path + STABLE, matching the three
-- existing helpers — see rls_policies.sql STEP A2 for why all three.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_my_managed_member(target_employee_id integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE e.id = target_employee_id
       AND e.manager_id = current_employee_id()
       AND current_employee_role() = 'sales_manager'
  );
$$;

GRANT EXECUTE ON FUNCTION is_my_managed_member(integer) TO authenticated;


-- ------------------------------------------------------------
-- STEP 5: manager team access — leads, activities, stage_history
--
-- Separate permissive policies (they OR together with what exists), so not
-- one byte of owner / exec / coordinator behaviour changes.
--
-- WHAT IS DELIBERATELY ABSENT, so each reads as a decision:
--
--   * NO INSERT on leads and NO INSERT/UPDATE on activities. A manager
--     never enters data on behalf of an exec (owner's ruling) — they log
--     their own work only, through the existing own_data policies. If a
--     manager joins a rep's site visit, the REP logs it and names the
--     manager in "Accompanied by".
--
--   * NO DELETE anywhere. Unchanged: owner-only, everywhere, always.
--
--   * NO site_contacts UPDATE. A site contact is a lead detail, and
--     details are not the manager's to edit.
--
-- The leads UPDATE policy is row-level and wide; STEP 7's trigger draws the
-- column line inside it. That pairing is not optional — see STEP 7.
-- ------------------------------------------------------------

-- leads
DROP POLICY IF EXISTS "manager_team_select" ON leads;
CREATE POLICY "manager_team_select" ON leads
  FOR SELECT USING (is_my_managed_member(owner_employee_id));

-- USING      -> may this manager touch the row as it stands? (their team's)
-- WITH CHECK -> is the result still legal? The `= current_employee_id()`
--   branch is what permits reassigning a team lead to THEMSELVES, which
--   is_my_managed_member() alone would refuse (a manager is not on their
--   own team). Without it, "reassign within your team, including to
--   yourself" would be UI-only and fail at the database.
--   Note what it still forbids: handing a lead to anyone outside the
--   manager's own reporting line.
DROP POLICY IF EXISTS "manager_team_update" ON leads;
CREATE POLICY "manager_team_update" ON leads
  FOR UPDATE USING (
    is_my_managed_member(owner_employee_id)
  ) WITH CHECK (
    is_my_managed_member(owner_employee_id)
    OR owner_employee_id = current_employee_id()
  );

-- activities — SELECT only, per the ruling above.
DROP POLICY IF EXISTS "manager_team_select" ON activities;
CREATE POLICY "manager_team_select" ON activities
  FOR SELECT USING (is_my_managed_member(employee_id));

-- stage_history — SELECT and INSERT. INSERT is not optional: a manager who
-- may change a team lead's stage must be able to record it, or the change
-- lands on `leads` and its audit row fails. Same pairing STEP 2 of
-- migration_lead_edit_rights.sql documents for the exec.
-- Still no UPDATE or DELETE for anyone, including owner. Append-only.
DROP POLICY IF EXISTS "manager_team_select" ON stage_history;
CREATE POLICY "manager_team_select" ON stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND is_my_managed_member(leads.owner_employee_id)
    )
  );

DROP POLICY IF EXISTS "manager_team_insert" ON stage_history;
CREATE POLICY "manager_team_insert" ON stage_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND is_my_managed_member(leads.owner_employee_id)
    )
  );


-- ------------------------------------------------------------
-- STEP 6: the read-only supervision surfaces
--
-- follow_ups is the manager's one write path into their team's day:
-- assigning a reminder to an exec, from the team tab, the exec's profile,
-- the lead screen, or a red-flag row. UPDATE is included so a manager can
-- reschedule or close one they set. No DELETE (owner-only, unchanged).
--
-- targets is SELECT-only: SetTargetForm stays owner-only, so there is no
-- write path for the UI to use. The manager reads their team's targets to
-- render attainment.
--
-- parties / sites: added as SEPARATE policies rather than by editing
-- team_scoped_select, which is live and verified. The manager's OWN
-- parties and sites already resolve through that policy's existing
-- role-agnostic branches (created_by / discovered_by / own-lead), so only
-- the team branch is new here. The explicit role test in front of each
-- EXISTS is a short-circuit: without it every party row on every read, for
-- every role, pays for a lead subquery that can only ever matter to a
-- manager.
--
-- loss_reasons: SELECT is owner-only today and hard-enforced in RLS — the
-- "Why we lose" card is genuinely invisible to a coordinator, not merely
-- hidden. The owner asked for managers to have it, so this is a real
-- widening. Scoped to their team's leads plus their own, since their
-- Dashboard has a My/Team switch and a card that could only ever work on
-- one side of it would be a trap.
--   NOTE the INSERT asymmetry that already exists and still holds:
--   loss_reasons INSERT is open to any active employee while SELECT is
--   not, so `.insert().select()` fails there for a non-owner (Postgres
--   applies the SELECT policy to INSERT ... RETURNING). This widening
--   makes that call start working for a manager on their own leads —
--   LeadStageSection.jsx deliberately has no .select() on that write and
--   must keep not having one, or it breaks for execs and coordinators.
--
-- lead_change_log / lead_owner_history: the Day Review day sheet reads
-- both. Mirrors the coordinator branches added by
-- migration_phase9_rls_fixes.sql. Both stay append-only.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "manager_team_select" ON follow_ups;
CREATE POLICY "manager_team_select" ON follow_ups
  FOR SELECT USING (is_my_managed_member(assigned_to));

DROP POLICY IF EXISTS "manager_team_insert" ON follow_ups;
CREATE POLICY "manager_team_insert" ON follow_ups
  FOR INSERT WITH CHECK (is_my_managed_member(assigned_to));

DROP POLICY IF EXISTS "manager_team_update" ON follow_ups;
CREATE POLICY "manager_team_update" ON follow_ups
  FOR UPDATE USING (is_my_managed_member(assigned_to))
  WITH CHECK (is_my_managed_member(assigned_to));

DROP POLICY IF EXISTS "manager_team_select" ON targets;
CREATE POLICY "manager_team_select" ON targets
  FOR SELECT USING (is_my_managed_member(employee_id));

DROP POLICY IF EXISTS "manager_team_select" ON parties;
CREATE POLICY "manager_team_select" ON parties
  FOR SELECT USING (
    current_employee_role() = 'sales_manager'
    AND (
      EXISTS (
        SELECT 1 FROM leads l
         WHERE is_my_managed_member(l.owner_employee_id)
           AND (l.party_id = parties.id
                OR l.referred_by_party_id = parties.id
                OR l.other_party_id = parties.id)
      )
      OR EXISTS (
        SELECT 1 FROM site_contacts sc
          JOIN leads l2 ON l2.site_id = sc.site_id
         WHERE sc.party_id = parties.id
           AND is_my_managed_member(l2.owner_employee_id)
      )
    )
  );

DROP POLICY IF EXISTS "manager_team_select" ON sites;
CREATE POLICY "manager_team_select" ON sites
  FOR SELECT USING (
    current_employee_role() = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.site_id = sites.id
         AND is_my_managed_member(l.owner_employee_id)
    )
  );

DROP POLICY IF EXISTS "manager_team_select" ON loss_reasons;
CREATE POLICY "manager_team_select" ON loss_reasons
  FOR SELECT USING (
    current_employee_role() = 'sales_manager'
    AND EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = loss_reasons.lead_id
         AND (is_my_managed_member(l.owner_employee_id)
              OR l.owner_employee_id = current_employee_id())
    )
  );

DROP POLICY IF EXISTS "manager_team_select" ON lead_change_log;
CREATE POLICY "manager_team_select" ON lead_change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = lead_change_log.lead_id
         AND is_my_managed_member(leads.owner_employee_id)
    )
  );

DROP POLICY IF EXISTS "manager_team_select" ON lead_owner_history;
CREATE POLICY "manager_team_select" ON lead_owner_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = lead_owner_history.lead_id
         AND is_my_managed_member(leads.owner_employee_id)
    )
  );


-- ------------------------------------------------------------
-- STEP 7: the manager lock — column-level, on leads
--
-- THE PAIR THAT MAKES "SUPERVISE, DON'T OVERWRITE" WORK. STEP 5's UPDATE
-- policy hands the manager the whole team row, because RLS restricts rows
-- and never columns. This trigger is the only thing standing between that
-- and a manager rewriting a rep's client details. Removing either half
-- silently guts the other — the same trap migration_sales_coordinator.sql
-- STEP 4b documented for the coordinator's version of this.
--
-- THE FOUR ALLOWED COLUMNS, and why each is there:
--   current_stage       — the point of the role. Direction is separately
--                         restricted to forward-only by STEP 8.
--   next_followup_date  — FollowUpForm stamps this column on any linked
--                         lead, and LeadStageSection's On Hold flow writes
--                         it in the SAME statement as the stage. Without
--                         it, "a manager may assign follow-ups" would fail
--                         at the database on every team lead.
--   order_value         — LeadQuickActions' Won prompt REQUIRES a value
--                         before it writes the stage. Excluding it would
--                         let a manager mark a deal Won only when a value
--                         happened to already be there, and dead-end them
--                         otherwise. The owner chose to include it.
--   owner_employee_id   — reassignment within their own team. Technically
--                         a "detail", and admitted here as the deliberate
--                         exception the owner asked for; its BOUNDS are
--                         enforced by STEP 5's WITH CHECK, not here.
--
-- Everything else — quote_value, closure_probability, dates, product,
-- party/site links, territory — is refused outright.
--
-- WHY NOT KEYED ON entered_by_role: the coordinator's dropped lock engaged
-- only once the exec had saved the record themselves. A manager's limit is
-- unconditional, so there is nothing to condition on. (stamp_entered_by_role()
-- only ever writes 'sales_executive' anyway, so a manager's own leads never
-- get stamped at all — see STEP 9.)
--
-- Comparison is BY VALUE, not "was this column in the UPDATE statement".
-- Re-sending a column unchanged is therefore always fine, which is what
-- keeps ordinary app saves working — LeadQuickActions re-sends the existing
-- order_value on a Won close and that produces no diff.
--
-- jsonb minus a key-array drops those keys from both sides before
-- comparing, so a column added to `leads` later is protected by default
-- rather than silently unguarded.
--
-- IS NOT DISTINCT FROM on the ownership test, not `=`: owner_employee_id is
-- nullable, and `NULL = x` is NULL — falsy — which would be the safe
-- direction here (an unassigned lead falls through to the locked path) but
-- only by accident. Made explicit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_manager_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed CONSTANT text[] := ARRAY[
    'current_stage','next_followup_date','order_value','owner_employee_id'
  ];
BEGIN
  IF current_employee_role() IS DISTINCT FROM 'sales_manager' THEN
    RETURN NEW;   -- owner, coordinator and the exec themselves are unaffected
  END IF;

  IF OLD.owner_employee_id IS NOT DISTINCT FROM current_employee_id() THEN
    RETURN NEW;   -- a manager's OWN lead: they are a rep here, no limits
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'This lead belongs to one of your sales executives — a manager can change its stage, follow-up date, order value and owner, but not its other details'
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


-- ------------------------------------------------------------
-- STEP 8: stage changes — admit the manager, FORWARD ONLY
--
-- REPLACES enforce_owner_only_stage_change() from
-- migration_lead_edit_rights.sql. The funnel sequence, the auth.uid()
-- admin-SQL guard, the won/lost reopening rule and the on_hold
-- laundering defence are all reproduced VERBATIM — the only change is
-- which roles land on which side of the forward-only branch:
--
--   owner, sales_coordinator  -> any direction, including backward
--   sales_executive           -> forward only   (unchanged)
--   sales_manager             -> forward only   (NEW)
--
-- The manager is forward-only on THEIR OWN leads as well as their team's,
-- by the owner's ruling: they are supervised on their own pipeline the
-- same way their reps are. Reopening a decided deal, or walking one back,
-- stays a coordinator/owner action for them too.
--
-- The exception messages said "Ask your coordinator or the owner". A
-- manager may not have a coordinator, so the wording is now neutral.
--
-- COALESCE, not a bare NOT IN: a deactivated employee has a real
-- auth.uid() but a NULL role, and `NULL NOT IN (...)` evaluates to NULL —
-- falsy — which would let them straight through the guard.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- The 8 sequential funnel stages. Mirrors FUNNEL_SEQUENCE in
  -- src/lib/stageProgress.js — keep the two in step.
  seq CONSTANT text[] := ARRAY[
    'calling','presentation','joinery_follow_up','measurements',
    'design_discussion','rfq','quote_submission','negotiation'
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

  IF caller_role NOT IN ('owner','sales_coordinator','sales_executive','sales_manager') THEN
    RAISE EXCEPTION 'You do not have permission to change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Owner and coordinator move a stage in any direction, including back.
  IF caller_role IN ('owner','sales_coordinator') THEN
    RETURN NEW;
  END IF;

  -- ---- sales_executive and sales_manager, from here down: forward only ----

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
  -- unrecognised legacy current_stage has no rank either, and is left
  -- alone rather than guessed at.
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
-- STEP 9: entered_by_role — widen the CHECK only
--
-- FORWARD-LOOKING ONLY. stamp_entered_by_role() still writes exactly one
-- value, 'sales_executive', and nothing in this migration changes that —
-- a manager's own lead is never stamped, and the manager lock in STEP 7
-- deliberately does not consult this column. The CHECK is widened purely
-- so the column can never become the thing that rejects a write if a
-- later change does start stamping it. Zero behavioural effect today.
-- ------------------------------------------------------------
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_entered_by_role_check;
ALTER TABLE leads ADD CONSTRAINT leads_entered_by_role_check
  CHECK (entered_by_role IS NULL
         OR entered_by_role IN ('owner','sales_executive','sales_coordinator','sales_manager'));

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_entered_by_role_check;
ALTER TABLE activities ADD CONSTRAINT activities_entered_by_role_check
  CHECK (entered_by_role IS NULL
         OR entered_by_role IN ('owner','sales_executive','sales_coordinator','sales_manager'));


-- ============================================================
-- DELIBERATELY NOT CHANGED — so these read as decisions, not oversights
--
--   employees SELECT   — still open to every active employee. A manager
--                        needs name lookups exactly as everyone else does.
--                        CONSEQUENCE: the database will NOT narrow a
--                        manager's roster for them. fetchMyTeamExecs()
--                        already filters coordinator_id client-side for the
--                        same reason; the manager's roster is filtered the
--                        same way, at the fetch, once.
--   employees UPDATE   — still owner-only, no exceptions. Only the owner
--                        assigns an exec to a manager (owner's ruling).
--   plans              — untouched, still unused anywhere in src/.
--   push_subscriptions — untouched. No push for managers (owner's ruling:
--                        in-app red flags only), so no policy is needed.
--   activities UPDATE  — no manager branch. An activity is a record of
--                        something a person did on a date.
--   DELETE, anywhere   — owner-only, unchanged, on every table.
--   is_my_team_member()— untouched. The coordinator's ~13 policies behave
--                        exactly as they did before this file ran.
-- ============================================================


-- ============================================================
-- VERIFY — run each of these after the migration. Expected results are
-- stated; anything else means a step did not land.
-- ============================================================

-- Q1. Role CHECK admits all four roles. Expect the definition to contain
--     'sales_manager'.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'employees'::regclass AND conname = 'employees_role_check';

-- Q2. manager_id exists, is integer, nullable, indexed and FK'd.
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name = 'employees' AND column_name = 'manager_id';
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'employees'::regclass AND conname = 'fk_employee_manager';
-- SELECT indexname FROM pg_indexes WHERE indexname = 'idx_employees_manager';

-- Q3. The helper exists and is SECURITY DEFINER + STABLE.
-- SELECT proname, prosecdef, provolatile FROM pg_proc
--  WHERE proname = 'is_my_managed_member';
--     -> prosecdef = true, provolatile = 's'

-- Q4. Every manager policy landed. Expect 14 rows across 11 tables:
--     leads (SELECT, UPDATE), activities (SELECT),
--     stage_history (SELECT, INSERT), follow_ups (SELECT, INSERT, UPDATE),
--     targets (SELECT), parties (SELECT), sites (SELECT),
--     loss_reasons (SELECT), lead_change_log (SELECT),
--     lead_owner_history (SELECT).
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE policyname LIKE 'manager_%' ORDER BY tablename, cmd;

-- Q5. Both leads triggers are present, and the coordinator's dropped lock
--     has NOT come back. Expect enforce_manager_lock and
--     owner_only_stage_change among the rows, and NO enforce_coordinator_lock.
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal ORDER BY tgname;

-- Q6. The stage function admits the manager and still forces forward-only
--     for them. Expect both true.
-- SELECT prosrc LIKE '%sales_manager%'                        AS admits_manager,
--        prosrc LIKE '%IN (''owner'',''sales_coordinator'')%'  AS free_move_is_owner_sc_only
--   FROM pg_proc WHERE proname = 'enforce_owner_only_stage_change';

-- Q7. Coordinator behaviour is untouched. Expect the same rows this
--     returned before the migration.
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE policyname LIKE 'coordinator_%' ORDER BY tablename, cmd;

-- Q8. THE TRIGGER RULES, exercised rather than inspected. Replace the ids.
--     Each of these must FAIL with the quoted message:
-- UPDATE employees SET manager_id = <an owner's id>   WHERE id = <exec id>;
--     -> 'manager_id must point at an employee whose role is sales_manager'
-- UPDATE employees SET manager_id = <a manager's id>  WHERE id = <a coordinator's id>;
--     -> 'Only a sales executive can be assigned to a manager'
-- UPDATE employees SET role = 'sales_executive'       WHERE id = <manager with reports>;
--     -> 'This manager still has sales executives reporting to them'
-- UPDATE employees SET is_active = false              WHERE id = <manager with reports>;
--     -> '...reassign their team before deactivating them'
--     And this must SUCCEED (promotion clears both lines in one statement):
-- UPDATE employees SET role = 'sales_manager', coordinator_id = NULL, manager_id = NULL
--  WHERE id = <exec id>;

-- Q9. The claim that a manager needs no new policy to work AS A REP.
--     Expect each of these to already contain a `current_employee_id()`
--     branch with no role name in it — i.e. they admit a manager's own
--     leads/activities/targets/follow_ups automatically.
-- SELECT tablename, policyname, cmd, qual FROM pg_policies
--  WHERE policyname LIKE 'own_data%' AND tablename IN
--        ('leads','activities','targets','follow_ups')
--  ORDER BY tablename, cmd;
