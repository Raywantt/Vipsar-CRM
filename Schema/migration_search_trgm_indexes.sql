-- ============================================================
-- MIGRATION: pg_trgm search indexes on parties/sites/employees  (2026-09-04)
--
-- Every free-text search in this app — Search, PartySearchOrCreate,
-- SiteSearchOrCreate, LeadSearchSelect, resolveLeadsSearchFilter — matches
-- with a LEADING-wildcard ILIKE ('%term%'), because a rep types a substring
-- of a name, not a prefix. tostem_crm_schema.sql's own index comment
-- predicted this exact moment: "if search ever feels slow as data grows,
-- that's when to add pg_trgm — deliberately skipped for this version."
--
-- The plain B-tree indexes already on parties(name)/parties(mobile)
-- (idx_parties_name/idx_parties_mobile) CANNOT accelerate a leading-wildcard
-- ILIKE at all — a B-tree only helps a search that starts matching from the
-- left edge of the value, and every search here starts matching from
-- anywhere inside it. Every one of those searches is a full sequential scan
-- today: 1,358 rows on parties, 1,206 on sites, and growing. This is a
-- real, load-bearing contributor to "search feels slow" everywhere in the
-- app, not a marginal one.
--
-- Run this in the Supabase SQL Editor. Nothing in the app or its RLS
-- policies changes — this only adds indexes Postgres's query planner can
-- choose to use instead of a sequential scan; no query, migration ordering,
-- or app code depends on it. Safe to re-run (CREATE EXTENSION/INDEX IF NOT
-- EXISTS throughout), and independent of every other migration in this
-- folder.
--
-- Columns covered — every column reached by a `.ilike()` or a
-- `.or('col.ilike...')` filter anywhere in src/ as of this migration:
--   parties.name, parties.mobile      (Search, PartySearchOrCreate,
--                                       resolveLeadsSearchFilter,
--                                       LeadSearchSelect, searchQueries.js)
--   sites.nickname, sites.locality,
--   sites.house_no                    (Search, SiteSearchOrCreate,
--                                       resolveLeadsSearchFilter,
--                                       LeadSearchSelect, searchQueries.js)
--   employees.name                    (resolveLeadsSearchFilter's employee
--                                       lookup, "Accompanied by" typeahead)
-- ============================================================


-- ---------- STEP 1: the extension ----------
--
-- Ships with every Postgres install Supabase runs; enabling it just makes
-- the gin_trgm_ops operator class available. No data is touched.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ---------- STEP 2: the indexes ----------
--
-- GIN + gin_trgm_ops is what lets Postgres use an index for a substring
-- match instead of scanning every row — the standard fix for '%term%'
-- ILIKE. Left the existing plain B-tree indexes on parties(name)/
-- parties(mobile) in place: those still help an exact-match `.eq()` lookup
-- elsewhere (e.g. dedup checks), which a trigram index doesn't serve as
-- well. This adds a second, purpose-built index alongside them rather than
-- replacing anything.
CREATE INDEX IF NOT EXISTS idx_parties_name_trgm     ON parties   USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_parties_mobile_trgm   ON parties   USING gin (mobile gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sites_nickname_trgm   ON sites     USING gin (nickname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sites_locality_trgm   ON sites     USING gin (locality gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sites_house_no_trgm   ON sites     USING gin (house_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_name_trgm   ON employees USING gin (name gin_trgm_ops);


-- ============================================================
-- VERIFICATION — run these after.
-- ============================================================

-- 1. Extension is installed:
--
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';
--
--    Expect one row.

-- 2. All six indexes exist:
--
-- SELECT indexname FROM pg_indexes
--  WHERE indexname IN (
--    'idx_parties_name_trgm', 'idx_parties_mobile_trgm',
--    'idx_sites_nickname_trgm', 'idx_sites_locality_trgm',
--    'idx_sites_house_no_trgm', 'idx_employees_name_trgm'
--  );
--
--    Expect 6 rows.

-- 3. The planner is actually choosing the new index (not just that it
--    exists) — run against a real substring that would match a handful of
--    rows, and confirm "Bitmap Index Scan on idx_parties_name_trgm" (or
--    similar) appears rather than "Seq Scan on parties":
--
-- EXPLAIN ANALYZE
-- SELECT id FROM parties WHERE name ILIKE '%an%';
--
--    A sequential scan can still win on a very small table or a term that
--    matches most of the rows (a query planner's own cost estimate, not a
--    sign anything is wrong) — if it's a Seq Scan, retry with a longer,
--    more selective substring before assuming the index isn't working.


-- ============================================================
-- ADDING A NEW SEARCHED COLUMN LATER
-- ============================================================
-- Any future free-text ILIKE search added against a NEW column needs its
-- own `CREATE INDEX ... USING gin (<col> gin_trgm_ops)` — the extension
-- from STEP 1 only needs installing once per database, but each column
-- searched needs its own index; adding a seventh searchable field without
-- one silently reintroduces this exact slowdown for just that field.
