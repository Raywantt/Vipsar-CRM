-- ============================================================
-- Makes "which firm does this architect work under" a real relationship
-- instead of a free-text label (2026-08-17).
--
-- Run this in the Supabase Dashboard's SQL Editor — the anon key this app
-- runs on can't execute DDL.
--
-- WHY: parties.firm_name is TEXT, so two architects at the same practice
-- hold two unrelated strings. Nothing can answer "who else is at this firm",
-- a typo silently creates a second firm, and renaming a practice means
-- editing every architect by hand. This adds parties.firm_party_id — a
-- self-reference from an architect to the 'firm' party they belong to — so
-- architect→firm becomes a real tree the app can walk in both directions.
--
-- firm_name is deliberately NOT dropped. After STEP 3 it's a read-only
-- fallback for any row the backfill couldn't match, and the app stops
-- writing to it. Dropping it would throw away those unmatched values.
--
-- Safe to re-run: every step is guarded (IF NOT EXISTS, or a NOT EXISTS /
-- IS NULL filter), so a second run changes nothing.
-- ============================================================


-- ------------------------------------------------------------
-- 1) The link itself.
--    ON DELETE SET NULL, not CASCADE: deleting a firm must never delete the
--    architects who worked there — they just stop being linked. (Note the
--    app has no firm-delete UI; this is for manual cleanup in the dashboard.)
-- ------------------------------------------------------------
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS firm_party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL;

-- A party can't be its own firm. Table-level so it can compare two columns.
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_firm_not_self;
ALTER TABLE parties ADD CONSTRAINT parties_firm_not_self
  CHECK (firm_party_id IS DISTINCT FROM id);

-- "Every architect at this firm" is the whole point of the tree, so index
-- the side that lookup filters on.
CREATE INDEX IF NOT EXISTS idx_parties_firm_party ON parties(firm_party_id);


-- ------------------------------------------------------------
-- 2) BACKFILL part 1 — promote each distinct firm_name to a real 'firm'
--    party, unless a firm with that name already exists.
--
--    Matching is case-insensitive and trim-insensitive, so 'Kapoor & Assoc'
--    and 'kapoor & assoc ' collapse into one firm rather than two. It is
--    NOT fuzzy: 'Kapoor and Assoc' stays separate, which is the honest
--    outcome — merging those would be a guess about the real world.
--
--    created_by is carried over from one of the architects, so the new firm
--    is visible to the same person under parties' own RLS policy (which
--    admits a row via its created_by, or via a lead the caller can see —
--    and a firm party has no lead).
-- ------------------------------------------------------------
INSERT INTO parties (name, party_type, created_by)
SELECT DISTINCT ON (lower(btrim(a.firm_name)))
       btrim(a.firm_name),
       'firm',
       a.created_by
FROM parties a
WHERE a.firm_name IS NOT NULL
  AND btrim(a.firm_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM parties f
    WHERE f.party_type = 'firm'
      AND lower(btrim(f.name)) = lower(btrim(a.firm_name))
  )
ORDER BY lower(btrim(a.firm_name)), a.id;


-- ------------------------------------------------------------
-- 3) BACKFILL part 2 — link each architect to its firm party.
--    Only fills rows that have no link yet, so re-running won't overwrite a
--    link someone has since corrected by hand.
-- ------------------------------------------------------------
UPDATE parties a
SET firm_party_id = f.id
FROM parties f
WHERE a.firm_party_id IS NULL
  AND a.firm_name IS NOT NULL
  AND btrim(a.firm_name) <> ''
  AND f.party_type = 'firm'
  AND lower(btrim(f.name)) = lower(btrim(a.firm_name))
  AND f.id <> a.id;


-- ------------------------------------------------------------
-- 4) Tell PostgREST about the new relationship.
--    The app embeds the firm as parties!firm_party_id(...), and PostgREST
--    resolves embeds from a cached copy of the schema. Supabase usually
--    reloads that by itself after DDL, but not always immediately — until it
--    does, every party search fails with:
--      "Could not find a relationship between 'parties' and 'parties'
--       in the schema cache"
--    This makes the reload explicit rather than something to wait out.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 5) VERIFY.
--    'unlinked' should be 0. Anything left there kept its firm_name text and
--    still displays it — it just isn't part of the tree yet.
-- ------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE firm_name IS NOT NULL AND btrim(firm_name) <> '')        AS with_firm_text,
  count(*) FILTER (WHERE firm_party_id IS NOT NULL)                               AS linked,
  count(*) FILTER (WHERE firm_name IS NOT NULL AND btrim(firm_name) <> ''
                     AND firm_party_id IS NULL)                                   AS unlinked,
  count(*) FILTER (WHERE party_type = 'firm')                                     AS firm_parties
FROM parties;

-- The tree, for eyeballing: every firm and who belongs to it.
SELECT f.id AS firm_id, f.name AS firm, a.id AS architect_id, a.name AS architect
FROM parties f
LEFT JOIN parties a ON a.firm_party_id = f.id
WHERE f.party_type = 'firm'
ORDER BY f.name, a.name;
