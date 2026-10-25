-- Kitchen reads (S1): get_kitchen_queue shows one ticket per open batch with ADD-ON marker
-- (BR-06), never drinks (BR-07), never money fields (G6); get_menu_availability lists
-- Sold Out state without prices. Roles: Admin, Cashier, Chef.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(26);

select tests.create_staff('kq.admin', 'admin') as admin \gset
select tests.create_staff('kq.cashier', 'cashier') as cashier \gset
select tests.create_staff('kq.waiter', 'waiter') as waiter \gset
select tests.create_staff('kq.chef', 'chef') as chef \gset
select tests.create_staff('kq.rider', 'rider') as rider \gset
select tests.create_staff('kq.former', 'chef') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(977) as t1 \gset

-- Start from an empty kitchen: the local seed has no orders, but be explicit.
update public.order_batches set status = 'served' where status in ('sent', 'preparing');

select tests.create_item('KQ Tikka', 60000) as tikka \gset
select tests.create_item('KQ Naan', 30000) as naan \gset
select tests.create_item('KQ Cola', 15000, false) as cola \gset
-- Every key at any depth of a jsonb value.
create function tests.all_keys(p_value jsonb) returns text[] language sql immutable as $$
  with recursive walk(v) as (
    select p_value
    union all
    select e.value from walk, lateral (
      select value from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end)
      union all
      select value from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]' end)
    ) e
  )
  select coalesce(array_agg(distinct k order by k), '{}')
    from walk, lateral jsonb_object_keys(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end) k
$$;
create function tests.money_keys(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(tests.all_keys(p_value)) k
   where k ~ '(price|cost|total|subtotal|discount|tax|amount|charge|paid|tender|due)'
$$;

-- Dine-In: 2 tikka with a note and a cola; Take Away: 1 tikka.
select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null,
     jsonb_build_array(tests.line(%L, 2, 'less spicy'), tests.line(%L))) $$, :'t1', :'tikka', :'cola')) ->> 'order_id' as o1 \gset
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o2 \gset
-- Drinks only: never a kitchen ticket.
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest 2', null, jsonb_build_array(tests.line(%L))) $$,
  :'cola')) ->> 'order_id' as o3 \gset

select tests.call_as(:'chef', 'select public.get_kitchen_queue()') as q1 \gset

-- ===== Tickets =====
select is(jsonb_array_length(:'q1'::jsonb -> 'tickets'), 2, 'two tickets: the drinks-only order is not in the kitchen (BR-07)');
select is(:'q1'::jsonb #>> '{tickets,0,order_id}', :'o1', 'oldest first');
select is(:'q1'::jsonb #>> '{tickets,0,table_number}', '977', 'the ticket shows the table number');
select is(:'q1'::jsonb #>> '{tickets,1,table_number}', null, 'a Take Away ticket has no table');
select is(:'q1'::jsonb #>> '{tickets,0,is_addon}', 'false', 'batch 1 is not an add-on');
select is(jsonb_array_length(:'q1'::jsonb #> '{tickets,0,items}'), 1, 'only the kitchen line, not the cola (BR-07)');
select is((:'q1'::jsonb #> '{tickets,0,items,0}') - 'order_item_id'::text,
  '{"name": "KQ Tikka", "quantity": 2, "notes": "less spicy"}'::jsonb, 'a line shows name, quantity and notes');
select ok((:'q1'::jsonb ->> 'server_time') is not null, 'server time for the ticket age (G11)');

-- ===== No money anywhere (G6) =====
select is(tests.money_keys(:'q1'), '{}'::text[], 'no money field at any depth of the kitchen queue');
select is(
  tests.all_keys(:'q1'),
  array['batch_id', 'batch_no', 'is_addon', 'items', 'name', 'notes', 'order_id', 'order_item_id', 'order_number',
        'order_type', 'preparing_at', 'quantity', 'sent_at', 'server_time', 'status', 'table_number', 'tickets'],
  'the queue has exactly these keys'
);

-- ===== ADD-ON (BR-06) and the batch lifecycle =====
select id as b1 from public.order_batches where order_id = :'o1' and batch_no = 1 \gset
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'preparing') $$, :'b1')) as p1 \gset
select tests.call_as(:'chef', format($$ select public.set_batch_status(gen_random_uuid(), %L, 'ready') $$, :'b1')) as p2 \gset
select tests.call_as(:'waiter', format(
  $$ select public.add_items_to_order(gen_random_uuid(), %L, jsonb_build_array(tests.line(%L), tests.line(%L))) $$,
  :'o1', :'naan', :'cola')) as added \gset
select tests.call_as(:'chef', 'select public.get_kitchen_queue()') as q2 \gset
select is(
  (select count(*)::int from jsonb_array_elements(:'q2'::jsonb -> 'tickets') t where t ->> 'order_id' = :'o1'), 1,
  'the Ready batch left the queue; only the add-on remains for that order'
);
select is(
  (select t ->> 'is_addon' from jsonb_array_elements(:'q2'::jsonb -> 'tickets') t where t ->> 'order_id' = :'o1'), 'true',
  'the new batch is marked ADD-ON (BR-06)'
);
select is(
  (select t #>> '{items,0,name}' from jsonb_array_elements(:'q2'::jsonb -> 'tickets') t where t ->> 'order_id' = :'o1'), 'KQ Naan',
  'the add-on ticket shows only the new kitchen item'
);

-- Cancelled lines and cancelled orders drop out.
select tests.call_as(:'cashier', format($$ select public.cancel_order(gen_random_uuid(), %L, 'Customer left') $$, :'o2')) as c2 \gset
select tests.call_as(:'chef', 'select public.get_kitchen_queue()') as q3 \gset
select is(jsonb_array_length(:'q3'::jsonb -> 'tickets'), 1, 'a cancelled order leaves the queue');
select tests.call_as(:'cashier', format($$ select public.remove_or_cancel_item(gen_random_uuid(), %L, 'Out of dough') $$,
  (select id from public.order_items where order_id = :'o1' and menu_item_id = :'naan'))) as c3 \gset
select is(tests.call_as(:'chef', 'select public.get_kitchen_queue()') -> 'tickets', '[]'::jsonb,
  'an add-on whose kitchen line was cancelled leaves the queue (the cola never was in it)');

-- ===== Roles =====
select is(tests.outcome_as(:'admin', 'select public.get_kitchen_queue()'), 'ok', 'admin may read the queue');
select is(tests.outcome_as(:'cashier', 'select public.get_kitchen_queue()'), 'ok', 'cashier may read the queue');
select is(tests.outcome_as(:'waiter', 'select public.get_kitchen_queue()'), 'NOT_AUTHORIZED', 'waiter may not');
select is(tests.outcome_as(:'rider', 'select public.get_kitchen_queue()'), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', 'select public.get_kitchen_queue()'), 'NOT_AUTHORIZED', 'deactivated chef may not');
select is(tests.outcome_as(null, 'select public.get_kitchen_queue()'), 'PERMISSION_DENIED', 'anon may not');

-- ===== Sold Out list =====
update public.menu_items set is_available = false where id = :'naan';
select tests.call_as(:'chef', 'select public.get_menu_availability()') as m1 \gset
select is(
  (select i ->> 'is_available' from jsonb_array_elements(:'m1'::jsonb -> 'items') i where i ->> 'menu_item_id' = :'naan'), 'false',
  'the Sold Out list shows the item as Sold Out'
);
select is(tests.money_keys(:'m1'), '{}'::text[], 'no prices in the Sold Out list');
select is(
  tests.all_keys(:'m1'),
  array['category_id', 'category_name', 'is_available', 'items', 'menu_item_id', 'name', 'needs_kitchen'],
  'the list has exactly these keys'
);
select is(tests.outcome_as(:'cashier', 'select public.get_menu_availability()'), 'ok', 'cashier may read the list');
select is(tests.outcome_as(:'waiter', 'select public.get_menu_availability()'), 'NOT_AUTHORIZED', 'waiter reads the menu table instead');

select * from finish();
rollback;
