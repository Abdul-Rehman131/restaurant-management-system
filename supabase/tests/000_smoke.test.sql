-- Proves the pgTAP harness runs against the local stack. Real tests start in T4 and T5.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select has_schema('public', 'public schema exists');
select is(
  current_setting('server_version_num')::int / 10000,
  17,
  'Postgres major version is 17 (matches [db] major_version in config.toml and staging)'
);

select * from finish();
rollback;
