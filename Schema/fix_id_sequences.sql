-- ============================================================================
-- fix_id_sequences.sql — realign every table's id sequence with its data
-- ============================================================================
--
-- SYMPTOM (2026-09-18): Log Activity → Architect Meeting with a NEW architect
-- failed with "Couldn't save the architect: duplicate key value violates
-- unique constraint ...". The app's insert sends no id — Postgres picks one
-- from the table's sequence. The only unique constraint on `parties` is its
-- primary key, so the sequence was handing out ids that already exist.
--
-- CAUSE: rows inserted WITH explicit ids (a data import) don't advance the
-- sequence. The next app insert then collides with an imported row, and keeps
-- colliding until the sequence climbs past the highest imported id.
--
-- FIX: move each sequence to MAX(id). Only ever moves a sequence FORWARD
-- (GREATEST with its current value), never rewinds one, touches no rows, and
-- is safe to re-run at any time — including after every future import.
--
-- Run in the Supabase SQL Editor. Step 1 is read-only; step 2 is the fix.
-- ============================================================================

-- ── STEP 1 (read-only): which tables are behind? ────────────────────────────
-- `behind_by` > 0 means the next insert on that table can fail.
DO $$
DECLARE
  r record;
  seq text;
  max_id bigint;
  seq_last bigint;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    seq := pg_get_serial_sequence('public.' || quote_ident(r.table_name), 'id');
    CONTINUE WHEN seq IS NULL;  -- uuid ids etc. have no sequence
    EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', r.table_name) INTO max_id;
    EXECUTE format('SELECT last_value FROM %s', seq) INTO seq_last;
    IF max_id > seq_last THEN
      RAISE NOTICE '% is BEHIND: max id %, sequence at % (behind by %)',
        r.table_name, max_id, seq_last, max_id - seq_last;
    END IF;
  END LOOP;
END $$;

-- ── STEP 2 (the fix): advance every sequence to at least MAX(id) ────────────
DO $$
DECLARE
  r record;
  seq text;
  max_id bigint;
  seq_last bigint;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    seq := pg_get_serial_sequence('public.' || quote_ident(r.table_name), 'id');
    CONTINUE WHEN seq IS NULL;
    EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', r.table_name) INTO max_id;
    EXECUTE format('SELECT last_value FROM %s', seq) INTO seq_last;
    IF max_id > seq_last THEN
      PERFORM setval(seq, max_id, true);
      RAISE NOTICE 'Fixed %: sequence moved % → %', r.table_name, seq_last, max_id;
    END IF;
  END LOOP;
END $$;
