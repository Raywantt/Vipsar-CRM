-- ============================================================
-- MIGRATION: product order + two renames (owner's ruling, 2026-10-06)
--
-- The owner's order for every product picker (and the RFQ form's list):
--   1 Tostem · 2 IN16 · 3 GIESTA · 4 Noki · 5 Sky Light · 6 Wrapping Bars ·
--   7 StoneLam · 8 VOX · 9 PremiAL · 10 Others
-- It isn't alphabetical, so it lives in a new products.sort_order column —
-- the products are rows, never a list in code. Two names change case:
-- Giesta → GIESTA, Wrapping bars → Wrapping Bars.
--
-- ⚠️ RUN BEFORE THE DEPLOY: the new app orders products by sort_order, and
-- ordering by a column that doesn't exist fails the whole read (every product
-- picker would come up empty).
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer;

UPDATE products SET name = 'GIESTA'        WHERE id = 25;
UPDATE products SET name = 'Wrapping Bars' WHERE id = 24;

UPDATE products SET sort_order = v.pos
  FROM (VALUES (12, 1), (22, 2), (25, 3), (10, 4), (11, 5), (24, 6), (18, 7), (13, 8), (23, 9), (15, 10)) AS v(id, pos)
 WHERE products.id = v.id;

-- Exactly the ten, in this order, or stop.
DO $check$
DECLARE
  v_names text[];
BEGIN
  SELECT array_agg(name ORDER BY sort_order) INTO v_names FROM products;
  IF v_names IS DISTINCT FROM ARRAY['Tostem','IN16','GIESTA','Noki','Sky Light','Wrapping Bars','StoneLam','VOX','PremiAL','Others'] THEN
    RAISE EXCEPTION 'Products are not the ten in the owner''s order: % — nothing changed.', v_names;
  END IF;
END
$check$;

COMMIT;

NOTIFY pgrst, 'reload schema';
