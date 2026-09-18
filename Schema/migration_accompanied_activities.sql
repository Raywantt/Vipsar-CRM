-- ============================================================
-- MIGRATION: accompanied_activities() — the colleague who went along can
-- see the meeting (2026-09-18)
--
-- THE PROBLEM. A manager (or another rep) often goes along to an important
-- meeting — a negotiation, a closure — on a lead they don't own. They can't
-- log anything against it (Log Activity's lead picker is scoped to the
-- actor's own leads, deliberately), so the lead's owner logs it and tags them
-- in "Accompanied by" (activities.accompanied_by). But `activities` SELECT is
-- own-data-or-owner, so the colleague could never see that row at all — the
-- tag was visible only to the owner of the lead and their supervisors.
--
-- THE OWNER'S RULINGS (2026-09-18):
--   * the lead owner logs it and tags the colleague — one row, never two;
--   * it SHOWS in the colleague's CRM with an "Accompanied" identifier, but
--     does NOT COUNT toward their activity totals, Day Review columns or
--     targets — team totals must still count one meeting as one;
--   * the colleague sees the lead's NAME only — no link, no Lead Detail.
--
-- WHY A FUNCTION AND NOT AN RLS POLICY. An extra permissive SELECT policy on
-- `activities` (accompanied_by = me) would make these rows appear in EVERY
-- existing query the colleague runs — several dashboard queries count
-- whatever RLS returns without filtering on employee_id, so the meeting would
-- be counted for them, which is exactly what the owner ruled out. It would
-- also need leads/parties/sites policies to show the name, which would open
-- Lead Detail too. This function changes no existing query and no policy; it
-- is the ONLY path to these rows, and it returns only what the screen shows:
-- type, time, who logged it, and the fields leadName.js needs to name the
-- lead (party name, site locality/house no/nickname). No notes, no values.
--
-- WHO CAN SEE A ROW — the same people who can see the colleague's own day:
--   * the colleague themselves;
--   * an owner;
--   * the colleague's coordinator (my_team_member_ids) or manager
--     (my_managed_member_ids), for Day Review day sheets and the Sales Exec
--     Profile.
-- A deactivated employee resolves current_employee_id() to NULL, so sees
-- nothing.
--
-- SECURITY DEFINER, so hide_test_accounts (a RESTRICTIVE RLS policy) does
-- NOT apply inside it — the same rule is repeated below with the same
-- helpers, or a test login tagging a real rep would leak into a real screen.
--
-- activities.created_at is a naive TIMESTAMP holding UTC wall clock, so the
-- bounds are converted with AT TIME ZONE 'UTC' rather than relying on the
-- session's TimeZone setting.
--
-- Fails soft until run: every caller treats an RPC error as "no accompanied
-- activities", so the app can deploy before this runs — the colleague just
-- doesn't see the tagged meetings yet. Needs no other migration first beyond
-- the ones already live (viewer_sees_test_data etc. from
-- migration_hide_test_accounts.sql, my_*_member_ids from
-- migration_rls_performance_follow_ups.sql).
-- Safe to re-run.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS accompanied_activities(timestamptz, timestamptz, integer);

CREATE FUNCTION accompanied_activities(
  p_from         timestamptz,
  p_to           timestamptz,
  p_companion_id integer DEFAULT NULL
)
RETURNS TABLE (
  id              integer,
  activity_type   text,
  created_at      timestamp,
  accompanied_by  integer,
  employee_id     integer,
  employee_name   text,
  lead_id         integer,
  party_id        integer,
  party_name      text,
  lead_party_name text,
  site_nickname   text,
  site_locality   text,
  site_house_no   text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id,
         a.activity_type,
         a.created_at,
         a.accompanied_by,
         a.employee_id,
         e.name,
         a.lead_id,
         a.party_id,
         ap.name,
         lp.name,
         s.nickname,
         s.locality,
         s.house_no
    FROM activities a
    JOIN employees e       ON e.id = a.employee_id
    LEFT JOIN parties ap   ON ap.id = a.party_id
    LEFT JOIN leads l      ON l.id = a.lead_id
    LEFT JOIN parties lp   ON lp.id = l.party_id
    LEFT JOIN sites s      ON s.id = l.site_id
   WHERE a.accompanied_by IS NOT NULL
     AND a.created_at >= (p_from AT TIME ZONE 'UTC')
     AND a.created_at <= (p_to AT TIME ZONE 'UTC')
     AND (p_companion_id IS NULL OR a.accompanied_by = p_companion_id)
     AND (
       a.accompanied_by = (SELECT current_employee_id())
       OR (SELECT current_employee_role()) = 'owner'
       OR a.accompanied_by = ANY((SELECT my_team_member_ids())::integer[])
       OR a.accompanied_by = ANY((SELECT my_managed_member_ids())::integer[])
     )
     AND (
       (SELECT viewer_sees_test_data())
       OR (a.employee_id <> ALL((SELECT test_employee_ids())::integer[])
           AND a.accompanied_by <> ALL((SELECT test_employee_ids())::integer[])
           AND COALESCE(a.lead_id <> ALL((SELECT test_lead_ids())::integer[]), true))
     )
   ORDER BY a.created_at, a.id;
$$;

REVOKE ALL ON FUNCTION accompanied_activities(timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION accompanied_activities(timestamptz, timestamptz, integer) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
