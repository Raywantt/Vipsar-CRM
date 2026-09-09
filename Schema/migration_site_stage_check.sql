-- ============================================================
-- MIGRATION: sites.site_stage — close it to the five standard stages (2026-09-09)
--
-- WHY: site_stage has been free text since the original schema
-- (tostem_crm_schema.sql line 110, `site_stage TEXT` with no CHECK, and a
-- now-stale comment naming the retired foundation/structure/finishing list).
-- Free text plus an "Other…" box on three screens is how the column
-- fragmented before: migration_normalize_site_stage.sql (2026-09-01) had to
-- clean up 12 distinct values collapsing to 6, and it was not cosmetic —
-- Dashboard's "Leads by site stage" card groups on the raw string, so Plaster
-- was really 88 leads while the card displayed 20 and ranked it fourth.
--
-- That migration fixed the DATA. It could not fix the CAUSE, and said so:
-- "the underlying hazard is NOT fixed — if this recurs, the fix is a
-- constraint or a normalising trigger, not another cleanup pass." This is
-- that constraint. The owner's ruling (2026-09-09): "i do not want any other
-- site stage other than the standard 5 that we are providing."
--
-- It recurred exactly once in the meantime — a single 'Finishing' row typed
-- through the Other… box on 2026-09-04 — which is what prompted this.
--
-- WHY A CHECK AND NOT JUST THE UI: the app's four write paths were all closed
-- in the same release (see below), but a constraint is the only layer that
-- also covers bulk imports and hand-written SQL. The five
-- Schema/import_*_legacy.sql files INSERT site_stage directly, bypassing the
-- UI entirely — that is where PLASTER / S.F SLAB / FLOORING came from in the
-- first place. App-side validation could never have caught those.
--
-- NULL STAYS LEGAL — 574 of 1,236 sites (46%) have no stage recorded, and
-- "not visited yet" is a real, honest state, not a gap to be filled in. The
-- empty string is deliberately NOT allowed: every write path already
-- normalises '' to NULL, and permitting both would give "unknown" two
-- spellings that group as separate buckets on the dashboard — the exact class
-- of bug this file exists to end.
--
-- ⚠️ TWO-SIDED CHANGE. Adding a sixth stage later needs BOTH halves changed:
-- this CHECK *and* src/lib/siteStageOptions.js's SITE_STAGE_OPTIONS. Change
-- only the app and every save of the new stage fails at the database with an
-- opaque 23514; change only the CHECK and no one can pick it. Same standing
-- trap leads.office_territory already documents.
--
-- ORDERING: independent of every other migration in this folder — no policy,
-- trigger or function is touched. It must run AFTER
-- migration_normalize_site_stage.sql (already live 2026-09-01), whose cleanup
-- is what makes the data satisfy this constraint at all.
--
-- Safe to re-run (DROP CONSTRAINT IF EXISTS before ADD).
-- ============================================================


-- ============================================================
-- STEP 0 — LOOK FIRST. Anything this returns will BLOCK step 2.
--
-- Expect ZERO rows. The column was audited from a live owner session on
-- 2026-09-09 immediately before this file was written: 1,236 sites = 662
-- exactly canonical + 574 NULL, with zero off-list values, zero empty
-- strings, zero whitespace-only values, zero untrimmed values and zero case
-- variants.
--
-- If this DOES return rows, someone has written a new value since. Do not
-- force the constraint — fix the rows first (the pattern is
-- migration_normalize_site_stage.sql STEP 1: an explicit value list, not a
-- clever UPPER()/regex fold, so it stays reviewable and cannot over-reach).
-- ============================================================

SELECT site_stage, COUNT(*) AS sites
  FROM sites
 WHERE site_stage IS NOT NULL
   AND site_stage NOT IN ('DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring')
 GROUP BY site_stage
 ORDER BY sites DESC;


-- ============================================================
-- STEP 1 — the census, for the record. Expect 6 rows totalling 1,236.
-- ============================================================

SELECT COALESCE(site_stage, '<NULL>') AS site_stage, COUNT(*) AS sites
  FROM sites
 GROUP BY site_stage
 ORDER BY sites DESC;


-- ============================================================
-- STEP 2 — the constraint. Run only once STEP 0 returns nothing.
--
-- The value list is src/lib/siteStageOptions.js's SITE_STAGE_OPTIONS
-- verbatim, in construction order (DPC first, Flooring last).
-- ============================================================

ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_site_stage_check;

ALTER TABLE sites
  ADD CONSTRAINT sites_site_stage_check
  CHECK (site_stage IS NULL
         OR site_stage IN ('DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring'));


-- ============================================================
-- STEP 3 — correct the stale column comment. It still names the
-- foundation/structure/finishing list retired on 2026-08-17, which is
-- actively misleading now that those values are refused.
-- ============================================================

COMMENT ON COLUMN sites.site_stage IS
  'Construction stage. CLOSED list, enforced by sites_site_stage_check: '
  'DPC, FF Slab, SF Slab, Plaster, Flooring, or NULL (not recorded yet). '
  'Keep in step with src/lib/siteStageOptions.js SITE_STAGE_OPTIONS — '
  'adding a stage needs BOTH changed.';


-- ============================================================
-- VERIFICATION — run after STEP 2.
-- ============================================================
--
-- 1. The constraint exists and has the right definition:
--
--    SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conrelid = 'sites'::regclass
--       AND conname = 'sites_site_stage_check';
--
-- 2. It actually REFUSES an off-list value. This is the discriminating
--    check — step 1 only proves the constraint was created, not that it
--    bites. Run it on any real row; it is written to roll itself back, so
--    it changes nothing either way:
--
--    BEGIN;
--      UPDATE sites SET site_stage = 'zz-not-a-real-stage'
--       WHERE id = (SELECT id FROM sites LIMIT 1);
--    ROLLBACK;
--
--    EXPECT: ERROR 23514, new row ... violates check constraint
--    "sites_site_stage_check". If that UPDATE SUCCEEDS, the constraint did
--    not take — do not treat this migration as done.
--
-- 3. NULL is still accepted (it must be — 574 rows rely on it):
--
--    BEGIN;
--      UPDATE sites SET site_stage = NULL
--       WHERE id = (SELECT id FROM sites WHERE site_stage IS NOT NULL LIMIT 1);
--    ROLLBACK;
--
--    EXPECT: UPDATE 1, no error.
--
-- ============================================================
-- THE APP SIDE, shipped in the same release as this file
-- ============================================================
--
-- All four write paths were closed to SITE_STAGE_OPTIONS + null, so nothing
-- in the UI can trip this constraint:
--
--   1. src/pages/LeadQuickCapture.jsx     New Lead (Scanning) — required
--   2. src/components/SiteDetailsSection.jsx  Lead Detail -> Site details
--   3. src/pages/ActivityLog.jsx          Log Activity -> Site Visit
--   4. src/components/SiteSearchOrCreate.jsx  (unmounted; closed anyway, so a
--                                             future mount cannot reopen it)
--
-- Each lost its <option value="other">Other…</option>, its free-text
-- "Describe stage" input, and the `=== 'other'` branch that actually wrote
-- the typed string. That last one is the important removal — it is the line
-- that produced the value, not the option that offered it.
--
-- NOTE the ordering hazard if you ever run this on a database whose data is
-- NOT clean: paths 2 and 3 seed their dropdown from the stored value and now
-- fall back to "— Not specified —" for anything non-canonical, so saving that
-- form would silently null a legacy value. That is unreachable on this
-- database (STEP 0 returned nothing before the constraint went on) and the
-- constraint is what keeps it unreachable — but clean the data BEFORE
-- deploying the app change, not after, on any other environment.
