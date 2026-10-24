-- create_order (T6): totals fixtures, numbering and business day, idempotency, rules and
-- permissions. Demo rates for every expected value: tax 16% (1600 bps), service charge 5%
-- (500 bps), service charge on Dine-In only, prices exclusive of tax (G7 defaults).
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(42);

update public.settings set tax_bps = 1600, service_charge_bps = 500;

select tests.create_staff('co.waiter', 'waiter') as waiter \gset
select tests.create_staff('co.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('co.cashier', 'cashier') as cashier \gset
select tests.create_staff('co.chef', 'chef') as chef \gset
select tests.create_staff('co.rider', 'rider') as rider \gset

select tests.create_table(501) as t1 \gset
select tests.create_table(502) as t2 \gset
select tests.create_table(503) as t3 \gset
update public.restaurant_tables set is_active = false where id = :'t3';

select tests.create_item('CO Tikka', 60000) as tikka \gset
select tests.create_item('CO Naan', 30000) as naan \gset
select tests.create_item('CO Water', 8000, false) as water \gset
select tests.create_item('CO Sold Out', 40000) as sold_out \gset
select tests.create_item('CO Archived', 40000) as archived \gset
update public.menu_items set is_available = false where id = :'sold_out';
update public.menu_items set is_active = false where id = :'archived';

select private.business_date(now()) as bd, to_char(private.business_date(now()), 'YYYYMMDD') as bd_compact \gset
select gen_random_uuid() as req1 \gset

-- ===== A Dine-In order by a waiter =====
select tests.login_as(:'waiter');
select public.create_order(
  :'req1', 'dine_in', :'t1', null, null,
  jsonb_build_array(tests.line(:'tikka', 2), tests.line(:'naan', 1, 'extra crisp'))
) as r1 \gset
select tests.logout();
select (:'r1'::jsonb ->> 'order_id') as o1 \gset

select is(:'r1'::jsonb ->> 'status', 'accepted', 'a staff order starts Accepted');
select is(:'r1'::jsonb ->> 'order_number', 'ORD-' || :'bd_compact' || '-001', 'the first order of the business day is 001 (BR-03)');
select is((select business_date from public.orders where id = :'o1'), :'bd'::date, 'business_date comes from private.business_date (BR-04)');
-- 2 x 600 + 1 x 300 = 1,500; service 5% = 75; tax 16% = 240; total 1,815
select results_eq(
  format($$ select subtotal, discount, service_charge, tax, total from public.orders where id = %L $$, :'o1'),
  $$ values (150000::bigint, 0::bigint, 7500::bigint, 24000::bigint, 181500::bigint) $$,
  'totals match the hand-calculated fixture (Rs 1,500 -> Rs 1,815)'
);
select results_eq(
  format($$ select (r ->> 'total')::bigint from (select %L::jsonb as r) s $$, :'r1'),
  $$ values (181500::bigint) $$,
  'the function returns the same total it stored'
);
select results_eq(
  format($$ select name_snapshot, price_snapshot, cost_snapshot, quantity, notes, needs_kitchen, batch_no
            from public.order_items where order_id = %L order by price_snapshot desc $$, :'o1'),
  $$ values ('CO Tikka'::text, 60000::bigint, 30000::bigint, 2::smallint, null::text, true, 1::smallint),
            ('CO Naan'::text, 30000::bigint, 15000::bigint, 1::smallint, 'extra crisp'::text, true, 1::smallint) $$,
  'lines store name, price and cost snapshots, quantity, notes and batch 1 (BR-02)'
);
select results_eq(
  format($$ select waiter_id, created_by, request_id from public.orders where id = %L $$, :'o1'),
  format($$ values (%L::uuid, %L::uuid, %L::uuid) $$, :'waiter', :'waiter', :'req1'),
  'the waiter owns the order, and the request id is stored'
);
select is((select status::text from public.order_batches where order_id = :'o1'), 'sent', 'batch 1 is sent to the kitchen');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'occupied', 'the table becomes Occupied');
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.order_status_history where order_id = %L $$, :'o1'),
  format($$ values (null::text, 'accepted'::text, %L::uuid) $$, :'waiter'),
  'status history records the creation by the waiter'
);

-- BR-02: a later menu price change never changes the order
update public.menu_items set price = 99999 where id = :'tikka';
select is(
  (select total from private.calc_order_totals(:'o1')),
  181500::bigint,
  'after a menu price change, recalculation still uses the snapshots (BR-02)'
);
update public.menu_items set price = 60000 where id = :'tikka';

-- ===== Idempotency (BR-15) =====
select tests.login_as(:'waiter');
select public.create_order(
  :'req1', 'dine_in', :'t1', null, null, jsonb_build_array(tests.line(:'tikka', 2))
) as r1_again \gset
select tests.logout();
select is(:'r1_again'::jsonb ->> 'order_id', :'o1', 'the same request id returns the same order');
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'the repeat is reported as a replay');
select is((select count(*)::int from public.orders where request_id = :'req1'), 1, 'only one order exists for the request id');

select tests.login_as(:'waiter2');
select throws_ok(
  format($$ select public.create_order(%L, 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'req1', :'t2', :'tikka'),
  'P0001', 'REQUEST_ID_CONFLICT', 'another user cannot reuse a request id'
);
select tests.logout();
select tests.login_as(:'waiter');

-- ===== Rules =====
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t1', :'tikka'),
  'P0001', 'TABLE_HAS_OPEN_ORDER', 'a second order on an open table is rejected (BR-05)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null,
            jsonb_build_array(tests.line(%L) || '{"price": 1}'::jsonb)) $$, :'t2', :'tikka'),
  'P0001', 'ITEM_FIELD_NOT_ALLOWED', 'a client-supplied price is rejected (BR-01)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'sold_out'),
  'P0001', 'ITEM_UNAVAILABLE', 'a sold-out item is rejected (BR-13)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'archived'),
  'P0001', 'ITEM_UNAVAILABLE', 'an archived item is rejected (BR-14)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(gen_random_uuid()))) $$, :'t2'),
  'P0001', 'ITEM_UNAVAILABLE', 'an unknown menu item is rejected'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 0))) $$, :'t2', :'tikka'),
  'P0001', 'QUANTITY_INVALID', 'quantity 0 is rejected'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L, 100))) $$, :'t2', :'tikka'),
  'P0001', 'QUANTITY_INVALID', 'quantity 100 is rejected'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null,
            jsonb_build_array(jsonb_build_object('menu_item_id', %L, 'quantity', 1.5))) $$, :'t2', :'tikka'),
  'P0001', 'QUANTITY_INVALID', 'a fractional quantity is rejected'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null,
            jsonb_build_array(jsonb_build_object('menu_item_id', %L))) $$, :'t2', :'tikka'),
  'P0001', 'QUANTITY_INVALID', 'a missing quantity is rejected (NULL-safe check)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, '[]'::jsonb) $$, :'t2'),
  'P0001', 'ITEMS_REQUIRED', 'an order needs at least one item'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', null, null, null, jsonb_build_array(tests.line(%L))) $$, :'tikka'),
  'P0001', 'TABLE_REQUIRED', 'a Dine-In order needs a table'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t3', :'tikka'),
  'P0001', 'TABLE_NOT_FOUND', 'an archived table cannot take orders'
);

-- Drinks only: no kitchen batch work, Ready at once (BR-07, BR-08)
select public.create_order(gen_random_uuid(), 'dine_in', :'t2', null, null,
  jsonb_build_array(tests.line(:'water', 1))) as r2 \gset
select tests.logout();
select (:'r2'::jsonb ->> 'order_id') as o2 \gset
select is(:'r2'::jsonb ->> 'order_number', 'ORD-' || :'bd_compact' || '-002', 'the next order is 002; replays and failures used no number');
select is(:'r2'::jsonb ->> 'status', 'ready', 'a drinks-only order is Ready immediately (BR-08)');
select results_eq(
  format($$ select status::text, ready_at is not null from public.order_batches where order_id = %L $$, :'o2'),
  $$ values ('ready'::text, true) $$,
  'its batch is Ready, so it never waits in the kitchen queue (BR-07)'
);
select results_eq(
  format($$ select to_status::text, changed_by is null from public.order_status_history where order_id = %L order by id $$, :'o2'),
  $$ values ('accepted'::text, false), ('ready'::text, true) $$,
  'history: Accepted by the waiter, then Ready by the system'
);

-- ===== Take Away at the counter =====
select tests.login_as(:'cashier');
select public.create_order(gen_random_uuid(), 'take_away', null, ' Test Customer ', '+00 000',
  jsonb_build_array(tests.line(:'tikka', 1))) as r3 \gset
-- 600, no service charge on Take Away, tax 16% = 96, total 696
select results_eq(
  format($$ select (r ->> 'service_charge')::bigint, (r ->> 'tax')::bigint, (r ->> 'total')::bigint from (select %L::jsonb as r) s $$, :'r3'),
  $$ values (0::bigint, 9600::bigint, 69600::bigint) $$,
  'Take Away: no service charge, tax 16% (Rs 600 -> Rs 696)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'take_away', %L, 'X', null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'tikka'),
  'P0001', 'TABLE_NOT_ALLOWED', 'a Take Away order cannot have a table'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'take_away', null, '  ', null, jsonb_build_array(tests.line(%L))) $$, :'tikka'),
  'P0001', 'CUSTOMER_NAME_REQUIRED', 'a Take Away order needs the customer name (spec 6.2)'
);
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'delivery', null, 'X', null, jsonb_build_array(tests.line(%L))) $$, :'tikka'),
  'P0001', 'ORDER_TYPE_NOT_SUPPORTED', 'delivery orders are not available before P3'
);
select tests.logout();
select results_eq(
  format($$ select customer_name, waiter_id, table_id from public.orders where id = %L $$, :'r3'::jsonb ->> 'order_id'),
  $$ values ('Test Customer'::text, null::uuid, null::uuid) $$,
  'Take Away stores the trimmed customer name and has no waiter or table'
);

-- ===== Permissions =====
select tests.login_as(:'waiter');
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'take_away', null, 'X', null, jsonb_build_array(tests.line(%L))) $$, :'tikka'),
  '42501', 'NOT_AUTHORIZED', 'a waiter cannot create a Take Away order'
);
select is(
  (select count(*)::int from public.orders),
  2,
  'the waiter sees their own two orders through RLS, not the counter order'
);
select tests.logout();

select tests.login_as(:'chef');
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'tikka'),
  '42501', 'NOT_AUTHORIZED', 'a chef cannot create orders'
);
select tests.logout();
select tests.login_as(:'rider');
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'take_away', null, 'X', null, jsonb_build_array(tests.line(%L))) $$, :'tikka'),
  '42501', 'NOT_AUTHORIZED', 'a rider cannot create orders'
);
select tests.logout();

update public.profiles set is_active = false where id = :'waiter2';
select tests.login_as(:'waiter2');
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'tikka'),
  '42501', 'NOT_AUTHORIZED', 'a deactivated waiter is refused on the next request'
);
select tests.logout();

select tests.login_as_anon();
select throws_ok(
  format($$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t2', :'tikka'),
  '42501', null, 'anon cannot call create_order'
);
select tests.logout();

select * from finish();
rollback;
