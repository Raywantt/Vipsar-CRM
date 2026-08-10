-- ============================================================
-- MIGRATION: Sales Coordinator role (Phase 8) — schema + RLS
-- Run this in the Supabase SQL Editor. Safe to re-run throughout
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS).
--
-- RUN THE BACKLOG FIRST. Schema/migration_backlog_2026_08_10.sql and
-- Schema/migration_lead_change_log.sql must both be in before this file.
-- This migration REPLACES enforce_owner_only_stage_change() (STEP 8), so
-- running it before the backlog would install the new function and then
-- have the backlog overwrite it with the old owner-only version.
--
-- WHAT THIS ADDS: a third role, 'sales_coordinator' (SC) — an oversight
-- role that owns no leads/activities of its own, supervises a fixed set of
-- sales executives (employees.coordinator_id), and is fully isolated from
-- every other SC's team.
--
-- ORDER IS LOAD-BEARING in three places, each called out at the step:
--   STEP 1 (role CHECK) precedes STEP 2 (coordinator_id + its validation
--     trigger), or no SC can exist to be pointed at.
--   STEP 3 (is_my_team_member) must come after STEP 2, because a
--     LANGUAGE sql function's body is validated at CREATE time and it
--     reads employees.coordinator_id. Getting this wrong fails the whole
--     file on its first statement with 42703 — which is exactly what
--     happened on the first live run of this migration.
--   STEP 8 (stage trigger) must come after the backlog, per above.
--
-- ============================================================
-- CORRECTIONS TO THE WRITTEN SPEC — read these, they are not nitpicks
--
-- 1. coordinator_id is INTEGER, not UUID. The spec says
--    `coordinator_id uuid references employees(id)`, but employees.id is
--    SERIAL (integer) — a UUID column could never reference it. Same for
--    every RLS predicate: the spec's `employees.coordinator_id = auth.uid()`
--    compares an employees.id to a Supabase auth UUID and would never
--    match. All predicates below use current_employee_id(), the existing
--    helper that resolves auth.uid() to an active employees.id.
--
-- 2. The coordinator_id role rule is a TRIGGER, not a CHECK constraint.
--    A CHECK cannot reference another row, and this rule is inherently
--    cross-row ("the employee this points at must have role
--    'sales_coordinator'"). The spec allowed either; this repo already
--    uses triggers for exactly this class of rule (owner_only_stage_change,
--    stamp_lead_creator).
--
-- 3. plans is deliberately untouched. The spec routes SC follow-up
--    assignment through plans.assigned_by, but `plans` has zero code
--    references anywhere in src/ — there is no plans view for an exec to
--    see an assignment in. The exec's real reminder surface is follow_ups
--    (Today screen + push notifications), which already carries
--    assigned_to/created_by and already renders "Assigned by {name}".
--    Confirmed with the product owner: SC assignment uses follow_ups.
--    STEP 7 grants SC the team-scoped follow_ups access that needs.
--    No plans.assigned_by column is added.
--
-- 4. parties/sites SELECT keeps a created_by/discovered_by branch. Without
--    it this migration would break New Lead outright — see STEP 6.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: employees.role — allow 'sales_coordinator'
--
-- MUST run before STEP 2: the coordinator_id validation trigger requires
-- an employee with role 'sales_coordinator' to exist before any exec can
-- be pointed at one.
--
-- Run this SELECT FIRST to confirm the constraint name, same safety step
-- migration_architect_meeting.sql uses (that file's assumption about
-- activities_activity_type_check was later confirmed by a real live error;
-- this one has not been confirmed the same way).
-- ------------------------------------------------------------
SELECT conname
  FROM pg_constraint
 WHERE conrelid = 'employees'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%role%';

-- If that returned employees_role_check, run these two lines as-is.
-- If it returned a different name, swap that name into both lines below.
--
-- Plain DROP, deliberately NOT `DROP ... IF EXISTS`. If the live constraint
-- turns out to carry a different name, IF EXISTS would silently do nothing,
-- the ADD below would succeed under the new name, and the ORIGINAL
-- two-value constraint would still be in force — so creating a
-- sales_coordinator would keep failing with a confusing violation against a
-- constraint this file appears to have just replaced. Failing loudly here is
-- worth more than idempotence. Re-running the whole file is still safe: by
-- then the constraint exists under this exact name and drops cleanly.
ALTER TABLE employees DROP CONSTRAINT employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','sales_executive','sales_coordinator'));


-- ------------------------------------------------------------
-- STEP 2: employees.coordinator_id + its validation trigger
--
-- NULL means "no coordinator" — the normal state for an owner, for an SC
-- (SCs report to the owner, not to each other), and for an exec not yet
-- assigned. Only a sales_executive may carry a non-NULL value.
--
-- ON DELETE SET NULL rather than RESTRICT: employees are deactivated, never
-- deleted, in this app (see employees.is_active) — but if a row ever is
-- removed, the team should survive unassigned rather than block the delete.
-- ------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS coordinator_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'employees'::regclass AND conname = 'fk_employee_coordinator'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT fk_employee_coordinator FOREIGN KEY (coordinator_id)
      REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drives is_my_team_member() on every team-scoped policy below, and the
-- Phase 3 admin screen's "who reports to this SC" lookup.
CREATE INDEX IF NOT EXISTS idx_employees_coordinator ON employees(coordinator_id);

-- The cross-row rules a CHECK constraint cannot express. All four raise
-- check_violation so PostgREST surfaces them as a normal inline error, the
-- same way the lost-lead and stage-change rules already do.
--
-- The last rule (blocking demotion of an SC who still has reports) is a
-- HARD block, deliberately different from the soft warn-and-allow the admin
-- UI gives for demoting an exec who still holds leads. The difference:
-- an exec's leads stay valid and readable after a role change, but an
-- orphaned coordinator_id pointing at a non-SC would silently break
-- is_my_team_member() for that whole team — a data-integrity break, not a
-- judgement call. The owner reassigns the reports first, then demotes.
--
-- >>> PHASE 3 UI REQUIREMENT, don't discover this in the browser <<<
-- PROMOTING an exec to sales_coordinator must CLEAR their coordinator_id in
-- the SAME statement. An exec being promoted still carries the coordinator
-- they used to report to, and rule 2 below rejects any non-exec holding a
-- coordinator_id — so `UPDATE employees SET role = 'sales_coordinator'`
-- alone fails with "Only a sales executive can be assigned to a
-- coordinator". The admin screen must send
-- `{ role: 'sales_coordinator', coordinator_id: null }` together.
-- Same applies to promoting an exec to owner.
CREATE OR REPLACE FUNCTION validate_employee_role_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_employee_role_assignment ON employees;
CREATE TRIGGER validate_employee_role_assignment
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_employee_role_assignment();


-- ------------------------------------------------------------
-- STEP 3: helper — "is this employee on the calling SC's team?"
--
-- MUST come after STEP 2. This is a LANGUAGE sql function, and Postgres
-- validates a sql function's body at CREATE time — so defining it before
-- employees.coordinator_id exists fails outright with
-- `42703: column e.coordinator_id does not exist`. (Found the hard way on
-- the first live run: this block originally sat at the top of the file.)
-- Do not move it back above STEP 2. A plpgsql function would survive the
-- reordering, since plpgsql resolves column references at call time rather
-- than at creation — but relying on late binding to paper over a real
-- dependency order is how the next person gets a runtime error instead of
-- an immediate one.
--
-- Every team-scoped policy below routes through this one function, for the
-- same reason current_employee_id()/current_employee_role() exist: the rule
-- gets taught to the database once, not repeated inline across ~20 policies
-- where the first typo becomes a silent data leak.
--
-- The role check inside is belt-and-braces. STEP 2's trigger already
-- guarantees coordinator_id only ever points at a sales_coordinator, so
-- `coordinator_id = current_employee_id()` could not match for a non-SC
-- caller anyway — but a policy this load-bearing shouldn't depend on a
-- constraint installed by a different step to be safe.
--
-- Returns false (not null) for a NULL argument: leads.owner_employee_id is
-- nullable, and EXISTS against `e.id = NULL` is false, so an unassigned
-- lead is invisible to every SC rather than visible to all of them.
--
-- SECURITY DEFINER + fixed search_path + STABLE, matching the two existing
-- helpers in rls_policies.sql — see that file's STEP A2 for the full
-- reasoning on why these three are required together.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_my_team_member(target_employee_id integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE e.id = target_employee_id
       AND e.coordinator_id = current_employee_id()
       AND current_employee_role() = 'sales_coordinator'
  );
$$;

GRANT EXECUTE ON FUNCTION is_my_team_member(integer) TO authenticated;


-- ------------------------------------------------------------
-- STEP 4: entered_by_role — the SC edit lock
--
-- READ THIS BEFORE "FIXING" ANYTHING BELOW. This column is a LOCK FLAG,
-- not an audit field, and it is the only one of its kind in this schema.
--
-- WHAT IT MEANS:
--   NULL                -> the assigned sales exec has never saved this
--                          record. The SC who created it may still edit it.
--   'sales_executive'   -> the exec has saved it at least once. The record
--                          is now theirs; the SC drops to view-only on it.
--
-- WHY IT EXISTS: an SC enters leads/activities on behalf of their team
-- (phone call comes in, SC logs it against the right exec). That entry
-- should stay correctable by the SC while it is still effectively a
-- placeholder — but the moment the exec who owns the work touches it, the
-- exec's version wins and the SC stops being able to overwrite it. Without
-- the flag the only two options are "SC can always overwrite the exec" or
-- "SC can never fix their own typo", both worse.
--
-- WHY A TRIGGER SETS IT, NOT APP CODE: identical reasoning to
-- lead_change_log (see migration_lead_change_log.sql). There is no single
-- lead-update service in this app — `leads` is written from four LeadDetail
-- sections, LeadStageSection, LeadQuickActions and three side-effect paths
-- in ActivityLog.jsx. A JS helper would have to be called from every one of
-- them, and the first missed call site silently leaves a record editable by
-- the SC forever. A trigger catches every path including the table editor.
--
-- WHY ONLY 'sales_executive' IS EVER WRITTEN: the CHECK permits all three
-- role values so the column reads sensibly and can widen later, but the
-- trigger only ever stamps 'sales_executive'. An owner-created or
-- SC-created record stays NULL on purpose — neither of those is "the exec
-- has taken ownership of this", which is the only thing the lock encodes.
--
-- NOTE the deliberate consequence: the lock is row-level, because RLS is
-- row-level. Once an exec touches a lead, the SC loses UPDATE on that
-- whole row — including current_stage, even though STEP 8 grants SCs
-- stage-change rights. See STEP 8's own note.
-- ------------------------------------------------------------
ALTER TABLE leads      ADD COLUMN IF NOT EXISTS entered_by_role TEXT;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS entered_by_role TEXT;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_entered_by_role_check;
ALTER TABLE leads ADD CONSTRAINT leads_entered_by_role_check
  CHECK (entered_by_role IS NULL
         OR entered_by_role IN ('owner','sales_executive','sales_coordinator'));

ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_entered_by_role_check;
ALTER TABLE activities ADD CONSTRAINT activities_entered_by_role_check
  CHECK (entered_by_role IS NULL
         OR entered_by_role IN ('owner','sales_executive','sales_coordinator'));

-- NO BACKFILL, deliberately — this is a product decision (2026-08-10), not
-- an omission. Every record predating this migration keeps a NULL
-- entered_by_role, so a newly appointed SC starts WITH edit rights over
-- their team's existing leads and activities, and loses them per-record as
-- each exec next saves that record themselves.
--
-- The alternative considered and rejected was stamping every existing
-- exec-owned row 'sales_executive' on day one. That is the safer-looking
-- default, but it would leave a new SC unable to touch anything real until
-- the team happened to re-save it — and completing half-filled records is
-- part of why the role exists. The lock still engages naturally, per
-- record, on first exec contact.
--
-- To reverse this later (lock the back catalogue after all), run:
--   UPDATE leads      SET entered_by_role = 'sales_executive'
--    WHERE entered_by_role IS NULL AND owner_employee_id IS NOT NULL;
--   UPDATE activities SET entered_by_role = 'sales_executive'
--    WHERE entered_by_role IS NULL AND employee_id IS NOT NULL;

-- One function, two tables. TG_ARGV[0] names the column holding "whose
-- record is this" — owner_employee_id on leads, employee_id on activities.
--
-- The owner-column check is redundant against RLS today (a sales_executive
-- can only INSERT/UPDATE rows they own in the first place) but it is what
-- makes the flag mean what it says rather than "some exec touched this".
CREATE OR REPLACE FUNCTION stamp_entered_by_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  record_owner integer;
BEGIN
  IF current_employee_role() IS DISTINCT FROM 'sales_executive' THEN
    RETURN NEW;
  END IF;

  record_owner := (to_jsonb(NEW) ->> TG_ARGV[0])::integer;

  IF record_owner = current_employee_id() THEN
    NEW.entered_by_role := 'sales_executive';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_entered_by_role ON leads;
CREATE TRIGGER stamp_entered_by_role
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION stamp_entered_by_role('owner_employee_id');

DROP TRIGGER IF EXISTS stamp_entered_by_role ON activities;
CREATE TRIGGER stamp_entered_by_role
  BEFORE INSERT OR UPDATE ON activities
  FOR EACH ROW
  EXECUTE FUNCTION stamp_entered_by_role('employee_id');


-- ------------------------------------------------------------
-- STEP 4b: the lock is COLUMN-level on leads, row-level on activities
--
-- Product decision (2026-08-10): an SC keeps stage rights on their team's
-- leads permanently — including Won/Lost — but must not overwrite the
-- exec's own typed-in details once the exec has taken the record over.
--
-- RLS cannot express that: a policy restricts which ROWS you may update,
-- never which COLUMNS. Same wall migration_owner_only_stage.sql hit, and
-- the same answer — a BEFORE UPDATE trigger, the one mechanism that can say
-- "this specific column, only for this role". So leads' UPDATE policy
-- (STEP 5) allows the whole team row, and this trigger draws the line
-- inside it. activities has no stage concept, so its lock stays row-level
-- in the policy and no trigger is needed there.
--
-- WHY THREE COLUMNS AND NOT ONE. The allowed set is current_stage plus the
-- two fields this app's own stage flows write in the SAME statement:
--   next_followup_date — LeadStageSection's On Hold flow writes it together
--     with the stage (a hold is invalid without a resume date), and it is
--     also what "SC can still attach follow-ups regardless of the lock"
--     requires in practice, since FollowUpForm stamps this column.
--   order_value        — LeadQuickActions' Won prompt requires a value
--     before it will write the stage. Excluding it would let an SC mark a
--     deal Won only if the value happened to already be set, and otherwise
--     dead-end them; a Won lead with no value contributes zero to every
--     booked-value metric, which an earlier code review already flagged.
-- Everything else on the row — quote_value, dates, product, site/party
-- links, owner — is refused outright once the exec has stamped the record.
--
-- The comparison is by VALUE, not by "was this column present in the
-- UPDATE". Sending a column unchanged is therefore always fine, which is
-- what keeps ordinary app saves working: LeadQuickActions re-sends the
-- existing order_value on a Won close and that produces no diff at all.
--
-- jsonb minus a key-array drops those keys from both sides before
-- comparing, so this stays correct if a column is added to `leads` later —
-- a new column is protected by default rather than silently unguarded.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_coordinator_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed CONSTANT text[] := ARRAY['current_stage','next_followup_date','order_value'];
BEGIN
  IF OLD.entered_by_role IS DISTINCT FROM 'sales_executive' THEN
    RETURN NEW;   -- not locked yet: SC may edit freely
  END IF;

  IF current_employee_role() IS DISTINCT FROM 'sales_coordinator' THEN
    RETURN NEW;   -- owner and the exec themselves are unaffected
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'This lead has been updated by its sales executive — a coordinator can change its stage and follow-up date, but not its other details'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_coordinator_lock ON leads;
CREATE TRIGGER enforce_coordinator_lock
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_coordinator_lock();


-- ------------------------------------------------------------
-- STEP 5: SC team access on leads / activities / stage_history /
--         site_contacts
--
-- Added as SEPARATE policies rather than by editing the existing
-- own_data_or_owner_role_* ones. Multiple permissive policies for the same
-- table+action are OR'd together, so this grants the SC branch without
-- touching a single byte of the owner/exec behaviour that is already live
-- and verified. If Phase 8 is ever rolled back, these drop cleanly.
--
-- THE LOCK APPEARS IN BOTH USING AND WITH CHECK on leads/activities:
--   USING      -> evaluated against the OLD row: may the SC touch this row
--                 at all? (No, once the exec has stamped it.)
--   WITH CHECK -> evaluated against the NEW row, AFTER BEFORE-triggers run:
--                 is the result still a row this SC is allowed to own?
-- The WITH CHECK team test is what stops an SC reassigning a lead OUT of
-- their team, or to themselves — is_my_team_member() is false for an SC's
-- own id (an SC has no coordinator), so "SC owns no leads" is enforced by
-- the database, not just by the UI never offering it.
--
-- No DELETE policy for SC anywhere in this file, per spec: DELETE stays
-- exactly as owner-only as it already is.
-- ------------------------------------------------------------

-- leads
DROP POLICY IF EXISTS "coordinator_team_select" ON leads;
CREATE POLICY "coordinator_team_select" ON leads
  FOR SELECT USING (is_my_team_member(owner_employee_id));

DROP POLICY IF EXISTS "coordinator_team_insert" ON leads;
CREATE POLICY "coordinator_team_insert" ON leads
  FOR INSERT WITH CHECK (is_my_team_member(owner_employee_id));

-- NOTE the lock is absent from this policy, unlike activities below. On
-- leads the lock is enforced COLUMN-wise by enforce_coordinator_lock()
-- (STEP 4b), because an SC must keep stage rights on a locked lead. A
-- row-level lock here would block the stage change too — RLS cannot
-- distinguish columns, which is the whole reason that trigger exists.
DROP POLICY IF EXISTS "coordinator_team_update" ON leads;
CREATE POLICY "coordinator_team_update" ON leads
  FOR UPDATE USING (
    is_my_team_member(owner_employee_id)
  ) WITH CHECK (
    is_my_team_member(owner_employee_id)
  );

-- activities
DROP POLICY IF EXISTS "coordinator_team_select" ON activities;
CREATE POLICY "coordinator_team_select" ON activities
  FOR SELECT USING (is_my_team_member(employee_id));

DROP POLICY IF EXISTS "coordinator_team_insert" ON activities;
CREATE POLICY "coordinator_team_insert" ON activities
  FOR INSERT WITH CHECK (is_my_team_member(employee_id));

DROP POLICY IF EXISTS "coordinator_team_update" ON activities;
CREATE POLICY "coordinator_team_update" ON activities
  FOR UPDATE USING (
    is_my_team_member(employee_id)
    AND entered_by_role IS DISTINCT FROM 'sales_executive'
  ) WITH CHECK (
    is_my_team_member(employee_id)
    AND entered_by_role IS DISTINCT FROM 'sales_executive'
  );

-- stage_history — stays append-only for everyone (no UPDATE/DELETE policy
-- exists for any role, including owner, and this migration adds none).
-- INSERT was narrowed to owner-only by migration_owner_only_stage.sql;
-- STEP 8 extends the matching column-level trigger to SCs, so the history
-- policy has to allow the same set or an SC's stage change would succeed
-- on `leads` and then fail to record itself.
DROP POLICY IF EXISTS "coordinator_team_select" ON stage_history;
CREATE POLICY "coordinator_team_select" ON stage_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND is_my_team_member(leads.owner_employee_id)
    )
  );

DROP POLICY IF EXISTS "coordinator_team_insert" ON stage_history;
CREATE POLICY "coordinator_team_insert" ON stage_history
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = stage_history.lead_id
         AND is_my_team_member(leads.owner_employee_id)
    )
  );

-- site_contacts — SELECT/INSERT are already open to every active employee,
-- so only UPDATE needs an SC branch (it is currently owner-only). Scoped
-- to sites that carry at least one of this SC's team's leads.
DROP POLICY IF EXISTS "coordinator_team_update" ON site_contacts;
CREATE POLICY "coordinator_team_update" ON site_contacts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = site_contacts.site_id
         AND is_my_team_member(leads.owner_employee_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = site_contacts.site_id
         AND is_my_team_member(leads.owner_employee_id)
    )
  );


-- ------------------------------------------------------------
-- STEP 6: parties / sites — narrow the exec's read, keep owner + SC wide
--
-- THIS REVERSES A DELIBERATE EARLIER DECISION. rls_policies.sql STEP D/E
-- moved parties OUT of the "own data or owner role" group specifically so
-- search-before-create would work across reps ("Rep B can't see a party Rep
-- A already created, so duplicate-checking silently fails"). That trade is
-- now made the other way round, on purpose — see DECISIONS.md 2026-08-10.
-- Company-wide dedup is NO LONGER GUARANTEED for sales executives.
--
-- Scope confirmed with the product owner: OWN LEADS ONLY, not team-wide.
-- Two execs under the same coordinator will not see each other's parties.
--
-- THE created_by / discovered_by BRANCH IS NOT OPTIONAL. PartySearchOrCreate
-- does `.insert(...).select(...).single()`, and Postgres applies the SELECT
-- policy to INSERT ... RETURNING rows. A party is created BEFORE the lead
-- that will reference it (LeadQuickCapture creates party, then site, then
-- lead), so at the moment of creation it is tied to no lead at all. Without
-- this branch the insert returns nothing and New Lead breaks for every
-- sales executive. Same for sites via SiteSearchOrCreate.
--
-- The activities branch covers an architect party an exec has logged a
-- meeting against but that never became a lead — without it the exec loses
-- sight of a party on their own past activity.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "authenticated_select" ON parties;
DROP POLICY IF EXISTS "team_scoped_select" ON parties;
CREATE POLICY "team_scoped_select" ON parties
  FOR SELECT USING (
    current_employee_role() IN ('owner','sales_coordinator')
    OR created_by = current_employee_id()
    OR EXISTS (
         SELECT 1 FROM leads l
          WHERE l.owner_employee_id = current_employee_id()
            AND (l.party_id = parties.id
                 OR l.referred_by_party_id = parties.id
                 OR l.other_party_id = parties.id)
       )
    OR EXISTS (
         SELECT 1 FROM activities a
          WHERE a.party_id = parties.id
            AND a.employee_id = current_employee_id()
       )
    OR EXISTS (
         SELECT 1 FROM site_contacts sc
          JOIN leads l2 ON l2.site_id = sc.site_id
          WHERE sc.party_id = parties.id
            AND l2.owner_employee_id = current_employee_id()
       )
  );

DROP POLICY IF EXISTS "authenticated_select" ON sites;
DROP POLICY IF EXISTS "team_scoped_select" ON sites;
CREATE POLICY "team_scoped_select" ON sites
  FOR SELECT USING (
    current_employee_role() IN ('owner','sales_coordinator')
    OR discovered_by = current_employee_id()
    OR EXISTS (
         SELECT 1 FROM leads l
          WHERE l.site_id = sites.id
            AND l.owner_employee_id = current_employee_id()
       )
  );

-- Supporting indexes for the EXISTS lookups those two policies now run on
-- every parties/sites row read. idx_leads_owner / idx_leads_party /
-- idx_leads_site / idx_activities_party already exist; these are the gaps.
CREATE INDEX IF NOT EXISTS idx_parties_created_by     ON parties(created_by);
CREATE INDEX IF NOT EXISTS idx_sites_discovered_by    ON sites(discovered_by);
CREATE INDEX IF NOT EXISTS idx_leads_referred_by      ON leads(referred_by_party_id);
CREATE INDEX IF NOT EXISTS idx_leads_other_party      ON leads(other_party_id);


-- ------------------------------------------------------------
-- STEP 7: follow_ups + targets for the SC
--
-- follow_ups is the SC's follow-up ASSIGNMENT mechanism (see CORRECTION 3
-- at the top of this file). SELECT/INSERT/UPDATE scoped to their team, so
-- an SC can assign a reminder to one of their execs and watch it get done.
-- The exec receives it exactly like any other assigned follow-up —
-- FollowUpList already shows "Assigned by {name}" whenever created_by
-- differs from assigned_to, and the push Edge Function already delivers it.
--
-- No lock applies here, per spec: assigning follow-ups is the SC's core job
-- and stays available regardless of entered_by_role on the linked lead.
--
-- No DELETE for SC — owner-only, unchanged.
--
-- targets is SELECT-only for the SC: their dashboard shows order-value-vs-
-- target for their team, but SetTargetForm stays owner-only, so there is no
-- reason to grant a write path the UI will never use.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "coordinator_team_select" ON follow_ups;
CREATE POLICY "coordinator_team_select" ON follow_ups
  FOR SELECT USING (is_my_team_member(assigned_to));

DROP POLICY IF EXISTS "coordinator_team_insert" ON follow_ups;
CREATE POLICY "coordinator_team_insert" ON follow_ups
  FOR INSERT WITH CHECK (is_my_team_member(assigned_to));

DROP POLICY IF EXISTS "coordinator_team_update" ON follow_ups;
CREATE POLICY "coordinator_team_update" ON follow_ups
  FOR UPDATE USING (is_my_team_member(assigned_to))
  WITH CHECK (is_my_team_member(assigned_to));

DROP POLICY IF EXISTS "coordinator_team_select" ON targets;
CREATE POLICY "coordinator_team_select" ON targets
  FOR SELECT USING (is_my_team_member(employee_id));


-- ------------------------------------------------------------
-- STEP 8: extend stage-change rights to the SC
--
-- REPLACES enforce_owner_only_stage_change() from
-- migration_owner_only_stage.sql (bundled into
-- migration_backlog_2026_08_10.sql). That file's own closing note
-- anticipated this edit: "If you'd rather reps could still close their own
-- deals, change the trigger's condition". Same mechanism, different role.
--
-- A sales_executive still CANNOT change a stage. Only owner and
-- sales_coordinator can, and an SC only ever reaches a row RLS already let
-- them update — which is the team scope from STEP 5.
--
-- This grant is only meaningful because of STEP 4b. RLS is row-level, so a
-- row-level lock would have taken the stage away again the moment the exec
-- touched the lead — leaving an SC able to change stage only on leads they
-- typed in themselves, which is not an oversight power in any real sense.
-- STEP 4b's column-level trigger is what makes "stage always, details
-- locked" actually hold. The two are a pair; removing either one silently
-- guts the other.
--
-- The auth.uid() guard is carried over unchanged — see
-- migration_owner_only_stage.sql for why removing it would block admin SQL.
-- ------------------------------------------------------------
-- COALESCE, not a bare NOT IN. A deactivated employee has a real auth.uid()
-- but current_employee_role() resolves NULL for them, and `NULL NOT IN
-- (...)` evaluates to NULL — falsy — which would let them through the guard
-- silently. The original owner-only version used `IS DISTINCT FROM 'owner'`,
-- which was NULL-safe by construction; a multi-value list is not, so the
-- NULL has to be collapsed explicitly.
CREATE OR REPLACE FUNCTION enforce_owner_only_stage_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.current_stage IS DISTINCT FROM OLD.current_stage
     AND auth.uid() IS NOT NULL
     AND COALESCE(current_employee_role(), '') NOT IN ('owner','sales_coordinator') THEN
    RAISE EXCEPTION 'Only an owner or sales coordinator can change a lead''s stage'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged and already installed by the backlog;
-- recreated here so this file stands alone if run on a fresh database.
DROP TRIGGER IF EXISTS owner_only_stage_change ON leads;
CREATE TRIGGER owner_only_stage_change
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_only_stage_change();

-- stage_history INSERT: owner-only from migration_owner_only_stage.sql,
-- plus the SC team branch added in STEP 5 as a separate policy. Both are
-- permissive and OR together — nothing to change here, noted so the pair
-- is not mistaken for a leftover.


-- ============================================================
-- DELIBERATELY NOT CHANGED — so these read as decisions, not oversights
--
--   plans            — untouched, still unused, no assigned_by column.
--                      See CORRECTION 3 at the top.
--   loss_reasons     — SELECT stays owner-only. The SC dashboard spec does
--                      not include a "why we lose" card, and this is the
--                      one table whose owner-only read is a hard RLS
--                      constraint rather than a UI gate.
--   lead_change_log  — SELECT stays own-leads-or-owner. The Day Review is
--                      not part of the SC surface in this phase.
--   DELETE           — no new DELETE policy for any table. An SC can delete
--                      nothing, exactly as specified.
--   employees SELECT — unchanged (any active employee can read the roster).
--                      Needed for the "Accompanied by" dropdown and every
--                      EmployeeLink name lookup, for all three roles.
-- ============================================================


-- ============================================================
-- VERIFY — run these after the migration
-- ============================================================

-- 1. Role CHECK now admits three values.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'employees'::regclass AND conname = 'employees_role_check';

-- 2. New columns exist. Expect employees.coordinator_id (integer),
--    leads.entered_by_role (text), activities.entered_by_role (text).
-- SELECT table_name, column_name, data_type FROM information_schema.columns
--  WHERE (table_name, column_name) IN
--        (('employees','coordinator_id'),('leads','entered_by_role'),
--         ('activities','entered_by_role'));

-- 3. Triggers present. Expect on leads: enforce_coordinator_lock,
--    log_lead_changes_ins, log_lead_changes_upd, owner_only_stage_change,
--    stamp_entered_by_role, stamp_lead_creator (6). On activities:
--    stamp_entered_by_role. On employees: validate_employee_role_assignment.
-- SELECT tgrelid::regclass AS table, tgname FROM pg_trigger
--  WHERE tgrelid IN ('leads'::regclass,'activities'::regclass,'employees'::regclass)
--    AND NOT tgisinternal ORDER BY 1, 2;

-- 4. No backfill ran — every pre-existing record should still be unlocked,
--    so a new SC can edit their team's history until each exec next saves.
--    Expect unlocked_leads to equal the total lead count.
-- SELECT (SELECT count(*) FROM leads WHERE entered_by_role IS NULL) AS unlocked_leads,
--        (SELECT count(*) FROM leads)                               AS total_leads;

-- 4b. The column-level lock behaves. Run as a real SC login, on a lead
--     whose entered_by_role is already 'sales_executive':
--       UPDATE leads SET current_stage = 'negotiation' WHERE id = <n>;  -- succeeds
--       UPDATE leads SET quote_value   = 999           WHERE id = <n>;  -- must ERROR
--     The second should raise 'This lead has been updated by its sales
--     executive...'. If it succeeds, enforce_coordinator_lock did not
--     install or the login is not actually a sales_coordinator.

-- 5. The validation trigger actually fires. All three should ERROR.
-- UPDATE employees SET coordinator_id = id WHERE id = (SELECT min(id) FROM employees);
--   -> 'An employee cannot be their own coordinator'
-- UPDATE employees SET coordinator_id = (SELECT id FROM employees WHERE role='owner' LIMIT 1)
--  WHERE id = (SELECT id FROM employees WHERE role='sales_executive' LIMIT 1);
--   -> 'coordinator_id must point at an employee whose role is sales_coordinator'

-- 6. Team isolation — run as a real SC login, not in the SQL Editor
--    (current_employee_id() is NULL here, so every policy above is false
--    and you would wrongly conclude the SC can see nothing).
--    Expect: only leads whose owner has coordinator_id = that SC's id.
-- SELECT count(*) FROM leads;

-- 7. The exec's parties read is genuinely narrowed — run as a sales exec
--    login. Expect fewer rows than `SELECT count(*) FROM parties` returns
--    for the owner, and New Lead must still be able to create a party.
-- SELECT count(*) FROM parties;
