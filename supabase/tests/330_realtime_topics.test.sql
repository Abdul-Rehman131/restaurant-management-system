-- Realtime topics (S1, M8): who may receive which private topic (my_role(), never the JWT
-- claim), what the order, batch, table and menu triggers send, and that payloads carry ids
-- only (G6). Realtime authorises a join with SELECT on realtime.messages where
-- realtime.topic() is the topic; tests.can_receive runs that same check.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(56);

select tests.create_staff('rt2.admin', 'admin') as admin \gset
select tests.create_staff('rt2.cashier', 'cashier') as cashier \gset
select tests.create_staff('rt2.waiter', 'waiter') as waiter \gset
select tests.create_staff('rt2.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('rt2.chef', 'chef') as chef \gset
select tests.create_staff('rt2.rider', 'rider') as rider \gset
select tests.create_staff('rt2.former', 'admin') as former \gset
update public.profiles set is_active = false where id = :'former';

-- True when p_user (NULL: anon) may receive messages on p_topic.
create function tests.can_receive(p_user uuid, p_topic text) returns boolean language plpgsql as $$
declare
  v_count integer;
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values (p_topic, 'broadcast', 'probe', '{}', true);
  if p_user is null then perform tests.login_as_anon(); else perform tests.login_as(p_user); end if;
  perform set_config('realtime.topic', p_topic, true);
  select count(*)::integer into v_count from realtime.messages where topic = p_topic;
  perform tests.logout();
  return v_count > 0;
end;
$$;

-- ===== Policies =====
select policies_are(
  'realtime', 'messages',
  array['staff_heartbeat_receive', 'staff_kitchen_receive', 'staff_menu_receive', 'staff_orders_receive',
        'staff_tables_receive', 'staff_waiter_receive'],
  'realtime.messages has exactly the receive policies from our migrations'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd <> 'SELECT'), 0,
  'no INSERT, UPDATE or DELETE policy: clients cannot broadcast'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
     and policyname like 'staff_%' and qual not like '%my_role()%'), 0,
  'every staff topic is decided by public.my_role()'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
     and (qual ilike '%jwt%' or qual like '%''app_role''%')), 0,  -- (::app_role is the enum type, not the claim)
  'no policy reads the JWT or its app_role claim'
);

-- ===== Who may receive what (spec 7.3) =====
select is(tests.can_receive(r.uid, r.topic), r.expected, format('%s on %s: %s', r.who, r.topic, case when r.expected then 'yes' else 'no' end))
  from (values
    ('admin', :'admin'::uuid, 'staff:orders', true),
    ('cashier', :'cashier'::uuid, 'staff:orders', true),
    ('waiter', :'waiter'::uuid, 'staff:orders', false),
    ('chef', :'chef'::uuid, 'staff:orders', false),
    ('rider', :'rider'::uuid, 'staff:orders', false),
    ('admin', :'admin'::uuid, 'staff:kitchen', true),
    ('cashier', :'cashier'::uuid, 'staff:kitchen', true),
    ('chef', :'chef'::uuid, 'staff:kitchen', true),
    ('waiter', :'waiter'::uuid, 'staff:kitchen', false),
    ('rider', :'rider'::uuid, 'staff:kitchen', false),
    ('admin', :'admin'::uuid, 'staff:tables', true),
    ('cashier', :'cashier'::uuid, 'staff:tables', true),
    ('waiter', :'waiter'::uuid, 'staff:tables', true),
    ('chef', :'chef'::uuid, 'staff:tables', false),
    ('rider', :'rider'::uuid, 'staff:tables', false),
    ('admin', :'admin'::uuid, 'staff:menu', true),
    ('cashier', :'cashier'::uuid, 'staff:menu', true),
    ('waiter', :'waiter'::uuid, 'staff:menu', true),
    ('chef', :'chef'::uuid, 'staff:menu', true),
    ('rider', :'rider'::uuid, 'staff:menu', false),
    ('waiter (own topic)', :'waiter'::uuid, 'staff:waiter:' || :'waiter', true),
    ('another waiter', :'waiter2'::uuid, 'staff:waiter:' || :'waiter', false),
    ('admin', :'admin'::uuid, 'staff:waiter:' || :'waiter', false),
    ('cashier', :'cashier'::uuid, 'staff:waiter:' || :'waiter', false),
    ('chef', :'chef'::uuid, 'staff:waiter:' || :'waiter', false),
    ('deactivated admin', :'former'::uuid, 'staff:orders', false),
    ('deactivated admin', :'former'::uuid, 'staff:kitchen', false),
    ('deactivated admin', :'former'::uuid, 'staff:tables', false),
    ('deactivated admin', :'former'::uuid, 'staff:menu', false),
    ('anon', null::uuid, 'staff:orders', false),
    ('anon', null::uuid, 'staff:kitchen', false),
    ('anon', null::uuid, 'staff:tables', false),
    ('anon', null::uuid, 'staff:menu', false),
    ('anon', null::uuid, 'staff:waiter:' || :'waiter', false),
    ('no staff profile', gen_random_uuid(), 'staff:orders', false)
  ) as r(who, uid, topic, expected);

-- A deactivated waiter loses the own topic at once, whatever the token says.
update public.profiles set is_active = false where id = :'waiter2';
select is(tests.can_receive(:'waiter2', 'staff:waiter:' || :'waiter2'), false, 'a deactivated waiter cannot receive own orders');
insert into realtime.messages (topic, extension, event, payload, private) values ('staff:orders', 'broadcast', 'probe', '{}', true);
select set_config('request.jwt.claims', json_build_object('sub', :'former', 'role', 'authenticated', 'app_role', 'admin')::text, true);
set local role authenticated;
select set_config('realtime.topic', 'staff:orders', true);
select is((select count(*)::int from realtime.messages where topic = 'staff:orders'), 0,
  'a stale app_role = admin claim of a deactivated user grants nothing');
select tests.logout();
update public.profiles set is_active = true where id = :'waiter2';

-- Clients cannot send.
select tests.login_as(:'cashier');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, event, payload, private) values ('staff:orders', 'broadcast', 'x', '{}', true) $$,
  '42501', null, 'a cashier cannot broadcast on staff:orders'
);
select tests.logout();

-- ===== What the triggers send =====
-- Messages per topic and event (the table is cleared before each step).
create function tests.sent(p_topic text, p_event text) returns bigint language sql as $$
  select count(*) from realtime.messages where topic = p_topic and event = p_event
$$;
delete from realtime.messages where event <> 'probe';  -- (owner, inside the rolled-back test)

select tests.create_table(931) as t1 \gset
select tests.create_table(932) as t2 \gset
select tests.create_item('RT Tikka', 60000) as tikka \gset
select is(tests.sent('staff:tables', 'table_changed'), 2::bigint, 'creating tables tells staff:tables');
select is(tests.sent('staff:menu', 'menu_changed') >= 2, true, 'creating a category and an item tells staff:menu');

delete from realtime.messages;
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset
select ok(tests.sent('staff:orders', 'order_changed') > 0, 'a new order tells the cashier (staff:orders)');
select ok(tests.sent('staff:kitchen', 'batch_changed') > 0, 'and the kitchen gets the new batch (staff:kitchen)');
select ok(tests.sent('staff:waiter:' || :'waiter', 'order_changed') > 0, 'and the owning waiter');
select is(tests.sent('staff:waiter:' || :'waiter2', 'order_changed'), 0::bigint, 'but not another waiter');
select ok(tests.sent('staff:tables', 'table_changed') > 0, 'the table turning Occupied tells staff:tables');

-- Ready alert (spec 6.1 step 4): the batch change reaches the waiter.
select id as b1 from public.order_batches where order_id = :'o1' \gset
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'preparing') $$, :'b1')) as x \gset
delete from realtime.messages;
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'ready') $$, :'b1')) as x \gset
select ok(tests.sent('staff:waiter:' || :'waiter', 'batch_changed') > 0, 'Ready reaches the owning waiter (batch_changed)');
select ok(tests.sent('staff:waiter:' || :'waiter', 'order_changed') > 0, 'with the order status change');
select is(
  (select payload - 'id' from realtime.messages where topic = 'staff:waiter:' || :'waiter' and event = 'batch_changed' limit 1),
  jsonb_build_object('order_id', :'o1'::uuid, 'batch_id', :'b1'::uuid),
  'the batch payload is just the order and batch ids'
);

-- Sold Out (BR-13).
delete from realtime.messages;
select tests.call_as(:'chef', format($$ select public.set_item_availability(gen_random_uuid(), %L, false) $$, :'tikka')) as x \gset
select is(
  (select payload - 'id' from realtime.messages where topic = 'staff:menu' and event = 'menu_changed'),
  jsonb_build_object('menu_item_id', :'tikka'::uuid),
  'Sold Out tells every ordering screen, with the item id only'
);

-- Handover: the old waiter is told too.
delete from realtime.messages;
select tests.call_as(:'cashier', format($$ select public.move_order_table(gen_random_uuid(), %L, %L, %L) $$, :'o1', :'t2', :'waiter2')) as x \gset
select ok(tests.sent('staff:waiter:' || :'waiter', 'order_changed') > 0, 'a handover tells the old waiter');
select ok(tests.sent('staff:waiter:' || :'waiter2', 'order_changed') > 0, 'and the new waiter');

-- ===== Payloads carry ids only (G6) =====
select tests.call_as(:'admin', format($$ select public.apply_discount(gen_random_uuid(), %L, 1000, 'x') $$, :'o1')) as x \gset
select tests.call_as(:'cashier', format($$ select public.remove_or_cancel_item(gen_random_uuid(), %L, 'x') $$,
  (select id from public.order_items where order_id = :'o1'))) as x \gset
select is(
  (select coalesce(array_agg(distinct k order by k), '{}') from realtime.messages m, jsonb_object_keys(m.payload) k
    where m.event <> 'probe'
      and k not in ('id', 'order_id', 'batch_id', 'table_id', 'menu_item_id', 'category_id')),
  '{}'::text[],
  'every payload holds ids only (no names, prices or totals)'
);

select * from finish();
rollback;
