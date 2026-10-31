-- ops_demo_account and keep_password (staging demo accounts with fixed passwords): service_role
-- only; the account then never has a temporary password pending, not even after an Admin's
-- reset; audited once; refused for unknown and deactivated accounts; no app role reads the flag.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(16);

grant usage on schema tests to service_role;

create function tests.as_service(p_sql text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  execute p_sql into v;
  perform tests.logout();
  return v;
end;
$f$;
create function tests.outcome_service(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    execute 'set local role service_role';
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v := case when sqlstate = 'XTEST' then 'ok' else sqlerrm end;
  end;
  perform tests.logout();
  return v;
end;
$f$;
grant execute on all functions in schema tests to service_role;

select tests.create_staff('da.admin', 'admin') as admin \gset
select tests.create_staff('da.cashier', 'cashier') as cashier \gset
select tests.create_staff('da.waiter', 'waiter') as waiter \gset
select tests.create_staff('da.chef', 'chef') as chef \gset
select tests.create_staff('da.rider', 'rider') as rider \gset
select tests.create_staff('da.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';

-- Only service_role.
select is(tests.outcome_as(:'admin', format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'an Admin cannot call it');
select is(tests.outcome_as(:'cashier', format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'a cashier cannot');
select is(tests.outcome_as(:'waiter', format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'a waiter cannot, not even for self');
select is(tests.outcome_as(:'chef', format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'a chef cannot');
select is(tests.outcome_as(:'rider', format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'a rider cannot');
select is(tests.outcome_as(null, format($$ select public.ops_demo_account(%L, 'X Y') $$, :'waiter')),
  'PERMISSION_DENIED', 'anon cannot');
select is(tests.outcome_as(:'admin', 'select keep_password from public.profiles'),
  'PERMISSION_DENIED', 'no app role can read the flag');

-- A temporary password is pending (a new or reset account) until it is a demo account.
update public.profiles set must_change_password = true where id = :'waiter';
select is(tests.outcome_as(:'waiter', 'select public.get_settings()'), 'PASSWORD_CHANGE_REQUIRED',
  'before: the temporary password must be changed');
select is(tests.as_service(format($$ select public.ops_demo_account(%L, 'Demo Waiter One') $$, :'waiter')),
  '{"username": "da.waiter", "role": "waiter"}'::jsonb, 'service_role marks it a demo account');
select is((select format('%s %s %s', full_name, keep_password, must_change_password) from public.profiles where id = :'waiter'),
  'Demo Waiter One t f', 'with the demo name, keep_password and nothing pending');
select is(tests.outcome_as(:'waiter', 'select public.get_settings()'), 'ok', 'after: the waiter works at once');
select is((select count(*)::int from public.audit_log where action = 'staff.demo_account' and target_id = :'waiter'::text),
  1, 'it is in the audit log');

-- An Admin's reset still sets the flag, but a demo password is never treated as temporary.
update public.profiles set must_change_password = true where id = :'waiter';
select is(tests.outcome_as(:'waiter', 'select public.get_settings()'), 'ok',
  'a reset demo account is not forced to change its password');

-- Running it again changes nothing more.
update public.profiles set must_change_password = false where id = :'waiter';
select tests.as_service(format($$ select public.ops_demo_account(%L, 'Demo Waiter One') $$, :'waiter'));
select is((select count(*)::int from public.audit_log where action = 'staff.demo_account' and target_id = :'waiter'::text),
  1, 'a second run writes no second audit entry');

select is(tests.outcome_service(format($$ select public.ops_demo_account(%L, 'X Y') $$, :'former')),
  'STAFF_INACTIVE', 'a deactivated account is refused');
select is(tests.outcome_service($$ select public.ops_demo_account(gen_random_uuid(), 'X Y') $$),
  'STAFF_NOT_FOUND', 'an unknown account is refused');

select * from finish();
rollback;
