-- ============================================================
-- DIAGNOSTIC (read-only — changes nothing): the "current transaction is
-- aborted" outage, 2026-09-21.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this WHOLE file → Run.
-- It is ONE query, so it returns ONE result table (two columns: section,
-- detail). Download that table as CSV and hand it back.
--
-- Sections:
--   1. API connections by state   — are any stuck inside a failed transaction?
--   2. All connections by role    — is anything else hogging the database?
--   3. Role settings              — per-role limits (e.g. statement_timeout)
--   4. Server settings            — memory / connection limits of this plan
--   5. Extensions                 — can a scheduled job clean up stuck connections?
--   6. Table sizes                — how big each table really is
--   7. Top queries by total time  — which app queries eat the database's time
-- ============================================================

with sections as (

  -- 1. PostgREST (the API every screen talks to) logs in as `authenticator`.
  select 1 as n, 0::bigint as k, 'API connections by state' as section,
         format('%s: %s connection(s), oldest open transaction %s',
                coalesce(state, '(none)'), count(*),
                coalesce(max(now() - xact_start)::text, '-')) as detail
    from pg_stat_activity
   where usename = 'authenticator'
   group by state

  union all
  -- 2.
  select 2, 0, 'All connections by role',
         format('%s / %s / %s: %s', usename, coalesce(nullif(application_name, ''), '-'),
                coalesce(state, '-'), count(*))
    from pg_stat_activity
   where datname = current_database()
   group by usename, application_name, state

  union all
  -- 3.
  select 3, 0, 'Role settings',
         format('%s: %s', rolname, coalesce(array_to_string(rolconfig, ', '), '(none)'))
    from pg_roles
   where rolname in ('authenticator', 'authenticated', 'anon', 'service_role', 'postgres')

  union all
  -- 4.
  select 4, 0, 'Server settings', format('%s = %s %s', name, setting, coalesce(unit, ''))
    from pg_settings
   where name in ('server_version', 'max_connections', 'shared_buffers', 'work_mem',
                  'effective_cache_size', 'idle_in_transaction_session_timeout')

  union all
  -- 5.
  select 5, 0, 'Extensions', format('%s %s (schema %s)', e.extname, e.extversion, ns.nspname)
    from pg_extension e
    join pg_namespace ns on ns.oid = e.extnamespace
   where e.extname in ('pg_cron', 'pg_net', 'pg_stat_statements')

  union all
  select 5, 1, 'Extensions',
         format('postgres may close other connections: %s',
                pg_has_role('postgres', 'pg_signal_backend', 'member'))

  union all
  -- 6.
  select 6, row_number() over (order by pg_total_relation_size(relid) desc), 'Table sizes',
         format('%s: %s rows, %s', relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)))
    from pg_stat_user_tables
   where schemaname = 'public'

  union all
  -- 7. Since the stats were last reset.
  select 7, 0, 'Top queries by total time',
         format('(stats collected since %s)', stats_reset)
    from pg_stat_statements_info

  union all
  select 7, row_number() over (order by s.total_exec_time desc), 'Top queries by total time',
         format('%s calls | total %s s | avg %s ms | max %s ms | %s',
                s.calls,
                round((s.total_exec_time / 1000)::numeric, 1),
                round(s.mean_exec_time::numeric),
                round(s.max_exec_time::numeric),
                left(regexp_replace(s.query, '\s+', ' ', 'g'), 400))
    from pg_stat_statements s
   where s.userid in (select oid from pg_roles
                       where rolname in ('authenticator', 'authenticated', 'anon', 'service_role'))
)
select section, detail
  from sections
 where not (n = 6 and k > 20)
   and not (n = 7 and k > 30)
 order by n, k, detail;
