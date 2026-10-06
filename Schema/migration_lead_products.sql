-- ============================================================
-- MIGRATION: several products per lead, quoted per product
-- (owner's rulings, 2026-10-06)
--
-- 1. leads.product_ids INTEGER[] — the lead's products, as many as apply.
--    THE one column the app reads and writes, from Lead Detail's Sales
--    progress AND the RFQ Raised form (the same picker). Backfilled from
--    product_id. leads.product_id stays, but only as a DERIVED mirror of the
--    first product (sync_lead_products below, like next_followup_date): the
--    build that was live before this keeps writing product_id until the new
--    one deploys, and the mirror keeps every older reader (data completeness,
--    the snapshot metrics) right. Nothing new should write it.
--
-- 2. rfqs.product_ids INTEGER[] — each RFQ's own frozen copy of what it was
--    raised for (owner's pick), from activities.rfq_product_ids, which the RFQ
--    Raised form now sends. An RFQ from the old build (rfq_segments only) has
--    its segment keys mapped to products. A price revision copies its quote's.
--
-- 3. Quotes per product: rfq_record_quote_lines(rfq, ref, lines, date) — the
--    Estimation Executive enters one value per product on the RFQ (all
--    required; owner's ruling); the RFQ's quote_value is their SUM (through
--    the existing rfq_record_quote, so every rule and side effect is
--    unchanged). The split is kept on the RFQ (rfqs.quote_lines) and copied
--    to the lead (leads.quote_lines) — the latest desk quote's split, which
--    every by-product figure reads. Shape: [{"product_id": 12, "value": 600000}, …].
--
-- 4. Leads by product (leads_category_breakdown): a lead counts under EACH of
--    its products. Its value goes to each product by the latest quote's split
--    — an open lead the line itself, a won/lost one its order value in the
--    quote's proportions (owner's ruling) — and a lead with ONE product gives
--    it the whole value. Anything that can't be split that way (a lead with
--    several products and no split quote) is reported under 'Not split yet'
--    rather than guessed. Mirrors src/lib/productShares.js exactly.
--
-- 5. The change log records product changes from product_ids (names joined,
--    at the time — the existing 'product' field).
--
-- ⚠️ RUN BEFORE THE DEPLOY: the new build selects product_ids / quote_lines
-- and calls rfq_record_quote_lines. Needs migration_products_order.sql (and
-- the portfolio migrations) first.
-- ⚠️ Re-running migration_bdm_handoff.sql or an older file defining
-- leads_category_breakdown(), or migration_lead_change_log.sql, or
-- migration_rfq_desk.sql (rfq_from_activity / rfq_start_price_revision),
-- puts the single-product versions back — re-run THIS file straight after.
--
-- RUN: paste into the Supabase SQL Editor and Run. Safe to re-run.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. leads.product_ids (+ the product_id mirror)
-- ------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS product_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS quote_lines JSONB;

UPDATE leads SET product_ids = ARRAY[product_id]
 WHERE product_id IS NOT NULL AND product_ids = '{}';

CREATE OR REPLACE FUNCTION sync_lead_products()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_bad integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(cardinality(NEW.product_ids), 0) = 0 AND NEW.product_id IS NOT NULL THEN
      NEW.product_ids := ARRAY[NEW.product_id];
    END IF;
  ELSIF NEW.product_ids IS DISTINCT FROM OLD.product_ids THEN
    NULL;                                   -- the new build: product_ids leads
  ELSIF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    -- the old build (or admin SQL) changed the single product
    NEW.product_ids := CASE WHEN NEW.product_id IS NULL THEN '{}'::integer[] ELSE ARRAY[NEW.product_id] END;
  END IF;

  NEW.product_ids := COALESCE(NEW.product_ids, '{}');
  IF cardinality(NEW.product_ids) <> (SELECT count(DISTINCT x) FROM unnest(NEW.product_ids) AS x) THEN
    RAISE EXCEPTION 'A product is listed twice on this lead.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_bad FROM unnest(NEW.product_ids) AS x WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = x);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'That product no longer exists — reload and pick again.' USING ERRCODE = 'check_violation';
  END IF;

  NEW.product_id := NEW.product_ids[1];     -- the mirror: always the first product
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_lead_products ON leads;
CREATE TRIGGER sync_lead_products
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION sync_lead_products();

-- ------------------------------------------------------------
-- 2. The RFQ's own copy
-- ------------------------------------------------------------
ALTER TABLE activities ADD COLUMN IF NOT EXISTS rfq_product_ids INTEGER[];
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_rfq_products_check;
ALTER TABLE activities ADD CONSTRAINT activities_rfq_products_check CHECK (
  rfq_product_ids IS NULL OR (activity_type = 'rfq_raised' AND cardinality(rfq_product_ids) > 0)
);

ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS product_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS quote_lines JSONB;

-- Segment key → product, for RFQs the old build raised (and any already there).
CREATE OR REPLACE FUNCTION rfq_segment_product_ids(p_segments text[])
RETURNS integer[]
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT p.id), '{}')
    FROM unnest(COALESCE(p_segments, '{}')) AS s
    JOIN products p ON p.name = CASE s
      WHEN 'tostem' THEN 'Tostem'   WHEN 'windows' THEN 'Tostem'
      WHEN 'in16' THEN 'IN16'       WHEN 'giesta' THEN 'GIESTA'
      WHEN 'noki' THEN 'Noki'       WHEN 'skylight' THEN 'Sky Light'
      WHEN 'wrapping_bars' THEN 'Wrapping Bars'
      WHEN 'stonelam' THEN 'StoneLam' WHEN 'vox' THEN 'VOX'
      WHEN 'premial' THEN 'PremiAL'
      ELSE 'Others' END;
$$;

UPDATE rfqs SET product_ids = rfq_segment_product_ids(segments)
 WHERE product_ids = '{}' AND cardinality(segments) > 0;

CREATE OR REPLACE FUNCTION rfq_from_activity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.activity_type <> 'rfq_raised' OR NEW.lead_id IS NULL OR NOT rfq_desk_is_live() THEN
    RETURN NULL;
  END IF;

  INSERT INTO rfqs (lead_id, activity_id, kind, revision,
                    raised_by_employee_id, logged_by_employee_id, is_test,
                    window_count, segments, product_ids)
  VALUES (
    NEW.lead_id,
    NEW.id,
    COALESCE(NEW.rfq_kind, 'fresh'),
    (SELECT count(*) FROM activities a
      WHERE a.lead_id = NEW.lead_id AND a.activity_type = 'rfq_raised' AND a.id < NEW.id),
    NEW.employee_id,
    COALESCE(NEW.logged_by_employee_id, NEW.employee_id),
    COALESCE((SELECT e.is_test_account FROM employees e WHERE e.id = NEW.employee_id), false),
    NEW.rfq_window_count,
    COALESCE(NEW.rfq_segments, '{}'),
    -- The new form sends products; the old one sent segment keys.
    COALESCE(NULLIF(NEW.rfq_product_ids, '{}'), rfq_segment_product_ids(NEW.rfq_segments))
  );

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION rfq_start_price_revision(p_lead_id integer)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last  rfqs;
  v_owner integer;
  r       rfqs;
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Estimation Executive or the owner can start a price revision.' USING ERRCODE = '42501';
  END IF;

  -- Serialise price revisions on one lead (the "already open" test below).
  SELECT owner_employee_id INTO v_owner FROM leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lead could not be found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_last FROM rfqs
   WHERE lead_id = p_lead_id AND status = 'quoted'
   ORDER BY quote_received_at DESC, id DESC
   LIMIT 1;
  IF NOT FOUND OR NOT rfq_test_scope_ok(v_last.is_test) THEN
    RAISE EXCEPTION 'This lead has no quoted RFQ to revise.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM rfqs
              WHERE lead_id = p_lead_id AND kind = 'price_revision'
                AND status IN ('with_estimation', 'with_lixil')) THEN
    RAISE EXCEPTION 'A price revision is already open on this lead.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO rfqs (lead_id, kind, revision, raised_by_employee_id, logged_by_employee_id, is_test,
                    window_count, segments, product_ids, status)
  VALUES (p_lead_id, 'price_revision', v_last.revision, v_owner, current_employee_id(), v_last.is_test,
          v_last.window_count, v_last.segments, v_last.product_ids, 'with_estimation')
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- ------------------------------------------------------------
-- 3. Quotes per product
-- ------------------------------------------------------------
-- p_lines: [{"product_id": 12, "value": 600000}, …] — exactly one line per
-- product on the RFQ, every value > 0. An RFQ that carries no product at all
-- (raised some other way) takes a single line with product_id null.
CREATE OR REPLACE FUNCTION rfq_record_quote_lines(
  p_rfq_id     integer,
  p_quote_ref  text,
  p_lines      jsonb,
  p_quote_date date DEFAULT NULL
)
RETURNS rfqs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        rfqs;
  v_total  numeric;
  v_ids    integer[];
  v_clean  jsonb;
BEGIN
  IF COALESCE(current_employee_role(), '') NOT IN ('estimation_executive', 'owner') THEN
    RAISE EXCEPTION 'Only the Estimation Executive or the owner can record a quote.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM rfqs WHERE id = p_rfq_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That RFQ could not be found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Enter the quote value for each product (without GST).' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e
              WHERE (e->>'value') IS NULL OR (e->>'value')::numeric <= 0) THEN
    RAISE EXCEPTION 'Enter the quote value for each product (without GST).' USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg((e->>'product_id')::integer ORDER BY (e->>'product_id')::integer)
    INTO v_ids
    FROM jsonb_array_elements(p_lines) e
   WHERE e->>'product_id' IS NOT NULL;

  IF cardinality(r.product_ids) > 0 THEN
    IF v_ids IS NULL
       OR v_ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(r.product_ids) x)
       OR jsonb_array_length(p_lines) <> cardinality(r.product_ids) THEN
      RAISE EXCEPTION 'Enter one value for each product on this RFQ.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF jsonb_array_length(p_lines) <> 1 OR v_ids IS NOT NULL THEN
    RAISE EXCEPTION 'This RFQ has no product — enter one total.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT sum((e->>'value')::numeric), jsonb_agg(jsonb_build_object(
           'product_id', (e->>'product_id')::integer,
           'value', round((e->>'value')::numeric, 2)))
    INTO v_total, v_clean
    FROM jsonb_array_elements(p_lines) e;

  -- Every other rule (reference, date, status, the lead's quote value, the
  -- exec's alert) is rfq_record_quote's own.
  r := rfq_record_quote(p_rfq_id, p_quote_ref, v_total, p_quote_date);

  UPDATE rfqs SET quote_lines = CASE WHEN cardinality(product_ids) > 0 THEN v_clean END
   WHERE id = r.id
  RETURNING * INTO r;
  UPDATE leads SET quote_lines = r.quote_lines WHERE id = r.lead_id;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION rfq_record_quote_lines(integer, text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rfq_record_quote_lines(integer, text, jsonb, date) TO authenticated;

-- ------------------------------------------------------------
-- 4. Leads by product — under each product, value by the quote's split
-- ------------------------------------------------------------
-- Every other branch is migration_bdm_handoff.sql's body, unchanged.
CREATE OR REPLACE FUNCTION leads_category_breakdown(p_owner_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  category_group text,
  category       text,
  lead_count     bigint,
  deal_value     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH scoped_leads AS (
    SELECT
      l.id,
      COALESCE(l.current_stage, 'calling') AS current_stage,
      l.site_id,
      l.quote_value,
      l.order_value,
      l.product_ids,
      l.quote_lines,
      s.site_stage,
      a.area_name
    FROM leads l
    LEFT JOIN sites    s ON s.id = l.site_id
    LEFT JOIN areas    a ON a.id = s.area_id
    WHERE (p_owner_ids IS NULL OR l.owner_employee_id = ANY (p_owner_ids))
      -- BDM pool leads stay out of every company figure until assigned
      -- (migration_bdm_handoff.sql) — except for the BDM who brought them in.
      AND (l.owner_employee_id IS NOT NULL OR l.bdm_employee_id IS NULL
           OR (SELECT current_employee_role()) = 'business_development_manager')
  ),
  -- Mirrors dealValueFor(): an open lead's value is its quote alone; a
  -- won/lost lead prefers order_value, falling back to quote_value.
  valued AS (
    SELECT
      *,
      CASE
        WHEN current_stage IN ('won', 'lost') THEN COALESCE(order_value, quote_value, 0)
        ELSE COALESCE(quote_value, 0)
      END AS deal_value
    FROM scoped_leads
  ),
  -- One row per (lead, product). productShares() in src/lib/productShares.js
  -- is the same rule: one product → the whole value; several → each product's
  -- line in the latest quote, scaled to the deal value (so a won lead's order
  -- value is split in the quote's proportions); a product with no line gets 0.
  lines AS (
    SELECT v.id, (e->>'product_id')::integer AS product_id, (e->>'value')::numeric AS line_value
      FROM valued v, jsonb_array_elements(COALESCE(v.quote_lines, '[]'::jsonb)) e
  ),
  line_totals AS (
    SELECT id, sum(line_value) AS total FROM lines GROUP BY id
  ),
  per_product AS (
    SELECT v.id,
           pid AS product_id,
           CASE
             WHEN cardinality(v.product_ids) = 1 THEN v.deal_value
             WHEN lt.total > 0 THEN v.deal_value * COALESCE(li.line_value, 0) / lt.total
             ELSE 0
           END AS share
      FROM valued v
      CROSS JOIN LATERAL unnest(v.product_ids) AS pid
      LEFT JOIN line_totals lt ON lt.id = v.id
      LEFT JOIN lines li ON li.id = v.id AND li.product_id = pid
  ),
  unsplit AS (
    -- What the split couldn't place: a lead with several products and no
    -- quote split (or a split covering none of its products).
    SELECT v.id, v.deal_value - COALESCE(sum(pp.share), 0) AS rest
      FROM valued v
      LEFT JOIN per_product pp ON pp.id = v.id
     WHERE cardinality(v.product_ids) > 1
     GROUP BY v.id, v.deal_value
  )
  -- areaCategory(): !site_id -> 'No site'; else sites.areas.area_name ?? 'No area set'
  SELECT 'area', CASE WHEN site_id IS NULL THEN 'No site' ELSE COALESCE(area_name, 'No area set') END,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2

  UNION ALL

  -- siteStageCategory(): !site_id -> 'No site'; else sites.site_stage || 'Not set'
  SELECT 'site_stage', CASE WHEN site_id IS NULL THEN 'No site' ELSE COALESCE(NULLIF(site_stage, ''), 'Not set') END,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2

  UNION ALL

  -- Products: a lead counts under each of its products.
  SELECT 'product', p.name, COUNT(*), SUM(pp.share)
  FROM per_product pp JOIN products p ON p.id = pp.product_id
  GROUP BY 1, 2

  UNION ALL

  SELECT 'product', 'Not specified', COUNT(*), SUM(deal_value)
  FROM valued WHERE cardinality(product_ids) = 0
  GROUP BY 1, 2

  UNION ALL

  SELECT 'product', 'Not split yet', COUNT(*), SUM(rest)
  FROM unsplit WHERE rest > 0.5
  GROUP BY 1, 2

  UNION ALL

  -- stageRows: grouped by current_stage (already defaulted to 'calling').
  SELECT 'stage', current_stage,
         COUNT(*), SUM(deal_value)
  FROM valued GROUP BY 1, 2
$$;

-- ------------------------------------------------------------
-- 5. The change log, from product_ids
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

  -- Names at the time, joined in the products' own order (an audit row says
  -- what the value WAS; an id would show today's name).
  IF NEW.product_ids IS DISTINCT FROM OLD.product_ids THEN
    INSERT INTO lead_change_log (lead_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, actor, 'product',
            (SELECT string_agg(p.name, ' + ' ORDER BY p.sort_order NULLS LAST, p.name)
               FROM products p WHERE p.id = ANY (OLD.product_ids)),
            (SELECT string_agg(p.name, ' + ' ORDER BY p.sort_order NULLS LAST, p.name)
               FROM products p WHERE p.id = ANY (NEW.product_ids)));
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
