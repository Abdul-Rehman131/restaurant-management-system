-- The Admin MFA switch (settings.require_admin_mfa, default on): on, an Admin below aal2 is
-- refused (MFA_REQUIRED) and my_role() is NULL; off (a staging demo), an Admin works at aal1.
-- Only service_role can flip it (ops_set_require_admin_mfa): no app role, not even an Admin,
-- not through update_settings and not by writing the table. Other roles are never affected.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

grant usage on schema tests to service_role;

select tests.create_staff('ms.admin', 'admin') as admin \gset
select tests.create_staff('ms.cashier', 'cashier') as cashier \gset
select tests.create_staff('ms.waiter', 'waiter') as waiter \gset
select tests.create_staff('ms.chef', 'chef') as chef \gset
select tests.create_staff('ms.rider', 'rider') as rider \gset

-- Runs p_sql as p_user at the given aal, always rolled back; returns 'ok' or the error.
create function tests.outcome_aal(p_user uuid, p_aal text, p_sql text)
returns text language plpgsql as $$
declare
  v_outcome text;
begin
  begin
    perform tests.login_as(p_user, p_aal);
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v_outcome := case when sqlstate = 'XTEST' then 'ok'
                      when sqlstate = '42501' and sqlerrm like 'permission denied%' then 'PERMISSION_DENIED'
                      else sqlerrm end;
  end;
  perform tests.logout();
  return v_outcome;
end;
$$;
create function tests.value_aal(p_user uuid, p_aal text, p_sql text)
returns text language plpgsql as $$
declare
  v text;
begin
  perform tests.login_as(p_user, p_aal);
  execute p_sql into v;
  perform tests.logout();
  return v;
end;
$$;
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
grant execute on all functions in schema tests to service_role;

-- ===== No app role can change it =====
select is(tests.outcome_aal(:'admin', 'aal2', 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'an Admin (aal2) cannot call the switch');
select is(tests.outcome_aal(:'cashier', 'aal1', 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'a cashier cannot');
select is(tests.outcome_aal(:'waiter', 'aal1', 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'a waiter cannot');
select is(tests.outcome_aal(:'chef', 'aal1', 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'a chef cannot');
select is(tests.outcome_aal(:'rider', 'aal1', 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'a rider cannot');
select is(tests.outcome_as(null, 'select public.ops_set_require_admin_mfa(false)'),
  'PERMISSION_DENIED', 'anon cannot');
select isnt(tests.outcome_aal(:'admin', 'aal2',
  $$ select public.update_settings(gen_random_uuid(), '{"require_admin_mfa": false}') $$), 'ok',
  'update_settings does not accept it');
select is(tests.outcome_aal(:'admin', 'aal2', 'update public.settings set require_admin_mfa = false'),
  'PERMISSION_DENIED', 'nor can the table be written');
select is((select require_admin_mfa from public.settings), true, 'it is still on');

-- ===== On (the default) =====
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.admin_menu()'), 'MFA_REQUIRED',
  'on: an aal1 Admin is refused');
select is(tests.value_aal(:'admin', 'aal1', 'select public.my_role()::text'), null,
  'on: my_role() is NULL at aal1 (RLS reads nothing)');
select is(tests.value_aal(:'admin', 'aal1', $$ select public.my_account()::text $$)::jsonb
            - 'role' - 'active' - 'password_change',
  '{"mfa_step": true, "admin_mfa": true}'::jsonb, 'on: my_account() asks for the second step');
select is(tests.outcome_aal(:'admin', 'aal2', 'select public.admin_menu()'), 'ok',
  'on: at aal2 the Admin works');

-- ===== Off (service_role) =====
select is(tests.as_service('select public.ops_set_require_admin_mfa(false)'),
  '{"require_admin_mfa": false, "changed": true}'::jsonb, 'service_role switches it off');
select is((select count(*)::int from public.audit_log where action = 'settings.admin_mfa_changed'), 1,
  'the change is in the audit log');
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.admin_menu()'), 'ok',
  'off: an aal1 Admin works');
select is(tests.value_aal(:'admin', 'aal1', 'select public.my_role()::text'), 'admin',
  'off: my_role() is admin at aal1');
select is(tests.value_aal(:'admin', 'aal1', $$ select public.my_account()::text $$)::jsonb
            - 'role' - 'active' - 'password_change',
  '{"mfa_step": false, "admin_mfa": false}'::jsonb, 'off: no second step, and the menu can say so');
select is(tests.outcome_aal(:'cashier', 'aal1', 'select public.get_open_bills()'), 'ok',
  'off: other roles are unchanged');
update public.profiles set must_change_password = true where id = :'admin';
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.admin_menu()'), 'PASSWORD_CHANGE_REQUIRED',
  'off: a temporary password must still be changed first');
update public.profiles set must_change_password = false where id = :'admin';

select is(tests.as_service('select public.ops_set_require_admin_mfa(false)'),
  '{"require_admin_mfa": false, "changed": false}'::jsonb, 'switching it off again changes nothing');
select is((select count(*)::int from public.audit_log where action = 'settings.admin_mfa_changed'), 1,
  'and writes no second audit entry');

-- ===== Back on =====
select is(tests.as_service('select public.ops_set_require_admin_mfa(true)'),
  '{"require_admin_mfa": true, "changed": true}'::jsonb, 'service_role switches it back on');
select is(tests.outcome_aal(:'admin', 'aal1', 'select public.admin_menu()'), 'MFA_REQUIRED',
  'on again: aal1 is refused');

select * from finish();
rollback;
