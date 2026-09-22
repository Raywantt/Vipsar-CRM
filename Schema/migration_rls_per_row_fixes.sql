-- ============================================================================
-- RLS per-row fixes + last_activity_per_lead()  (2026-09-22)
--
-- WHAT THIS DOES — speed only. NOBODY SEES ONE ROW MORE OR LESS THAN BEFORE.
--
-- Written from the LIVE definitions (Schema/dump_live_rls_and_functions.sql,
-- run by the owner 2026-09-22 → backup/logs/Database_counting.csv), not from
-- the older Schema/ files, so it can't quietly undo anything that is live.
-- Every policy below is DROPPED and RE-CREATED with the same name, the same
-- command, the same roles and a logically identical condition. Three safe
-- rewrites, the same recipe migration_rls_performance_*.sql already applied
-- to leads / activities / follow_ups / stage_history:
--
--   1. A bare helper call — current_employee_role(), current_employee_id() —
--      becomes (SELECT helper()). Bare, Postgres runs the helper (a query on
--      `employees`) once PER ROW; wrapped, once per request. The helpers are
--      STABLE, so the answer is identical either way. This matters most on
--      employees / products / areas, which are pulled into EVERY lead read
--      (employees!owner_employee_id, products!product_id, sites→areas): a
--      1,341-lead download was calling a helper ~4,000 times.
--   2. A per-row is_my_team_member(x) / is_my_managed_member(x) becomes
--      x = ANY((SELECT my_team_member_ids())) / my_managed_member_ids(),
--      behind a cheap role test. is_my_team_member(x) is exactly "x is in the
--      array my_team_member_ids() returns" (both require the viewer to be a
--      coordinator whose employees.coordinator_id points at them), so the
--      truth table is unchanged; the array is computed once.
--   3. parties' three EXISTS sub-searches (run for EVERY contact row) become
--      one array of reachable party ids computed once per request by a small
--      SECURITY INVOKER function containing the SAME sub-searches. INVOKER
--      matters: the leads / activities / site_contacts inside it are read
--      with the viewer's own RLS, exactly as inside the old EXISTS. The
--      manager version was the worst hotspot in the app — it called
--      is_my_managed_member() for every (contact × lead) pair, which is how
--      a sales manager's reads reached the 8-second limit.
--
-- Also adds last_activity_per_lead(): one row per lead (its latest activity),
-- computed in the database instead of downloading every activity to reduce
-- in the browser. SECURITY INVOKER, so each viewer gets exactly the rows their
-- RLS allows — the same answer the download gave. The app calls it and falls
-- back to the download if it isn't there, so running this before or after
-- the deploy is safe.
--
-- HOW TO RUN: Supabase → SQL Editor → New query → paste this whole file →
-- Run. It is one transaction: it either all applies or none of it does.
-- Safe to re-run. To undo, run Schema/rollback_rls_per_row_fixes.sql.
--
-- ORDER: this is step 9 of CLAUDE.md's migration order — it must stay the
-- LAST file that defines these policies. Re-running an older file that
-- CREATE-OR-REPLACEs them (rls_policies.sql, the coordinator / manager / BDM
-- migrations) puts the slow versions back; re-run this file afterwards.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper arrays for parties (SECURITY INVOKER — see note 3 above).
-- ---------------------------------------------------------------------------

-- Parties reachable through the viewer's OWN work: their leads (client,
-- referrer, other party), their activities, and site contacts on their
-- leads' sites. The three EXISTS branches of parties.team_scoped_select.
CREATE OR REPLACE FUNCTION public.my_linked_party_ids()
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.pid), '{}'::integer[])
    FROM (
      SELECT unnest(ARRAY[l.party_id, l.referred_by_party_id, l.other_party_id]) AS pid
        FROM leads l
       WHERE l.owner_employee_id = (SELECT current_employee_id())
      UNION ALL
      SELECT a.party_id
        FROM activities a
       WHERE a.employee_id = (SELECT current_employee_id())
         AND a.party_id IS NOT NULL
      UNION ALL
      SELECT sc.party_id
        FROM site_contacts sc
        JOIN leads l2 ON l2.site_id = sc.site_id
       WHERE l2.owner_employee_id = (SELECT current_employee_id())
    ) x
   WHERE x.pid IS NOT NULL;
$$;

-- Parties reachable through a sales manager's TEAM's leads — the two EXISTS
-- branches of parties.manager_team_select.
CREATE OR REPLACE FUNCTION public.my_managed_party_ids()
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.pid), '{}'::integer[])
    FROM (
      SELECT unnest(ARRAY[l.party_id, l.referred_by_party_id, l.other_party_id]) AS pid
        FROM leads l
       WHERE l.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
      UNION ALL
      SELECT sc.party_id
        FROM site_contacts sc
        JOIN leads l2 ON l2.site_id = sc.site_id
       WHERE l2.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
    ) x
   WHERE x.pid IS NOT NULL;
$$;

-- Parties reachable through the leads a BDM brought in — the two EXISTS
-- branches of parties.bdm_sourced_select.
CREATE OR REPLACE FUNCTION public.my_bdm_party_ids()
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.pid), '{}'::integer[])
    FROM (
      SELECT unnest(ARRAY[l.party_id, l.referred_by_party_id, l.other_party_id]) AS pid
        FROM leads l
       WHERE l.bdm_employee_id = (SELECT current_employee_id())
      UNION ALL
      SELECT sc.party_id
        FROM site_contacts sc
        JOIN leads l2 ON l2.site_id = sc.site_id
       WHERE l2.bdm_employee_id = (SELECT current_employee_id())
    ) x
   WHERE x.pid IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.my_linked_party_ids()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_managed_party_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_bdm_party_ids()     TO authenticated;

-- ---------------------------------------------------------------------------
-- parties
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS team_scoped_select ON public.parties;
CREATE POLICY team_scoped_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = ANY (ARRAY['owner'::text, 'sales_coordinator'::text]))
    OR (created_by = (SELECT current_employee_id()))
    OR (id = ANY ((SELECT my_linked_party_ids())::integer[]))
  );

DROP POLICY IF EXISTS manager_team_select ON public.parties;
CREATE POLICY manager_team_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (id = ANY ((SELECT my_managed_party_ids())::integer[]))
  );

DROP POLICY IF EXISTS bdm_sourced_select ON public.parties;
CREATE POLICY bdm_sourced_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'business_development_manager'::text)
    AND (id = ANY ((SELECT my_bdm_party_ids())::integer[]))
  );

-- ---------------------------------------------------------------------------
-- sites — the manager branch called is_my_managed_member() per row.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS manager_team_select ON public.sites;
CREATE POLICY manager_team_select ON public.sites
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (EXISTS (
      SELECT 1 FROM leads l
       WHERE l.site_id = sites.id
         AND l.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
    ))
  );

-- ---------------------------------------------------------------------------
-- employees — embedded in every lead read (employees!owner_employee_id).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_select ON public.employees;
CREATE POLICY authenticated_select ON public.employees
  AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS owner_only_delete ON public.employees;
CREATE POLICY owner_only_delete ON public.employees
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_insert ON public.employees;
CREATE POLICY owner_only_insert ON public.employees
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_update ON public.employees;
CREATE POLICY owner_only_update ON public.employees
  AS PERMISSIVE FOR UPDATE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text)
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

-- ---------------------------------------------------------------------------
-- products — embedded in every lead read (products!product_id).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_select ON public.products;
CREATE POLICY authenticated_select ON public.products
  AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS owner_only_delete ON public.products;
CREATE POLICY owner_only_delete ON public.products
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_insert ON public.products;
CREATE POLICY owner_only_insert ON public.products
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_update ON public.products;
CREATE POLICY owner_only_update ON public.products
  AS PERMISSIVE FOR UPDATE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text)
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

-- ---------------------------------------------------------------------------
-- areas — embedded via sites → areas, and read whole on several screens.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_insert ON public.areas;
CREATE POLICY authenticated_insert ON public.areas
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS authenticated_select ON public.areas;
CREATE POLICY authenticated_select ON public.areas
  AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS owner_only_delete ON public.areas;
CREATE POLICY owner_only_delete ON public.areas
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_update ON public.areas;
CREATE POLICY owner_only_update ON public.areas
  AS PERMISSIVE FOR UPDATE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text)
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

-- ---------------------------------------------------------------------------
-- site_contacts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_insert ON public.site_contacts;
CREATE POLICY authenticated_insert ON public.site_contacts
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS authenticated_select ON public.site_contacts;
CREATE POLICY authenticated_select ON public.site_contacts
  AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS owner_only_delete ON public.site_contacts;
CREATE POLICY owner_only_delete ON public.site_contacts
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS owner_only_update ON public.site_contacts;
CREATE POLICY owner_only_update ON public.site_contacts
  AS PERMISSIVE FOR UPDATE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text)
  WITH CHECK ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS coordinator_team_update ON public.site_contacts;
CREATE POLICY coordinator_team_update ON public.site_contacts
  AS PERMISSIVE FOR UPDATE TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_coordinator'::text)
    AND (EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = site_contacts.site_id
         AND leads.owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
    ))
  )
  WITH CHECK (
    ((SELECT current_employee_role()) = 'sales_coordinator'::text)
    AND (EXISTS (
      SELECT 1 FROM leads
       WHERE leads.site_id = site_contacts.site_id
         AND leads.owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
    ))
  );

-- ---------------------------------------------------------------------------
-- loss_reasons
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_insert ON public.loss_reasons;
CREATE POLICY authenticated_insert ON public.loss_reasons
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS owner_only_select ON public.loss_reasons;
CREATE POLICY owner_only_select ON public.loss_reasons
  AS PERMISSIVE FOR SELECT TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS manager_team_select ON public.loss_reasons;
CREATE POLICY manager_team_select ON public.loss_reasons
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = loss_reasons.lead_id
         AND (l.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
              OR l.owner_employee_id = (SELECT current_employee_id()))
    ))
  );

-- ---------------------------------------------------------------------------
-- targets
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.targets;
CREATE POLICY own_data_or_owner_role_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_or_owner_role_insert ON public.targets;
CREATE POLICY own_data_or_owner_role_insert ON public.targets
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_or_owner_role_update ON public.targets;
CREATE POLICY own_data_or_owner_role_update ON public.targets
  AS PERMISSIVE FOR UPDATE TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text))
  WITH CHECK ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS owner_only_delete ON public.targets;
CREATE POLICY owner_only_delete ON public.targets
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS coordinator_team_select ON public.targets;
CREATE POLICY coordinator_team_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_coordinator'::text)
    AND (employee_id = ANY ((SELECT my_team_member_ids())::integer[]))
  );

DROP POLICY IF EXISTS manager_team_select ON public.targets;
CREATE POLICY manager_team_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (employee_id = ANY ((SELECT my_managed_member_ids())::integer[]))
  );

-- ---------------------------------------------------------------------------
-- lead_change_log (the Day Review's "changes made")
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.lead_change_log;
CREATE POLICY own_data_or_owner_role_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'owner'::text)
    OR (EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = lead_change_log.lead_id
         AND leads.owner_employee_id = (SELECT current_employee_id())
    ))
  );

DROP POLICY IF EXISTS coordinator_team_select ON public.lead_change_log;
CREATE POLICY coordinator_team_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_coordinator'::text)
    AND (EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_change_log.lead_id
         AND l.owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
    ))
  );

DROP POLICY IF EXISTS manager_team_select ON public.lead_change_log;
CREATE POLICY manager_team_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = lead_change_log.lead_id
         AND leads.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
    ))
  );

-- ---------------------------------------------------------------------------
-- lead_owner_history
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS authenticated_insert ON public.lead_owner_history;
CREATE POLICY authenticated_insert ON public.lead_owner_history
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((SELECT current_employee_role()) IS NOT NULL);

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.lead_owner_history;
CREATE POLICY own_data_or_owner_role_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'owner'::text)
    OR (EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_owner_history.lead_id
         AND l.owner_employee_id = (SELECT current_employee_id())
    ))
  );

DROP POLICY IF EXISTS coordinator_team_select ON public.lead_owner_history;
CREATE POLICY coordinator_team_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_coordinator'::text)
    AND (EXISTS (
      SELECT 1 FROM leads l
       WHERE l.id = lead_owner_history.lead_id
         AND l.owner_employee_id = ANY ((SELECT my_team_member_ids())::integer[])
    ))
  );

DROP POLICY IF EXISTS manager_team_select ON public.lead_owner_history;
CREATE POLICY manager_team_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING (
    ((SELECT current_employee_role()) = 'sales_manager'::text)
    AND (EXISTS (
      SELECT 1 FROM leads
       WHERE leads.id = lead_owner_history.lead_id
         AND leads.owner_employee_id = ANY ((SELECT my_managed_member_ids())::integer[])
    ))
  );

-- ---------------------------------------------------------------------------
-- follow_up_change_log
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS visible_with_its_follow_up ON public.follow_up_change_log;
CREATE POLICY visible_with_its_follow_up ON public.follow_up_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM follow_ups f
     WHERE f.id = follow_up_change_log.follow_up_id
       AND (f.assigned_to = (SELECT current_employee_id())
            OR (SELECT current_employee_role()) = 'owner'::text
            OR f.assigned_to = ANY ((SELECT my_team_member_ids())::integer[]))
  ));

-- ---------------------------------------------------------------------------
-- Small own-row tables — wrapped for consistency.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS own_data_insert ON public.employee_preferences;
CREATE POLICY own_data_insert ON public.employee_preferences
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (employee_id = (SELECT current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.employee_preferences;
CREATE POLICY own_data_or_owner_role_select ON public.employee_preferences
  AS PERMISSIVE FOR SELECT TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_update ON public.employee_preferences;
CREATE POLICY own_data_update ON public.employee_preferences
  AS PERMISSIVE FOR UPDATE TO public
  USING (employee_id = (SELECT current_employee_id()))
  WITH CHECK (employee_id = (SELECT current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_insert ON public.plans;
CREATE POLICY own_data_or_owner_role_insert ON public.plans
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.plans;
CREATE POLICY own_data_or_owner_role_select ON public.plans
  AS PERMISSIVE FOR SELECT TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_or_owner_role_update ON public.plans;
CREATE POLICY own_data_or_owner_role_update ON public.plans
  AS PERMISSIVE FOR UPDATE TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text))
  WITH CHECK ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS owner_only_delete ON public.plans;
CREATE POLICY owner_only_delete ON public.plans
  AS PERMISSIVE FOR DELETE TO public
  USING ((SELECT current_employee_role()) = 'owner'::text);

DROP POLICY IF EXISTS own_data_delete ON public.push_subscriptions;
CREATE POLICY own_data_delete ON public.push_subscriptions
  AS PERMISSIVE FOR DELETE TO public
  USING (employee_id = (SELECT current_employee_id()));

DROP POLICY IF EXISTS own_data_insert ON public.push_subscriptions;
CREATE POLICY own_data_insert ON public.push_subscriptions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (employee_id = (SELECT current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.push_subscriptions;
CREATE POLICY own_data_or_owner_role_select ON public.push_subscriptions
  AS PERMISSIVE FOR SELECT TO public
  USING ((employee_id = (SELECT current_employee_id())) OR ((SELECT current_employee_role()) = 'owner'::text));

DROP POLICY IF EXISTS own_data_update ON public.push_subscriptions;
CREATE POLICY own_data_update ON public.push_subscriptions
  AS PERMISSIVE FOR UPDATE TO public
  USING (employee_id = (SELECT current_employee_id()))
  WITH CHECK (employee_id = (SELECT current_employee_id()));

-- ---------------------------------------------------------------------------
-- last_activity_per_lead() — one row per lead, computed here instead of in
-- the browser. SECURITY INVOKER: every viewer gets exactly what their RLS on
-- `activities` allows, which is what downloading every row gave them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.last_activity_per_lead()
RETURNS TABLE (lead_id integer, created_at timestamp without time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT a.lead_id, MAX(a.created_at)
    FROM activities a
   WHERE a.lead_id IS NOT NULL
   GROUP BY a.lead_id;
$$;

REVOKE ALL ON FUNCTION public.last_activity_per_lead() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.last_activity_per_lead() TO authenticated;

COMMIT;

-- PostgREST caches the list of functions; tell it about the new one.
NOTIFY pgrst, 'reload schema';

-- Quick check (optional): every policy this file touched, with its new text.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('parties','sites','employees','products','areas','site_contacts','loss_reasons',
                     'targets','lead_change_log','lead_owner_history','follow_up_change_log',
                     'employee_preferences','plans','push_subscriptions')
 ORDER BY tablename, policyname;
