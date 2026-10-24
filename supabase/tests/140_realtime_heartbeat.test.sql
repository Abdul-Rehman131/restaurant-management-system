-- Realtime authorization (T8): the private staff:heartbeat channel. Realtime lets a user join
-- a private topic when SELECT on realtime.messages, with realtime.topic() set to that topic,
-- is allowed by RLS. These tests run that same check for every role.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(17);

select tests.create_staff('rt.admin', 'admin') as admin \gset
select tests.create_staff('rt.cashier', 'cashier') as cashier \gset
select tests.create_staff('rt.waiter', 'waiter') as waiter \gset
select tests.create_staff('rt.chef', 'chef') as chef \gset
select tests.create_staff('rt.rider', 'rider') as rider \gset
select tests.create_staff('rt.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';

-- One message on the heartbeat topic and one on another private topic (as the owner, which
-- bypasses RLS). Realtime keeps a partition for today.
insert into realtime.messages (topic, extension, event, payload, private)
values ('staff:heartbeat', 'broadcast', 'beat', '{}', true),
       ('staff:other', 'broadcast', 'beat', '{}', true);

-- Rows the current session may receive on a topic, the way Realtime asks.
create function tests.visible_on(p_topic text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*)::integer into v_count from realtime.messages where topic = p_topic;
  return v_count;
end;
$$;
grant execute on function tests.visible_on(text) to authenticated, anon;

-- ===== The policy decides with my_role(), never the JWT claim =====
select policies_are(
  'realtime', 'messages', array['staff_heartbeat_receive'],
  'realtime.messages has exactly the policies from our migrations'
);
select policy_cmd_is(
  'realtime', 'messages', 'staff_heartbeat_receive', 'select',
  'the heartbeat policy is receive-only (SELECT)'
);
select policy_roles_are(
  'realtime', 'messages', 'staff_heartbeat_receive', array['authenticated'],
  'only signed-in users can be authorised'
);
select ok(
  (select qual like '%my_role()%' from pg_policies
    where schemaname = 'realtime' and policyname = 'staff_heartbeat_receive'),
  'the policy checks public.my_role()'
);
select ok(
  (select qual not like '%jwt%' and qual not like '%app_role%' from pg_policies
    where schemaname = 'realtime' and policyname = 'staff_heartbeat_receive'),
  'the policy never reads the JWT or its app_role claim'
);

-- ===== Every active staff role may join the heartbeat =====
select tests.login_as(:'admin');
select is(tests.visible_on('staff:heartbeat'), 1, 'admin may join staff:heartbeat');
select tests.logout();
select tests.login_as(:'cashier');
select is(tests.visible_on('staff:heartbeat'), 1, 'cashier may join staff:heartbeat');
select tests.logout();
select tests.login_as(:'waiter');
select is(tests.visible_on('staff:heartbeat'), 1, 'waiter may join staff:heartbeat');
select is(tests.visible_on('staff:other'), 0, 'the policy covers staff:heartbeat only, not other topics');
select tests.logout();
select tests.login_as(:'chef');
select is(tests.visible_on('staff:heartbeat'), 1, 'chef may join staff:heartbeat');
select tests.logout();
select tests.login_as(:'rider');
select is(tests.visible_on('staff:heartbeat'), 1, 'rider may join staff:heartbeat');
select tests.logout();

-- ===== Refused: deactivated staff, a forged claim, anon =====
select tests.login_as(:'former');
select is(tests.visible_on('staff:heartbeat'), 0, 'deactivated staff cannot join (my_role() is NULL)');
select tests.logout();

-- A deactivated user whose token still says app_role = admin (stale or forged claim).
select set_config('request.jwt.claims',
  json_build_object('sub', :'former', 'role', 'authenticated', 'app_role', 'admin')::text, true);
set local role authenticated;
select is(tests.visible_on('staff:heartbeat'), 0, 'an app_role claim does not grant access');
select tests.logout();

-- Signed in with no staff profile at all.
select tests.login_as(gen_random_uuid());
select is(tests.visible_on('staff:heartbeat'), 0, 'a user without a staff profile cannot join');
select tests.logout();

select tests.login_as_anon();
select is(tests.visible_on('staff:heartbeat'), 0, 'anon cannot join');
select tests.logout();

-- ===== Receive only: clients cannot broadcast =====
select tests.login_as(:'admin');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private)
     values ('staff:heartbeat', 'broadcast', 'beat', '{}', true) $$,
  '42501', null,
  'even an admin cannot send on the private channel (no INSERT policy)'
);
select tests.logout();
select tests.login_as_anon();
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private)
     values ('staff:heartbeat', 'broadcast', 'beat', '{}', true) $$,
  '42501', null,
  'anon cannot send on the private channel'
);
select tests.logout();

select * from finish();
rollback;
