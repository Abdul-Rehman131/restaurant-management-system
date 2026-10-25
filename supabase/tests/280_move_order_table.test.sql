-- move_order_table (S1): move to a free table (BR-05, G13), hand over to another waiter
-- (Cashier and Admin only), rules, idempotency, roles.
begin;
create extension if not exists pgtap with schema extensions;
\ir helpers.psql

select plan(32);

select tests.create_staff('mv.admin', 'admin') as admin \gset
select tests.create_staff('mv.cashier', 'cashier') as cashier \gset
select tests.create_staff('mv.waiter', 'waiter') as waiter \gset
select tests.create_staff('mv.waiter2', 'waiter') as waiter2 \gset
select tests.create_staff('mv.chef', 'chef') as chef \gset
select tests.create_staff('mv.rider', 'rider') as rider \gset
select tests.create_staff('mv.former', 'waiter') as former \gset
update public.profiles set is_active = false where id = :'former';
select tests.create_table(991) as t1 \gset
select tests.create_table(992) as t2 \gset
select tests.create_table(993) as t3 \gset
select tests.create_table(994) as t4 \gset
update public.restaurant_tables set is_active = false where id = :'t4';
select tests.create_item('MV Tikka', 60000) as tikka \gset

create function tests.move(p_order uuid, p_table uuid, p_waiter uuid default null, p_request uuid default gen_random_uuid())
returns text language sql as $$
  select format($f$ select public.move_order_table(%L, %L, %L, %L) $f$, p_request, p_order, p_table, p_waiter)
$$;

select tests.call_as(:'waiter', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t1', :'tikka')) ->> 'order_id' as o1 \gset
select tests.call_as(:'waiter2', format(
  $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$,
  :'t3', :'tikka')) ->> 'order_id' as o3 \gset

-- ===== The waiter moves own order =====
select tests.call_as(:'waiter', format($$ select public.request_bill(gen_random_uuid(), %L) $$, :'o1')) as billed \gset
select gen_random_uuid() as req1 \gset
select tests.call_as(:'waiter', tests.move(:'o1', :'t2', null, :'req1')) as r1 \gset
select is(:'r1'::jsonb ->> 'table_id', :'t2', 'the order moves to the free table');
select is((select status::text from public.restaurant_tables where id = :'t1'), 'available', 'the old table becomes Available');
select is((select status::text from public.restaurant_tables where id = :'t2'), 'bill_requested',
  'the new table takes over the status (Bill Requested)');
select is(:'r1'::jsonb ->> 'waiter_id', :'waiter', 'the waiter keeps the order');
select is(
  tests.outcome_as(:'cashier', format(
    $$ select public.create_order(gen_random_uuid(), 'dine_in', %L, null, null, jsonb_build_array(tests.line(%L))) $$, :'t1', :'tikka')),
  'ok', 'the old table can take a new order'
);

-- Idempotency (BR-15)
select tests.call_as(:'waiter', tests.move(:'o1', :'t2', null, :'req1')) as r1_again \gset
select is(:'r1_again'::jsonb ->> 'replayed', 'true', 'a retry is a replay');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t1', null, :'req1')), 'REQUEST_ID_CONFLICT',
  'the same request id with another table is a conflict');

-- ===== Rules =====
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t3')), 'TABLE_HAS_OPEN_ORDER', 'the target table must be free (BR-05)');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t2')), 'TABLE_SAME', 'moving to the same table');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t4')), 'TABLE_NOT_FOUND', 'an archived table');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', gen_random_uuid())), 'TABLE_NOT_FOUND', 'an unknown table');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', null)), 'MOVE_NOTHING_TO_CHANGE', 'nothing to change');
select is(tests.outcome_as(:'waiter', tests.move(gen_random_uuid(), :'t1')), 'ORDER_NOT_FOUND', 'an unknown order');
select tests.call_as(:'cashier', format(
  $$ select public.create_order(gen_random_uuid(), 'take_away', null, 'Guest', null, jsonb_build_array(tests.line(%L))) $$,
  :'tikka')) ->> 'order_id' as o_ta \gset
select is(tests.outcome_as(:'cashier', tests.move(:'o_ta', :'t1')), 'MOVE_DINE_IN_ONLY', 'a Take Away order has no table');

-- ===== Handover to another waiter (Cashier and Admin) =====
select tests.call_as(:'cashier', tests.move(:'o1', null, :'waiter2')) as r2 \gset
select is(:'r2'::jsonb ->> 'waiter_id', :'waiter2', 'the cashier hands the order to another waiter');
select is(:'r2'::jsonb ->> 'table_id', :'t2', 'the table stays');
select tests.login_as(:'waiter2');
select is((select count(*)::int from public.orders where id = :'o1'), 1, 'the new waiter now sees the order');
select tests.logout();
select tests.login_as(:'waiter');
select is((select count(*)::int from public.orders where id = :'o1'), 0, 'the old waiter no longer does');
select tests.logout();
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t1')), 'NOT_AUTHORIZED', 'the old waiter can no longer move it');

select tests.call_as(:'admin', tests.move(:'o1', :'t1', :'waiter')) as r3 \gset
select results_eq(
  format($$ select table_id, waiter_id from public.orders where id = %L $$, :'o1'),
  format($$ values (%L::uuid, %L::uuid) $$, :'t1', :'waiter'),
  'the admin moves the table and the waiter in one call'
);
select is(tests.outcome_as(:'cashier', tests.move(:'o1', null, :'chef')), 'WAITER_INVALID', 'the new owner must be a waiter');
select is(tests.outcome_as(:'cashier', tests.move(:'o1', null, :'former')), 'WAITER_INVALID', 'and active');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', null, :'waiter2')), 'NOT_AUTHORIZED', 'a waiter cannot hand an order to another waiter');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t2', :'waiter')), 'ok', 'a waiter naming self is allowed (no change)');

-- ===== Roles =====
select is(tests.outcome_as(:'admin', tests.move(:'o1', :'t2')), 'ok', 'admin may move');
select is(tests.outcome_as(:'cashier', tests.move(:'o1', :'t2')), 'ok', 'cashier may move');
select is(tests.outcome_as(:'waiter', tests.move(:'o1', :'t2')), 'ok', 'the owning waiter may move');
select is(tests.outcome_as(:'waiter2', tests.move(:'o1', :'t2')), 'NOT_AUTHORIZED', 'another waiter may not');
select is(tests.outcome_as(:'chef', tests.move(:'o1', :'t2')), 'NOT_AUTHORIZED', 'chef may not');
select is(tests.outcome_as(:'rider', tests.move(:'o1', :'t2')), 'NOT_AUTHORIZED', 'rider may not');
select is(tests.outcome_as(:'former', tests.move(:'o1', :'t2')), 'NOT_AUTHORIZED', 'deactivated staff may not');
select is(tests.outcome_as(null, tests.move(:'o1', :'t2')), 'PERMISSION_DENIED', 'anon may not');

select * from finish();
rollback;
