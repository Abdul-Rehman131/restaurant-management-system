-- Own password (S6): a temporary password (new or reset account) must be changed before any API
-- call works: my_role() is NULL (RLS, Realtime) and require_role raises
-- PASSWORD_CHANGE_REQUIRED (RPCs), Admins included; my_account() still answers for the
-- screens. account_password_changed (service_role only, via the `account` Edge Function)
-- clears the flag, audits it, ends the other sessions and replays a retry. Also: my_role()
-- needs aal2 for an Admin, so a password-only Admin session reads nothing.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(30);

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

select tests.create_staff('op.admin', 'admin') as admin \gset
select tests.create_staff('op.admin2', 'admin') as admin2 \gset
select tests.create_staff('op.waiter', 'waiter') as waiter \gset
select tests.create_staff('op.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(941) as t1 \gset

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
    v := case when sqlstate = 'XTEST' then 'ok'
              when sqlstate = '42501' and sqlerrm like 'permission denied%' then 'PERMISSION_DENIED'
              else sqlerrm end;
  end;
  perform tests.logout();
  return v;
end;
$f$;

-- An Admin RPC at aal1 for p_user: 'ok' or the error.
create function tests.outcome_aal_free(p_user uuid) returns text language plpgsql as $f$
declare v text;
begin
  begin
    perform tests.login_as(p_user, 'aal1');
    perform public.admin_menu();
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v := case when sqlstate = 'XTEST' then 'ok' else sqlerrm end;
  end;
  perform tests.logout();
  return v;
end;
$f$;

-- ===== The flag is set by the Admin's temporary passwords =====
select is((select must_change_password from public.profiles where id = :'waiter'), false,
  'an existing account has no pending change');
insert into auth.users (id, email, aud, role)
values (gen_random_uuid(), public.staff_login_email('op.new'), 'authenticated', 'authenticated')
returning id as newbie \gset
select tests.as_service(format(
  $$ select public.staff_admin_create(%L, gen_random_uuid(), %L, 'op.new', 'New Person', null, 'waiter') $$,
  :'admin', :'newbie')) as created \gset
select is((select must_change_password from public.profiles where id = :'newbie'), true,
  'a new account must change its temporary password');
select tests.as_service(format(
  $$ select public.staff_admin_password_reset(%L, gen_random_uuid(), %L) $$, :'admin', :'waiter')) as reset \gset
select is((select must_change_password from public.profiles where id = :'waiter'), true,
  'a reset account must change it again');

-- ===== Refused everywhere while pending =====
select tests.login_as(:'waiter');
select is(public.my_role(), null, 'my_role() is NULL while a password change is pending');
select is((select count(*)::int from public.restaurant_tables), 0, 'RLS reads return nothing');
select is((select count(*)::int from public.categories), 0, 'not even the menu');
select is(public.my_account(),
  '{"active": true, "role": "waiter", "mfa_step": false, "password_change": true, "admin_mfa": true}'::jsonb,
  'my_account() tells the screens to ask for the new password');
select tests.logout();
select is(tests.outcome_as(:'waiter', 'select public.get_settings()'), 'PASSWORD_CHANGE_REQUIRED',
  'an RPC read is refused with PASSWORD_CHANGE_REQUIRED');
select is(tests.outcome_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, '[]') $$, :'t1')),
  'PASSWORD_CHANGE_REQUIRED', 'and an RPC write');

-- Admins included; the MFA step is asked first.
update public.profiles set must_change_password = true where id = :'admin2';
select is(tests.outcome_as(:'admin2', 'select public.admin_menu()'), 'PASSWORD_CHANGE_REQUIRED',
  'an Admin with a temporary password is refused at aal2');
select tests.login_as(:'admin2', 'aal1');
select is(public.my_account() ->> 'mfa_step', 'true', 'at aal1 the MFA step comes first');
select tests.logout();
select is(tests.outcome_aal_free(:'admin2'), 'MFA_REQUIRED', 'require_role asks for MFA before the password');

-- ===== A password-only Admin session reads nothing (S6) =====
select tests.login_as(:'admin', 'aal1');
select is(public.my_role(), null, 'my_role() is NULL for an Admin at aal1');
select is((select count(*)::int from public.audit_log), 0, 'so the audit log is not readable');
select is((select count(*)::int from public.payments), 0, 'nor payments');
select tests.logout();
select tests.login_as(:'admin');
select ok((select count(*) from public.audit_log) > 0, 'at aal2 the Admin reads them');
select tests.logout();

-- ===== The change itself (service_role, after the Edge Function set the new password) =====
select is(tests.outcome_as(:'waiter', format(
  $$ select public.account_password_changed(%L, gen_random_uuid(), null) $$, :'waiter')),
  'PERMISSION_DENIED', 'the browser cannot clear the flag itself');
select is(tests.outcome_as(:'waiter', format(
  $$ select public.account_password_replay(%L, gen_random_uuid()) $$, :'waiter')),
  'PERMISSION_DENIED', 'nor look up a replay');

insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'waiter') returning id as keep \gset
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'waiter'), (gen_random_uuid(), :'waiter');
select gen_random_uuid() as req \gset
select is(tests.as_service(format($$ select public.account_password_replay(%L, %L) $$, :'waiter', :'req')),
  null, 'a new request id has no stored result');
select tests.as_service(format($$ select public.account_password_changed(%L, %L, %L) $$,
  :'waiter', :'req', :'keep')) as changed \gset
select is(:'changed'::jsonb ->> 'password_change', 'false', 'the change clears the flag');
select is((:'changed'::jsonb ->> 'sessions_revoked')::int, 2, 'and ends the other two sessions');
select is((select array_agg(id) from auth.sessions where user_id = :'waiter'), array[:'keep']::uuid[],
  'the session that changed it stays signed in');
select is((select user_id from public.audit_log where action = 'staff.password_changed' and target_id = :'waiter'),
  :'waiter'::uuid, 'staff.password_changed is in the audit log as the person');
select is(tests.as_service(format($$ select public.account_password_changed(%L, %L, %L) $$,
  :'waiter', :'req', :'keep')) ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.as_service(format($$ select public.account_password_replay(%L, %L) $$, :'waiter', :'req')) ->> 'replayed',
  'true', 'and the Edge Function finds it before checking the old password again');
select tests.login_as(:'waiter');
select is(public.my_role()::text, 'waiter', 'after the change my_role() works again');
select ok((select count(*) from public.restaurant_tables) > 0, 'and RLS reads return rows');
select tests.logout();
select is(tests.outcome_as(:'waiter', 'select public.get_settings()'), 'ok', 'and RPCs work');

select is(tests.outcome_service(format($$ select public.account_password_changed(%L, gen_random_uuid(), null) $$, :'former')),
  'NOT_AUTHORIZED', 'a deactivated account cannot change its password');
select is(tests.outcome_service($$ select public.account_password_changed(null, gen_random_uuid(), null) $$),
  'NOT_AUTHORIZED', 'nor an unknown one');

select * from finish();
rollback;
