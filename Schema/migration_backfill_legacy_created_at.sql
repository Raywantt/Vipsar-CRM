-- ============================================================
-- migration_backfill_legacy_created_at.sql
--
-- Written 2026-09-03. NOT YET RUN against the live database.
--
-- WHAT THIS IS
-- A DATA migration. It rewrites rows; it creates nothing, drops nothing,
-- and touches no policy, trigger, function, constraint or grant. It is
-- independent of every other migration in this folder and can run at any
-- point after the three legacy imports.
--
-- WHY
-- Schema/import_{vipul,harish,manohar}_legacy.sql each INSERT INTO leads
-- without listing `created_at`, so all 431 imported leads took the column
-- DEFAULT now() and landed on the timestamp of their own import
-- transaction. Measured live 2026-09-03: 431 legacy leads hold exactly
-- THREE distinct created_at values, one per import file, all on
-- 2026-09-02. The real dates the sheets carried went into
-- `lead_generated_at` instead and range from 2023-01-21 to 2026-08-28.
--
-- Two consequences, both live today:
--   * Every legacy lead reports 2 September 2026 as its creation date,
--     which is when the row was written, not when the deal began.
--   * "Newest first" is not an ordering at all for these rows. A 431-way
--     tie on the sort column resolves arbitrarily in Postgres. That is
--     what hid lead #480 "Bhuvnesh Jain" from Log Activity's picker on
--     2026-09-03 (see src/components/LeadSearchSelect.jsx's header
--     comment); the picker itself is fixed, but the tie is still there
--     and still governs All Leads and anything else sorted this way.
--
-- ============================================================
-- NEEDS ATTENTION — ALREADY HANDLED. Read this before worrying.
-- ============================================================
-- This migration WAS going to flood the dashboard, and no longer does.
--
-- src/lib/attention.js line ~101 reads `lastActivityAt ?? lead.created_at`,
-- so a lead with no logged activity uses created_at as its last-touch proxy.
-- Moving 423 leads onto their real 2023-2026 dates would therefore have sent
-- Needs Attention from 165 rows to 396 overnight, 334 of them stale.
--
-- That was fixed FIRST, in the same session, before this file was cleared to
-- run: attention.js now carries HISTORY_STARTS_AT ('2026-09-02'), which
-- treats any signal dated before the import as though it arrived on the
-- import date -- but ONLY for leads carrying a 'legacy-' external_reference_id.
-- All five buckets therefore clear for the imported back-catalogue and refill
-- on their own thresholds (RFQ +3d, quotes +5d, stale +14d), while the app's
-- own 292 leads are untouched and keep every bit of their real signal.
--
-- Measured live 2026-09-03 with the clamp in place, running this migration's
-- exact effect through the real computeAttentionBuckets:
--
--     Needs Attention BEFORE migration ... 57 rows
--     Needs Attention AFTER  migration ... 57 rows   <- no change at all
--     imported leads appearing in any bucket ... 0
--
-- So there is nothing to brace for here. If you DO see the queue jump after
-- running this, HISTORY_STARTS_AT has been removed or external_reference_id
-- has been dropped from fetchLeadsForBreakdown / fetchLeadsList -- both are
-- pinned by tests in src/lib/attention.test.js.
--
-- NOTE the two are independent: this migration is safe to run whether or not
-- the clamp is present, and the clamp is correct whether or not this has run.
-- They were simply designed together.
--
-- One thing this migration straightforwardly FIXES rather than disturbs:
-- Dashboard.jsx's "N of M open leads are 90+ days old" currently counts
-- every legacy lead as one day old, so that figure is badly understated
-- today. Likewise "New leads" for the current period is inflated by 423
-- leads that were not new in September; they redistribute to the periods
-- they belong to (2023: 2, 2024: 7, 2025: 124, 2026: 290).
--
-- TRIGGER SAFETY — checked against the live definitions, not assumed.
-- Four triggers sit on `leads`; none does anything on a created_at-only
-- UPDATE:
--   * owner_only_stage_change (BEFORE UPDATE) returns NEW immediately
--     when current_stage is unchanged.
--   * stamp_entered_by_role (BEFORE INSERT OR UPDATE) returns NEW
--     immediately unless current_employee_role() = 'sales_executive';
--     the SQL Editor has no auth.uid(), so it is NULL there.
--   * log_lead_changes_upd (AFTER UPDATE) only writes a lead_change_log
--     row when quote_value, order_value or product_id changes. This
--     migration writes no audit rows, by design — created_at is not one
--     of that trail's four tracked fields.
--   * lead_reassign_moves_follow_ups is AFTER UPDATE **OF
--     owner_employee_id**, so it does not fire at all.
--
-- Safe to re-run: after a successful run the WHERE clause matches zero
-- rows (created_at is no longer on the import date). A re-run reports
-- "0 rows" rather than erroring.
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1 — PREVIEW (read-only). Run this on its own first.
--
-- Confirm the counts match the header before changing anything. If
-- `import_batches` comes back as anything other than the three
-- 2026-09-02 timestamps, STOP: something has already edited these rows
-- and the guard in STEP 2 needs revisiting.
-- ------------------------------------------------------------
SELECT
  count(*)                                            AS legacy_leads,
  count(*) FILTER (WHERE lead_generated_at IS NOT NULL) AS will_move,
  count(*) FILTER (WHERE lead_generated_at IS NULL)     AS left_alone,
  min(lead_generated_at)                              AS earliest_real_date,
  max(lead_generated_at)                              AS latest_real_date,
  count(DISTINCT created_at)                          AS import_batches
FROM leads
WHERE external_reference_id LIKE 'legacy-%';


-- ------------------------------------------------------------
-- STEP 2 — THE BACKFILL
--
-- Three guards, each load-bearing:
--
--   external_reference_id LIKE 'legacy-%'
--     The 292 leads created through the app itself already have a true
--     created_at and must never be touched by this.
--
--   lead_generated_at IS NOT NULL
--     8 legacy leads carry no date because the sheet had none for them.
--     They are LEFT AT THE IMPORT TIMESTAMP on purpose. Inventing a date
--     would put a fabricated fact in the same column as 423 real ones,
--     indistinguishable from them forever after — the same reason
--     leads.office_territory was left nullable rather than guessed from
--     the owner's office. All 8 belong to Vipul Sharma; STEP 3 lists
--     them so they can be filled in by hand if the real dates surface.
--     Consequence to be aware of: those 8 keep sorting as the newest
--     leads in the system until someone does.
--
--   created_at::date = DATE '2026-09-02'
--     Only ever rewrite a row still sitting at its import timestamp.
--     This is what makes the migration idempotent and what stops it
--     clobbering a created_at that someone has since corrected by hand.
--     If the imports are ever re-run on a different day, update this
--     date to match — do not simply delete the line.
--
-- `lead_generated_at` is a DATE, so the result is midnight. That is
-- deliberate: no time of day is known, and midnight invents the least.
-- Per this schema's naive-timestamp convention (see the Timestamps note
-- in CLAUDE.md's Day Review section) the app parses it as UTC, so it
-- renders 05:30 IST on the correct calendar date. Leads sharing a legacy
-- date therefore still tie with each other, but only within that one
-- day, and fetchLeadsList already sorts `created_at desc, id desc` so
-- the tie resolves deterministically instead of arbitrarily.
-- ------------------------------------------------------------
UPDATE leads
   SET created_at = lead_generated_at::timestamp
 WHERE external_reference_id LIKE 'legacy-%'
   AND lead_generated_at IS NOT NULL
   AND created_at::date = DATE '2026-09-02';
-- Expected: UPDATE 423


-- ------------------------------------------------------------
-- STEP 3 — VERIFY
-- ------------------------------------------------------------

-- 3a. Every moved lead's created_at must now equal its legacy date, and
--     nothing may remain stranded on the import day except the known 8.
SELECT
  count(*) FILTER (WHERE created_at::date = lead_generated_at)  AS matched_ok,
  count(*) FILTER (WHERE lead_generated_at IS NOT NULL
                     AND created_at::date <> lead_generated_at) AS still_wrong,
  count(*) FILTER (WHERE lead_generated_at IS NULL)             AS undated_left_alone
FROM leads
WHERE external_reference_id LIKE 'legacy-%';
-- Expected: matched_ok = 423, still_wrong = 0, undated_left_alone = 8

-- 3b. The app-created leads must be untouched. This is the guard that
--     matters most — a wrong WHERE clause in STEP 2 would show up here.
SELECT count(*) AS non_legacy_leads,
       min(created_at) AS earliest,
       max(created_at) AS latest
FROM leads
WHERE external_reference_id IS NULL
   OR external_reference_id NOT LIKE 'legacy-%';
-- Expected: non_legacy_leads = 292, and the range unchanged from before.

-- 3c. The 8 leads with no known date, for manual follow-up. All Vipul's.
--     Known ids at the time of writing: 480 (legacy-152), 504 (128),
--     511 (121), 597 (31), 598 (30), 623 (5), 624 (4), 625 (3).
SELECT l.id,
       l.external_reference_id,
       e.name AS owner,
       p.name AS client,
       l.current_stage,
       l.created_at
FROM leads l
LEFT JOIN employees e ON e.id = l.owner_employee_id
LEFT JOIN parties   p ON p.id = l.party_id
WHERE l.external_reference_id LIKE 'legacy-%'
  AND l.lead_generated_at IS NULL
ORDER BY l.id;

-- 3d. Sanity: the year spread should now look like a real history.
SELECT date_part('year', created_at) AS yr, count(*)
FROM leads
WHERE external_reference_id LIKE 'legacy-%'
GROUP BY 1 ORDER BY 1;
-- Expected: 2023 -> 2, 2024 -> 7, 2025 -> 124, 2026 -> 298
--           (2026 is 290 moved + the 8 undated still on 2026-09-02)


-- ------------------------------------------------------------
-- ROLLBACK — exact, not approximate.
--
-- Each import file wrote one transaction timestamp, and each maps
-- one-to-one onto a single rep (verified live 2026-09-03), so the
-- original values are fully recoverable from owner_employee_id alone:
--
--   Vipul Sharma    2026-09-02 08:37:07.265654
--   Harish Joshi    2026-09-02 11:14:53.781685
--   Manohar Mishra  2026-09-02 11:45:53.973882
--
-- Run only if you want the pre-migration state back. It restores the
-- 431-way tie and everything that came with it.
--
-- UPDATE leads l
--    SET created_at = CASE e.name
--          WHEN 'Vipul Sharma'   THEN TIMESTAMP '2026-09-02 08:37:07.265654'
--          WHEN 'Harish Joshi'   THEN TIMESTAMP '2026-09-02 11:14:53.781685'
--          WHEN 'Manohar Mishra' THEN TIMESTAMP '2026-09-02 11:45:53.973882'
--        END
--   FROM employees e
--  WHERE e.id = l.owner_employee_id
--    AND l.external_reference_id LIKE 'legacy-%'
--    AND e.name IN ('Vipul Sharma','Harish Joshi','Manohar Mishra');
--
-- If a lead has been REASSIGNED to a different rep since the import,
-- this mapping no longer identifies its batch and that row would be
-- restored to the wrong timestamp. Check before relying on it:
--   SELECT count(*) FROM leads l JOIN employees e ON e.id = l.owner_employee_id
--    WHERE l.external_reference_id LIKE 'legacy-%'
--      AND e.name NOT IN ('Vipul Sharma','Harish Joshi','Manohar Mishra');
-- ------------------------------------------------------------
