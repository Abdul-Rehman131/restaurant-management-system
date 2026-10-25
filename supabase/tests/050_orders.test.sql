-- Order core: constraints and indexes behind BR-05, BR-12, BR-15, BR-10 and line limits.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(24);

select tests.create_table(801) as t1 \gset
select tests.create_table(802) as t2 \gset
select tests.create_item('Test Tikka', 60000) as kebab \gset
select tests.create_order('dine_in', :'t1', 1) as o1 \gset

-- BR-05: one open order per table (partial unique index)
select has_index('public', 'orders', 'orders_one_open_per_table', 'BR-05 partial unique index exists');
select throws_ok(
  format($$ select tests.create_order('dine_in', %L, 2) $$, :'t1'),
  '23505', null, 'BR-05: a second open order on the same table is rejected'
);
select lives_ok(
  format($$ select tests.create_order('dine_in', %L, 3) $$, :'t2'),
  'BR-05: another table can have its own open order'
);
select lives_ok(
  format($$ update public.orders set status = 'cancelled', cancel_reason = 'Test', cancelled_at = now()
            where id = %L;
            select tests.create_order('dine_in', %L, 4) $$, :'o1', :'t1'),
  'BR-05: after the open order is closed, the table can take a new order'
);
select lives_ok(
  $$ select tests.create_order('take_away', null, 5); select tests.create_order('take_away', null, 6) $$,
  'BR-05 does not limit take-away orders (no table)'
);

-- BR-15: request_id is unique
select has_index('public', 'orders', 'orders_request_id_key', 'BR-15 unique index on request_id exists');
select throws_ok(
  format($$ insert into public.orders (order_number, business_date, type, request_id)
            select 'ORD-20261024-099', business_date, 'take_away', request_id
              from public.orders where id = %L $$, :'o1'),
  '23505', null, 'BR-15: a repeated request_id cannot create a second order'
);

-- Order shape
select throws_ok(
  $$ insert into public.orders (order_number, business_date, type, request_id)
     values ('ORD-20261024-098', date '2026-10-24', 'dine_in', gen_random_uuid()) $$,
  '23514', null, 'a Dine-In order needs a table'
);
select throws_ok(
  format($$ insert into public.orders (order_number, business_date, type, table_id, request_id)
            values ('ORD-20261024-097', date '2026-10-24', 'take_away', %L, gen_random_uuid()) $$, :'t2'),
  '23514', null, 'a Take Away order cannot have a table'
);
select throws_ok(
  $$ insert into public.orders (order_number, business_date, type, request_id)
     values ('ORDER-1', date '2026-10-24', 'take_away', gen_random_uuid()) $$,
  '23514', null, 'order numbers must match ORD-YYYYMMDD-NNN'
);
select throws_ok(
  $$ select tests.create_order('take_away', null, 5) $$,
  '23505', null, 'order numbers are unique'
);

-- Lifecycle guards
select throws_ok(
  format($$ update public.orders set status = 'completed' where id = %L $$, :'o1'),
  '23514', null, 'BR-12: an unpaid order cannot be Completed'
);
select throws_ok(
  $$ update public.orders set status = 'cancelled', cancelled_at = now()
      where order_number = 'ORD-20261024-005' $$,
  '23514', null, 'a cancellation needs a reason (NULL reason is rejected)'
);
select throws_ok(
  $$ update public.orders set subtotal = 1000, discount = 100 where order_number = 'ORD-20261024-005' $$,
  '23514', null, 'BR-10: a discount needs a reason'
);
select throws_ok(
  $$ update public.orders set subtotal = 1000, discount = 1001, discount_reason = 'Test'
      where order_number = 'ORD-20261024-005' $$,
  '23514', null, 'a discount cannot exceed the subtotal'
);
select throws_ok(
  $$ update public.orders set total = -1 where order_number = 'ORD-20261024-005' $$,
  '23514', null, 'money columns cannot be negative'
);

-- Order lines
select throws_ok(
  format($$ insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot,
              price_snapshot, needs_kitchen, quantity)
            values (%L, 1, %L, 'Test Tikka', 60000, true, 0) $$, :'o1', :'kebab'),
  '23514', null, 'quantity 0 is rejected'
);
select throws_ok(
  format($$ insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot,
              price_snapshot, needs_kitchen, quantity)
            values (%L, 1, %L, 'Test Tikka', 60000, true, 100) $$, :'o1', :'kebab'),
  '23514', null, 'quantity 100 is rejected'
);
select lives_ok(
  format($$ insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot,
              price_snapshot, needs_kitchen, quantity)
            values (%1$L, 1, %2$L, 'Test Tikka', 60000, true, 1),
                   (%1$L, 1, %2$L, 'Test Tikka', 60000, true, 99) $$, :'o1', :'kebab'),
  'quantities 1 and 99 are accepted'
);
select is(
  (select line_total from public.order_items where order_id = :'o1' and quantity = 99),
  5940000::bigint,
  'line_total is price snapshot x quantity, in minor units'
);
select throws_ok(
  format($$ insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot,
              price_snapshot, needs_kitchen, quantity)
            values (%L, 1, %L, 'Test Tikka', -1, true, 1) $$, :'o1', :'kebab'),
  '23514', null, 'a negative price snapshot is rejected'
);
select throws_ok(
  format($$ insert into public.order_items (order_id, batch_no, menu_item_id, name_snapshot,
              price_snapshot, needs_kitchen, quantity)
            values (%L, 7, %L, 'Test Tikka', 60000, true, 1) $$, :'o1', :'kebab'),
  '23503', null, 'a line must belong to an existing batch of its order'
);
select throws_ok(
  format($$ update public.order_items set is_cancelled = true, cancelled_at = now()
            where order_id = %L $$, :'o1'),
  '23514', null, 'BR-09: cancelling a sent line needs a reason (NULL reason is rejected)'
);

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.orders'::regclass, 'public.order_batches'::regclass,
                  'public.order_items'::regclass)),
  'RLS is enabled on orders, order_batches and order_items'
);

select * from finish();
rollback;
