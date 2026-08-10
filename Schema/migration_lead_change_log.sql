-- ============================================================
-- MIGRATION: lead_change_log — the audit trail behind the Day Review
-- Run this in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP ... IF EXISTS throughout).
--
-- RUN THE BACKLOG FIRST. Schema/migration_backlog_2026_08_10.sql must go
-- in before this file. Two reasons, both load-bearing:
--   1. That file renames the old stage values (new/hot/quote →
--      calling/negotiation/quote_submission) in leads AND stage_history.
--      The Day Review reads stage changes straight out of stage_history
--      (see WHY STAGE ISN'T IN THIS TABLE below), so running this first
--      would just mean the day sheet renders stale stage chips until the
--      rename lands.
--   2. That file installs owner_only_stage_change, a BEFORE UPDATE
--      trigger on leads. This file adds AFTER triggers on the same table.
--      Postgres fires BEFORE triggers first and AFTER triggers only on a
--      successful row update, so the two compose correctly in that order —
--      but the backlog's own bulk UPDATEs must run before its trigger step,
--      which is exactly why that file is sequenced the way it is. Don't
--      interleave the two files.
--
-- WHAT THIS IS FOR: the "Changes made to leads" block on the exec day
-- sheet, and the "Changes" column on the team table. Both answer "what
-- did this rep actually alter today, old value → new value" — nothing in
-- the schema records that today.
--
-- WHY A TRIGGER, NOT APP CODE: there is no single lead-update service in
-- this app. `leads` is written from SalesProgressSection, SiteDetailsSection,
-- ClientDetailsSection, LeadStageSection, LeadQuickActions and three
-- separate side-effect paths in ActivityLog.jsx. A JS helper would have to
-- be called from all of them, and the first one anyone forgets becomes a
-- silently missing audit row — in an audit trail, that's the one failure
-- mode that matters. A trigger catches every path, including future
-- screens and edits made directly in the Supabase table editor.
--
-- WHY STAGE ISN'T IN THIS TABLE: stage_history already records exactly
-- that — lead_id, stage, changed_by, changed_at, append-only, with real
-- history going back to the start of the project. Logging stage changes
-- here too would create a second source of truth for one fact, and the
-- day sheet would show no stage changes at all for any date before this
-- migration runs. The Day Review reads stage moves (including Won/Lost,
-- which are stages in this app, not a separate status field) from
-- stage_history and everything else from here.
--
-- WHAT'S DELIBERATELY NOT LOGGED: owner reassignment (lead_owner_history
-- already has it, and the design brief excludes it from this trail),
-- contact/address/source edits, and lead notes. There is no notes column
-- on `leads` at all — the only notes in this schema live on `activities`,
-- and those already show in the day sheet's own Activities block.
--
-- NO old_display/new_display COLUMNS: the original design spec had the DB
-- store pre-formatted strings like '₹6.10L'. This app already formats
-- every rupee figure through src/lib/format.js, so storing a second
-- pre-baked copy would just be a value that can drift from the renderer.
-- Raw values here, formatted client-side like everywhere else.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1: leads.created_by_employee_id
--
-- The team table's "New" column counts leads a rep created on a given
-- day. `leads` records who currently OWNS a lead, never who created it —
-- so without this column, every lead that's been reassigned since would
-- be credited to the wrong person, retroactively, on a day sheet for a
-- date before the reassignment even happened.
--
-- Backfilled from owner_employee_id: correct for every lead that's never
-- been reassigned (the overwhelming majority), and the best available
-- guess for the rest. lead_owner_history could refine that further for
-- the handful of reassigned leads; not worth the complexity at pilot size.
-- ------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by_employee_id INTEGER REFERENCES employees(id);

UPDATE leads
   SET created_by_employee_id = owner_employee_id
 WHERE created_by_employee_id IS NULL
   AND owner_employee_id IS NOT NULL;


-- ------------------------------------------------------------
-- STEP 2: the table
--
-- changed_at is timestamptz, unlike the naive TIMESTAMP used elsewhere in
-- this schema. Every number on the Day Review is bounded to one calendar
-- day in IST, and a naive column forces that conversion to be re-derived
-- correctly at every call site. New table, so there's no back-compat
-- reason to inherit the older convention.
--
-- `field` is a closed set. Anything outside it is silently ignored by the
-- trigger below rather than logged — this trail is deliberately narrow.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_change_log (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER     NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  changed_by  INTEGER     REFERENCES employees(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  field       TEXT        NOT NULL CHECK (field IN
                            ('created','quote_value','order_value','product')),
  old_value   TEXT,   -- NULL for 'created'
  new_value   TEXT,
  detail      TEXT    -- 'created': the lead's source_type. Unused otherwise.
);

-- (changed_by, changed_at) drives the team table and day sheet — every
-- query is "this exec, this day". (lead_id, changed_at) drives the lead's
-- own timeline on Lead Detail.
CREATE INDEX IF NOT EXISTS idx_lead_change_log_by_at   ON lead_change_log (changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_change_log_lead_at ON lead_change_log (lead_id, changed_at DESC);


-- ------------------------------------------------------------
-- STEP 3: supporting indexes for the day-scoped queries
--
-- The Day Review runs "everything this exec did on date D" across four
-- tables at once. The existing single-column indexes (idx_leads_owner,
-- idx_activities_employee) cover the employee half; these add the date
-- half so each query is one index range scan instead of a scan-then-filter.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activities_employee_created ON activities (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned_due     ON follow_ups (assigned_to, due_date);
CREATE INDEX IF NOT EXISTS idx_stage_history_by_at         ON stage_history (changed_by, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_created_by_at         ON leads (created_by_employee_id, created_at DESC);


-- ------------------------------------------------------------
-- STEP 4: stamp the creator
--
-- BEFORE INSERT so it can still write to NEW. LeadQuickCapture doesn't
-- send this column, so the trigger is what actually populates it —
-- the app needs no change for creator attribution to start working.
--
-- COALESCE keeps an explicitly-supplied value (a future import script, or
-- backfill SQL, setting a real historical creator) rather than overwriting
-- it with whoever is running the statement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_lead_creator()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_by_employee_id :=
    COALESCE(NEW.created_by_employee_id, current_employee_id(), NEW.owner_employee_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_lead_creator ON leads;
CREATE TRIGGER stamp_lead_creator
  BEFORE INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION stamp_lead_creator();


-- ------------------------------------------------------------
-- STEP 5: the change-logging trigger
--
-- SECURITY DEFINER so it can write to lead_change_log, which grants no
-- INSERT to anyone (STEP 6) — the trigger is the table's only writer, by
-- design, which is what makes the trail impossible to forge from the app.
--
-- changed_by may be NULL: current_employee_id() resolves to NULL in the
-- SQL Editor (no auth.uid()) and for a deactivated employee. A NULL there
-- honestly means "not attributable to an app user" — better than
-- inventing an actor. Those rows simply don't appear on anyone's day.
--
-- Product stores the product NAME, not the id, on purpose. An audit row
-- should say what the value was at the time; resolving an id later would
-- show today's name for a renamed product, and nothing at all for a
-- deleted one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_lead_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor INTEGER := current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_change_log (lead_id, changed_by, field, old_value, new_value, detail)
    VALUES (NEW.id,
            COALESCE(NEW.created_by_employee_id, actor),
            'created', NULL, NEW.id::text, NEW.source_type);
    RETURN NULL;   -- AFTER trigger: return value is ignored
  END IF;

  IF NEW.quote_value IS DISTINCT FROM OLD.quote_value THEN
    INSERT INTO lead_change_log (lead_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'quote_value', OLD.quote_value::text, NEW.quote_value::text);
  END IF;

  IF NEW.order_value IS DISTINCT FROM OLD.order_value THEN
    INSERT INTO lead_change_log (lead_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'order_value', OLD.order_value::text, NEW.order_value::text);
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    INSERT INTO lead_change_log (lead_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'product',
            (SELECT name FROM products WHERE id = OLD.product_id),
            (SELECT name FROM products WHERE id = NEW.product_id));
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_lead_changes_ins ON leads;
CREATE TRIGGER log_lead_changes_ins
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION log_lead_changes();

DROP TRIGGER IF EXISTS log_lead_changes_upd ON leads;
CREATE TRIGGER log_lead_changes_upd
  AFTER UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION log_lead_changes();


-- ------------------------------------------------------------
-- STEP 6: grants + RLS
--
-- SELECT only, for everyone. No INSERT/UPDATE/DELETE grant and no policy
-- for them — permanently append-only at both layers, for every role
-- including owner, the same shape stage_history and loss_reasons already
-- have. The SECURITY DEFINER trigger writes as the table's owner, which
-- is not subject to these grants.
--
-- REVOKE first because rls_policies.sql's STEP A ran
-- `GRANT SELECT, INSERT, UPDATE ON ALL TABLES` and set ALTER DEFAULT
-- PRIVILEGES for future tables — so this table may arrive already
-- writable depending on which role creates it.
--
-- SELECT scoping mirrors what migration_scope_stage_history.sql does to
-- stage_history: own leads, or owner sees everything. A rep's day sheet is
-- their own; only the owner reviews the team.
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON lead_change_log FROM authenticated;
GRANT SELECT ON lead_change_log TO authenticated;

ALTER TABLE lead_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_data_or_owner_role_select" ON lead_change_log;
CREATE POLICY "own_data_or_owner_role_select" ON lead_change_log
  FOR SELECT USING (
    current_employee_role() = 'owner'
    OR EXISTS (
      SELECT 1 FROM leads
      WHERE leads.id = lead_change_log.lead_id
        AND leads.owner_employee_id = current_employee_id()
    )
  );


-- ------------------------------------------------------------
-- STEP 7: backfill a 'created' row per existing lead
--
-- So the day sheet's timeline shows lead creation for dates before this
-- migration, instead of starting blank. leads.created_at is a naive
-- TIMESTAMP holding UTC, so it's converted explicitly rather than left to
-- the session timezone.
--
-- Note this does NOT backfill value/product changes — those are
-- genuinely unrecoverable, nothing recorded them. See the degraded-mode
-- note below.
--
-- NOT EXISTS makes it re-runnable and stops a second run duplicating rows.
-- ------------------------------------------------------------
INSERT INTO lead_change_log (lead_id, changed_by, changed_at, field, old_value, new_value, detail)
SELECT l.id,
       l.created_by_employee_id,
       COALESCE(l.created_at AT TIME ZONE 'UTC', now()),
       'created', NULL, l.id::text, l.source_type
  FROM leads l
 WHERE NOT EXISTS (
         SELECT 1 FROM lead_change_log c
          WHERE c.lead_id = l.id AND c.field = 'created'
       );


-- ============================================================
-- DEGRADED MODE — read this before looking at an old date
--
-- Value and product changes only exist from the moment this migration
-- runs. A day sheet for any earlier date will show creations and stage
-- moves (both backfilled/pre-existing) but no value or product edits —
-- because none were ever recorded, not because the rep made none. The UI
-- renders an explicit "Change history starts <date>" note rather than a
-- zero, so this can't be misread as an idle day.
-- ============================================================


-- ============================================================
-- VERIFY — run these after the migration
-- ============================================================

-- 1. Table and columns. Expect 8 rows: id, lead_id, changed_by,
--    changed_at, field, old_value, new_value, detail.
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'lead_change_log' ORDER BY ordinal_position;

-- 2. All three triggers present on leads (plus owner_only_stage_change
--    from the backlog file, so expect 4).
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal ORDER BY tgname;

-- 3. Backfill landed — one 'created' row per lead, no duplicates.
-- SELECT (SELECT count(*) FROM leads)                                   AS leads,
--        (SELECT count(*) FROM lead_change_log WHERE field = 'created') AS created_rows;

-- 4. Creator attribution filled in.
-- SELECT count(*) FILTER (WHERE created_by_employee_id IS NULL) AS unattributed,
--        count(*)                                               AS total
--   FROM leads;

-- 5. Live end-to-end check — change a quote value on any lead through
--    the app (Lead Detail → Sales progress → Quote value → Save), then:
-- SELECT c.changed_at, e.name, c.field, c.old_value, c.new_value
--   FROM lead_change_log c LEFT JOIN employees e ON e.id = c.changed_by
--  WHERE c.field <> 'created'
--  ORDER BY c.changed_at DESC LIMIT 10;
--    Expect one row, your name, the old and new value. If changed_by is
--    NULL there, current_employee_id() didn't resolve — check the login is
--    an active employee row.

-- 6. Append-only holds. Both should fail with "permission denied".
-- INSERT INTO lead_change_log (lead_id, field, new_value) VALUES (1, 'product', 'x');
-- DELETE FROM lead_change_log WHERE id = 1;
