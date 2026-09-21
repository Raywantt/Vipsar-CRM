-- ============================================================
-- MIGRATION: self-healing for the "current transaction is aborted" outage
-- (2026-09-21). Run in: Supabase dashboard → SQL Editor. Safe to re-run.
--
-- WHAT HAPPENED. Three times now, every screen (the login lookup included)
-- failed with "current transaction is aborted, commands ignored until end of
-- transaction block" (SQLSTATE 25P02), for every employee at once, and then
-- recovered on its own. Reproduced live on 2026-09-21 ~06:23 UTC: a burst of
-- ~100+ simultaneous requests (five logged-in browser tabs reloading at once —
-- the same shape as the whole team opening the app at 10am) left PostgREST's
-- pooled database connections inside a FAILED transaction that never ended.
-- Every request handed such a connection is refused at its very first
-- statement, even an anonymous one that touches no data. It cleared ~1 minute
-- after the burst stopped, when PostgREST retired its idle connections.
--
-- WHAT THIS DOES. A small scheduled job that closes any API connection stuck
-- inside a transaction for longer than a real request could ever take.
-- PostgREST notices the closed connection and opens a fresh one, so an
-- outage that used to last until traffic died down now lasts at most ~30s.
--
-- WHY IT IS SAFE.
--   * Only `authenticator` connections (PostgREST's own login) are touched —
--     never the SQL Editor, the dashboard, cron, or the Edge Function's
--     direct work.
--   * Only a connection that is IDLE inside a transaction that started over
--     30 seconds ago. PostgREST runs each request as one transaction back to
--     back with no pauses, and app queries are cut off at 8 seconds
--     (statement_timeout), so a healthy request is never in this state.
--   * The function lives in a private schema (`ops`) the API does not expose,
--     and EXECUTE is revoked from everyone but the owner, so no logged-in
--     user can call it.
--
-- This is the SAFETY NET, not the fix. The fix is the app sending far fewer,
-- lighter requests per screen, which removes the bursts that trigger this.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION ops.close_stuck_api_connections()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  closed integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT pid, state, now() - xact_start AS age, left(query, 120) AS last_query
      FROM pg_stat_activity
     WHERE usename = 'authenticator'
       AND xact_start < now() - interval '30 seconds'
       AND (
             -- A failed transaction nobody ended: broken, whatever else is
             -- true. Deliberately no idle-time condition — under steady
             -- traffic a poisoned connection is re-handed out every second
             -- or two, so it never looks idle for long.
             state = 'idle in transaction (aborted)'
             -- An open transaction simply left waiting: only once it has
             -- also sat untouched for a while.
          OR (state = 'idle in transaction' AND state_change < now() - interval '10 seconds')
           )
  LOOP
    IF pg_terminate_backend(r.pid) THEN
      closed := closed + 1;
      -- Shows up in Supabase → Logs → Postgres, so each rescue is visible.
      RAISE LOG 'ops.close_stuck_api_connections: closed pid % (%; open %; last: %)',
        r.pid, r.state, r.age, r.last_query;
    END IF;
  END LOOP;
  RETURN closed;
END;
$$;

REVOKE ALL ON FUNCTION ops.close_stuck_api_connections() FROM PUBLIC, anon, authenticated;

-- Every 30 seconds. pg_cron 1.5+ understands 'N seconds'; if this line errors
-- with an invalid schedule, the diagnostic showed an older pg_cron — use
-- '* * * * *' (every minute) instead.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'close-stuck-api-connections';
SELECT cron.schedule(
  'close-stuck-api-connections',
  '30 seconds',
  $$SELECT ops.close_stuck_api_connections()$$
);

-- CHECK (run after): expect one row, active = true.
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'close-stuck-api-connections';
--
-- Did it ever have to step in? (Supabase → Logs → Postgres, search for
-- "close_stuck_api_connections".) Or here:
-- SELECT start_time, status, return_message FROM cron.job_run_details
--  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'close-stuck-api-connections')
--  ORDER BY start_time DESC LIMIT 20;
--
-- UNDO:
-- SELECT cron.unschedule('close-stuck-api-connections');
-- DROP FUNCTION IF EXISTS ops.close_stuck_api_connections();
