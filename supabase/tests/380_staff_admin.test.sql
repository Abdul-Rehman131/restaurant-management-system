-- Staff administration, database half (S5, M1): service_role only, the actor re-checked as an
-- active Admin, create / update / deactivate / reactivate / password reset, the self and
-- last-Admin guards, revoked sessions, audit entries (BR-24) and replays (BR-15).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(45);

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

select tests.create_staff('sa.admin', 'admin') as admin \gset
select tests.create_staff('sa.admin2', 'admin') as admin2 \gset
select tests.create_staff('sa.cashier', 'cashier') as cashier \gset
select tests.create_staff('sa.waiter', 'waiter') as waiter \gset
select tests.create_staff('sa.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';

-- Runs p_sql as service_role (the Edge Function's key), always rolled back: 'ok' or the error.
create function tests.outcome_service(p_sql text) returns text language plpgsql as $$
declare
  v_outcome text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
    execute 'set local role service_role';
    execute p_sql;
    raise exception 'rolled back' using errcode = 'XTEST';
  exception when others then
    v_outcome := case
      when sqlstate = 'XTEST' then 'ok'
      when sqlstate = '42501' and sqlerrm like 'permission denied%' then 'PERMISSION_DENIED'
      else sqlerrm end;
  end;
  perform tests.logout();
  return v_outcome;
end;
$$;
-- Runs p_sql as service_role and keeps its effects; returns its jsonb value.
create function tests.call_service(p_sql text) returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  execute p_sql into v_result;
  perform tests.logout();
  return v_result;
end;
$$;
-- A login without a profile yet, as the Edge Function creates it.
create function tests.login(p_username text) returns uuid language sql as $$
  insert into auth.users (id, email, aud, role)
  values (gen_random_uuid(), public.staff_login_email(p_username), 'authenticated', 'authenticated')
  returning id
$$;
create function tests.create_sql(p_actor uuid, p_user uuid, p_username text, p_role text,
                                 p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.staff_admin_create(%L, %L, %L, %L, 'New Person', '0300 1234567', %L) $f$,
                p_actor, p_request, p_user, p_username, p_role)
$$;
create function tests.active_sql(p_actor uuid, p_user uuid, p_active boolean, p_reason text,
                                 p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.staff_admin_set_active(%L, %L, %L, %L, %L) $f$,
                p_actor, p_request, p_user, p_active, p_reason)
$$;

-- ===== Only the Edge Function (service_role) =====
select is(tests.outcome_as(:'admin', tests.create_sql(:'admin', gen_random_uuid(), 'sa.x', 'waiter')),
  'PERMISSION_DENIED', 'an Admin in the browser cannot call staff_admin_create');
select is(tests.outcome_as(:'admin', tests.active_sql(:'admin', :'waiter', false, 'x')),
  'PERMISSION_DENIED', 'nor staff_admin_set_active');
select is(tests.outcome_as(:'admin', format($$ select public.staff_admin_password_reset(%L, gen_random_uuid(), %L) $$, :'admin', :'waiter')),
  'PERMISSION_DENIED', 'nor staff_admin_password_reset');
select is(tests.outcome_as(null, tests.active_sql(:'admin', :'waiter', false, 'x')), 'PERMISSION_DENIED', 'nor anon');

-- The actor is re-checked: an active Admin.
select is(tests.outcome_service(tests.active_sql(:'cashier', :'waiter', false, 'x')), 'NOT_AUTHORIZED',
  'a cashier as actor is refused');
select is(tests.outcome_service(tests.active_sql(:'former', :'waiter', false, 'x')), 'NOT_AUTHORIZED',
  'a deactivated Admin as actor is refused');
select is(tests.outcome_service(tests.active_sql(null, :'waiter', false, 'x')), 'NOT_AUTHORIZED',
  'no actor is refused');

-- ===== Create =====
select tests.login('sa.newbie') as newbie \gset
select gen_random_uuid() as req_create \gset
select tests.call_service(tests.create_sql(:'admin', :'newbie', '  SA.Newbie ', 'waiter', :'req_create')) as created \gset
select is(:'created'::jsonb -> 'staff' ->> 'username', 'sa.newbie', 'the profile is created, username lower case and trimmed');
select is(:'created'::jsonb -> 'staff' ->> 'role', 'waiter', 'with its role');
select is(:'created'::jsonb -> 'staff' ->> 'phone', '0300 1234567', 'and phone');
select is((select user_id from public.audit_log where action = 'staff.created' and target_id = :'newbie'), :'admin'::uuid,
  'staff.created is in the audit log with the acting Admin (BR-24)');
select is(tests.call_service(tests.create_sql(:'admin', :'newbie', '  SA.Newbie ', 'waiter', :'req_create')) ->> 'replayed',
  'true', 'a retry is a replay');
select is(tests.call_service(format($$ select public.staff_admin_replay(%L, %L, 'staff_admin_create', null, %L) $$,
  :'admin', :'req_create',
  jsonb_build_object('username', '  SA.Newbie ', 'full_name', 'New Person', 'phone', '0300 1234567', 'role', 'waiter')))
  -> 'staff' ->> 'id', :'newbie', 'staff_admin_replay returns the stored result (the Edge Function checks first)');
select is(tests.call_service(format($$ select public.staff_admin_replay(%L, gen_random_uuid(), 'staff_admin_create', null, '{}') $$, :'admin')),
  null, 'and NULL for a new request id');
select is(tests.outcome_service(format($$ select public.staff_admin_replay(%L, gen_random_uuid(), 'staff_admin_update', null, '{}') $$, :'admin')),
  'REQUEST_ID_CONFLICT', 'only create and password reset replays can be looked up');

select tests.login('sa.other') as other \gset
select is(tests.outcome_service(tests.create_sql(:'admin', :'other', 'sa.newbie', 'waiter')), 'USERNAME_TAKEN', 'a taken username');
select is(tests.outcome_service(tests.create_sql(:'admin', :'other', 'sa.someone', 'waiter')), 'PROFILE_EMAIL_MISMATCH',
  'the login email must match the username');
select is(tests.outcome_service(tests.create_sql(:'admin', :'other', 'x', 'waiter')), 'USERNAME_INVALID', 'a bad username');
select is(tests.outcome_service(format($$ select public.staff_admin_create(%L, gen_random_uuid(), %L, 'sa.other', ' ', null, 'waiter') $$, :'admin', :'other')),
  'FULL_NAME_INVALID', 'a full name is required');
select is(tests.outcome_service(format($$ select public.staff_admin_create(%L, gen_random_uuid(), %L, 'sa.other', 'X', %L, 'waiter') $$, :'admin', :'other', repeat('1', 31))),
  'PHONE_INVALID', 'a phone over 30');
select is(tests.outcome_service(format($$ select public.staff_admin_create(%L, gen_random_uuid(), %L, 'sa.other', 'X', null, null) $$, :'admin', :'other')),
  'ROLE_REQUIRED', 'a role is required');

-- ===== Update =====
select tests.call_service(format($$ select public.staff_admin_update(%L, gen_random_uuid(), %L, 'Newbie Khan', null, 'cashier') $$,
  :'admin', :'newbie')) as upd \gset
select is(:'upd'::jsonb -> 'staff' ->> 'role', 'cashier', 'the role is changed');
select is(
  (select new_value from public.audit_log where action = 'staff.updated' and target_id = :'newbie'),
  '{"full_name": "Newbie Khan", "phone": null, "role": "cashier"}'::jsonb, 'staff.updated lists the changed values');
select is(tests.outcome_service(format($$ select public.staff_admin_update(%L, gen_random_uuid(), %L, 'Me', null, 'cashier') $$, :'admin', :'admin')),
  'CANNOT_CHANGE_SELF', 'an Admin cannot demote their own account');
select is(tests.outcome_service(format($$ select public.staff_admin_update(%L, gen_random_uuid(), %L, 'Me Too', '1', 'admin') $$, :'admin', :'admin')),
  'ok', 'but can edit their own name and phone');
select is(tests.outcome_service(format($$ select public.staff_admin_update(%L, gen_random_uuid(), gen_random_uuid(), 'X', null, 'waiter') $$, :'admin')),
  'STAFF_NOT_FOUND', 'an unknown account');
select is(tests.outcome_service(format($$ select public.staff_admin_update(%L, gen_random_uuid(), %L, 'Second', null, 'waiter') $$, :'admin', :'admin2')),
  'ok', 'another Admin can be demoted while an Admin is left');

-- ===== Last Admin =====
-- Through the functions the actor is always another active Admin, so the guard fires when two
-- Admins demote or deactivate each other at the same moment: the row locks serialise them and
-- the second sees one Admin left. Here the guard itself:
select is(tests.outcome_service(format($$ select private.check_not_last_admin(%L) $$, :'admin')),
  'PERMISSION_DENIED', 'the guard is internal');
update public.profiles set is_active = false where role = 'admin' and id <> :'admin';
select throws_ok(format($$ select private.check_not_last_admin(%L) $$, :'admin'), 'P0001', 'LAST_ADMIN',
  'the only active Admin cannot be demoted or deactivated');
update public.profiles set is_active = true where id = :'admin2';
select lives_ok(format($$ select private.check_not_last_admin(%L) $$, :'admin'), 'with a second active Admin it can');

-- ===== Deactivate and reactivate =====
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'newbie'), (gen_random_uuid(), :'newbie');
select is(tests.outcome_service(tests.active_sql(:'admin', :'newbie', false, ' ')), 'REASON_REQUIRED', 'a reason is required');
select is(tests.outcome_service(tests.active_sql(:'admin', :'admin', false, 'Leaving')), 'CANNOT_CHANGE_SELF',
  'an Admin cannot deactivate their own account');
select gen_random_uuid() as req_off \gset
select tests.call_service(tests.active_sql(:'admin', :'newbie', false, 'Left the job', :'req_off')) as off \gset
select is(:'off'::jsonb -> 'staff' ->> 'is_active', 'false', 'the account is deactivated');
select is((:'off'::jsonb ->> 'sessions_revoked')::int, 2, 'and both sessions are revoked');
select is((select count(*)::int from auth.sessions where user_id = :'newbie'), 0, 'no session is left');
select tests.login_as(:'newbie');
select is(public.my_role(), null, 'the deactivated user is refused at the next request (my_role NULL)');
select tests.logout();
select is(
  (select reason from public.audit_log where action = 'staff.deactivated' and target_id = :'newbie' and user_id = :'admin'),
  'Left the job', 'staff.deactivated is in the audit log with the reason');
select is(tests.call_service(tests.active_sql(:'admin', :'newbie', false, 'Left the job', :'req_off')) ->> 'replayed', 'true',
  'a retry is a replay');
select is(tests.outcome_service(tests.active_sql(:'admin', :'newbie', true, 'x', :'req_off')), 'REQUEST_ID_CONFLICT',
  'the same request id the other way is a conflict');
select tests.call_service(tests.active_sql(:'admin', :'newbie', true, null)) as back_on \gset
select is(:'back_on'::jsonb -> 'staff' ->> 'is_active', 'true', 'the account is reactivated');
select is((select count(*)::int from public.audit_log where action = 'staff.reactivated' and target_id = :'newbie'), 1,
  'staff.reactivated is in the audit log');

-- ===== Password reset =====
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'newbie');
select tests.call_service(format($$ select public.staff_admin_password_reset(%L, gen_random_uuid(), %L) $$, :'admin', :'newbie')) as reset \gset
select is((:'reset'::jsonb ->> 'sessions_revoked')::int, 1, 'a password reset revokes the sessions');
select is((select count(*)::int from public.audit_log where action = 'staff.password_reset' and target_id = :'newbie'), 1,
  'staff.password_reset is in the audit log');
select is(tests.outcome_service(format($$ select public.staff_admin_password_reset(%L, gen_random_uuid(), %L) $$, :'admin', :'admin')),
  'CANNOT_CHANGE_SELF', 'an Admin cannot reset their own password here');
select is(tests.outcome_service(format($$ select public.staff_admin_password_reset(%L, gen_random_uuid(), %L) $$, :'admin', :'former')),
  'STAFF_INACTIVE', 'nor the password of a deactivated account');

select * from finish();
rollback;
