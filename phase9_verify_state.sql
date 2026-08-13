-- ============================================================
-- PHASE 9 — LIVE STATE VERIFICATION (READ ONLY)
--
-- NOT A MIGRATION. This file creates, alters and deletes nothing. It is a
-- single SELECT that reports what is actually installed in the live database,
-- so the audit doesn't have to trust CLAUDE.md's claims about which
-- migrations ran.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste this
-- whole file -> Run. Copy the entire result table back to Claude.
--
-- Reads pg_proc / pg_trigger / pg_policies / pg_class / information_schema
-- only. Safe to run any number of times.
-- ============================================================

WITH checks AS (

  -- ---------- helper functions (rls_policies.sql STEP A2 + coordinator STEP 3) ----------
  SELECT 10 AS ord, 'fn current_employee_id exists' AS item,
         '1' AS expected, count(*)::text AS actual
    FROM pg_proc WHERE proname = 'current_employee_id'

  UNION ALL SELECT 11, 'fn current_employee_role exists',
         '1', count(*)::text FROM pg_proc WHERE proname = 'current_employee_role'

  UNION ALL SELECT 12, 'fn is_my_team_member exists',
         '1', count(*)::text FROM pg_proc WHERE proname = 'is_my_team_member'

  UNION ALL SELECT 13, 'helpers are SECURITY DEFINER',
         '3', count(*)::text FROM pg_proc
   WHERE proname IN ('current_employee_id','current_employee_role','is_my_team_member')
     AND prosecdef

  -- ---------- role CHECK admits three values ----------
  UNION ALL SELECT 20, 'employees_role_check definition',
         'includes sales_coordinator',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid = 'employees'::regclass
                      AND conname = 'employees_role_check'), 'CONSTRAINT NOT FOUND')

  -- ---------- triggers ----------
  UNION ALL SELECT 30, 'triggers on leads',
         'enforce_coordinator_lock, log_lead_changes_ins, log_lead_changes_upd, owner_only_stage_change, stamp_entered_by_role, stamp_lead_creator',
         COALESCE((SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
                    WHERE tgrelid = 'leads'::regclass AND NOT tgisinternal), '(none)')

  UNION ALL SELECT 31, 'triggers on activities',
         'stamp_activity_logger, stamp_entered_by_role',
         COALESCE((SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
                    WHERE tgrelid = 'activities'::regclass AND NOT tgisinternal), '(none)')

  UNION ALL SELECT 32, 'triggers on employees',
         'validate_employee_role_assignment',
         COALESCE((SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
                    WHERE tgrelid = 'employees'::regclass AND NOT tgisinternal), '(none)')

  -- ---------- stage trigger extends to sales_coordinator (coordinator STEP 8) ----------
  UNION ALL SELECT 40, 'stage trigger allows sales_coordinator',
         'true',
         COALESCE((SELECT (prosrc ILIKE '%sales_coordinator%')::text FROM pg_proc
                    WHERE proname = 'enforce_owner_only_stage_change'), 'FUNCTION NOT FOUND')

  UNION ALL SELECT 41, 'coordinator lock fn exists (STEP 4b)',
         '1', count(*)::text FROM pg_proc WHERE proname = 'enforce_coordinator_lock'

  UNION ALL SELECT 42, 'coordinator lock allowed columns',
         'current_stage, next_followup_date, order_value',
         COALESCE((SELECT substring(prosrc from 'ARRAY\[[^\]]*\]') FROM pg_proc
                    WHERE proname = 'enforce_coordinator_lock'), 'FUNCTION NOT FOUND')

  -- ---------- RLS enabled ----------
  UNION ALL SELECT 50, 'tables with RLS enabled (of 16)',
         '16',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relrowsecurity
             AND c.relname IN ('activities','areas','employees','follow_ups','lead_change_log',
                 'lead_owner_history','leads','loss_reasons','parties','plans','products',
                 'push_subscriptions','site_contacts','sites','stage_history','targets'))

  UNION ALL SELECT 51, 'any of the 16 WITHOUT RLS',
         '(none)',
         COALESCE((SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND NOT c.relrowsecurity
                      AND c.relname IN ('activities','areas','employees','follow_ups','lead_change_log',
                          'lead_owner_history','leads','loss_reasons','parties','plans','products',
                          'push_subscriptions','site_contacts','sites','stage_history','targets')), '(none)')

  -- ---------- per-table policy inventory ----------
  UNION ALL SELECT 60, 'policies: leads', 'own_data_or_owner_role_{select,insert,update} + owner_only_delete + coordinator_team_{select,insert,update}',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='leads'), '(none)')

  UNION ALL SELECT 61, 'policies: activities', 'own_data_* + owner_only_delete + coordinator_team_*',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='activities'), '(none)')

  UNION ALL SELECT 62, 'policies: parties', 'team_scoped_select + authenticated_insert + own_data_or_owner_role_update + owner_only_delete + coordinator_team_update',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='parties'), '(none)')

  UNION ALL SELECT 63, 'policies: sites', 'team_scoped_select + authenticated_insert + own_data_or_owner_role_update + owner_only_delete + coordinator_team_update',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='sites'), '(none)')

  UNION ALL SELECT 64, 'policies: stage_history', 'own_data_or_owner_role_select + owner_only_insert + coordinator_team_{select,insert}; NO update/delete',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='stage_history'), '(none)')

  UNION ALL SELECT 65, 'policies: follow_ups', 'own_data_* + owner_only_delete + coordinator_team_*',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='follow_ups'), '(none)')

  UNION ALL SELECT 66, 'policies: employees', 'authenticated_select + owner_only_{insert,update,delete}',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='employees'), '(none)')

  UNION ALL SELECT 67, 'policies: targets', 'own_data_* + owner_only_delete + coordinator_team_select',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='targets'), '(none)')

  UNION ALL SELECT 68, 'policies: loss_reasons', 'owner_only_select + authenticated_insert ONLY',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='loss_reasons'), '(none)')

  UNION ALL SELECT 69, 'policies: lead_change_log', 'own_data_or_owner_role_select ONLY',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='lead_change_log'), '(none)')

  UNION ALL SELECT 70, 'policies: lead_owner_history', 'authenticated_{select,insert} ONLY',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='lead_owner_history'), '(none)')

  UNION ALL SELECT 71, 'policies: plans', 'own_data_* + owner_only_delete (no SC branch)',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='plans'), '(none)')

  UNION ALL SELECT 72, 'policies: push_subscriptions', 'own_data_or_owner_role_select + own_data_{insert,update,delete}',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions'), '(none)')

  UNION ALL SELECT 73, 'policies: site_contacts', 'authenticated_{select,insert} + owner_only_{update,delete} + coordinator_team_update',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='site_contacts'), '(none)')

  UNION ALL SELECT 74, 'policies: areas', 'authenticated_{select,insert} + owner_only_{update,delete}',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='areas'), '(none)')

  UNION ALL SELECT 75, 'policies: products', 'authenticated_select + owner_only_{insert,update,delete}',
         COALESCE((SELECT string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='products'), '(none)')

  -- ---------- the exec's narrowed parties read actually landed (coordinator STEP 6) ----------
  UNION ALL SELECT 80, 'parties SELECT is team_scoped (not wide open)',
         'true',
         COALESCE((SELECT (qual ILIKE '%created_by%')::text FROM pg_policies
                    WHERE schemaname='public' AND tablename='parties' AND cmd='SELECT' LIMIT 1),
                  'NO SELECT POLICY')

  UNION ALL SELECT 81, 'stage_history SELECT is scoped to own leads',
         'true',
         COALESCE((SELECT (qual ILIKE '%owner_employee_id%')::text FROM pg_policies
                    WHERE schemaname='public' AND tablename='stage_history' AND cmd='SELECT'
                      AND policyname = 'own_data_or_owner_role_select' LIMIT 1),
                  'POLICY NOT FOUND')

  -- ---------- grants ----------
  UNION ALL SELECT 90, 'authenticated DELETE grants',
         'employees,areas,sites,site_contacts,parties,products,leads,activities,plans,targets,follow_ups,push_subscriptions (12) — NOT stage_history/loss_reasons/lead_owner_history/lead_change_log',
         COALESCE((SELECT string_agg(table_name, ',' ORDER BY table_name)
                     FROM information_schema.role_table_grants
                    WHERE grantee='authenticated' AND table_schema='public'
                      AND privilege_type='DELETE'), '(none)')

  UNION ALL SELECT 91, 'authenticated grants on lead_change_log',
         'SELECT only',
         COALESCE((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
                     FROM information_schema.role_table_grants
                    WHERE grantee='authenticated' AND table_schema='public'
                      AND table_name='lead_change_log'), '(none)')

  UNION ALL SELECT 92, 'authenticated grants on stage_history',
         'SELECT,INSERT (no UPDATE/DELETE)',
         COALESCE((SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
                     FROM information_schema.role_table_grants
                    WHERE grantee='authenticated' AND table_schema='public'
                      AND table_name='stage_history'), '(none)')

  UNION ALL SELECT 93, 'tables service_role can SELECT',
         'informational — lead_change_log + lead_owner_history are known missing',
         COALESCE((SELECT string_agg(table_name, ',' ORDER BY table_name)
                     FROM information_schema.role_table_grants
                    WHERE grantee='service_role' AND table_schema='public'
                      AND privilege_type='SELECT'), '(none)')

  -- ---------- indexes the audit depends on ----------
  UNION ALL SELECT 100, 'key indexes present',
         'idx_employees_coordinator, idx_leads_owner, idx_activities_employee*, idx_stage_history_*',
         COALESCE((SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes
                    WHERE schemaname='public'
                      AND indexname IN ('idx_employees_coordinator','idx_leads_owner',
                          'idx_activities_employee','idx_activities_employee_created',
                          'idx_stage_history_stage_changed','idx_stage_history_by_at',
                          'idx_leads_created_by_at','idx_parties_created_by',
                          'idx_sites_discovered_by')), '(none)')

  -- ---------- CHECK constraints the seeder must respect ----------
  UNION ALL SELECT 110, 'activities.activity_type CHECK',
         'includes architect_meeting',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid='activities'::regclass AND conname='activities_activity_type_check'),
                  'NOT FOUND')

  UNION ALL SELECT 111, 'follow_ups.activity_type CHECK',
         'includes architect_meeting + other',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid='follow_ups'::regclass
                      AND pg_get_constraintdef(oid) ILIKE '%activity_type%' LIMIT 1), 'NOT FOUND')

  UNION ALL SELECT 112, 'leads.current_stage DEFAULT',
         'calling',
         COALESCE((SELECT column_default FROM information_schema.columns
                    WHERE table_name='leads' AND column_name='current_stage'), 'NONE')

  UNION ALL SELECT 113, 'targets.period_type CHECK',
         'week,month,quarter,year',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid='targets'::regclass
                      AND pg_get_constraintdef(oid) ILIKE '%period_type%' LIMIT 1), 'NOT FOUND')

  UNION ALL SELECT 114, 'parties.party_type CHECK',
         'includes pmc',
         COALESCE((SELECT pg_get_constraintdef(oid) FROM pg_constraint
                    WHERE conrelid='parties'::regclass AND conname='parties_party_type_check'),
                  'NOT FOUND')
)
SELECT ord, item, expected, actual
  FROM checks
 ORDER BY ord;
