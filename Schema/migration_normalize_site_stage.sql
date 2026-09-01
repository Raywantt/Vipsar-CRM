-- ============================================================
-- MIGRATION: sites.site_stage — normalise casing/spelling variants  (2026-09-01)
--
-- WHY: site_stage is deliberately free text (see src/lib/siteStageOptions.js
-- and the Site details / Site Visit "Other…" escape hatches), so the same
-- real stage has been typed several ways. Measured live against the sites
-- table on 2026-09-01: 262 rows, 12 distinct values, collapsing to 6.
--
--   PLASTER 63 + Plaster 20 + PLASTERING 5   -> Plaster    (88)
--   S.F SLAB 32 + SF Slab 3                  -> SF Slab    (35)
--   FLOORING 18 + Flooring 10                -> Flooring   (28)
--   F.F SLAB 25 + FF Slab 1                  -> FF Slab    (26)
--   DPC 22                                   -> DPC        (22, already correct)
--   NULL 62                                  -> left NULL  (genuinely unknown)
--
-- This is not cosmetic. Dashboard's "Leads by site stage" card groups on the
-- raw string, so it was rendering 13 buckets and REPORTING WRONG NUMBERS:
-- Plaster is the single largest stage at 88 leads but displayed as 20, ranked
-- fourth, with its larger duplicate sitting lower down the same card. The
-- Site details and Site Visit dropdowns were likewise offering the same stage
-- twice, which is how the variants kept being created.
--
-- Targets are src/lib/siteStageOptions.js's SITE_STAGE_OPTIONS exactly:
--   'DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring'
-- Keep the two in step — a value normalised to a string that is not in that
-- list will fall straight back into the "Other…" branch and re-fragment.
--
-- NOT TOUCHED, deliberately — one row needs a human decision, not a guess:
--   'Shucho windows need to uninstall' (1 row)
-- That is a note somebody typed into a stage field, not a construction stage.
-- It is left exactly as-is; STEP 2 below lists it so you can decide whether
-- to null it or move it into the site's notes. Guessing a stage for it would
-- invent a fact indistinguishable from a real one, which is the same rule
-- office_territory follows for pre-existing leads.
--
-- Safe to re-run: every UPDATE is idempotent (already-correct rows do not
-- match their own WHERE clause), and re-running changes 0 rows.
--
-- ORDERING: independent of every other migration in this folder — no policy,
-- trigger, function or constraint is touched, only row values. Run any time.
--
-- NOTE this is a data migration, unlike most files here. It rewrites real
-- rows. The counts above are what the live database held on 2026-09-01; STEP
-- 0 lets you confirm nothing has drifted before you commit to STEP 1.
-- ============================================================


-- ============================================================
-- STEP 0 — LOOK FIRST. Run this alone and check it matches the header.
-- ============================================================

SELECT COALESCE(site_stage, '<NULL>') AS site_stage, COUNT(*) AS sites
  FROM sites
 GROUP BY site_stage
 ORDER BY sites DESC;


-- ============================================================
-- STEP 1 — normalise the variants onto SITE_STAGE_OPTIONS.
--
-- Matching is explicit rather than a clever UPPER()/regex fold, on purpose:
-- 'FF Slab' vs 'F.F SLAB' differ by punctuation as well as case, and
-- 'PLASTERING' is a different word from 'PLASTER' — so a generic fold would
-- either miss them or over-merge something it should not. Listing the real
-- values keeps this reviewable and impossible to over-reach.
-- ============================================================

UPDATE sites SET site_stage = 'Plaster'
 WHERE site_stage IN ('PLASTER', 'PLASTERING', 'plaster', 'plastering')
   AND site_stage <> 'Plaster';

UPDATE sites SET site_stage = 'SF Slab'
 WHERE site_stage IN ('S.F SLAB', 'S.F Slab', 'SF SLAB', 's.f slab', 'sf slab')
   AND site_stage <> 'SF Slab';

UPDATE sites SET site_stage = 'FF Slab'
 WHERE site_stage IN ('F.F SLAB', 'F.F Slab', 'FF SLAB', 'f.f slab', 'ff slab')
   AND site_stage <> 'FF Slab';

UPDATE sites SET site_stage = 'Flooring'
 WHERE site_stage IN ('FLOORING', 'flooring')
   AND site_stage <> 'Flooring';

UPDATE sites SET site_stage = 'DPC'
 WHERE site_stage IN ('dpc', 'Dpc', 'D.P.C', 'D.P.C.')
   AND site_stage <> 'DPC';


-- ============================================================
-- STEP 2 — anything still outside the canonical list, for your decision.
-- Expect exactly one row: 'Shucho windows need to uninstall'.
-- Nothing is changed here; this is a report.
-- ============================================================

SELECT id, site_stage
  FROM sites
 WHERE site_stage IS NOT NULL
   AND site_stage NOT IN ('DPC', 'FF Slab', 'SF Slab', 'Plaster', 'Flooring')
 ORDER BY site_stage;

-- If you decide that row is a note rather than a stage, clear it with:
--   UPDATE sites SET site_stage = NULL WHERE id = <the id above>;
-- (left commented — it is your call, not the migration's)


-- ============================================================
-- VERIFICATION — run after STEP 1.
-- ============================================================
--
-- SELECT COALESCE(site_stage, '<NULL>') AS site_stage, COUNT(*) AS sites
--   FROM sites GROUP BY site_stage ORDER BY sites DESC;
--
--   Expect 7 rows on 2026-09-01 data:
--     Plaster 88, <NULL> 62, SF Slab 35, Flooring 28, FF Slab 26, DPC 22,
--     and the single un-normalised note row from STEP 2.
--   Total must still be 262 — this migration moves rows between buckets,
--   it never deletes one.
