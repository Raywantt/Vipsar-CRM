-- ============================================================================
-- UNDO for Schema/migration_rls_per_row_fixes.sql — puts back EXACTLY the
-- policies that were live on 2026-09-22 (generated from the owner's
-- catalogue dump, backup/logs/Database_counting.csv), then drops the new
-- functions. Only needed if the speed fix ever has to be reverted.
-- Supabase → SQL Editor → paste → Run. One transaction.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS team_scoped_select ON public.parties;
CREATE POLICY team_scoped_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = ANY (ARRAY['owner'::text, 'sales_coordinator'::text])) OR (created_by = ( SELECT current_employee_id() AS current_employee_id)) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.owner_employee_id = ( SELECT current_employee_id() AS current_employee_id)) AND ((l.party_id = parties.id) OR (l.referred_by_party_id = parties.id) OR (l.other_party_id = parties.id))))) OR (EXISTS ( SELECT 1
   FROM activities a
  WHERE ((a.party_id = parties.id) AND (a.employee_id = ( SELECT current_employee_id() AS current_employee_id))))) OR (EXISTS ( SELECT 1
   FROM (site_contacts sc
     JOIN leads l2 ON ((l2.site_id = sc.site_id)))
  WHERE ((sc.party_id = parties.id) AND (l2.owner_employee_id = ( SELECT current_employee_id() AS current_employee_id)))))));

DROP POLICY IF EXISTS manager_team_select ON public.parties;
CREATE POLICY manager_team_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = 'sales_manager'::text) AND ((EXISTS ( SELECT 1
   FROM leads l
  WHERE (( SELECT is_my_managed_member(l.owner_employee_id) AS is_my_managed_member) AND ((l.party_id = parties.id) OR (l.referred_by_party_id = parties.id) OR (l.other_party_id = parties.id))))) OR (EXISTS ( SELECT 1
   FROM (site_contacts sc
     JOIN leads l2 ON ((l2.site_id = sc.site_id)))
  WHERE ((sc.party_id = parties.id) AND ( SELECT is_my_managed_member(l2.owner_employee_id) AS is_my_managed_member)))))));

DROP POLICY IF EXISTS bdm_sourced_select ON public.parties;
CREATE POLICY bdm_sourced_select ON public.parties
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = 'business_development_manager'::text) AND ((EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.bdm_employee_id = ( SELECT current_employee_id() AS current_employee_id)) AND ((l.party_id = parties.id) OR (l.referred_by_party_id = parties.id) OR (l.other_party_id = parties.id))))) OR (EXISTS ( SELECT 1
   FROM (site_contacts sc
     JOIN leads l2 ON ((l2.site_id = sc.site_id)))
  WHERE ((sc.party_id = parties.id) AND (l2.bdm_employee_id = ( SELECT current_employee_id() AS current_employee_id))))))));

DROP POLICY IF EXISTS manager_team_select ON public.sites;
CREATE POLICY manager_team_select ON public.sites
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = 'sales_manager'::text) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.site_id = sites.id) AND ( SELECT is_my_managed_member(l.owner_employee_id) AS is_my_managed_member))))));

DROP POLICY IF EXISTS authenticated_select ON public.employees;
CREATE POLICY authenticated_select ON public.employees
  AS PERMISSIVE FOR SELECT TO public
  USING ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS owner_only_delete ON public.employees;
CREATE POLICY owner_only_delete ON public.employees
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_insert ON public.employees;
CREATE POLICY owner_only_insert ON public.employees
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_update ON public.employees;
CREATE POLICY owner_only_update ON public.employees
  AS PERMISSIVE FOR UPDATE TO public
  USING ((current_employee_role() = 'owner'::text))
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS authenticated_select ON public.products;
CREATE POLICY authenticated_select ON public.products
  AS PERMISSIVE FOR SELECT TO public
  USING ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS owner_only_delete ON public.products;
CREATE POLICY owner_only_delete ON public.products
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_insert ON public.products;
CREATE POLICY owner_only_insert ON public.products
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_update ON public.products;
CREATE POLICY owner_only_update ON public.products
  AS PERMISSIVE FOR UPDATE TO public
  USING ((current_employee_role() = 'owner'::text))
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS authenticated_insert ON public.areas;
CREATE POLICY authenticated_insert ON public.areas
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS authenticated_select ON public.areas;
CREATE POLICY authenticated_select ON public.areas
  AS PERMISSIVE FOR SELECT TO public
  USING ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS owner_only_delete ON public.areas;
CREATE POLICY owner_only_delete ON public.areas
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_update ON public.areas;
CREATE POLICY owner_only_update ON public.areas
  AS PERMISSIVE FOR UPDATE TO public
  USING ((current_employee_role() = 'owner'::text))
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS authenticated_insert ON public.site_contacts;
CREATE POLICY authenticated_insert ON public.site_contacts
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS authenticated_select ON public.site_contacts;
CREATE POLICY authenticated_select ON public.site_contacts
  AS PERMISSIVE FOR SELECT TO public
  USING ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS owner_only_delete ON public.site_contacts;
CREATE POLICY owner_only_delete ON public.site_contacts
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS owner_only_update ON public.site_contacts;
CREATE POLICY owner_only_update ON public.site_contacts
  AS PERMISSIVE FOR UPDATE TO public
  USING ((current_employee_role() = 'owner'::text))
  WITH CHECK ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS coordinator_team_update ON public.site_contacts;
CREATE POLICY coordinator_team_update ON public.site_contacts
  AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.site_id = site_contacts.site_id) AND is_my_team_member(leads.owner_employee_id)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.site_id = site_contacts.site_id) AND is_my_team_member(leads.owner_employee_id)))));

DROP POLICY IF EXISTS authenticated_insert ON public.loss_reasons;
CREATE POLICY authenticated_insert ON public.loss_reasons
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS owner_only_select ON public.loss_reasons;
CREATE POLICY owner_only_select ON public.loss_reasons
  AS PERMISSIVE FOR SELECT TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS manager_team_select ON public.loss_reasons;
CREATE POLICY manager_team_select ON public.loss_reasons
  AS PERMISSIVE FOR SELECT TO public
  USING (((current_employee_role() = 'sales_manager'::text) AND (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = loss_reasons.lead_id) AND (is_my_managed_member(l.owner_employee_id) OR (l.owner_employee_id = current_employee_id())))))));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.targets;
CREATE POLICY own_data_or_owner_role_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_or_owner_role_insert ON public.targets;
CREATE POLICY own_data_or_owner_role_insert ON public.targets
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_or_owner_role_update ON public.targets;
CREATE POLICY own_data_or_owner_role_update ON public.targets
  AS PERMISSIVE FOR UPDATE TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)))
  WITH CHECK (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS owner_only_delete ON public.targets;
CREATE POLICY owner_only_delete ON public.targets
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS coordinator_team_select ON public.targets;
CREATE POLICY coordinator_team_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = 'sales_coordinator'::text) AND ( SELECT is_my_team_member(targets.employee_id) AS is_my_team_member)));

DROP POLICY IF EXISTS manager_team_select ON public.targets;
CREATE POLICY manager_team_select ON public.targets
  AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT current_employee_role() AS current_employee_role) = 'sales_manager'::text) AND ( SELECT is_my_managed_member(targets.employee_id) AS is_my_managed_member)));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.lead_change_log;
CREATE POLICY own_data_or_owner_role_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING (((current_employee_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_change_log.lead_id) AND (leads.owner_employee_id = current_employee_id()))))));

DROP POLICY IF EXISTS coordinator_team_select ON public.lead_change_log;
CREATE POLICY coordinator_team_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = lead_change_log.lead_id) AND is_my_team_member(l.owner_employee_id)))));

DROP POLICY IF EXISTS manager_team_select ON public.lead_change_log;
CREATE POLICY manager_team_select ON public.lead_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_change_log.lead_id) AND is_my_managed_member(leads.owner_employee_id)))));

DROP POLICY IF EXISTS authenticated_insert ON public.lead_owner_history;
CREATE POLICY authenticated_insert ON public.lead_owner_history
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((current_employee_role() IS NOT NULL));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.lead_owner_history;
CREATE POLICY own_data_or_owner_role_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING (((current_employee_role() = 'owner'::text) OR (EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = lead_owner_history.lead_id) AND (l.owner_employee_id = current_employee_id()))))));

DROP POLICY IF EXISTS coordinator_team_select ON public.lead_owner_history;
CREATE POLICY coordinator_team_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM leads l
  WHERE ((l.id = lead_owner_history.lead_id) AND is_my_team_member(l.owner_employee_id)))));

DROP POLICY IF EXISTS manager_team_select ON public.lead_owner_history;
CREATE POLICY manager_team_select ON public.lead_owner_history
  AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM leads
  WHERE ((leads.id = lead_owner_history.lead_id) AND is_my_managed_member(leads.owner_employee_id)))));

DROP POLICY IF EXISTS visible_with_its_follow_up ON public.follow_up_change_log;
CREATE POLICY visible_with_its_follow_up ON public.follow_up_change_log
  AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM follow_ups f
  WHERE ((f.id = follow_up_change_log.follow_up_id) AND ((f.assigned_to = current_employee_id()) OR (current_employee_role() = 'owner'::text) OR is_my_team_member(f.assigned_to))))));

DROP POLICY IF EXISTS own_data_insert ON public.employee_preferences;
CREATE POLICY own_data_insert ON public.employee_preferences
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((employee_id = current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.employee_preferences;
CREATE POLICY own_data_or_owner_role_select ON public.employee_preferences
  AS PERMISSIVE FOR SELECT TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_update ON public.employee_preferences;
CREATE POLICY own_data_update ON public.employee_preferences
  AS PERMISSIVE FOR UPDATE TO public
  USING ((employee_id = current_employee_id()))
  WITH CHECK ((employee_id = current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_insert ON public.plans;
CREATE POLICY own_data_or_owner_role_insert ON public.plans
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.plans;
CREATE POLICY own_data_or_owner_role_select ON public.plans
  AS PERMISSIVE FOR SELECT TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_or_owner_role_update ON public.plans;
CREATE POLICY own_data_or_owner_role_update ON public.plans
  AS PERMISSIVE FOR UPDATE TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)))
  WITH CHECK (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS owner_only_delete ON public.plans;
CREATE POLICY owner_only_delete ON public.plans
  AS PERMISSIVE FOR DELETE TO public
  USING ((current_employee_role() = 'owner'::text));

DROP POLICY IF EXISTS own_data_delete ON public.push_subscriptions;
CREATE POLICY own_data_delete ON public.push_subscriptions
  AS PERMISSIVE FOR DELETE TO public
  USING ((employee_id = current_employee_id()));

DROP POLICY IF EXISTS own_data_insert ON public.push_subscriptions;
CREATE POLICY own_data_insert ON public.push_subscriptions
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((employee_id = current_employee_id()));

DROP POLICY IF EXISTS own_data_or_owner_role_select ON public.push_subscriptions;
CREATE POLICY own_data_or_owner_role_select ON public.push_subscriptions
  AS PERMISSIVE FOR SELECT TO public
  USING (((employee_id = current_employee_id()) OR (current_employee_role() = 'owner'::text)));

DROP POLICY IF EXISTS own_data_update ON public.push_subscriptions;
CREATE POLICY own_data_update ON public.push_subscriptions
  AS PERMISSIVE FOR UPDATE TO public
  USING ((employee_id = current_employee_id()))
  WITH CHECK ((employee_id = current_employee_id()));

DROP FUNCTION IF EXISTS public.my_linked_party_ids();
DROP FUNCTION IF EXISTS public.my_managed_party_ids();
DROP FUNCTION IF EXISTS public.my_bdm_party_ids();
DROP FUNCTION IF EXISTS public.last_activity_per_lead();

COMMIT;

NOTIFY pgrst, 'reload schema';
