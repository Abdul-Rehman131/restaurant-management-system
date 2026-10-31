-- ops_password_reset: the operator's password reset behind
-- `pnpm seed:staging -- --reset-password=<username>`. service_role only; sets the temporary-
-- password flag, ends every session, audits it, replays a retry; refused for every staff role,
-- anon, an unknown and a deactivated account.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

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

-- Again, for the two helpers just created.
grant execute on all functions in schema tests to service_role;

select tests.create_staff('rp.admin', 'admin') as admin \gset
select tests.create_staff('rp.cashier', 'cashier') as cashier \gset
select tests.create_staff('rp.waiter', 'waiter') as waiter \gset
select tests.create_staff('rp.chef', 'chef') as chef \gset
select tests.create_staff('rp.rider', 'rider') as rider \gset
select tests.create_staff('rp.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';
select gen_random_uuid() as req \gset

-- Nobody but service_role can call it: not even an Admin (an Admin uses Staff, reset password).
select is(tests.outcome_as(:'admin', format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'an Admin cannot call it');
select is(tests.outcome_as(:'cashier', format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'a cashier cannot');
select is(tests.outcome_as(:'waiter', format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'a waiter cannot, not even for self');
select is(tests.outcome_as(:'chef', format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'a chef cannot');
select is(tests.outcome_as(:'rider', format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'a rider cannot');
select is(tests.outcome_as(null, format('select public.ops_password_reset(gen_random_uuid(), %L)', :'waiter')),
  'PERMISSION_DENIED', 'anon cannot');

-- service_role: the Admin's password becomes temporary and every session ends.
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'admin'), (gen_random_uuid(), :'admin');
select is(tests.as_service(format($$ select public.ops_password_reset(%L, %L) $$, :'req', :'admin')) ->> 'sessions_revoked',
  '2', 'service_role resets it and ends both sessions');
select is((select must_change_password from public.profiles where id = :'admin'), true,
  'the password must be changed at the next sign-in');
select is((select count(*)::int from auth.sessions where user_id = :'admin'), 0, 'no session is left');
select is((select reason from public.audit_log where action = 'staff.password_reset' and target_id = :'admin'::text),
  'operator reset (pnpm seed:staging --reset-password)', 'the audit log records an operator reset');
select is(tests.outcome_as(:'admin', 'select public.admin_menu()'), 'PASSWORD_CHANGE_REQUIRED',
  'until the change, the Admin''s RPCs are refused');

-- A retry with the same request id replays the first answer and changes nothing more.
select is(tests.as_service(format($$ select public.ops_password_reset(%L, %L) $$, :'req', :'admin')) ->> 'replayed',
  'true', 'a retry replays');
select is((select count(*)::int from public.audit_log where action = 'staff.password_reset' and target_id = :'admin'::text),
  1, 'and writes no second audit entry');
select is(tests.outcome_service(format($$ select public.ops_password_reset(%L, %L) $$, :'req', :'waiter')),
  'REQUEST_ID_CONFLICT', 'the same request id for another account conflicts');

select is(tests.outcome_service(format($$ select public.ops_password_reset(gen_random_uuid(), %L) $$, :'former')),
  'STAFF_INACTIVE', 'a deactivated account is refused');
select is(tests.outcome_service($$ select public.ops_password_reset(gen_random_uuid(), gen_random_uuid()) $$),
  'STAFF_NOT_FOUND', 'an unknown account is refused');
select is(tests.outcome_service(format($$ select public.ops_password_reset(null, %L) $$, :'waiter')),
  'REQUEST_ID_REQUIRED', 'a request id is required');

select * from finish();
rollback;
