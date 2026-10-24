-- Extensions and the private schema for internal helpers.
--
-- `private` is not exposed through the Data API, so nothing in it can be called directly by a
-- browser. Business functions in `public` (T6+) are SECURITY DEFINER and call these helpers.
--
-- pgTAP is NOT installed here: it is test-only and each test file creates it inside its own
-- rolled-back transaction. pg_cron is added in P2, when the first scheduled job exists.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Keeps updated_at current on every business table.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blocks UPDATE and DELETE on append-only tables (history, audit log).
create function private.prevent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY: % rows cannot be changed or deleted', tg_table_name
    using errcode = 'P0001';
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
