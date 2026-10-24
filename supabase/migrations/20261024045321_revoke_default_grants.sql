-- Lock down the API roles (T5). Supabase grants `anon` and `authenticated` ALL privileges on
-- every table, sequence and function that `postgres` creates in `public`, including TRUNCATE,
-- which bypasses RLS. From here on:
--   * anon gets nothing (P2 adds exactly what the public website needs);
--   * authenticated gets only explicit SELECT grants (later migrations) and EXECUTE on an
--     allow-list of RPCs. Writes happen only inside SECURITY DEFINER functions.
--   * service_role (server-side only, never in a browser) keeps its access.
-- Guard tests in supabase/tests/010_security_guards.test.sql fail if any of this regresses.

-- Existing objects
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

-- Future objects created by the migration role
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke all on functions from public, anon, authenticated;
-- Postgres grants EXECUTE on new functions to PUBLIC globally; a per-schema rule cannot remove
-- a global default, so revoke it globally for the migration role.
alter default privileges for role postgres
  revoke execute on functions from public;

-- anon cannot even resolve names in public. USAGE was granted to PUBLIC; authenticated and
-- service_role keep their own explicit USAGE grants.
revoke usage on schema public from public, anon;

-- private is never reachable through the API: it is not in [api].schemas and the API roles
-- have no USAGE on it.
revoke all on schema private from public, anon, authenticated;
