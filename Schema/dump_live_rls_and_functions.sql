-- ============================================================================
-- READ-ONLY. Changes nothing. Safe to run at any time, even during work hours:
-- it only reads the database's own catalogue (no table data, no EXPLAIN), so it
-- finishes in well under a second and adds no load.
--
-- What it's for: the database speed work (2026-09-21). Several permission
-- rules are re-checked once per ROW instead of once per request, which is what
-- makes a 2,000-lead read take 1.5 s. To rewrite those rules without undoing
-- anything live, the exact live definitions are needed — the Schema/ files
-- can't be trusted to match (CLAUDE.md, "Verify against the live database").
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. One table comes back (section, name, detail). Download it as a
-- CSV and save it in the project's backup\logs\ folder (git-ignored — this
-- repo is public).
-- ============================================================================

with policies as (
  select
    'policy'::text as section,
    tablename || ' / ' || policyname as name,
    concat_ws(E'\n',
      'permissive: ' || permissive,
      'roles: ' || array_to_string(roles, ','),
      'cmd: ' || cmd,
      'using: ' || coalesce(qual, '-'),
      'with check: ' || coalesce(with_check, '-')
    ) as detail
  from pg_policies
  where schemaname = 'public'
),
functions as (
  select
    'function'::text as section,
    n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
    pg_get_functiondef(p.oid) as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'ops')
    and p.prokind in ('f', 'p')
    -- skip functions that belong to an installed extension
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.deptype = 'e'
    )
),
indexes as (
  select
    'index'::text as section,
    tablename || ' / ' || indexname as name,
    indexdef as detail
  from pg_indexes
  where schemaname = 'public'
),
tables as (
  select
    'table'::text as section,
    c.relname as name,
    concat_ws(E'\n',
      'rows (estimate): ' || c.reltuples::bigint,
      'rls enabled: ' || c.relrowsecurity,
      'size: ' || pg_size_pretty(pg_total_relation_size(c.oid))
    ) as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
grants as (
  select
    'grant'::text as section,
    table_name || ' / ' || grantee as name,
    string_agg(privilege_type, ', ' order by privilege_type) as detail
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated', 'service_role')
  group by table_name, grantee
)
select * from policies
union all select * from functions
union all select * from indexes
union all select * from tables
union all select * from grants
order by section, name;
